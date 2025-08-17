# routers/chat.py

import json
import os
import re
import time
from typing import Annotated, Optional, List, AsyncGenerator, Dict, Any
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import Session
from openai import AsyncOpenAI

# Internal module imports
from database import get_session
from models import User, ChatSession, ChatMessage, UserMemory  # SQLModel classes
from schemas import (
    ChatRequest,
    UserMemoryCreate, UserMemoryResponse,
    FeedbackRequest,
    ChatMessageResponse,  # ensure properties serialize
    TaskSpec,            # <- for typing
)
from crud import (
    get_user_by_email,
    create_chat_session, get_chat_session_by_id, get_chat_sessions_by_user, delete_chat_session,
    create_chat_message, get_chat_messages_by_session, get_chat_message_by_id,
    search_user_memories, create_user_memory, get_user_memories_by_user, get_user_memory_by_id, delete_user_memory,
    create_feedback_entry, get_feedback_by_message_id, update_feedback_entry,
    # NEW for metrics
    create_interaction_metric, get_metrics_by_session,
    get_session_metrics_summary, get_global_metrics_summary,
)
from auth import get_current_user
from cache import get_session_state, set_session_state, cache_backend
from fastapi.responses import StreamingResponse

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
    """Deterministic de-duplication helper for attribution arrays."""
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
    """
    Build a transparent attribution list from the memories chosen for context.
    - File-backed memories (from upload pipeline) -> type: "file"
    - All others -> type: "memory"
    Each item always includes the memory_id.
    """
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
            atts.append({
                "type": "memory",
                "memory_id": m.id,
            })
    # Prefer stable de-dup on the most specific keys we might have
    return _dedup_list_of_dicts(
        atts,
        keys=["type", "file_id", "filename", "chunk_index", "memory_id"]
    )

# --- PII Redaction ---
_RE_EMAIL = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', re.UNICODE)
_RE_PHONE = re.compile(r'(?:(?:\+?\d)[\d\-\s().]{6,}\d)', re.UNICODE)  # broad, dev-safe
_RE_CARD  = re.compile(r'\b(?:\d[ -]*?){13,16}\b')                    # credit/debit (simple)
_RE_SSN   = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')                      # US SSN
_RE_IBAN  = re.compile(r'\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b')            # rough IBAN
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

