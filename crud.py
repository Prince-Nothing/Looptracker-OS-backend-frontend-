from __future__ import annotations

from typing import Optional, List, Dict, Any
from sqlmodel import Session, select
from passlib.context import CryptContext

from models import (
    User,
    ChatSession,
    ChatMessage,
    File,
    FileStatus,
    UserMemory,
    DocumentChunk,
    Feedback,
    InteractionMetric,  # NEW: metrics table
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# -----------------------
# Auth / Users
# -----------------------

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_user(session: Session, email: str, password: str) -> "User":
    hashed_password = get_password_hash(password)
    user = User(email=email, hashed_password=hashed_password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_user_by_email(session: Session, email: str) -> Optional["User"]:
    statement = select(User).where(User.email == email)
    return session.exec(statement).first()


def get_user_by_id(session: Session, user_id: int) -> Optional["User"]:
    statement = select(User).where(User.id == user_id)
    return session.exec(statement).first()


def update_user_email(session: Session, user: "User", new_email: str) -> "User":
    user.email = new_email
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update_user_password(session: Session, user: "User", new_password: str) -> "User":
    user.hashed_password = get_password_hash(new_password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


# -----------------------
# Chat Sessions
# -----------------------

def create_chat_session(session: Session, user_id: int) -> "ChatSession":
    chat_session = ChatSession(user_id=user_id)
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)
    return chat_session


def get_chat_session_by_id(session: Session, session_id: int) -> Optional["ChatSession"]:
    statement = select(ChatSession).where(ChatSession.id == session_id)
    return session.exec(statement).first()


def get_chat_sessions_by_user(session: Session, user_id: int) -> List["ChatSession"]:
    statement = (
        select(ChatSession)
        .where(ChatSession.user_id == user_id)
        .order_by(ChatSession.created_at.desc())
    )
    return session.exec(statement).all()


def delete_chat_session(session: Session, chat_session: "ChatSession") -> bool:
    messages_to_delete = session.exec(
        select(ChatMessage).where(ChatMessage.chat_session_id == chat_session.id)
    ).all()
    for message in messages_to_delete:
        session.delete(message)
    session.delete(chat_session)
    session.commit()
    return True


# -----------------------
# Chat Messages
# -----------------------

def create_chat_message(
    session: Session,
    chat_session_id: int,
    role: str,
    content: str,
    properties: Optional[dict] = None,
) -> "ChatMessage":
    chat_message = ChatMessage(
        chat_session_id=chat_session_id,
        role=role,
        content=content,
        properties=properties,
    )
    session.add(chat_message)
    session.commit()
    session.refresh(chat_message)
    return chat_message


def get_chat_message_by_id(session: Session, message_id: int) -> Optional["ChatMessage"]:
    statement = select(ChatMessage).where(ChatMessage.id == message_id)
    return session.exec(statement).first()


def get_chat_messages_by_session(session: Session, chat_session_id: int) -> List["ChatMessage"]:
    statement = (
        select(ChatMessage)
        .where(ChatMessage.chat_session_id == chat_session_id)
        .order_by(ChatMessage.timestamp)
    )
    return session.exec(statement).all()


# -----------------------
# Files
# -----------------------

def create_file(
    session: Session,
    user_id: int,
    filename: str,
    s3_key: str,
    file_mime_type: str,
    status: "FileStatus",
) -> "File":
    file_record = File(
        user_id=user_id,
        filename=filename,
        s3_key=s3_key,
        file_mime_type=file_mime_type,
        status=status,
    )
    session.add(file_record)
    session.commit()
    session.refresh(file_record)
    return file_record


def get_file_by_id(session: Session, file_id: int) -> Optional["File"]:
    statement = select(File).where(File.id == file_id)
    return session.exec(statement).first()


def get_files_by_user(session: Session, user_id: int) -> List["File"]:
    statement = (
        select(File)
        .where(File.user_id == user_id)
        .order_by(File.upload_timestamp.desc())
    )
    return session.exec(statement).all()


def update_file_status(
    session: Session,
    file_record: "File",
    status: "FileStatus",
    error_message: Optional[str] = None,
) -> "File":
    file_record.status = status
    file_record.error_message = error_message
    session.add(file_record)
    session.commit()
    session.refresh(file_record)
    return file_record


def delete_file(session: Session, file_record: "File") -> bool:
    session.delete(file_record)
    session.commit()
    return True


# -----------------------
# User Memory (pgvector)
# -----------------------

def create_user_memory(
    session: Session,
    user_id: int,
    content: str,
    embedding: List[float],
    properties: Optional[dict] = None,
) -> "UserMemory":
    if properties is None:
        properties = {}
    user_memory = UserMemory(
        user_id=user_id,
        content=content,
        embedding=embedding,
        properties=properties,
    )
    session.add(user_memory)
    session.commit()
    session.refresh(user_memory)
    return user_memory


def get_user_memory_by_id(session: Session, memory_id: int) -> Optional["UserMemory"]:
    statement = select(UserMemory).where(UserMemory.id == memory_id)
    return session.exec(statement).first()


def get_user_memories_by_user(session: Session, user_id: int) -> List["UserMemory"]:
    statement = (
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.timestamp)
    )
    return session.exec(statement).all()


def search_user_memories(
    session: Session,
    user_id: int,
    query_embedding: List[float],
    limit: Optional[int] = None,
) -> List["UserMemory"]:
    if not query_embedding:
        # Fallback: recent if no embedding
        stmt = (
            select(UserMemory)
            .where(UserMemory.user_id == user_id)
            .order_by(UserMemory.timestamp.desc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return session.exec(stmt).all()

    stmt = (
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.embedding.cosine_distance(query_embedding))
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return session.exec(stmt).all()


def delete_user_memory(session: Session, user_memory: "UserMemory") -> bool:
    session.delete(user_memory)
    session.commit()
    return True


# -----------------------
# Document Chunks (RAG)
# -----------------------

def create_document_chunk_record(
    session: Session,
    file_id: int,
    user_id: int,
    chunk_content: str,
    embedding: List[float],
    metadata: dict,
) -> "DocumentChunk":
    chunk_record = DocumentChunk(
        file_id=file_id,
        user_id=user_id,
        chunk_content=chunk_content,
        embedding=embedding,
        properties=metadata,
    )
    session.add(chunk_record)
    session.commit()
    session.refresh(chunk_record)
    return chunk_record


def get_relevant_document_chunks(
    session: Session,
    user_id: int,
    query_embedding: List[float],
    top_k: int = 5,
    file_ids: Optional[List[int]] = None,
) -> List["DocumentChunk"]:
    statement = select(DocumentChunk).where(DocumentChunk.user_id == user_id)
    if file_ids:
        statement = statement.where(DocumentChunk.file_id.in_(file_ids))
    statement = statement.order_by(
        DocumentChunk.embedding.cosine_distance(query_embedding)
    ).limit(top_k)
    return session.exec(statement).all()


# -----------------------
# Feedback
# -----------------------

def create_feedback_entry(
    session: Session,
    user_id: int,
    chat_message_id: int,
    rating: int,
    comment: Optional[str] = None,
) -> "Feedback":
    feedback_entry = Feedback(
        user_id=user_id,
        chat_message_id=chat_message_id,
        rating=rating,
        comment=comment,
    )
    session.add(feedback_entry)
    session.commit()
    session.refresh(feedback_entry)
    return feedback_entry


def get_feedback_by_message_id(session: Session, chat_message_id: int) -> Optional["Feedback"]:
    statement = select(Feedback).where(Feedback.chat_message_id == chat_message_id)
    return session.exec(statement).first()


def get_feedback_by_user(session: Session, user_id: int) -> List["Feedback"]:
    statement = (
        select(Feedback)
        .where(Feedback.user_id == user_id)
        .order_by(Feedback.timestamp.desc())
    )
    return session.exec(statement).all()


def update_feedback_entry(
    session: Session,
    feedback_id: int,
    rating: Optional[int] = None,
    comment: Optional[str] = None,
) -> Optional["Feedback"]:
    feedback_entry = session.get(Feedback, feedback_id)
    if feedback_entry:
        if rating is not None:
            feedback_entry.rating = rating
        if comment is not None:
            feedback_entry.comment = comment
        session.add(feedback_entry)
        session.commit()
        session.refresh(feedback_entry)
        return feedback_entry
    return None


# -----------------------
# Interaction Metrics (Telemetry)
# -----------------------

def create_interaction_metric(
    session: Session,
    chat_session_id: int,
    chat_message_id: Optional[int],
    model: Optional[str],
    cache_backend: Optional[str],
    metrics: Dict[str, Any],
    extra: Optional[Dict[str, Any]] = None,
) -> InteractionMetric:
    """
    Persist a single interaction metric row. Best-effort insert.
    """
    row = InteractionMetric(
        chat_session_id=chat_session_id,
        chat_message_id=chat_message_id,
        model=model,
        cache_backend=cache_backend,
        t_stream_open_ms=metrics.get("t_stream_open_ms"),
        t_first_chunk_ms=metrics.get("t_first_chunk_ms"),
        t_first_text_ms=metrics.get("t_first_text_ms"),
        t_total_ms=metrics.get("t_total_ms"),
        chunks=metrics.get("chunks"),
        bytes_streamed=metrics.get("bytes_streamed"),
        extra=extra or {},
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def get_metrics_by_session(
    session: Session,
    chat_session_id: int,
    limit: int = 200,
) -> List[InteractionMetric]:
    stmt = (
        select(InteractionMetric)
        .where(InteractionMetric.chat_session_id == chat_session_id)
        .order_by(InteractionMetric.id.desc())
        .limit(limit)
    )
    return session.exec(stmt).all()


def _percentile(sorted_values: List[int], pct: float) -> Optional[float]:
    """
    Compute a percentile from a pre-sorted list using linear interpolation.
    Returns None if list is empty. pct in [0, 100].
    """
    n = len(sorted_values)
    if n == 0:
        return None
    if n == 1:
        return float(sorted_values[0])
    rank = (pct / 100.0) * (n - 1)
    low = int(rank)
    high = min(low + 1, n - 1)
    frac = rank - low
    return sorted_values[low] * (1 - frac) + sorted_values[high] * frac


def _summarize_series(values: List[Optional[int]]) -> Dict[str, Optional[float]]:
    v = [int(x) for x in values if isinstance(x, (int, float))]
    if not v:
        return {"count": 0, "avg": None, "p50": None, "p95": None, "min": None, "max": None}
    v_sorted = sorted(v)
    avg = sum(v) / len(v)
    return {
        "count": len(v),
        "avg": avg,
        "p50": _percentile(v_sorted, 50),
        "p95": _percentile(v_sorted, 95),
        "min": float(v_sorted[0]),
        "max": float(v_sorted[-1]),
    }


def get_session_metrics_summary(
    session: Session,
    chat_session_id: int,
    limit: int = 200,
) -> Dict[str, Any]:
    rows = get_metrics_by_session(session, chat_session_id, limit=limit)

    t_total = [r.t_total_ms for r in rows]
    t_first_text = [r.t_first_text_ms for r in rows]
    t_first_chunk = [r.t_first_chunk_ms for r in rows]
    t_open = [r.t_stream_open_ms for r in rows]
    bytes_streamed = [r.bytes_streamed for r in rows if r.bytes_streamed is not None]

    model_counts: Dict[str, int] = {}
    cache_counts: Dict[str, int] = {}
    for r in rows:
        if r.model:
            model_counts[r.model] = model_counts.get(r.model, 0) + 1
        if r.cache_backend:
            cache_counts[r.cache_backend] = cache_counts.get(r.cache_backend, 0) + 1

    total_bytes = sum(bytes_streamed) if bytes_streamed else 0
    avg_bytes = (total_bytes / len(bytes_streamed)) if bytes_streamed else None

    created_ts = [r.created_at for r in rows if r.created_at]
    start = min(created_ts).isoformat() if created_ts else None
    end = max(created_ts).isoformat() if created_ts else None

    return {
        "count": len(rows),
        "window": {"start": start, "end": end},
        "models": model_counts,
        "cache_backends": cache_counts,
        "t_total_ms": _summarize_series(t_total),
        "t_first_text_ms": _summarize_series(t_first_text),
        "t_first_chunk_ms": _summarize_series(t_first_chunk),
        "t_stream_open_ms": _summarize_series(t_open),
        "bytes_streamed": {
            "total": total_bytes,
            "avg": avg_bytes,
        },
    }


def get_global_metrics_summary(
    session: Session,
    limit: int = 500,
) -> Dict[str, Any]:
    stmt = select(InteractionMetric).order_by(InteractionMetric.id.desc()).limit(limit)
    rows = session.exec(stmt).all()

    t_total = [r.t_total_ms for r in rows]
    t_first_text = [r.t_first_text_ms for r in rows]
    t_first_chunk = [r.t_first_chunk_ms for r in rows]
    t_open = [r.t_stream_open_ms for r in rows]
    bytes_streamed = [r.bytes_streamed for r in rows if r.bytes_streamed is not None]

    model_counts: Dict[str, int] = {}
    cache_counts: Dict[str, int] = {}
    for r in rows:
        if r.model:
            model_counts[r.model] = model_counts.get(r.model, 0) + 1
        if r.cache_backend:
            cache_counts[r.cache_backend] = cache_counts.get(r.cache_backend, 0) + 1

    total_bytes = sum(bytes_streamed) if bytes_streamed else 0
    avg_bytes = (total_bytes / len(bytes_streamed)) if bytes_streamed else None

    created_ts = [r.created_at for r in rows if r.created_at]
    start = min(created_ts).isoformat() if created_ts else None
    end = max(created_ts).isoformat() if created_ts else None

    return {
        "count": len(rows),
        "window": {"start": start, "end": end},
        "models": model_counts,
        "cache_backends": cache_counts,
        "t_total_ms": _summarize_series(t_total),
        "t_first_text_ms": _summarize_series(t_first_text),
        "t_first_chunk_ms": _summarize_series(t_first_chunk),
        "t_stream_open_ms": _summarize_series(t_open),
        "bytes_streamed": {
            "total": total_bytes,
            "avg": avg_bytes,
        },
    }
