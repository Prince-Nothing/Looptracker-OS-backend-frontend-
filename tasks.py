# tasks.py

import os
import io
import re
import tempfile
import json
import redis
import filetype # NEW: The superior, pure-Python validation library

from celery import Celery
from dotenv import load_dotenv, find_dotenv
import boto3
from botocore.exceptions import NoCredentialsError
from openai import OpenAI

# Database and models are needed in the worker
from database import get_session
from crud import get_file_by_id, update_file_status, create_user_memory
from models import FileStatus

# --- Celery App Configuration ---
load_dotenv(find_dotenv(usecwd=True))
broker_url = os.getenv("CELERY_BROKER_URL")
result_backend = os.getenv("CELERY_RESULT_BACKEND")
if not broker_url or not result_backend:
    raise ValueError("CELERY_BROKER_URL and CELERY_RESULT_BACKEND must be set in your .env file")

celery_app = Celery("looptracker_tasks", broker=broker_url, backend=result_backend, include=['tasks'])
celery_app.conf.update(task_track_started=True)


# --- Re-initialize clients needed by the worker ---
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION")
)
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)

# --- Helper function to publish status updates ---
def publish_status_update(user_id: int, file_id: int, status: str, error_message: str = None):
    channel = f"file-updates:{user_id}"
    payload = {"file_id": file_id, "status": status, "error_message": error_message}
    redis_client.publish(channel, json.dumps(payload))
    print(f"Published to {channel}: {payload}")


# --- Helper functions for processing ---
def get_text_from_pdf(content_bytes):
    try: from PyPDF2 import PdfReader
    except ImportError: raise ImportError("PyPDF2 is not installed. Please run 'pip install PyPDF2'")
    pdf_file = io.BytesIO(content_bytes)
    reader = PdfReader(pdf_file)
    return "".join(page.extract_text() or "" for page in reader.pages)

def get_text_from_docx(content_bytes):
    try: from docx import Document
    except ImportError: raise ImportError("python-docx is not installed. Please run 'pip install python-docx'")
    doc_file = io.BytesIO(content_bytes)
    document = Document(doc_file)
    return "\n".join(para.text for para in document.paragraphs)

def embed_text(text: str):
    response = openai_client.embeddings.create(input=text, model="text-embedding-ada-002")
    return response.data[0].embedding


# --- The Main Celery Task (UPGRADED with filetype library) ---
@celery_app.task(bind=True)
def process_and_validate_file(self, file_id: int, user_id: int):
    temp_file_path = None
    with next(get_session()) as session:
        file_record = get_file_by_id(session, file_id)
        if not file_record:
            print(f"File with ID {file_id} not found. Aborting task.")
            return

        try:
            update_file_status(session, file_record, FileStatus.PROCESSING)
            session.commit()
            publish_status_update(user_id, file_id, "processing")

            with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file_record.filename}") as temp_file:
                temp_file_path = temp_file.name
                s3_client.download_fileobj(S3_BUCKET_NAME, file_record.s3_key, temp_file)
            
            # --- UPGRADED: Robust Validation with filetype ---
            if os.path.getsize(temp_file_path) > 10 * 1024 * 1024:
                raise ValueError("File exceeds maximum size of 10MB.")

            kind = filetype.guess(temp_file_path)
            if kind is None:
                raise ValueError("Could not determine file type from content.")

            allowed_types = {
                'txt': 'text/plain',
                'pdf': 'application/pdf',
                'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            }
            
            if kind.extension not in allowed_types or kind.mime not in allowed_types.values():
                raise ValueError(f"Invalid file content. Detected type: {kind.mime}")
            # --- End of Upgraded Validation Block ---

            with open(temp_file_path, 'rb') as f:
                file_content_bytes = f.read()

            extracted_text = ""
            if kind.extension == 'txt': extracted_text = file_content_bytes.decode('utf-8', errors='ignore')
            elif kind.extension == 'pdf': extracted_text = get_text_from_pdf(file_content_bytes)
            elif kind.extension == 'docx': extracted_text = get_text_from_docx(file_content_bytes)
            
            if not extracted_text.strip(): raise ValueError("No text could be extracted from the file.")

            max_chunk_length = 1500
            initial_chunks = re.split(r'\n\s*\n', extracted_text)
            final_chunks = [ichunk[i:i+max_chunk_length] for ichunk in initial_chunks if ichunk.strip() for i in range(0, len(ichunk), max_chunk_length)]
            chunks = [chunk.strip() for chunk in final_chunks if chunk.strip()]

            if not chunks: raise ValueError("File content resulted in no valid text chunks.")
            
            for i, chunk_content in enumerate(chunks):
                embedding = embed_text(chunk_content)
                if embedding:
                    create_user_memory(
                        session=session, user_id=user_id, content=chunk_content, embedding=embedding,
                        properties={"source": "file_upload", "file_id": file_record.id, "filename": file_record.filename, "chunk_index": i}
                    )
            session.commit()
            
            update_file_status(session, file_record, FileStatus.PROCESSED)
            session.commit()
            publish_status_update(user_id, file_id, "processed")
            return {"status": "Success", "chunks_created": len(chunks)}

        except (ValueError, NoCredentialsError, ImportError) as e:
            error_str = str(e)
            print(f"VALIDATION/PROCESSING ERROR for file ID {file_id}: {error_str}")
            update_file_status(session, file_record, FileStatus.FAILED, error_message=error_str)
            session.commit()
            publish_status_update(user_id, file_id, "failed", error_message=error_str)
            return {"status": "Failed", "error": error_str}
        except Exception as e:
            error_str = "An unexpected server error occurred."
            print(f"UNEXPECTED ERROR for file ID {file_id}: {str(e)}")
            update_file_status(session, file_record, FileStatus.FAILED, error_message=error_str)
            session.commit()
            publish_status_update(user_id, file_id, "failed", error_message=error_str)
            raise e
        finally:
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)