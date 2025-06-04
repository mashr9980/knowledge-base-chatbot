import os
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User, UserRole
from app.models.document import Document
from app.schemas.user import User as UserSchema, UserUpdate
from app.schemas.document import Document as DocumentSchema, DocumentResponse, DocumentStatus
from app.core.dependencies import get_admin_user
from app.services.document_store import DocumentStore
from app.services.document_processor import queue_document_processing, get_document_processing_status
from app.utils.helpers import validate_file_extension, validate_file_size, get_file_type
from app.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Initialize document store
document_store = DocumentStore(settings.OUTPUT_FOLDER)

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
    admin_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """
    Upload and queue document for processing (admin only)
    This endpoint is now non-blocking and processes documents in background
    """
    logger.info(f"Admin {admin_user.username} uploading document: {file.filename}")
    
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
    
    # Save file immediately
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    temp_file_path = os.path.join(settings.UPLOAD_DIR, f"temp_{document_id}.{file_type}")
    
    try:
        with open(temp_file_path, "wb") as f:
            f.write(file_content)
        
        logger.info(f"File saved to: {temp_file_path}")
        
        # Create database record immediately
        document = Document(
            document_id=document_id,
            filename=f"{document_id}.{file_type}",
            original_filename=file.filename,
            file_path=temp_file_path,
            file_size=len(file_content),
            file_type=file_type,
            uploaded_by=admin_user.id,
            status="processing" 
        )
        
        db.add(document)
        db.commit()
        db.refresh(document)
        
        logger.info(f"Document record created in database: {document_id}")
        
        # Add to document store metadata (non-blocking)
        await document_store.add_document(document_id, file.filename)
        
        queue_document_processing(document_id, temp_file_path, priority=1)
        
        logger.info(f"Document {document_id} queued for processing")
        
        return {
            "document_id": document_id,
            "message": "Document uploaded successfully and queued for processing. Processing will continue in background."
        }
    
    except Exception as e:
        logger.error(f"Error uploading document: {str(e)}")
        # Cleanup on error
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except:
                pass
        
        # Rollback database changes
        db.rollback()
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error uploading document: {str(e)}"
        )

@router.get("/documents", response_model=List[DocumentSchema])
def get_all_documents(
    admin_user: User = Depends(get_admin_user),
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
    
    # Get processing status from background processor
    processing_status = get_document_processing_status(document_id)
    
    # Combine database status with processing status
    status_info = {
        "document_id": document_id,
        "status": document.status,
        "error": document.error_message,
        "created_at": document.created_at.isoformat(),
        "chunks_count": document.chunks_count
    }
    
    # Add processing queue information if available
    if processing_status:
        status_info.update({
            "processing_status": processing_status.get('status'),
            "worker": processing_status.get('worker'),
            "retry_count": processing_status.get('retry_count', 0)
        })
    
    return status_info

@router.get("/documents/{document_id}/processing-status")
def get_document_processing_details(
    document_id: str,
    admin_user: User = Depends(get_admin_user)
):
    """Get detailed processing status from background processor"""
    processing_status = get_document_processing_status(document_id)
    
    if not processing_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No processing information found for this document"
        )
    
    return processing_status

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
    
    try:
        # Delete from FAISS store
        document_store.delete_document(document_id)
        
        # Delete file from filesystem
        if os.path.exists(document.file_path):
            os.remove(document.file_path)
        
        # Delete from database
        db.delete(document)
        db.commit()
        
        logger.info(f"Document {document_id} deleted successfully by admin {admin_user.username}")
        
        return {"message": "Document deleted successfully"}
    
    except Exception as e:
        logger.error(f"Error deleting document {document_id}: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting document: {str(e)}"
        )

@router.get("/system/status")
def get_system_status(
    admin_user: User = Depends(get_admin_user)
):
    """Get system status and resource usage (admin only)"""
    from app.database import get_pool_status
    import psutil
    
    # Get database pool status
    pool_status = get_pool_status()
    
    # Get system resources
    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    
    return {
        "database_pool": pool_status,
        "system_resources": {
            "cpu_usage_percent": cpu_percent,
            "memory_usage_percent": memory.percent,
            "memory_available_gb": memory.available / (1024**3),
            "memory_total_gb": memory.total / (1024**3)
        },
        "configuration": {
            "web_workers": settings.WORKERS,
            "doc_processing_workers": settings.DOC_PROCESSING_WORKERS,
            "max_concurrent_connections": settings.MAX_CONCURRENT_CONNECTIONS
        }
    }