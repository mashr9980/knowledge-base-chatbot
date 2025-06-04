import json
import uuid
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from app.models.chat import ChatSession, ChatMessage
from app.models.user import User
from app.services.document_store import DocumentStore
from app.config import settings

class ChatService:
    def __init__(self, db: Session, document_store: DocumentStore):
        self.db = db
        self.document_store = document_store
    
    def create_session(self, user_id: int, document_id: str = "unified_kb", session_name: str = "New Chat") -> ChatSession:
        """Create a new chat session for unified knowledge base"""
        session_id = str(uuid.uuid4())
        session = ChatSession(
            session_id=session_id,
            user_id=user_id,
            document_id=document_id,
            session_name=session_name
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session
    
    def get_user_sessions(self, user_id: int) -> List[ChatSession]:
        """Get all chat sessions for a user"""
        return self.db.query(ChatSession).filter(
            ChatSession.user_id == user_id
        ).order_by(ChatSession.updated_at.desc()).all()
    
    def get_session_messages(self, session_id: str, user_id: int) -> List[ChatMessage]:
        """Get all messages for a session"""
        session = self.db.query(ChatSession).filter(
            ChatSession.session_id == session_id,
            ChatSession.user_id == user_id
        ).first()
        
        if not session:
            return []
        
        return self.db.query(ChatMessage).filter(
            ChatMessage.session_id == session.id
        ).order_by(ChatMessage.created_at.asc()).all()
    
    def get_session_by_id(self, session_id: str, user_id: int) -> Optional[ChatSession]:
        """Get session by ID"""
        return self.db.query(ChatSession).filter(
            ChatSession.session_id == session_id,
            ChatSession.user_id == user_id
        ).first()
    
    def save_message(self, session_id: int, message: str, response: str, 
                    processing_time: int, used_latest_data: bool = False) -> ChatMessage:
        """Save chat message to database"""
        chat_message = ChatMessage(
            session_id=session_id,
            message=message,
            response=response,
            processing_time=processing_time,
            used_latest_data=used_latest_data
        )
        self.db.add(chat_message)
        self.db.commit()
        self.db.refresh(chat_message)
        return chat_message