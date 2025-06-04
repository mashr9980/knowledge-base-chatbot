from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.document import Document, DocumentStatus
from app.schemas.user import User as UserSchema
from app.services.document_store import DocumentStore
from app.core.dependencies import get_current_active_user
from app.config import settings

router = APIRouter(prefix="/users", tags=["users"])

document_store = DocumentStore(settings.OUTPUT_FOLDER)

@router.get("/me", response_model=UserSchema)
def get_current_user_profile(current_user: User = Depends(get_current_active_user)):
    """Get current user profile"""
    return UserSchema.from_orm(current_user)

@router.get("/knowledge-base/status")
def get_knowledge_base_status_for_user(
    current_user: User = Depends(get_current_active_user)
):
    """Get unified knowledge base status for users"""
    kb_status = document_store.get_knowledge_base_status()
    return {
        "status": "ready" if kb_status['total_chunks'] > 0 else "empty",
        "total_documents": kb_status['total_documents'],
        "total_chunks": kb_status['total_chunks'],
        "last_updated": kb_status['last_updated'],
        "message": "Knowledge base ready for chat" if kb_status['total_chunks'] > 0 else "Knowledge base is empty. Contact admin to add documents."
    }