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
    """Create a new chat session for unified knowledge base"""
    chat_service = ChatService(db, document_store)
    session = chat_service.create_session(
        current_user.id, 
        "unified_kb",
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

@router.get("/knowledge-base/status")
def get_knowledge_base_status():
    """Get unified knowledge base status"""
    return document_store.get_knowledge_base_status()

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
            
            session_id = init_message.get("session_id")
            
            logger.info(f"Initializing unified knowledge base chat, session_id: {session_id}")
            
            if "unified_kb" not in active_connections:
                active_connections["unified_kb"] = {}
            active_connections["unified_kb"][client_id] = websocket
            
            kb_status = document_store.get_knowledge_base_status()
            if kb_status['total_chunks'] == 0:
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "error": "Knowledge base is empty. Please contact admin to upload documents."
                }))
                return
            
            if session_id:
                session = chat_service.get_session_by_id(session_id, user.id)
                if not session:
                    session = chat_service.create_session(user.id, "unified_kb")
                    session_id = session.session_id
                    logger.info(f"Created new session as provided session_id not found: {session_id}")
            else:
                session = chat_service.create_session(user.id, "unified_kb")
                session_id = session.session_id
                logger.info(f"Created new session: {session_id}")
            
            await websocket.send_text(json.dumps({
                "status": "initialized",
                "session_id": session_id,
                "knowledge_base_status": kb_status,
                "message": "Sage Assistant connected successfully. I'm ready to help you with questions about our knowledge base."
            }))
            is_initialized = True
            logger.info("Sage WebSocket initialized successfully for unified knowledge base")
            
            while True:
                try:
                    logger.info("Waiting for question...")
                    data = await websocket.receive_text()
                    logger.info(f"Received data: {data}")
                    
                    if not data or data.strip() == "":
                        if websocket.client_state.name == 'CONNECTED':
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
                        if websocket.client_state.name == 'CONNECTED':
                            await websocket.send_text(json.dumps({
                                "status": "error",
                                "error": "Invalid or empty question."
                            }))
                        continue
                    
                    logger.info(f"Processing question: {question}")
                    
                    with Timer() as timer:
                        context_chunks = await document_store.search(
                            question,
                            k=settings.SIMILAR_DOCS_COUNT
                        )
                        
                        formatted_chat_history = ""
                        for entry in chat_history:
                            formatted_chat_history += f"User: {entry['question']}\nSage: {entry['answer']}\n\n"
                        
                        context_text = "\n\n".join(context_chunks) if context_chunks else "(No relevant content found in the knowledge base for your question)"
                        
                        system_prompt = (
                            "You are a Document-Based Assistant. Your primary and ONLY function is to provide information "
                            "exclusively from the uploaded documents provided to you. You are strictly forbidden from using "
                            "any external knowledge, training data, or general information not contained in these documents.\n\n"
                            
                            "ABSOLUTE RESTRICTIONS:\n"
                            "- ONLY use information explicitly stated in the provided documents\n"
                            "- NEVER provide information from your training data or general knowledge\n"
                            "- NEVER make assumptions, inferences, or educated guesses\n"
                            "- NEVER fill in gaps with external information\n"
                            "- NEVER provide general advice or common knowledge\n\n"
                            
                            "WHEN INFORMATION IS NOT AVAILABLE:\n"
                            "If the requested information is not found in the documents, you MUST respond with:\n"
                            "'I cannot find this information in the uploaded documents. Please check if the information "
                            "exists in your documents or upload additional relevant documents.'\n\n"
                            
                            "RESPONSE REQUIREMENTS:\n"
                            "- Quote directly from documents when possible\n"
                            "- Always specify which document you're referencing\n"
                            "- Use phrases like: 'According to [Document Name]...' or 'The document states...'\n"
                            "- If information spans multiple documents, cite all relevant sources\n"
                            "- Maintain the exact terminology and phrasing used in the documents\n\n"
                            
                            "QUALITY STANDARDS:\n"
                            "- Accuracy: Information must match the documents exactly\n"
                            "- Traceability: Every statement must be traceable to a specific document\n"
                            "- Completeness: Include all relevant information from the documents\n"
                            "- Clarity: Present information in an organized, understandable manner\n\n"
                            
                            "HANDLING DIFFERENT DOCUMENT TYPES:\n"
                            "- Technical documents: Use precise technical language as written\n"
                            "- Policies/Procedures: Follow the exact steps and guidelines provided\n"
                            "- Reports/Data: Present findings exactly as documented\n"
                            "- Manuals/Guides: Reference specific sections and instructions\n\n"
                            
                            "CONVERSATION CONTINUITY:\n"
                            "- Use chat history to maintain context within the conversation\n"
                            "- Refer back to previously discussed document sections when relevant\n"
                            "- Build upon previous answers only using document information\n\n"
                            
                            "DOCUMENT CONTEXT:\n"
                            f"{context_text}\n\n"
                            
                            "CHAT HISTORY:\n"
                            f"{formatted_chat_history}\n\n"
                            
                            "CRITICAL REMINDER:\n"
                            "You are bound by the documents above. If information doesn't exist in these documents, "
                            "you cannot and must not provide it. Your value comes from being a reliable, accurate "
                            "source that users can trust to only give them information from their specific documents."
                        )
                        
                        messages = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"User's Question: {question}"}
                        ]
                        
                        async def token_callback(token):
                            try:
                                if websocket.client_state.name == 'CONNECTED':
                                    await websocket.send_text(json.dumps({
                                        "status": "streaming",
                                        "token": token
                                    }))
                            except Exception as e:
                                logger.error(f"Error sending token: {e}")
                                return False
                            return True
                        
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
                    
                    if websocket.client_state.name == 'CONNECTED':
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
                        if websocket.client_state.name == 'CONNECTED':
                            await websocket.send_text(json.dumps({
                                "status": "error",
                                "error": str(e)
                            }))
                    except:
                        logger.error("Failed to send error message to client - connection already closed")
        
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected before full initialization.")
        except Exception as e:
            logger.error(f"WebSocket startup error: {str(e)}")
            try:
                if websocket.client_state.name == 'CONNECTED':
                    await websocket.send_text(json.dumps({
                        "status": "error",
                        "error": str(e)
                    }))
            except:
                logger.error("Failed to send startup error to client - connection already closed")
        finally:
            if "unified_kb" in active_connections and client_id in active_connections["unified_kb"]:
                del active_connections["unified_kb"][client_id]
                if not active_connections["unified_kb"]:
                    del active_connections["unified_kb"]
    
    finally:
        db.close()

async def websocket_heartbeat():
    """Send periodic heartbeats to keep WebSocket connections alive"""
    while True:
        await asyncio.sleep(30)
        
        if "unified_kb" in active_connections:
            client_ids = list(active_connections["unified_kb"].keys())
            
            for client_id in client_ids:
                try:
                    if client_id in active_connections.get("unified_kb", {}):
                        websocket = active_connections["unified_kb"][client_id]
                        await websocket.send_text(json.dumps({
                            "status": "heartbeat"
                        }))
                except Exception as e:
                    logger.error(f"Error sending heartbeat: {str(e)}")
                    if "unified_kb" in active_connections and client_id in active_connections["unified_kb"]:
                        del active_connections["unified_kb"][client_id]
                        if not active_connections["unified_kb"]:
                            del active_connections["unified_kb"]