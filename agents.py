# agents.py

import os
import json
from typing import Optional
from openai import AsyncOpenAI
from pydantic import ValidationError

# Internal module imports
import schemas

# --- Agent Clients ---
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# --- INTENT COMPILER AGENT ---

INTENT_COMPILER_SYSTEM = """You are the Intent Compiler for Looptracker OS.
Your only job:
- Convert the user's message into a JSON object that strictly matches the TaskSpec schema.
- Output ONLY the JSON object. No prose. No code fences. No commentary."""

TASKSPEC_INSTRUCTIONS = """
The JSON MUST have these fields:
{
  "task": "Concise summary of the user's core goal or question.",
  "constraints": ["List of any explicit or implicit constraints, e.g., 'avoid advice', 'use Socratic style'."],
  "success_criteria": ["What a successful response should achieve, e.g., 'mirror emotions', 'identify loop', 'ask 1-2 precise questions'."],
  "risk_tolerance": "One of 'low', 'med', or 'high'. Default 'med'. If user is distressed/sensitive → 'low'.",
  "latency_budget_ms": 5000
}
Rules:
- Keep 'task' under ~140 chars.
- Keep arrays short (<= 5 items); prioritize signal over coverage.
- Prefer 'low' risk if there's any chance of emotional harm.
- If the user asks for concrete info/instructions and shows low emotional risk → 'med' or 'high' depending on urgency.
"""

async def _validate_taskspec_json(json_str: str) -> schemas.TaskSpec:
    # First attempt: direct validation of the returned content
    return schemas.TaskSpec.model_validate_json(json_str)

def _coerce_taskspec_from_loose_text(text: str) -> Optional[schemas.TaskSpec]:
    """
    Try to rescue when the LLM accidentally wraps JSON with prose.
    Extract the first {...} block and validate it.
    """
    try:
        first = text.find("{")
        last = text.rfind("}")
        if first == -1 or last == -1 or last <= first:
            return None
        snippet = text[first:last+1]
        return schemas.TaskSpec.model_validate_json(snippet)
    except Exception:
        return None

async def compile_intent(user_message: str) -> schemas.TaskSpec:
    """
    Takes a raw user message and compiles it into a structured TaskSpec.
    This is the first agent in the reasoning pipeline.
    - Fast model
    - JSON response enforced
    - One-shot self-repair if validation fails
    - Safe fallback
    """
    messages = [
        {"role": "system", "content": INTENT_COMPILER_SYSTEM},
        {"role": "system", "content": TASKSPEC_INSTRUCTIONS.strip()},
        {"role": "user", "content": user_message},
    ]

    try:
        # Use a fast model and JSON mode
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=300,
        )
        raw = resp.choices[0].message.content or ""
        try:
            return await _validate_taskspec_json(raw)
        except (json.JSONDecodeError, ValidationError):
            # Attempt to coerce from loose text (rare with JSON mode, but safe to include)
            rescued = _coerce_taskspec_from_loose_text(raw)
            if rescued:
                return rescued
            raise

    except Exception as e:
        # Log and return a safe default TaskSpec (LOW risk by default)
        print(f"INTENT COMPILER ERROR: {e}")
        return schemas.TaskSpec(
            task=f"Analyze user message: {user_message[:140]}",
            constraints=[],
            success_criteria=["Be helpful and concise.", "Mirror the user's state.", "Ask one focused question."],
            risk_tolerance=schemas.RiskTolerance.LOW,
            latency_budget_ms=5000,
        )
