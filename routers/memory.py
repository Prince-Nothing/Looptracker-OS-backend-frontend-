# routers/memory.py
import os
from typing import Annotated, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session
from openai import AsyncOpenAI

from database import get_session
from models import User
from schemas import UserMemoryCreate, UserMemoryResponse
from crud import (
    create_user_memory, get_user_memories_by_user, get_user_memory_by_id,
    delete_user_memory, search_user_memories
)
from auth import get_current_user

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def embed_text_for_memory(text: str) -> List[float]:
    if not text.strip():
        return []
    try:
        resp = await client.embeddings.create(input=text, model="text-embedding-3-small")
        return resp.data[0].embedding
    except Exception as e:
        print(f"[memory] embed error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate embedding")

@router.post("/memory", response_model=UserMemoryResponse, tags=["Memory"])
async def create_new_user_memory(
    memory_data: UserMemoryCreate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    embedding = await embed_text_for_memory(memory_data.content)
    user_memory = create_user_memory(
        session=session,
        user_id=current_user.id,
        content=memory_data.content,
        embedding=embedding,
        properties=memory_data.properties
    )
    return user_memory

@router.get("/memory", response_model=List[UserMemoryResponse], tags=["Memory"])
def get_all_user_memories(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    return get_user_memories_by_user(session, current_user.id)

@router.post("/memory/search", response_model=List[UserMemoryResponse], tags=["Memory"])
async def search_user_memories_endpoint(
    query: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: Optional[int] = Query(default=10, ge=1, le=50)
):
    query_embedding = await embed_text_for_memory(query)
    return search_user_memories(session=session, user_id=current_user.id, query_embedding=query_embedding, limit=limit)

@router.delete("/memory/{memory_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Memory"])
def delete_user_memory_endpoint(
    memory_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    user_memory = get_user_memory_by_id(session, memory_id)
    if not user_memory or user_memory.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Memory not found.")
    delete_user_memory(session, user_memory)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
