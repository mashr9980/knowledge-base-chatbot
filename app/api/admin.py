import os
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User, UserRole
from app.models.document import Document
from app.schemas.user import User as UserSchema, UserUpdate
from app.schemas.document import Document as DocumentSchema, DocumentResponse, DocumentStatus
from app.core.dependencies import get_admin_user
from app.services.document_store import DocumentStore
from app.utils.helpers import validate_file_extension, validate_file_size, get_file_type
from app.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

# Initialize document store
document_store = DocumentStore(settings.OUTPUT_FOLDER)

async def process_document_task(document_id: str, temp_pdf_path: str, db: Session):
    """Background task for document processing"""
    try:
        success = await document_store.process_document(document_id, temp_pdf_path, db)
        if not success:
            raise Exception("Document processing failed")
    except Exception as e:
        # Update database status
        db_document = db.query(Document).filter(Document.document_id == document_id).first()
        if db_document:
            db_document.status = "failed"
            db_document.error_message = str(e)
            db.commit()
    finally:
        # Cleanup temporary file
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

@router.get("/users", response_model=List[UserSchema])
def get_all_users(
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get all users (admin only)"""
    users = db.query(User).all()
    return users

@router.put("/users/{user_id}", response_model=UserSchema)
def update_user(
    user_id: int,
    user_update: UserUpdate,
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Update user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    for field, value in user_update.dict(exclude_unset=True).items():
        setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    return user

@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Delete user (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    if user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete admin user"
        )
    
    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}

@router.post("/documents/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Upload and process document (admin only)"""
    # Validate file
    if not validate_file_extension(file.filename, settings.ALLOWED_EXTENSIONS_LIST):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(settings.ALLOWED_EXTENSIONS_LIST)}"
        )
    
    file_content = await file.read()
    if not validate_file_size(len(file_content), settings.MAX_FILE_SIZE):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size too large. Maximum size: {settings.MAX_FILE_SIZE} bytes"
        )
    
    # Generate unique document ID
    document_id = str(uuid.uuid4())
    
    # Get actual file type from filename
    file_type = get_file_type(file.filename)
    
    # Save file with correct extension (not forcing PDF)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    temp_file_path = os.path.join(settings.UPLOAD_DIR, f"temp_{document_id}.{file_type}")
    
    with open(temp_file_path, "wb") as f:
        f.write(file_content)
    
    # Create database record
    document = Document(
        document_id=document_id,
        filename=f"{document_id}.{file_type}",
        original_filename=file.filename,
        file_path=temp_file_path,
        file_size=len(file_content),
        file_type=file_type,
        uploaded_by=admin_user.id
    )
    
    db.add(document)
    db.commit()
    db.refresh(document)
    
    # Add to document store
    await document_store.add_document(document_id, file.filename)
    
    # Process document in background
    background_tasks.add_task(process_document_task, document_id, temp_file_path, db)
    
    return {
        "document_id": document_id,
        "message": "Document upload initiated"
    }

@router.get("/documents", response_model=List[DocumentSchema])
def get_all_documents(
    # admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get all documents (admin only)"""
    documents = db.query(Document).order_by(Document.created_at.desc()).all()
    return documents

@router.get("/documents/{document_id}/status", response_model=DocumentStatus)
def get_document_status(
    document_id: str,
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get document processing status"""
    document = db.query(Document).filter(Document.document_id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    return {
        "document_id": document_id,
        "status": document.status,
        "error": document.error_message,
        "created_at": document.created_at.isoformat(),
        "chunks_count": document.chunks_count
    }

@router.delete("/documents/{document_id}")
def delete_document(
    document_id: str,
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Delete document (admin only)"""
    document = db.query(Document).filter(Document.document_id == document_id).first()
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    # Delete from FAISS store
    document_store.delete_document(document_id)
    
    # Delete file from filesystem
    if os.path.exists(document.file_path):
        os.remove(document.file_path)
    
    # Delete from database
    db.delete(document)
    db.commit()
    
    return {"message": "Document deleted successfully"}