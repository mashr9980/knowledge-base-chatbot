import os
from typing import List
from app.config import settings

def validate_file_extension(filename: str) -> bool:
    """Validate if file extension is allowed."""
    if not filename:
        return False
    
    extension = filename.split('.')[-1].lower()
    return extension in settings.ALLOWED_EXTENSIONS

def validate_file_size(file_size: int) -> bool:
    """Validate if file size is within limits."""
    return file_size <= settings.MAX_FILE_SIZE

def get_file_type(filename: str) -> str:
    """Get file type from filename."""
    return filename.split('.')[-1].lower()

def cleanup_file(file_path: str) -> bool:
    """Delete a file from filesystem."""
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
        return False
    except Exception as e:
        print(f"Error deleting file {file_path}: {str(e)}")
        return False