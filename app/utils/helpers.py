import time
from typing import Dict, Any

def process_llm_response(llm_response: Dict[str, Any]) -> str:
    """Process the LLM response to extract clean answer."""
    answer = llm_response['result']
    if "Answer:" in answer:
        answer = answer.split("Answer:")[-1].strip()
    return answer

def format_response(question: str, answer: str, elapsed_time: int) -> str:
    """Format the final response with question, answer and time."""
    return f"""Question: {question}
Answer: {answer}
Time: {elapsed_time} seconds"""

class Timer:
    """Context manager for timing operations."""
    def __init__(self):
        self.start = None
        self.end = None
        self.interval = 0
        
    def __enter__(self):
        self.start = time.time()
        return self

    def __exit__(self, *args):
        self.end = time.time()
        self.interval = int(round(self.end - self.start, 0))

def validate_file_extension(filename: str, allowed_extensions: list) -> bool:
    """Validate if file extension is allowed."""
    if not filename:
        return False
    
    extension = filename.split('.')[-1].lower()
    return extension in allowed_extensions

def validate_file_size(file_size: int, max_size: int) -> bool:
    """Validate if file size is within limits."""
    return file_size <= max_size

def get_file_type(filename: str) -> str:
    """Get file type from filename."""
    return filename.split('.')[-1].lower()