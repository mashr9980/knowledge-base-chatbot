import os
import uuid
import pickle
import logging
import asyncio
from typing import Dict, Optional, List
from datetime import datetime
from pathlib import Path
import numpy as np
import faiss
import torch
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from sqlalchemy.orm import Session
from app.models.document import Document, DocumentStatus
from app.config import settings
import pandas as pd
import docx

logger = logging.getLogger(__name__)

class DocumentStore:
    def __init__(self, base_path: str):
        logger.info(f"Initializing DocumentStore with base path: {base_path}")
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.index_path = self.base_path / "faiss_index"
        self.metadata_path = self.base_path / "metadata.pickle"
        
        self.embeddings = HuggingFaceEmbeddings(
            model_name=settings.EMBEDDINGS_MODEL,
            model_kwargs={'device': "cuda" if torch.cuda.is_available() else "cpu"}
        )
        
        self._initialize_storage()

    def _initialize_storage(self):
        logger.info("Initializing storage")
        try:
            if self.index_path.exists() and self.metadata_path.exists():
                logger.info("Loading existing index and metadata")
                self.index = faiss.read_index(str(self.index_path))
                with open(self.metadata_path, 'rb') as f:
                    self.metadata = pickle.load(f)
            else:
                logger.info("Creating new index and metadata")
                embedding_dim = len(self.embeddings.embed_query("test"))
                self.index = faiss.IndexFlatL2(embedding_dim)
                self.metadata = {
                    'documents': {}, 
                    'id_mapping': {}  
                }
                self._save_storage()
        except Exception as e:
            logger.error(f"Error initializing storage: {str(e)}")
            raise

    def _save_storage(self):
        logger.info("Saving storage")
        try:
            faiss.write_index(self.index, str(self.index_path))
            with open(self.metadata_path, 'wb') as f:
                pickle.dump(self.metadata, f)
        except Exception as e:
            logger.error(f"Error saving storage: {str(e)}")
            raise

    async def add_document(self, document_id: str, filename: str) -> None:
        logger.info(f"Adding document {document_id} with filename {filename}")
        self.metadata['documents'][document_id] = {
            'status': DocumentStatus.PROCESSING,
            'chunks': [],
            'filename': filename,
            'created_at': datetime.utcnow().isoformat()
        }
        self._save_storage()

    def _load_document_by_type(self, file_path: str, file_type: str):
        """Load document based on file type"""
        try:
            if file_type.lower() == 'pdf':
                loader = PyPDFLoader(file_path)
                return loader.load()
            
            elif file_type.lower() == 'docx':
                # Use python-docx for better handling
                doc = docx.Document(file_path)
                content = []
                for paragraph in doc.paragraphs:
                    if paragraph.text.strip():
                        content.append(paragraph.text)
                
                # Create a document object similar to langchain format
                from langchain_core.documents import Document as LangChainDoc
                return [LangChainDoc(page_content='\n'.join(content), metadata={'source': file_path})]
            
            elif file_type.lower() == 'txt':
                loader = TextLoader(file_path, encoding='utf-8')
                return loader.load()
            
            elif file_type.lower() in ['xlsx', 'xls']:
                # Handle Excel files
                df = pd.read_excel(file_path)
                content = df.to_string(index=False)
                
                from langchain_core.documents import Document as LangChainDoc
                return [LangChainDoc(page_content=content, metadata={'source': file_path})]
            
            else:
                raise ValueError(f"Unsupported file type: {file_type}")
                
        except Exception as e:
            logger.error(f"Error loading {file_type} file: {str(e)}")
            raise

    async def process_document(self, document_id: str, file_path: str, db: Session) -> bool:
        logger.info(f"Processing document {document_id}")
        try:
            # Update database status
            db_document = db.query(Document).filter(Document.document_id == document_id).first()
            if db_document:
                db_document.status = DocumentStatus.PROCESSING
                db.commit()
            
            # Get file type from database record
            file_type = db_document.file_type if db_document else 'pdf'
            logger.info(f"Processing file as type: {file_type}")
            
            # Load document based on type
            documents = self._load_document_by_type(file_path, file_type)
            
            # Split documents into chunks
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.SPLIT_CHUNK_SIZE,
                chunk_overlap=settings.SPLIT_OVERLAP
            )
            chunks = text_splitter.split_documents(documents)
            logger.info(f"Split document into {len(chunks)} chunks")
            
            # Create embeddings for chunks
            chunk_texts = [chunk.page_content for chunk in chunks]
            logger.info("Creating embeddings")
            embeddings = self.embeddings.embed_documents(chunk_texts)
            
            # Add to FAISS index
            logger.info("Adding to FAISS index")
            start_idx = self.index.ntotal
            self.index.add(np.array(embeddings))
            
            # Update metadata
            chunk_metadata = []
            for i, chunk in enumerate(chunks):
                faiss_id = start_idx + i
                self.metadata['id_mapping'][faiss_id] = (document_id, i)
                chunk_metadata.append({
                    'text': chunk.page_content,
                    'page': chunk.metadata.get('page', 0)
                })
            
            logger.info("Updating document status")
            self.metadata['documents'][document_id].update({
                'status': DocumentStatus.COMPLETED,
                'chunks': chunk_metadata
            })
            
            self._save_storage()
            
            # Update database
            if db_document:
                db_document.status = DocumentStatus.COMPLETED
                db_document.chunks_count = len(chunks)
                db.commit()
            
            logger.info(f"Successfully processed document {document_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error processing document: {str(e)}")
            self.metadata['documents'][document_id]['status'] = DocumentStatus.FAILED
            self.metadata['documents'][document_id]['error'] = str(e)
            self._save_storage()
            
            # Update database
            if db_document:
                db_document.status = DocumentStatus.FAILED
                db_document.error_message = str(e)
                db.commit()
            
            return False

    async def search(self, document_id: str, query: str, k: int = 4) -> List[str]:
        """Search for relevant chunks in a specific document"""
        if document_id not in self.metadata['documents']:
            raise ValueError(f"Document {document_id} not found")
            
        if self.metadata['documents'][document_id]['status'] != DocumentStatus.COMPLETED:
            raise ValueError(f"Document {document_id} is not ready")
            
        # Create query embedding
        query_embedding = self.embeddings.embed_query(query)
        
        # Search in FAISS
        D, I = self.index.search(np.array([query_embedding]), k * 2)
        
        # Filter results for specific document
        relevant_chunks = []
        for idx in I[0]:
            if idx != -1:
                doc_id, chunk_id = self.metadata['id_mapping'][int(idx)]
                if doc_id == document_id:
                    chunk = self.metadata['documents'][doc_id]['chunks'][chunk_id]
                    relevant_chunks.append(chunk['text'])
                    if len(relevant_chunks) == k:
                        break
                        
        return relevant_chunks

    def get_document_status(self, document_id: str) -> Optional[Dict]:
        """Get document processing status from FAISS metadata"""
        return self.metadata['documents'].get(document_id)

    def delete_document(self, document_id: str) -> bool:
        """Delete document from FAISS store"""
        try:
            if document_id in self.metadata['documents']:
                # Remove from metadata
                del self.metadata['documents'][document_id]
                
                # Remove from id_mapping (this is complex for FAISS, so we'll mark as deleted)
                # In production, you might want to rebuild the index periodically
                keys_to_remove = []
                for faiss_id, (doc_id, chunk_id) in self.metadata['id_mapping'].items():
                    if doc_id == document_id:
                        keys_to_remove.append(faiss_id)
                
                for key in keys_to_remove:
                    del self.metadata['id_mapping'][key]
                
                self._save_storage()
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting document: {str(e)}")
            return False