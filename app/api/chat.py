import json
import uuid
import asyncio
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.chat import ChatSession
from app.models.llm import LLMModel
from app.schemas.chat import (
    ChatSession as ChatSessionSchema,
    ChatMessage as ChatMessageSchema,
    ChatSessionCreate
)
from app.core.dependencies import get_current_active_user
from app.services.chat_service import ChatService
from app.services.document_store import DocumentStore
from app.core.security import verify_token
from app.utils.helpers import Timer
from app.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

document_store = DocumentStore(settings.OUTPUT_FOLDER)
llm_model = LLMModel()
active_connections = {}

@router.post("/sessions", response_model=ChatSessionSchema)
def create_chat_session(
    session_data: ChatSessionCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Create a new chat session"""
    chat_service = ChatService(db, document_store)
    session = chat_service.create_session(
        current_user.id, 
        session_data.document_id, 
        session_data.session_name
    )
    return ChatSessionSchema.from_orm(session)

@router.get("/sessions", response_model=List[ChatSessionSchema])
def get_user_sessions(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get all chat sessions for current user"""
    chat_service = ChatService(db, document_store)
    sessions = chat_service.get_user_sessions(current_user.id)
    return [ChatSessionSchema.from_orm(session) for session in sessions]

@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageSchema])
def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Get all messages for a chat session"""
    chat_service = ChatService(db, document_store)
    messages = chat_service.get_session_messages(session_id, current_user.id)
    return [ChatMessageSchema.from_orm(message) for message in messages]

@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db)
):
    """Delete a chat session"""
    session = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    db.delete(session)
    db.commit()
    return {"message": "Session deleted successfully"}

@router.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    await websocket.accept()
    
    username = verify_token(token)
    if not username:
        await websocket.send_text(json.dumps({
            "status": "error",
            "error": "Invalid token"
        }))
        await websocket.close()
        return
    
    db = next(get_db())
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.is_active:
            await websocket.send_text(json.dumps({
                "status": "error",
                "error": "User not found or inactive"
            }))
            await websocket.close()
            return
        
        document_id = None
        session_id = None
        is_initialized = False
        chat_history = []
        client_id = str(uuid.uuid4())
        
        chat_service = ChatService(db, document_store)
        
        try:
            logger.info("Waiting for initialization message...")
            
            try:
                init_data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                logger.info(f"Received init data: {init_data}")
                
                if not init_data or init_data.strip() == "":
                    await websocket.send_text(json.dumps({
                        "status": "error",
                        "error": "Empty initialization message received"
                    }))
                    return
                
                try:
                    init_message = json.loads(init_data)
                except json.JSONDecodeError as e:
                    logger.error(f"JSON decode error: {e}, received: {repr(init_data)}")
                    await websocket.send_text(json.dumps({
                        "status": "error",
                        "error": f"Invalid JSON in initialization message: {str(e)}"
                    }))
                    return
                
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": "Initialization timeout. Please send initialization message within 30 seconds."
                }))
                return
            
            document_id = init_message.get("document_id")
            session_id = init_message.get("session_id")
            
            if not document_id:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": "Missing document_id in initialization message."
                }))
                return
            
            logger.info(f"Initializing with document_id: {document_id}, session_id: {session_id}")
            
            if document_id not in active_connections:
                active_connections[document_id] = {}
            active_connections[document_id][client_id] = websocket
            
            faiss_status = document_store.get_document_status(document_id)
            if not faiss_status:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": "Document not found in vector store."
                }))
                return
            
            if faiss_status['status'] != "completed":
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": f"Document is not ready yet. Current status: {faiss_status['status']}"
                }))
                return
            
            if session_id:
                session = chat_service.get_session_by_id(session_id, user.id)
                if not session:
                    session = chat_service.create_session(user.id, document_id)
                    session_id = session.session_id
                    logger.info(f"Created new session as provided session_id not found: {session_id}")
            else:
                session = chat_service.create_session(user.id, document_id)
                session_id = session.session_id
                logger.info(f"Created new session: {session_id}")
            
            await websocket.send_text(json.dumps({
                "status": "initialized",
                "document_id": document_id,
                "session_id": session_id,
                "message": "Sage Assistant connected successfully. I'm ready to help you with questions about your document."
            }))
            is_initialized = True
            logger.info("Sage WebSocket initialized successfully")
            
            while True:
                try:
                    logger.info("Waiting for question...")
                    data = await websocket.receive_text()
                    logger.info(f"Received data: {data}")
                    
                    if not data or data.strip() == "":
                        await websocket.send_text(json.dumps({
                            "status": "error", 
                            "error": "Empty message received"
                        }))
                        continue
                    
                    try:
                        message_data = json.loads(data)
                        question = message_data.get("question", data)
                    except json.JSONDecodeError:
                        question = data.strip()
                    
                    if not question or not isinstance(question, str) or question.strip() == "":
                        await websocket.send_text(json.dumps({
                            "status": "error",
                            "error": "Invalid or empty question."
                        }))
                        continue
                    
                    logger.info(f"Processing question: {question}")
                    
                    with Timer() as timer:
                        context_chunks = await document_store.search(
                            document_id,
                            question,
                            k=settings.SIMILAR_DOCS_COUNT
                        )
                        
                        formatted_chat_history = ""
                        for entry in chat_history:
                            formatted_chat_history += f"User: {entry['question']}\nSage: {entry['answer']}\n\n"
                        
                        context_text = "\n\n".join(context_chunks) if context_chunks else "(No relevant content found in the document for your question)"
                        
                        system_prompt = (
                            "You are Sage Assistant - a helpful AI assistant designed to help users understand and navigate documents.\n\n"
                            
                            "Your role and responsibilities:\n"
                            "- You are a professional, knowledgeable, and helpful assistant\n"
                            "- Your primary function is to answer questions about the uploaded document\n"
                            "- You should be friendly, clear, and concise in your responses\n"
                            "- Always maintain a professional tone while being approachable\n\n"
                            
                            "IMPORTANT GUIDELINES:\n"
                            "1. DOCUMENT-ONLY RESPONSES: You must ONLY provide information that is contained within the uploaded document. Do not use external knowledge or make assumptions.\n\n"
                            
                            "2. WHEN INFORMATION IS NOT AVAILABLE: If the user asks about something that is not mentioned or explained in the document, you must clearly state:\n"
                            "   'I'm sorry, but this information is not provided in the uploaded document. Please refer to the document directly or contact the document author for clarification.'\n\n"
                            
                            "3. DOCUMENT CONTEXT USAGE: Use the provided document context to answer questions accurately. Quote relevant sections when helpful, but keep responses concise.\n\n"
                            
                            "4. CONVERSATION CONTINUITY: Use the chat history to maintain context and provide follow-up responses that build on previous interactions.\n\n"
                            
                            "5. RESPONSE FORMAT:\n"
                            "   - Start with a brief, friendly acknowledgment\n"
                            "   - Provide the answer based on document content\n"
                            "   - If information is not in the document, clearly state this\n"
                            "   - Keep responses focused and helpful\n\n"
                            
                            "6. SCOPE LIMITATIONS: Do not provide:\n"
                            "   - General advice not based on the document\n"
                            "   - External information or current events\n"
                            "   - Personal opinions or interpretations beyond what's stated in the document\n"
                            "   - Information from other sources\n\n"
                            
                            f"DOCUMENT CONTEXT:\n{context_text}\n\n"
                            f"PREVIOUS CONVERSATION:\n{formatted_chat_history}\n\n"
                            
                            "Please provide a helpful response based solely on the document content. If the information is not in the document, clearly state this limitation."
                        )
                        
                        messages = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": question}
                        ]
                        
                        async def token_callback(token):
                            try:
                                await websocket.send_text(json.dumps({
                                    "status": "streaming",
                                    "token": token
                                }))
                            except Exception as e:
                                logger.error(f"Error sending token: {e}")
                        
                        final_response = await llm_model.stream_chat(messages, token_callback)
                        
                        chat_history.append({
                            "question": question,
                            "answer": final_response
                        })
                        
                        if len(chat_history) > 10:
                            chat_history = chat_history[-10:]
                        
                        chat_service.save_message(
                            session.id, 
                            question, 
                            final_response, 
                            timer.interval * 1000,
                            False
                        )
                    
                    await websocket.send_text(json.dumps({
                        "status": "complete",
                        "answer": final_response,
                        "time": timer.interval,
                        "session_id": session_id
                    }))
                    
                    logger.info("Question processed successfully")
                
                except WebSocketDisconnect:
                    logger.info(f"WebSocket disconnected (initialized: {is_initialized})")
                    break
                except Exception as e:
                    logger.error(f"Error in WebSocket chat: {str(e)}")
                    try:
                        await websocket.send_text(json.dumps({
                            "status": "error",
                            "error": str(e)
                        }))
                    except:
                        logger.error("Failed to send error message to client")
        
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected before full initialization.")
        except Exception as e:
            logger.error(f"WebSocket startup error: {str(e)}")
            try:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": str(e)
                }))
            except:
                logger.error("Failed to send startup error to client")
        finally:
            if document_id and document_id in active_connections and client_id in active_connections[document_id]:
                del active_connections[document_id][client_id]
                if not active_connections[document_id]:
                    del active_connections[document_id]
    
    finally:
        db.close()

async def websocket_heartbeat():
    """Send periodic heartbeats to keep WebSocket connections alive"""
    while True:
        await asyncio.sleep(30)
        
        document_ids = list(active_connections.keys())
        
        for doc_id in document_ids:
            if doc_id in active_connections:
                client_ids = list(active_connections[doc_id].keys())
                
                for client_id in client_ids:
                    try:
                        if client_id in active_connections.get(doc_id, {}):
                            websocket = active_connections[doc_id][client_id]
                            await websocket.send_text(json.dumps({
                                "status": "heartbeat"
                            }))
                    except Exception as e:
                        logger.error(f"Error sending heartbeat: {str(e)}")
                        if doc_id in active_connections and client_id in active_connections[doc_id]:
                            del active_connections[doc_id][client_id]
                            if not active_connections[doc_id]:
                                del active_connections[doc_id]