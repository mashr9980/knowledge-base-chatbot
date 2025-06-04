import asyncio
import multiprocessing
import queue
import threading
import logging
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from typing import Dict, Any, Optional
from dataclasses import dataclass
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.document import Document, DocumentStatus
from app.services.document_store import DocumentStore
from app.config import settings

logger = logging.getLogger(__name__)

@dataclass
class DocumentProcessingTask:
    document_id: str
    file_path: str
    priority: int = 1  # 1 = high, 2 = normal, 3 = low
    retry_count: int = 0
    max_retries: int = 3

class DocumentProcessingService:
    """
    Dedicated service for processing documents in separate processes/threads
    to avoid blocking the main application for other users
    """
    
    def __init__(self):
        self.task_queue = queue.PriorityQueue()
        self.processing_status = {}  # document_id -> status
        self.is_running = False
        self.workers = []
        self.process_pool = None
        self.thread_pool = None
        
        # Initialize based on hardware configuration
        self.max_workers = settings.DOC_PROCESSING_WORKERS
        
        logger.info(f"Initializing DocumentProcessingService with {self.max_workers} workers")
    
    def start(self):
        """Start the document processing service"""
        if self.is_running:
            logger.warning("DocumentProcessingService is already running")
            return
        
        self.is_running = True
        
        # Create process pool for CPU-intensive tasks
        self.process_pool = ProcessPoolExecutor(max_workers=self.max_workers)
        
        # Create thread pool for I/O operations
        self.thread_pool = ThreadPoolExecutor(max_workers=self.max_workers * 2)
        
        # Start worker threads for task management
        for i in range(min(3, self.max_workers)):  # Task management threads
            worker_thread = threading.Thread(
                target=self._worker_loop,
                name=f"DocProcessor-{i}",
                daemon=True
            )
            worker_thread.start()
            self.workers.append(worker_thread)
        
        logger.info(f"DocumentProcessingService started with {len(self.workers)} worker threads")
    
    def stop(self):
        """Stop the document processing service"""
        if not self.is_running:
            return
        
        self.is_running = False
        
        # Shutdown process pool
        if self.process_pool:
            self.process_pool.shutdown(wait=True)
        
        # Shutdown thread pool
        if self.thread_pool:
            self.thread_pool.shutdown(wait=True)
        
        logger.info("DocumentProcessingService stopped")
    
    def add_document(self, document_id: str, file_path: str, priority: int = 1):
        """Add a document to the processing queue"""
        task = DocumentProcessingTask(
            document_id=document_id,
            file_path=file_path,
            priority=priority
        )
        
        # Add to queue with priority (lower number = higher priority)
        self.task_queue.put((priority, time.time(), task))
        
        # Update status
        self.processing_status[document_id] = {
            'status': 'queued',
            'added_at': time.time(),
            'priority': priority
        }
        
        logger.info(f"Document {document_id} added to processing queue with priority {priority}")
    
    def get_processing_status(self, document_id: str) -> Optional[Dict[str, Any]]:
        """Get current processing status of a document"""
        return self.processing_status.get(document_id)
    
    def _worker_loop(self):
        """Main worker loop for processing documents"""
        worker_name = threading.current_thread().name
        logger.info(f"Worker {worker_name} started")
        
        while self.is_running:
            try:
                # Get task from queue with timeout
                try:
                    priority, timestamp, task = self.task_queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                
                logger.info(f"Worker {worker_name} processing document {task.document_id}")
                
                # Update status
                self.processing_status[task.document_id] = {
                    'status': 'processing',
                    'started_at': time.time(),
                    'worker': worker_name,
                    'retry_count': task.retry_count
                }
                
                # Process document in process pool
                future = self.process_pool.submit(
                    self._process_document_task,
                    task.document_id,
                    task.file_path
                )
                
                try:
                    # Wait for processing to complete
                    success = future.result(timeout=300)  # 5 minute timeout per document
                    
                    if success:
                        self.processing_status[task.document_id] = {
                            'status': 'completed',
                            'completed_at': time.time()
                        }
                        logger.info(f"Document {task.document_id} processed successfully")
                    else:
                        self._handle_processing_failure(task, "Processing failed")
                
                except Exception as e:
                    logger.error(f"Error processing document {task.document_id}: {str(e)}")
                    self._handle_processing_failure(task, str(e))
                
                finally:
                    self.task_queue.task_done()
            
            except Exception as e:
                logger.error(f"Unexpected error in worker {worker_name}: {str(e)}")
                time.sleep(1)  # Prevent tight error loop
        
        logger.info(f"Worker {worker_name} stopped")
    
    def _handle_processing_failure(self, task: DocumentProcessingTask, error_message: str):
        """Handle document processing failure with retry logic"""
        task.retry_count += 1
        
        if task.retry_count <= task.max_retries:
            # Retry with lower priority
            retry_priority = min(3, task.priority + 1)
            retry_task = DocumentProcessingTask(
                document_id=task.document_id,
                file_path=task.file_path,
                priority=retry_priority,
                retry_count=task.retry_count,
                max_retries=task.max_retries
            )
            
            # Add back to queue with delay
            time.sleep(2 ** task.retry_count)  # Exponential backoff
            self.task_queue.put((retry_priority, time.time(), retry_task))
            
            self.processing_status[task.document_id] = {
                'status': 'retrying',
                'error': error_message,
                'retry_count': task.retry_count,
                'max_retries': task.max_retries
            }
            
            logger.warning(f"Retrying document {task.document_id} (attempt {task.retry_count}/{task.max_retries})")
        else:
            # Max retries exceeded
            self.processing_status[task.document_id] = {
                'status': 'failed',
                'error': error_message,
                'failed_at': time.time(),
                'retry_count': task.retry_count
            }
            logger.error(f"Document {task.document_id} failed after {task.retry_count} retries")
    
    @staticmethod
    def _process_document_task(document_id: str, file_path: str) -> bool:
        """
        Static method for processing document in separate process
        This runs in a separate process to avoid GIL limitations
        """
        try:
            # Create new database session for this process
            db = SessionLocal()
            
            try:
                # Initialize document store
                document_store = DocumentStore(settings.OUTPUT_FOLDER)
                
                # Process the document
                success = asyncio.run(
                    document_store.process_document(document_id, file_path, db)
                )
                
                return success
            
            finally:
                db.close()
        
        except Exception as e:
            logger.error(f"Error in document processing task: {str(e)}")
            return False

# Global instance
document_processor = DocumentProcessingService()

def start_document_processor():
    """Start the global document processor"""
    document_processor.start()

def stop_document_processor():
    """Stop the global document processor"""
    document_processor.stop()

def queue_document_processing(document_id: str, file_path: str, priority: int = 1):
    """Queue a document for processing"""
    document_processor.add_document(document_id, file_path, priority)

def get_document_processing_status(document_id: str) -> Optional[Dict[str, Any]]:
    """Get document processing status"""
    return document_processor.get_processing_status(document_id)