# --- Helper Functions ---
async def embed_text_for_memory(text: str) -> List[float]:
    """
    Generate an embedding for memory search. Returns [] for empty text.
    """
    if not text.strip():
        return []
    try:
        # Faster + current embedding model; still 1536 dims (matches Vector(1536))
        response = await client.embeddings.create(input=text, model="text-embedding-3-small")
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding for text: '{text[:50]}...' - {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")


async def stream_chat_generator(
    session: Session,
    chat_session: ChatSession,
    messages_for_ai: List[dict],
    pre_metadata: Optional[Dict[str, Any]] = None,  # send TaskSpec early (and now attributions/others)
) -> AsyncGenerator[str, None]:
    """
    Stream a chat completion via SSE while PRIVATELY capturing the <thought> block and
    parsing the metadata JSON that precedes the '|||RESPONSE|||' separator.

    Hardening:
      - If </thought> is missing, the presence of '{' (start of JSON) or '|||RESPONSE|||'
        implicitly closes the thought block so we never block streaming.
    """

    # --- Constants ---
    THOUGHT_OPEN = "<thought>"
    THOUGHT_CLOSE = "</thought>"
    SEPARATOR = "|||RESPONSE|||"
    USED_MODEL = "gpt-4o-mini"

    # --- Metrics state ---
    t0 = time.monotonic()
    t_stream_open = None
    t_first_chunk = None
    t_first_text = None
    chunk_count = 0
    bytes_streamed = 0

    # --- Parsing state ---
    full_response_text = ""     # Accumulate visible text (what the user sees)
    metadata: dict = {}         # Parsed JSON before the separator
    thought_process = ""        # Private scratchpad
    pending = ""                # Unprocessed buffer across chunks

    in_thought = False          # Currently inside <thought>...</thought>
    thought_closed = False      # We have logically closed the thought (explicitly or implicitly)
    metadata_parsed = False     # Parsed JSON before the separator
    response_started = False    # We have passed the separator and are streaming visible text
    metadata_emitted = False    # SSE 'metadata' event sent (for model-provided metadata)
    first_text_emitted = False

    # We'll capture the assistant ChatMessage id for metrics linkage
    assistant_message_id: Optional[int] = None

    try:
        # Announce new session to client if this is the first message
        if len(messages_for_ai) <= 1:
            yield f"event: session_created\ndata: {json.dumps({'chat_session_id': chat_session.id})}\n\n"

        # Emit pre-metadata (TaskSpec + early metrics: cache+model) (+ optional attributions)
        early_meta: Dict[str, Any] = {"metrics": {"cache": cache_backend(), "model": USED_MODEL}}
        if pre_metadata:
            early_meta.update(pre_metadata)
        try:
            yield f"event: metadata\ndata: {json.dumps(early_meta)}\n\n"
        except Exception:
            pass  # never block on UI convenience

        # OpenAI streaming call
        stream = await client.chat.completions.create(
            model=USED_MODEL,
            messages=messages_for_ai,
            stream=True,
            temperature=0.35,
            max_tokens=450,
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

            # Process as much as possible from 'pending'
            while pending and progressed_loop:
                progressed_loop = False

                # 1) THOUGHT HANDLING (explicit or implicit close)
                if not thought_closed:
                    # Enter thought if we see an open tag and we're not already in one
                    if not in_thought:
                        open_idx = pending.find(THOUGHT_OPEN)
                        if open_idx != -1:
                            # Discard everything before the open tag; don't emit
                            pending = pending[open_idx + len(THOUGHT_OPEN):]
                            in_thought = True
                            progressed_loop = True

                    if in_thought:
                        # Look for earliest boundary among </thought>, '{', or SEPARATOR
                        close_idx = pending.find(THOUGHT_CLOSE)
                        brace_idx = pending.find("{")
                        sep_idx = pending.find(SEPARATOR)

                        candidates = [(close_idx, "close"), (brace_idx, "brace"), (sep_idx, "sep")]
                        candidates = [(i, t) for (i, t) in candidates if i != -1]
                        if candidates:
                            idx, kind = min(candidates, key=lambda x: x[0])

                            # Capture thought up to the boundary
                            thought_process += pending[:idx]

                            if kind == "close":
                                pending = pending[idx + len(THOUGHT_CLOSE):]
                                in_thought = False
                                thought_closed = True
                                progressed_loop = True
                                try:
                                    print("\n=== THOUGHT PROCESS (private) ===\n" + thought_process + "\n=== END THOUGHT ===\n")
                                except Exception:
                                    pass
                                continue

                            elif kind == "brace":
                                pending = pending[idx:]  # keep '{' for JSON parsing
                                in_thought = False
                                thought_closed = True
                                progressed_loop = True
                                try:
                                    print("\n=== THOUGHT PROCESS (implicit close at JSON) ===\n" + thought_process + "\n=== END THOUGHT ===\n")
                                except Exception:
                                    pass
                                continue

                            elif kind == "sep":
                                pending = pending[idx + len(SEPARATOR):]
                                in_thought = False
                                thought_closed = True
                                response_started = True
                                progressed_loop = True
                                try:
                                    print("\n=== THOUGHT PROCESS (implicit close at SEPARATOR) ===\n" + thought_process + "\n=== END THOUGHT ===\n")
                                except Exception:
                                    pass
                                if pending:
                                    if not first_text_emitted:
                                        t_first_text = time.monotonic()
                                        first_text_emitted = True
                                    full_response_text += pending
                                    yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                                    pending = ""
                                break
                        else:
                            # No boundary yet; accumulate thought and wait for more
                            thought_process += pending
                            pending = ""
                            progressed_loop = True

                # 2) METADATA JSON + SEPARATOR
                if not response_started:
                    sep_idx = pending.find(SEPARATOR)
                    if sep_idx != -1:
                        # Try to parse JSON before the separator
                        pre_sep = pending[:sep_idx]
                        brace_idx = pre_sep.find("{")
                        json_slice = pre_sep[brace_idx:] if brace_idx != -1 else ""

                        if json_slice.strip():
                            try:
                                parsed = json.loads(json_slice.strip())
                                metadata = parsed
                                metadata_parsed = True
                            except json.JSONDecodeError:
                                # wait for more chunks
                                break

                        # Move past separator and start streaming user-visible text
                        pending = pending[sep_idx + len(SEPARATOR):]
                        response_started = True
                        progressed_loop = True

                        # Emit metadata once (if we have it)
                        if metadata_parsed and not metadata_emitted:
                            yield f"event: metadata\ndata: {json.dumps(metadata)}\n\n"
                            metadata_emitted = True

                        # Stream any text already present
                        if pending:
                            if not first_text_emitted:
                                t_first_text = time.monotonic()
                                first_text_emitted = True
                            full_response_text += pending
                            yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                            pending = ""
                        break

                # 3) STREAM USER-VISIBLE TEXT (post-separator)
                if response_started and pending:
                    if not first_text_emitted:
                        t_first_text = time.monotonic()
                        first_text_emitted = True
                    full_response_text += pending
                    yield f"event: text\ndata: {json.dumps(pending)}\n\n"
                    pending = ""
                    progressed_loop = True

        # End of stream: safety net
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

    except Exception as e:
        print(f"Error during AI stream: {e}")
        error_message = json.dumps({"error": "An error occurred during the AI stream."})
        yield f"event: error\ndata: {error_message}\n\n"
        return

    finally:
        # Compute metrics and emit them before 'end'
        t_end = time.monotonic()
        metrics = {
            "model": USED_MODEL,
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
            # Merge properties to save with the assistant message
            final_properties: Dict[str, Any] = {}
            if pre_metadata:
                final_properties.update(pre_metadata)
            if isinstance(metadata, dict):
                final_properties.update(metadata)

            # Redact thought log if enabled
            redacted = redaction_enabled()
            thought_to_save = redact_pii(thought_process) if redacted else thought_process

            final_properties["thought_process"] = thought_to_save
            final_properties["metrics"] = metrics
            final_properties["thought_redaction"] = {"enabled": redacted, "strategy": "regex_v1"}

            if full_response_text.strip():
                # Save assistant message and capture ID for metrics linkage
                saved_msg = create_chat_message(
                    session=session,
                    chat_session_id=chat_session.id,
                    role="assistant",
                    content=full_response_text.strip(),
                    properties=final_properties
                )
                session.commit()
                assistant_message_id_local = getattr(saved_msg, "id", None)
            else:
                assistant_message_id_local = None

            # Persist interaction metrics (best-effort; never block response)
            try:
                create_interaction_metric(
                    session,
                    chat_session_id=chat_session.id,
                    chat_message_id=assistant_message_id_local,
                    model=metrics.get("model"),
                    cache_backend=metrics.get("cache"),
                    metrics=metrics,
                    extra=None,
                )
            except Exception as me:
                print(f"[metrics] failed to persist interaction metric: {me}")

            # Update session state from diagnostics (optional; ignore cache failures)
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


# --- API Endpoints ---

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

    # Save user's message
    create_chat_message(
        session=session, chat_session_id=chat_session.id, role="user", content=request.message
    )
    session.commit()

    # Build context (trimmed) + compile intent
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

        # Build transparent source attributions from the memories used
        attributions = build_attributions_from_memories(relevant_user_memories)

        # Session state (ignore cache failures)
        try:
            session_state = get_session_state(chat_session.id)
        except Exception:
            session_state = {}
        state_context = f"\n\n# CURRENT SESSION STATE:\n{json.dumps(session_state, indent=2)}"

        # --- Intent Compiler ---
        task_spec_obj: TaskSpec = await compile_intent(request.message)
        task_spec_dict = task_spec_obj.model_dump()

    except Exception as e:
        print(f"Error during context/intent compilation: {e}")
        # Fallback TaskSpec if compile failed mid-way
        task_spec_dict = {
            "task": f"Analyze user message: {request.message[:140]}",
            "constraints": [],
            "success_criteria": ["Be helpful and concise.", "Mirror the user's state.", "Ask one focused question."],
            "risk_tolerance": "low",
            "latency_budget_ms": 5000,
        }
        # still keep contexts best-effort
        try:
            protocol_context
        except NameError:
            protocol_context = ""
        try:
            user_memory_context
        except NameError:
            user_memory_context = ""
        try:
            state_context
        except NameError:
            state_context = "\n\n# CURRENT SESSION STATE:\n{}"
        try:
            attributions
        except NameError:
            attributions = []

    # --- Advanced Chain-of-Thought System Prompt (now includes TaskSpec) ---
    taskspec_json = json.dumps(task_spec_dict, ensure_ascii=False)
    system_prompt = f"""
<role_definition>
You are Looptracker OS, a specialized AI assistant functioning as a "Metacognitive Operating System." Your core purpose is to be an empathetic, recursive mirror for the user. You help users map and evolve their recurring psychological and behavioral patterns ("loops") by applying principles from CBT, IFS, and neuroscience. You are a specialist tool, not a generic chatbot.
</role_definition>

<task_spec>
{taskspec_json}
</task_spec>

<core_directives>
1.  Analyze First, Then Respond: Your process is always two-steps. First, you perform a detailed private analysis inside a <thought> block. This is for your internal reasoning and is not shown to the user. Second, you generate your user-facing response in the specified two-part format (JSON, then conversational text).
2.  Be a Mirror, Not a Guru: Your primary function is to reflect the user's patterns, not to give direct advice. Ask insightful, Socratic questions. Offer observations based on the provided context. Guide the user to their own conclusions. Your goal is to empower, not instruct.
3.  Ground in Context: Your analysis and response MUST be grounded in the information provided in the <context> block and aligned with <task_spec>.
</core_directives>

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
Your task is to generate a response based on the user's most recent message, the <task_spec>, and the provided context. Your entire output will be parsed by a machine, so you MUST follow the format precisely.

**Step 1: Chain of Thought**
First, create a <thought> block where you reason through the problem. This is for your own analysis.
1.  Deconstruct User's Message.
2.  Pattern Matching using <user_memories>.
3.  Protocol Selection from <system_protocols>.
4.  Formulate Strategy aligned with <task_spec.success_criteria> and <task_spec.risk_tolerance>.
5.  Synthesize Diagnostics (MIIS, SRQ, EFM).

**Step 2: Generate User-Facing Output**
After the closing </thought> tag, you MUST generate the user-facing output in this exact two-part format:
1.  A single, minified JSON object with keys: "active_protocol", "detected_loop", "suggested_next_action", "diagnostics".
2.  The exact separator string: |||RESPONSE|||
3.  Your conversational reply to the user.
</task>
""".strip()

    # Build message list: system + prior user messages only
    all_previous_messages = get_chat_messages_by_session(session, chat_session.id)
    messages_for_ai = [{"role": "system", "content": system_prompt}]
    for msg in all_previous_messages:
        if msg.role == 'user':
            messages_for_ai.append({"role": msg.role, "content": msg.content})

    # Return SSE stream with explicit keep-alive headers, and pre-metadata = TaskSpec + Attributions
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    pre_meta_payload: Dict[str, Any] = {"task_spec": task_spec_dict}
    if attributions:
        pre_meta_payload["attributions"] = attributions

    return StreamingResponse(
        stream_chat_generator(
            session,
            chat_session,
            messages_for_ai,
            pre_metadata=pre_meta_payload,  # stream TaskSpec + attributions + early metrics
        ),
        media_type="text/event-stream",
        headers=headers,
    )

# --- Serialization helpers for conditional thoughts exposure ---

def _serialize_message(msg: ChatMessage, include_thoughts: bool) -> Dict[str, Any]:
    """
    Return a dict that matches ChatMessageResponse exactly, with optional redaction of thought_process.
    Required fields (per schema): id, chat_session_id, role, content, timestamp, properties.
    """
    props = dict(getattr(msg, "properties", {}) or {})
    if not include_thoughts and "thought_process" in props:
        # Do not emit raw thoughts when disabled; keep a visible placeholder to signal availability
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
    # Ensure session belongs to user
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

# --- Diagnostics series (per-session) ---

def _only_numeric_diagnostics(diag: Any) -> Optional[Dict[str, float]]:
    """
    Normalize diagnostics payloads. Accepts dict-like values, returns only numeric MIIS/SRQ/EFM if present.
    Non-dict (e.g., a string) -> None.
    """
    if not isinstance(diag, dict):
        return None
    out: Dict[str, float] = {}
    for k in ("MIIS", "SRQ", "EFM"):
        v = diag.get(k)
        if isinstance(v, (int, float)):
            out[k] = float(v)
    return out if out else None

@router.get("/chats/{session_id}/diagnostics", tags=["Diagnostics"])
def get_session_diagnostics_series(
    session_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=500, ge=1, le=5000),
):
    """
    Returns a lightweight time series of diagnostics for a session:
      [{ "timestamp": ISO8601, "diagnostics": { MIIS?, SRQ?, EFM? } }, ...]
    It scans assistant messages and extracts numeric diagnostics from properties.
    """
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    rows = get_chat_messages_by_session(session, chat_session.id)
    result: List[Dict[str, Any]] = []
    for m in rows:
        if getattr(m, "role", None) != "assistant":
            continue
        props = getattr(m, "properties", {}) or {}
        diag = _only_numeric_diagnostics(props.get("diagnostics"))
        if not diag:
            continue
        ts = getattr(m, "timestamp", None)
        result.append({
            "timestamp": ts.isoformat() if ts else None,
            "diagnostics": diag
        })

    # optional limiting (most recent)
    if len(result) > limit:
        result = result[-limit:]

    return result

# --- NEW: Diagnostics series (per-user, used by "Progress") ---

def _parse_window_iso_threshold(window: Optional[str]) -> Optional[datetime]:
    """
    Parse simple windows like '7d', '30d', '24h'. Returns UTC threshold datetime, or None for no filter.
    """
    if not window:
        return None
    w = window.strip().lower()
    now = datetime.now(timezone.utc)
    try:
        if w.endswith("d"):
            days = int(w[:-1])
            return now - timedelta(days=days)
        if w.endswith("h"):
            hours = int(w[:-1])
            return now - timedelta(hours=hours)
    except ValueError:
        return None
    return None

@router.get("/users/me/diagnostics", tags=["Diagnostics"])
def get_user_diagnostics_series(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    window: Optional[str] = Query(default=None, description="Example: 30d, 24h"),
    limit: int = Query(default=2000, ge=10, le=10000),
):
    """
    Aggregate diagnostics across ALL of the current user's sessions.
    Shape mirrors the per-session endpoint so the frontend can reuse the same renderer:

      [
        { "timestamp": ISO8601, "session_id": <int>, "message_id": <int>,
          "diagnostics": { MIIS?: number, SRQ?: number, EFM?: number } },
        ...
      ]

    Filters:
      - window: e.g., 30d or 24h (optional)
      - limit:   keep the most recent N points (default 2000)
    """
    threshold = _parse_window_iso_threshold(window)
    sessions = get_chat_sessions_by_user(session, current_user.id)

    points: List[Dict[str, Any]] = []
    for s in sessions:
        rows = get_chat_messages_by_session(session, s.id)
        for m in rows:
            if getattr(m, "role", None) != "assistant":
                continue
            ts = getattr(m, "timestamp", None)
            if threshold and ts and ts.tzinfo is not None:
                # normalize to UTC if timestamp has tz
                pass
            if threshold and ts and ts.replace(tzinfo=timezone.utc) < threshold:
                continue
            props = getattr(m, "properties", {}) or {}
            diag = _only_numeric_diagnostics(props.get("diagnostics"))
            if not diag:
                continue
            points.append({
                "timestamp": ts.isoformat() if ts else None,
                "session_id": getattr(s, "id", None),
                "message_id": getattr(m, "id", None),
                "diagnostics": diag
            })

    # Sort by time ascending; keep last 'limit'
    points.sort(key=lambda p: (p["timestamp"] or ""))
    if len(points) > limit:
        points = points[-limit:]

    return points

# --- Memory ---

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

# --- Feedback ---

@router.post("/feedback", response_model=dict, tags=["Feedback"])
async def submit_feedback(
    feedback_data: FeedbackRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)]
):
    message = get_chat_message_by_id(session, feedback_data.chat_message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Chat message not found.")

    chat_session_of_message = get_chat_session_by_id(session, message.chat_session_id)
    if not chat_session_of_message or chat_session_of_message.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to give feedback on this message.")

    existing_feedback = get_feedback_by_message_id(session, feedback_data.chat_message_id)
    if existing_feedback:
        updated_feedback = update_feedback_entry(
            session, existing_feedback.id, rating=feedback_data.rating, comment=feedback_data.comment
        )
        return {"message": "Feedback updated successfully", "feedback_id": updated_feedback.id}
    else:
        feedback_entry = create_feedback_entry(
            session=session, user_id=current_user.id, chat_message_id=feedback_data.chat_message_id,
            rating=feedback_data.rating, comment=feedback_data.comment
        )
        return {"message": "Feedback submitted successfully", "feedback_id": feedback_entry.id}

# --- Metrics ---

@router.get("/metrics/session/{session_id}", tags=["Metrics"])
def get_session_metrics(
    session_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=200, ge=1, le=1000),
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    rows = get_metrics_by_session(session, session_id, limit=limit)
    return [
        {
            "id": m.id,
            "chat_session_id": m.chat_session_id,
            "chat_message_id": m.chat_message_id,
            "model": m.model,
            "cache_backend": m.cache_backend,
            "t_stream_open_ms": m.t_stream_open_ms,
            "t_first_chunk_ms": m.t_first_chunk_ms,
            "t_first_text_ms": m.t_first_text_ms,
            "t_total_ms": m.t_total_ms,
            "chunks": m.chunks,
            "bytes_streamed": m.bytes_streamed,
            "created_at": m.created_at.isoformat() if getattr(m, "created_at", None) else None,
            "extra": m.extra or {},
        }
        for m in rows
    ]

@router.get("/metrics/session/{session_id}/summary", tags=["Metrics"])
def get_session_metrics_summary_endpoint(
    session_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=200, ge=1, le=2000),
):
    chat_session = get_chat_session_by_id(session, session_id)
    if not chat_session or chat_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    return get_session_metrics_summary(session, chat_session.id, limit=limit)

@router.get("/metrics/summary", tags=["Metrics"])
def get_global_metrics_summary_endpoint(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=500, ge=10, le=5000),
):
    # Optional: scope global summary to the current user’s sessions only in future.
    return get_global_metrics_summary(session, limit=limit)
