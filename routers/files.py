# routers/files.py

import os
import uuid
import json
import asyncio
from typing import Annotated, List

# MODIFIED: Added 'Response' to the import list
from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File as FastAPIFile, Response
from sqlmodel import Session
import boto3
from botocore.exceptions import NoCredentialsError
import redis.asyncio as redis
from sse_starlette.sse import EventSourceResponse

# Internal module imports
from database import get_session
from models import User, File, FileStatus
from auth import get_current_user, get_current_user_sse
from tasks import process_and_validate_file
from crud import create_file, get_files_by_user, get_file_by_id, delete_file as crud_delete_file

# --- Router and Clients ---
router = APIRouter(
    prefix="/files",
    tags=["Files"]
)

s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION")
)
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
redis_client = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), decode_responses=True)


# --- SSE Generator for Real-Time Updates ---
async def file_status_generator(request: Request, user_id: int):
    pubsub = redis_client.pubsub()
    channel_name = f"file-updates:{user_id}"
    await pubsub.subscribe(channel_name)
    
    try:
        while True:
            if await request.is_disconnected():
                print(f"Client disconnected from SSE stream for user {user_id}.")
                break

            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message:
                yield { "event": "status_update", "data": message['data'] }
            
            await asyncio.sleep(0.1)

    except asyncio.CancelledError:
        print(f"SSE stream for user {user_id} was cancelled.")
    finally:
        await pubsub.unsubscribe(channel_name)
        print(f"Unsubscribed and closed SSE stream for user {user_id}.")


# --- API Endpoints ---

@router.post("/upload", response_model=dict)
async def upload_file(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = FastAPIFile(...)
):
    if not S3_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="S3 bucket name not configured.")
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded or filename is missing.")

    s3_key = f"uploads/{current_user.id}/{uuid.uuid4()}_{file.filename}"
    
    try:
        contents = await file.read()
        s3_client.put_object(Bucket=S3_BUCKET_NAME, Key=s3_key, Body=contents, ContentType=file.content_type)
        
        file_record = create_file(
            session=session,
            user_id=current_user.id,
            filename=file.filename,
            s3_key=s3_key,
            file_mime_type=file.content_type or 'application/octet-stream',
            status=FileStatus.UPLOADED
        )
        session.commit()
        session.refresh(file_record)
        
        process_and_validate_file.delay(file_id=file_record.id, user_id=current_user.id)
        
        return {"message": "File uploaded successfully, processing in background.", "file_id": file_record.id}
        
    except NoCredentialsError:
        raise HTTPException(status_code=500, detail="AWS credentials not available.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not upload file: {str(e)}")


@router.get("/status-stream")
async def file_status_stream(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user_sse)]
):
    """Endpoint for clients to subscribe to real-time file processing status updates."""
    return EventSourceResponse(file_status_generator(request, current_user.id))


@router.get("/", response_model=List[dict])
def list_user_files(
    session: Annotated[Session, Depends(get_session)], 
    current_user: Annotated[User, Depends(get_current_user)]
):
    files = get_files_by_user(session, current_user.id)
    return [
        {
            "id": f.id, 
            "filename": f.filename, 
            "status": f.status.value, 
            "upload_timestamp": f.upload_timestamp.isoformat()
        } 
        for f in files
    ]

@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_file(
    file_id: int, 
    session: Annotated[Session, Depends(get_session)], 
    current_user: Annotated[User, Depends(get_current_user)]
):
    if not S3_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="S3 bucket name not configured.")
    
    file_record = get_file_by_id(session, file_id)
    if not file_record or file_record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="File not found or not authorized for deletion.")
    
    s3_client.delete_object(Bucket=S3_BUCKET_NAME, Key=file_record.s3_key)
    crud_delete_file(session, file_record)
    return Response(status_code=status.HTTP_204_NO_CONTENT)