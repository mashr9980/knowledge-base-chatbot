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
        self.index_path = self.base_path / "unified_faiss_index"
        self.metadata_path = self.base_path / "unified_metadata.pickle"
        
        self.embeddings = HuggingFaceEmbeddings(
            model_name=settings.EMBEDDINGS_MODEL,
            model_kwargs={'device': "cuda" if torch.cuda.is_available() else "cpu"}
        )
        
        self._initialize_storage()

    def _initialize_storage(self):
        logger.info("Initializing unified knowledge base storage")
        try:
            if self.index_path.exists() and self.metadata_path.exists():
                logger.info("Loading existing unified index and metadata")
                self.index = faiss.read_index(str(self.index_path))
                with open(self.metadata_path, 'rb') as f:
                    self.metadata = pickle.load(f)
            else:
                logger.info("Creating new unified index and metadata")
                embedding_dim = len(self.embeddings.embed_query("test"))
                self.index = faiss.IndexFlatL2(embedding_dim)
                self.metadata = {
                    'documents': {},
                    'chunks': [],
                    'id_mapping': {},
                    'global_status': 'ready'
                }
                self._save_storage()
        except Exception as e:
            logger.error(f"Error initializing storage: {str(e)}")
            raise

    def _save_storage(self):
        logger.info("Saving unified storage")
        try:
            faiss.write_index(self.index, str(self.index_path))
            with open(self.metadata_path, 'wb') as f:
                pickle.dump(self.metadata, f)
        except Exception as e:
            logger.error(f"Error saving storage: {str(e)}")
            raise

    async def add_document(self, document_id: str, filename: str) -> None:
        logger.info(f"Adding document {document_id} with filename {filename} to unified knowledge base")
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
                doc = docx.Document(file_path)
                content = []
                for paragraph in doc.paragraphs:
                    if paragraph.text.strip():
                        content.append(paragraph.text)
                
                from langchain_core.documents import Document as LangChainDoc
                return [LangChainDoc(page_content='\n'.join(content), metadata={'source': file_path})]
            
            elif file_type.lower() == 'txt':
                loader = TextLoader(file_path, encoding='utf-8')
                return loader.load()
            
            elif file_type.lower() in ['xlsx', 'xls']:
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
        logger.info(f"Processing document {document_id} for unified knowledge base")
        try:
            db_document = db.query(Document).filter(Document.document_id == document_id).first()
            if db_document:
                db_document.status = DocumentStatus.PROCESSING
                db.commit()
            
            file_type = db_document.file_type if db_document else 'pdf'
            logger.info(f"Processing file as type: {file_type}")
            
            documents = self._load_document_by_type(file_path, file_type)
            
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=settings.SPLIT_CHUNK_SIZE,
                chunk_overlap=settings.SPLIT_OVERLAP
            )
            chunks = text_splitter.split_documents(documents)
            logger.info(f"Split document into {len(chunks)} chunks")
            
            chunk_texts = [chunk.page_content for chunk in chunks]
            logger.info("Creating embeddings for unified knowledge base")
            embeddings = self.embeddings.embed_documents(chunk_texts)
            
            logger.info("Adding to unified FAISS index")
            start_idx = self.index.ntotal
            self.index.add(np.array(embeddings))
            
            chunk_metadata = []
            for i, chunk in enumerate(chunks):
                faiss_id = start_idx + i
                chunk_info = {
                    'text': chunk.page_content,
                    'page': chunk.metadata.get('page', 0),
                    'document_id': document_id,
                    'filename': db_document.original_filename if db_document else 'unknown',
                    'chunk_index': i
                }
                
                self.metadata['id_mapping'][faiss_id] = len(self.metadata['chunks'])
                self.metadata['chunks'].append(chunk_info)
                chunk_metadata.append(chunk_info)
            
            logger.info("Updating unified knowledge base metadata")
            self.metadata['documents'][document_id].update({
                'status': DocumentStatus.COMPLETED,
                'chunks': chunk_metadata,
                'chunk_count': len(chunks)
            })
            
            self._save_storage()
            
            if db_document:
                db_document.status = DocumentStatus.COMPLETED
                db_document.chunks_count = len(chunks)
                db.commit()
            
            logger.info(f"Successfully processed document {document_id} into unified knowledge base")
            return True
            
        except Exception as e:
            logger.error(f"Error processing document: {str(e)}")
            self.metadata['documents'][document_id]['status'] = DocumentStatus.FAILED
            self.metadata['documents'][document_id]['error'] = str(e)
            self._save_storage()
            
            if db_document:
                db_document.status = DocumentStatus.FAILED
                db_document.error_message = str(e)
                db.commit()
            
            return False

    async def search(self, query: str, k: int = 4) -> List[str]:
        """Search across the entire unified knowledge base"""
        try:
            if self.index.ntotal == 0:
                logger.warning("No documents in unified knowledge base")
                return []
            
            query_embedding = self.embeddings.embed_query(query)
            
            D, I = self.index.search(np.array([query_embedding]), k)
            
            relevant_chunks = []
            for idx in I[0]:
                if idx != -1 and idx in self.metadata['id_mapping']:
                    chunk_idx = self.metadata['id_mapping'][int(idx)]
                    if chunk_idx < len(self.metadata['chunks']):
                        chunk = self.metadata['chunks'][chunk_idx]
                        relevant_chunks.append(chunk['text'])
            
            logger.info(f"Found {len(relevant_chunks)} relevant chunks from unified knowledge base")
            return relevant_chunks
                        
        except Exception as e:
            logger.error(f"Error searching unified knowledge base: {str(e)}")
            return []

    def get_document_status(self, document_id: str) -> Optional[Dict]:
        """Get document processing status from unified knowledge base"""
        return self.metadata['documents'].get(document_id)

    def get_knowledge_base_status(self) -> Dict:
        """Get overall knowledge base status"""
        total_documents = len(self.metadata['documents'])
        completed_documents = len([doc for doc in self.metadata['documents'].values() 
                                 if doc['status'] == DocumentStatus.COMPLETED])
        total_chunks = len(self.metadata['chunks'])
        
        return {
            'status': self.metadata['global_status'],
            'total_documents': total_documents,
            'completed_documents': completed_documents,
            'total_chunks': total_chunks,
            'last_updated': datetime.utcnow().isoformat()
        }

    def delete_document(self, document_id: str) -> bool:
        """Delete document from unified knowledge base"""
        try:
            if document_id in self.metadata['documents']:
                logger.info(f"Removing document {document_id} from unified knowledge base")
                
                chunks_to_remove = []
                for i, chunk in enumerate(self.metadata['chunks']):
                    if chunk.get('document_id') == document_id:
                        chunks_to_remove.append(i)
                
                for chunk_idx in reversed(chunks_to_remove):
                    del self.metadata['chunks'][chunk_idx]
                
                keys_to_remove = []
                for faiss_id, chunk_idx in self.metadata['id_mapping'].items():
                    if chunk_idx in chunks_to_remove or chunk_idx >= len(self.metadata['chunks']):
                        keys_to_remove.append(faiss_id)
                
                for key in keys_to_remove:
                    del self.metadata['id_mapping'][key]
                
                del self.metadata['documents'][document_id]
                
                logger.warning(f"Document {document_id} removed from metadata. FAISS index rebuild recommended for optimal performance.")
                
                self._save_storage()
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting document: {str(e)}")
            return False

    def rebuild_index(self):
        """Rebuild FAISS index from current chunks (optional maintenance operation)"""
        try:
            logger.info("Rebuilding unified FAISS index")
            
            if not self.metadata['chunks']:
                logger.info("No chunks to rebuild index from")
                return
            
            chunk_texts = [chunk['text'] for chunk in self.metadata['chunks']]
            embeddings = self.embeddings.embed_documents(chunk_texts)
            
            embedding_dim = len(embeddings[0])
            self.index = faiss.IndexFlatL2(embedding_dim)
            self.index.add(np.array(embeddings))
            
            self.metadata['id_mapping'] = {i: i for i in range(len(self.metadata['chunks']))}
            
            self._save_storage()
            logger.info("FAISS index rebuilt successfully")
            
        except Exception as e:
            logger.error(f"Error rebuilding index: {str(e)}")
            raise