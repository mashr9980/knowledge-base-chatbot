from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.document import Document, DocumentStatus
from app.schemas.user import User as UserSchema
from app.schemas.document import Document as DocumentSchema
from app.core.dependencies import get_current_active_user

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me", response_model=UserSchema)
def get_current_user_profile(current_user: User = Depends(get_current_active_user)):
    """Get current user profile"""
    return UserSchema.from_orm(current_user)

@router.get("/documents", response_model=List[DocumentSchema])
def get_user_available_documents(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get documents available for chat (user endpoint)"""
    documents = db.query(Document).filter(
        Document.status == DocumentStatus.COMPLETED,
        Document.chunks_count > 0
    ).order_by(Document.created_at.desc()).all()
    return documents