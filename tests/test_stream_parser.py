import asyncio
import json
import types
import pytest

pytestmark = pytest.mark.asyncio

# Helpers to fabricate OpenAI-like stream chunks
class Delta:
    def __init__(self, content): self.content = content

class Choice:
    def __init__(self, delta): self.delta = delta

class Chunk:
    def __init__(self, text): self.choices = [Choice(Delta(text))]

async def make_stream(chunks):
    for piece in chunks:
        await asyncio.sleep(0)  # yield control
        yield Chunk(piece)

# Minimal fakes for DB & CRUD
class FakeSession:
    def commit(self): pass

class FakeChatSession:
    def __init__(self, id): self.id = id

created_messages = []

def fake_create_chat_message(session, chat_session_id, role, content, properties):
    created_messages.append({
        "chat_session_id": chat_session_id,
        "role": role,
        "content": content,
        "properties": properties
    })

@pytest.fixture(autouse=True)
def reset_created_messages():
    created_messages.clear()
    yield
    created_messages.clear()

async def collect_events(gen):
    events = []
    async for evt in gen:
        # evt lines look like: "event: text\ndata: \"hello\"\n\n"
        events.append(evt)
    return events

async def run_case(chunks):
    """
    Monkeypatch routers.chat.client.chat.completions.create to return our fake stream.
    Also monkeypatch create_chat_message to capture final write.
    """
    from looptracker_backend.routers import chat as chat_module

    async def fake_create(**kwargs):
        return types.SimpleNamespace(
            __aiter__=lambda self=None: make_stream(chunks),
            __anext__=None
        )

    # Patch OpenAI stream
    chat_module.client.chat.completions.create = fake_create  # type: ignore

    # Patch DB write
    chat_module.create_chat_message = fake_create_chat_message  # type: ignore

    session = FakeSession()
    chat_session = FakeChatSession(id=123)
    messages_for_ai = [{"role": "system", "content": "sys"}]  # length=1 triggers session_created

    gen = chat_module.stream_chat_generator(session, chat_session, messages_for_ai)
    events = await collect_events(gen)
    return events, created_messages

def parse_events(events):
    parsed = []
    for raw in events:
        lines = [l for l in raw.splitlines() if l.strip()]
        # expect pairs: event: X, data: Y
        e = None; d = None
        for line in lines:
            if line.startswith("event: "): e = line[len("event: "):]
            if line.startswith("data: "): d = line[len("data: "):]
        if e is not None:
            parsed.append((e, d))
    return parsed

def collect_text(events_parsed):
    texts = [json.loads(d) for (e, d) in events_parsed if e == "text"]
    return "".join(texts)

# --- Tests ---

async def test_clean_thought_then_json_then_response():
    chunks = [
        "<thought>private analysis</thought>{\"active_protocol\":\"A\",\"diagnostics\":{\"MIIS\":3}}|||RESPONSE|||Hello user. ",
        "More text."
    ]
    events, writes = await run_case(chunks)
    parsed = parse_events(events)
    assert parsed[0][0] == "session_created"
    # Metadata present and emitted once
    metas = [json.loads(d) for (e, d) in parsed if e == "metadata"]
    assert len(metas) == 1
    assert metas[0]["active_protocol"] == "A"
    # Only post-separator text streamed
    visible = collect_text(parsed)
    assert visible == "Hello user. More text."
    # DB write captured with private thought
    assert len(writes) == 1
    assert writes[0]["properties"]["thought_process"] == "private analysis"

async def test_split_tags_and_json_across_chunks():
    chunks = [
        "<tho", "ught>deep pri", "vate</th", "ought>",
        "{\"active_protocol\":\"B\",\"diagnostics\":{\"SRQ\":7}}|||RES",
        "PONSE|||Hi there",
        " and welcome."
    ]
    events, writes = await run_case(chunks)
    parsed = parse_events(events)
    metas = [json.loads(d) for (e, d) in parsed if e == "metadata"]
    assert len(metas) == 1 and metas[0]["active_protocol"] == "B"
    visible = collect_text(parsed)
    assert visible == "Hi there and welcome."
    assert writes[0]["properties"]["thought_process"] == "deep private"

async def test_json_incomplete_until_later_chunk():
    chunks = [
        "<thought>x</thought>{\"active_protocol\":\"",
        "C\",\"diagnostics\":{\"EFM\":4}}|||RESPONSE|||Answer."
    ]
    events, writes = await run_case(chunks)
    parsed = parse_events(events)
    metas = [json.loads(d) for (e, d) in parsed if e == "metadata"]
    assert len(metas) == 1 and metas[0]["active_protocol"] == "C"
    visible = collect_text(parsed)
    assert visible == "Answer."
    assert writes[0]["properties"]["thought_process"] == "x"
