# routers/chat.py

import json
import os
import re
import time
from typing import Annotated, Optional, List, AsyncGenerator, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session
from openai import AsyncOpenAI
from fastapi.responses import StreamingResponse

# Internal module imports
from database import get_session
from models import User, ChatSession, ChatMessage, UserMemory
from schemas import (
    ChatRequest,
    ChatMessageResponse,   # ensure properties serialize
    TaskSpec,              # typing only
)
from crud import (
    get_user_by_email,
    create_chat_session, get_chat_session_by_id, get_chat_sessions_by_user, delete_chat_session,
    create_chat_message, get_chat_messages_by_session, get_chat_message_by_id,
    search_user_memories,
)
from auth import get_current_user
from cache import get_session_state, set_session_state, cache_backend

# NEW: Intent Compiler
from agents import compile_intent

# --- Router and Clients ---
router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# --- Small utils ---
def clamp_text(txt: str, max_chars: int) -> str:
    if len(txt) <= max_chars:
        return txt
    return txt[: max_chars].rstrip() + "\n… (truncated)"

def join_and_clamp(blocks: List[str], max_chars: int) -> str:
    combined = "\n\n".join(blocks)
    return clamp_text(combined, max_chars)

def _dedup_list_of_dicts(items: List[Dict[str, Any]], keys: List[str]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for it in items:
        key = tuple(it.get(k) for k in keys)
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out

def build_attributions_from_memories(memories: List[UserMemory]) -> List[Dict[str, Any]]:
    atts: List[Dict[str, Any]] = []
    for m in memories:
        props = getattr(m, "properties", {}) or {}
        source = props.get("source")
        if source == "file_upload":
            atts.append({
                "type": "file",
                "file_id": props.get("file_id"),
                "filename": props.get("filename") or props.get("file_name"),
                "chunk_index": props.get("chunk_index"),
                "memory_id": m.id,
            })
        else:
            atts.append({"type": "memory", "memory_id": m.id})
    return _dedup_list_of_dicts(atts, keys=["type", "file_id", "filename", "chunk_index", "memory_id"])

# --- PII Redaction ---
_RE_EMAIL = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', re.UNICODE)
_RE_PHONE = re.compile(r'(?:(?:\+?\d)[\d\-\s().]{6,}\d)', re.UNICODE)
_RE_CARD  = re.compile(r'\b(?:\d[ -]*?){13,16}\b')
_RE_SSN   = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')
_RE_IBAN  = re.compile(r'\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b')
_RE_ADDR  = re.compile(
    r'\b\d{1,5}\s+[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+'
    r'(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way)\b',
    re.IGNORECASE
)

def redact_pii(text: str) -> str:
    if not text:
        return text
    t = text
    t = _RE_EMAIL.sub('[email]', t)
    t = _RE_PHONE.sub('[phone]', t)
    t = _RE_CARD.sub('[card]', t)
    t = _RE_SSN.sub('[ssn]', t)
    t = _RE_IBAN.sub('[iban]', t)
    t = _RE_ADDR.sub('[address]', t)
    return t

def redaction_enabled() -> bool:
    return (os.getenv("THOUGHT_LOG_REDACT", "on").strip().lower() in ("1", "true", "on", "yes"))

# --- Helpers ---
async def embed_text_for_memory(text: str) -> List[float]:
    if not text.strip():
        return []
    try:
        response = await client.embeddings.create(input=text, model="text-embedding-3-small")
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate embedding")

async def stream_chat_generator(
    session: Session,
    chat_session: ChatSession,
    messages_for_ai: List[dict],
    pre_metadata: Optional[Dict[str, Any]] = None,
) -> AsyncGenerator[str, None]:
    THOUGHT_OPEN = "<thought>"
    THOUGHT_CLOSE = "</thought>"
    SEPARATOR = "|||RESPONSE|||"
    USED_MODEL = "gpt-4o-mini"

    t0 = time.monotonic()
    t_stream_open = None
    t_first_chunk = None
    t_first_text = None
    chunk_count = 0
    bytes_streamed = 0

    full_response_text = ""
    metadata: dict = {}
    thought_process = ""
    pending = ""

    in_thought = False
    thought_closed = False
    metadata_parsed = False
    response_started = False
    metadata_emitted = False
    first_text_emitted = False

    try:
        if len(messages_for_ai) <= 1:
            yield f"event: session_created\ndata: {json.dumps({'chat_session_id': chat_session.id})}\n\n"

        early_meta: Dict[str, Any] = {"metrics": {"cache": cache_backend(), "model": USED_MODEL}}
        if pre_metadata:
            early_meta.update(pre_metadata)
        yield f"event: metadata\ndata: {json.dumps(early_meta)}\n\n"

        stream = await client.chat.completions.create(
            model=USED_MODEL, messages=messages_for_ai, stream=True, temperature=0.35, max_tokens=450
        )
        t_stream_open = time.monotonic()

        async for chunk in stream:
            chunk_content = chunk.choices[0].delta.content or ""
            if chunk_content:
                chunk_count += 1
                bytes_streamed += len(chunk_content.encode("utf-8"))
                if t_first_chunk is None:
                    t_first_chunk = time.monotonic()

            pending += chunk_content
            progressed_loop = True
            while pending and progressed_loop:
                progressed_loop = False

                if not thought_closed:
                    if not in_thought:
                        open_idx = pending.find(THOUGHT_OPEN)
                        if open_idx != -1:
                            pending = pending[open_idx + len(THOUGHT_OPEN):]
                            in_thought = True
                            progressed_loop = True

                    if in_thought:
                        close_idx = pending.find(THOUGHT_CLOSE)
                        brace_idx = pending.find("{")
                        sep_idx = pending.find(SEPARATOR)
                        candidates = [(close_idx, "close"), (brace_idx, "brace"), (sep_idx, "sep")]
                        candidates = [(i, t) for (i, t) in candidates if i != -1]
                        if candidates:
                            idx, kind = min(candidates, key=lambda x: x[0])
                            thought_process += pending[:idx]
                            if kind == "close":
                                pending = pending[idx + len(THOUGHT_CLOSE):]
                                in_thought = False
                                thought_closed = True
                                progressed_loop = True
                                continue
                            elif kind == "brace":
                                pending = pending[idx:]
                                in_thought = False
                                thought_closed = True
                                progressed_loop = True
                                continue
                            elif kind == "sep":
                                pending = pending[idx + len(SEPARATOR):]
                                in_thought = False
                                thought_closed = True
                                response_started = True
                                progressed_loop = True
                                if pending:
                                    if not first_text_emitted:
                                        t_first_text = time.monotonic()
                                        first_text_emitted = True
                                    full_response_text += pending
                                    yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                                    pending = ""
                                break
                        else:
                            thought_process += pending
                            pending = ""
                            progressed_loop = True

                if not response_started:
                    sep_idx = pending.find(SEPARATOR)
                    if sep_idx != -1:
                        pre_sep = pending[:sep_idx]
                        brace_idx = pre_sep.find("{")
                        json_slice = pre_sep[brace_idx:] if brace_idx != -1 else ""
                        if json_slice.strip():
                            try:
                                parsed = json.loads(json_slice.strip())
                                metadata = parsed
                                metadata_parsed = True
                            except json.JSONDecodeError:
                                break
                        pending = pending[sep_idx + len(SEPARATOR):]
                        response_started = True
                        progressed_loop = True
                        if metadata_parsed and not metadata_emitted:
                            yield f"event: metadata\ndata: {json.dumps(metadata)}\n\n"
                            metadata_emitted = True
                        if pending:
                            if not first_text_emitted:
                                t_first_text = time.monotonic()
                                first_text_emitted = True
                            full_response_text += pending
                            yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                            pending = ""
                        break

                if response_started and pending:
                    if not first_text_emitted:
                        t_first_text = time.monotonic()
                        first_text_emitted = True
                    full_response_text += pending
                    yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                    pending = ""
                    progressed_loop = True

        if not response_started and pending:
            sanitized = re.sub(r"<thought>.*?</thought>", "", pending, flags=re.DOTALL)
            sanitized = sanitized.replace("<thought>", "").replace("</thought>", "")
            if sanitized.strip():
                if not first_text_emitted:
                    t_first_text = time.monotonic()
                    first_text_emitted = True
                full_response_text += sanitized
                yield f"event: text\ndata: {json.dumps(sanitized)}\n\n"

        if metadata_parsed and not metadata_emitted:
            yield f"event: metadata\ndata: {json.dumps(metadata)}\n\n"

    finally:
        t_end = time.monotonic()
        metrics = {
            "model": "gpt-4o-mini",
            "cache": cache_backend(),
            "t_stream_open_ms": int(((t_stream_open or t_end) - t0) * 1000),
            "t_first_chunk_ms": int(((t_first_chunk or t_end) - t0) * 1000),
            "t_first_text_ms": int(((t_first_text or t_end) - t0) * 1000),
            "t_total_ms": int((t_end - t0) * 1000),
            "chunks": chunk_count,
            "bytes_streamed": bytes_streamed,
        }
        try:
            yield f"event: metadata\ndata: {json.dumps({'metrics': metrics})}\n\n"
        except Exception:
            pass

        try:
            final_properties: Dict[str, Any] = {}
            if pre_metadata:
                final_properties.update(pre_metadata)
            if isinstance(metadata, dict):
                final_properties.update(metadata)

            redacted = redaction_enabled()
            thought_to_save = redact_pii(thought_process) if redacted else thought_process

            final_properties["thought_process"] = thought_to_save
            final_properties["metrics"] = metrics
            final_properties["thought_redaction"] = {"enabled": redacted, "strategy": "regex_v1"}

            if full_response_text.strip():
                create_chat_message(
                    session=session,
                    chat_session_id=chat_session.id,
                    role="assistant",
                    content=full_response_text.strip(),
                    properties=final_properties
                )
                session.commit()

            if isinstance(metadata, dict):
                new_diagnostics = metadata.get("diagnostics")
                if new_diagnostics and isinstance(new_diagnostics, dict):
                    try:
                        session_state = get_session_state(chat_session.id)
                    except Exception:
                        session_state = {}
                    session_state.update(new_diagnostics)
                    try:
                        set_session_state(chat_session.id, session_state)
                    except Exception:
                        pass

            yield f"event: end\ndata: {json.dumps({'message': 'Stream ended'})}\n\n"
        except Exception as e:
            print(f"Error in generator's finally block: {e}")

# --- /chat ---
@router.post("/chat", tags=["Chat"])
async def chat_with_ai(
    request: ChatRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    user_id = current_user.id

    system_user = get_user_by_email(session, email="system_ai@looptracker.os")
    if not system_user:
        raise HTTPException(status_code=500, detail="System AI user not configured.")
    system_user_id = system_user.id

    if request.chat_session_id:
        chat_session = get_chat_session_by_id(session, request.chat_session_id)
        if not chat_session or chat_session.user_id != user_id:
            raise HTTPException(status_code=404, detail="Chat session not found or does not belong to user")
    else:
        chat_session = create_chat_session(session, user_id=user_id)
        session.commit()
        session.refresh(chat_session)

    create_chat_message(session=session, chat_session_id=chat_session.id, role="user", content=request.message)
    session.commit()

    # Build context
    try:
        user_message_embedding = await embed_text_for_memory(request.message)

        relevant_protocols = search_user_memories(
            session=session, user_id=system_user_id, query_embedding=user_message_embedding, limit=6
        )
        protocol_blocks = [f"--- Relevant Protocol ---\n{clamp_text(mem.content, 800)}" for mem in relevant_protocols]
        protocol_context = join_and_clamp(protocol_blocks, 6000)

        relevant_user_memories = search_user_memories(
            session=session, user_id=user_id, query_embedding=user_message_embedding, limit=8
        )
        user_blocks = [f"--- User's Relevant Memory ---\n{clamp_text(mem.content, 800)}" for mem in relevant_user_memories]
        user_memory_context = join_and_clamp(user_blocks, 6000)

        attributions = build_attributions_from_memories(relevant_user_memories)

        try:
            session_state = get_session_state(chat_session.id)
        except Exception:
            session_state = {}
        state_context = f"\n\n# CURRENT SESSION STATE:\n{json.dumps(session_state, indent=2)}"

        task_spec_obj: TaskSpec = await compile_intent(request.message)
        task_spec_dict = task_spec_obj.model_dump()

    except Exception:
        task_spec_dict = {
            "task": f"Analyze user message: {request.message[:140]}",
            "constraints": [],
            "success_criteria": ["Be helpful and concise.", "Mirror the user's state.", "Ask one focused question."],
            "risk_tolerance": "low",
            "latency_budget_ms": 5000,
        }
        protocol_context = ""
        user_memory_context = ""
        state_context = "\n\n# CURRENT SESSION STATE:\n{}"
        attributions = []

    taskspec_json = json.dumps(task_spec_dict, ensure_ascii=False)
    system_prompt = f"""
<role_definition>
You are Looptracker OS, a specialized AI assistant functioning as a "Metacognitive Operating System."
</role_definition>

<task_spec>
{taskspec_json}
</task_spec>

<context>
<user_memories>
{user_memory_context}
</user_memories>

<system_protocols>
{protocol_context}
</system_protocols>

<session_state>
{state_context}
</session_state>
</context>

<task>
Create a <thought> block for private reasoning, then emit:
1) A minified JSON with keys: "active_protocol","detected_loop","suggested_next_action","diagnostics"
2) The separator: |||RESPONSE|||
3) Conversational reply.
</task>
""".strip()

    all_previous_messages = get_chat_messages_by_session(session, chat_session.id)
    messages_for_ai = [{"role": "system", "content": system_prompt}]
    for msg in all_previous_messages:
        if msg.role == 'user':
            messages_for_ai.append({"role": msg.role, "content": msg.content})

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    pre_meta_payload: Dict[str, Any] = {"task_spec": task_spec_dict}
    if attributions:
        pre_meta_payload["attributions"] = attributions

    return StreamingResponse(
        stream_chat_generator(session, chat_session, messages_for_ai, pre_metadata=pre_meta_payload),
        media_type="text/event-stream",
        headers=headers,
    )

# --- Serialization helper for history ---
def _serialize_message(msg: ChatMessage, include_thoughts: bool) -> Dict[str, Any]:
    props = dict(getattr(msg, "properties", {}) or {})
    if not include_thoughts and "thought_process" in props:
        props["thought_process"] = "[redacted]"
    return {
        "id": getattr(msg, "id", None),
        "chat_session_id": getattr(msg, "chat_session_id", None),
        "role": getattr(msg, "role", None),
        "content": getattr(msg, "content", ""),
        "timestamp": getattr(msg, "timestamp", None),
        "properties": props,
    }

# --- Chat History ---
@router.get("/chats", response_model=List[ChatSession], tags=["Chat History"])
def get_user_chat_sessions_endpoint(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    return get_chat_sessions_by_user(session, current_user.id)

@router.get("/chats/{session_id}/messages", response_model=List[ChatMessageResponse], tags=["Chat History"])
def get_chat_session_messages_endpoint(
    session_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    include_thoughts: bool = Query(default=True)
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    rows = get_chat_messages_by_session(session, chat_session.id)
    return [_serialize_message(m, include_thoughts) for m in rows]

@router.get("/chats/{session_id}/messages/{message_id}", response_model=ChatMessageResponse, tags=["Chat History"])
def get_single_message_endpoint(
    session_id: int,
    message_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    include_thoughts: bool = Query(default=True)
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    msg = get_chat_message_by_id(session, message_id)
    if not msg or msg.chat_session_id != session_id:
        raise HTTPException(status_code=404, detail="Message not found.")
    return _serialize_message(msg, include_thoughts)

@router.delete("/chats/{session_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Chat History"])
def delete_chat_session_endpoint(
    session_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    delete_chat_session(session, chat_session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
