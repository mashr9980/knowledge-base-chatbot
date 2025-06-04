import os
import uuid
from typing import List, Optional
import PyPDF2
import docx
import pandas as pd
from sqlalchemy.orm import Session
from app.models.document import Document, DocumentChunk
from app.config import settings
from app.services.vector_store import VectorStore

class DocumentProcessor:
    def __init__(self, db: Session):
        self.db = db
        self.vector_store = VectorStore()
    
    def save_file(self, file_content: bytes, original_filename: str) -> tuple[str, str]:
        """Save uploaded file and return file path and generated filename."""
        file_extension = original_filename.split('.')[-1].lower()
        generated_filename = f"{uuid.uuid4()}.{file_extension}"
        file_path = os.path.join(settings.UPLOAD_DIR, generated_filename)
        
        # Create upload directory if it doesn't exist
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        
        with open(file_path, "wb") as f:
            f.write(file_content)
        
        return file_path, generated_filename
    
    def extract_text(self, file_path: str, file_type: str) -> str:
        """Extract text from different file types."""
        try:
            if file_type == "pdf":
                return self._extract_from_pdf(file_path)
            elif file_type == "docx":
                return self._extract_from_docx(file_path)
            elif file_type == "txt":
                return self._extract_from_txt(file_path)
            elif file_type == "xlsx":
                return self._extract_from_xlsx(file_path)
            else:
                raise ValueError(f"Unsupported file type: {file_type}")
        except Exception as e:
            raise Exception(f"Error extracting text: {str(e)}")
    
    def _extract_from_pdf(self, file_path: str) -> str:
        text = ""
        with open(file_path, "rb") as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
        return text
    
    def _extract_from_docx(self, file_path: str) -> str:
        doc = docx.Document(file_path)
        text = ""
        for paragraph in doc.paragraphs:
            text += paragraph.text + "\n"
        return text
    
    def _extract_from_txt(self, file_path: str) -> str:
        with open(file_path, "r", encoding="utf-8") as file:
            return file.read()
    
    def _extract_from_xlsx(self, file_path: str) -> str:
        df = pd.read_excel(file_path)
        return df.to_string()
    
    def chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into chunks with overlap."""
        if len(text) <= chunk_size:
            return [text]
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(start + chunk_size, len(text))
            
            # Try to break at a sentence boundary
            if end < len(text):
                last_period = text.rfind('.', start, end)
                if last_period > start + chunk_size // 2:
                    end = last_period + 1
            
            chunks.append(text[start:end].strip())
            start = max(start + chunk_size - overlap, end)
        
        return chunks
    
    def process_document(self, document_id: int) -> bool:
        """Process document: extract text, create chunks, generate embeddings."""
        try:
            document = self.db.query(Document).filter(Document.id == document_id).first()
            if not document:
                return False
            
            # Extract text
            text = self.extract_text(document.file_path, document.file_type)
            document.content = text
            
            # Create chunks
            chunks = self.chunk_text(text)
            
            # Generate embeddings and save chunks
            for i, chunk in enumerate(chunks):
                embedding = self.vector_store.generate_embedding(chunk)
                
                chunk_obj = DocumentChunk(
                    document_id=document_id,
                    chunk_text=chunk,
                    chunk_index=i,
                    embedding=embedding.tobytes() if embedding is not None else None
                )
                self.db.add(chunk_obj)
            
            document.is_processed = True
            self.db.commit()
            
            # Update vector store
            self.vector_store.add_documents([
                {"id": f"{document_id}_{i}", "text": chunk, "document_id": document_id}
                for i, chunk in enumerate(chunks)
            ])
            
            return True
            
        except Exception as e:
            self.db.rollback()
            print(f"Error processing document: {str(e)}")
            return False