# routers/diagnostics.py
from __future__ import annotations

from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session

from database import get_session
from auth import get_current_user
from models import User
from crud import (
    get_chat_session_by_id,
    get_chat_messages_by_session,
    get_chat_sessions_by_user,   # ⬅️ new import
)
from schemas import DiagnosticDataPoint

router = APIRouter()

# -------- existing: per-session --------
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
        if m.role != "assistant":
            continue
        diags = (m.properties or {}).get("diagnostics")
        if isinstance(diags, dict) and diags:
            points.append(DiagnosticDataPoint(timestamp=m.timestamp, diagnostics=diags))

    points.sort(key=lambda p: p.timestamp)
    return points

# -------- new: per-user (for Progress) --------
def _parse_window_iso_threshold(window: Optional[str]) -> Optional[datetime]:
    """
    Accepts '30d' or '24h' and returns a UTC threshold datetime.
    """
    if not window:
        return None
    w = window.strip().lower()
    now = datetime.now(timezone.utc)
    try:
        if w.endswith("d"):
            return now - timedelta(days=int(w[:-1]))
        if w.endswith("h"):
            return now - timedelta(hours=int(w[:-1]))
    except ValueError:
        return None
    return None

@router.get("/users/me/diagnostics", response_model=List[DiagnosticDataPoint], tags=["Diagnostics"])
def get_user_diagnostics_series(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    window: Optional[str] = Query(default=None, description="e.g., 30d or 24h"),
    limit: int = Query(default=2000, ge=10, le=10000),
):
    """
    Aggregate diagnostics across ALL of the current user's sessions.
    Returns the same shape as per-session: List[DiagnosticDataPoint]
    """
    threshold = _parse_window_iso_threshold(window)

    points: List[DiagnosticDataPoint] = []
    for s in get_chat_sessions_by_user(session, current_user.id):
        for m in get_chat_messages_by_session(session, s.id):
            if m.role != "assistant":
                continue

            # Optional time filter
            if threshold and m.timestamp:
                ts = m.timestamp
                ts_utc = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
                if ts_utc < threshold:
                    continue

            diags = (m.properties or {}).get("diagnostics")
            if isinstance(diags, dict) and diags:
                points.append(DiagnosticDataPoint(timestamp=m.timestamp, diagnostics=diags))

    # sort oldest→newest; keep most recent N if needed
    points.sort(key=lambda p: p.timestamp or datetime.min.replace(tzinfo=timezone.utc))
    if len(points) > limit:
        points = points[-limit:]
    return points
