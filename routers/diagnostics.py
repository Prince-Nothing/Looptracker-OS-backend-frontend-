from __future__ import annotations

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from database import get_session
from auth import get_current_user
from models import User
from crud import get_chat_session_by_id, get_chat_messages_by_session
from schemas import DiagnosticDataPoint

router = APIRouter()

@router.get("/chats/{session_id}/diagnostics", response_model=List[DiagnosticDataPoint], tags=["Diagnostics"])
def get_diagnostics_series(
    session_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    msgs = get_chat_messages_by_session(session, session_id)

    points: List[DiagnosticDataPoint] = []
    for m in msgs:
        # only assistant messages will have model-produced diagnostics
        if m.role != "assistant":
            continue
        props = m.properties or {}
        diags = props.get("diagnostics")
        if isinstance(diags, dict) and diags:
            # Pydantic will validate shape; keep raw dict so we can extend in future
            points.append(DiagnosticDataPoint(timestamp=m.timestamp, diagnostics=diags))

    # already chronological by timestamp; if not, sort:
    points.sort(key=lambda p: p.timestamp)
    return points
