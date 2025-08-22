# routers/triage.py
from fastapi import APIRouter
from typing import List, Optional, Tuple
import re

from schemas import TriageRequest, TriageResponse, TriageLabel

router = APIRouter(prefix="/triage", tags=["triage"])

# --- Lightweight keyword scoring (SE / ACT / IFS) ---

BODY_TERMS = {
    "chest","stomach","belly","gut","throat","neck","jaw","headache",
    "dizzy","tingle","tingling","nausea","nauseous","butterflies",
    "tight","tightness","pressure","pounding","heart racing","palpitations",
    "sweaty","sweating","clammy","shaky","short of breath","breath","breathing"
}
IFS_TERMS = {
    "part of me","a part of me","protector","manager","firefighter","exile",
    "inner child","burdened","polarized","blend","blended"
}
FUSION_TERMS = {
    "always","never","must","should","have to","can’t","can't",
    "i am a failure","i’m a failure","i am worthless","i’m worthless",
    "i am broken","i’m broken"
}

def _contains_any(text: str, phrases) -> bool:
    t = text.lower()
    return any(p in t for p in phrases)

def _score_se(text: str, distress: Optional[float]) -> float:
    base = 0.0
    if _contains_any(text, BODY_TERMS): base += 0.6
    if distress is not None and distress >= 7: base += 0.25
    return min(base, 1.0)

def _score_ifs(text: str) -> float:
    base = 0.0
    if _contains_any(text, IFS_TERMS): base += 0.7
    if re.search(r"\b(part|piece)\s+of\s+me\b", text.lower()): base += 0.3
    return min(base, 1.0)

def _score_act(text: str) -> float:
    base = 0.0
    if _contains_any(text, FUSION_TERMS): base += 0.6
    if re.search(r"\bi am\b\s+(a\s+)?(failure|loser|worthless|broken|bad)", text.lower()):
        base += 0.3
    return min(base, 1.0)

def _pick_label(text: str, distress: Optional[float]) -> Tuple[TriageLabel, float, str, Optional[TriageLabel]]:
    se = _score_se(text, distress)
    ifs = _score_ifs(text)
    act = _score_act(text)

    scores = [("SE", se), ("IFS", ifs), ("ACT", act)]
    scores.sort(key=lambda x: x[1], reverse=True)
    (label, conf), (second_label, second_conf), _ = scores

    if label == "SE":
        rationale = "Detected somatic markers or high distress → regulate first (SE)."
    elif label == "IFS":
        rationale = "Detected parts-language → explore with compassionate inquiry (IFS)."
    else:
        rationale = "Detected fused/global thoughts → defuse and re-anchor to values (ACT)."

    confidence = min(max(conf, 0.55 if conf > 0 else 0.5), 0.95)
    second_choice: Optional[TriageLabel] = second_label if second_conf >= 0.4 else None
    return label, confidence, rationale, second_choice

SE_PROMPTS: List[str] = [
    "Let’s pendulate ~90s: (1) find one safe sensation (feet/chair), (2) notice the most activated area, (3) gently alternate. What shifts?",
    "Where in your body is this strongest? Name location + 0–10 intensity, then try 5 slower breaths—did it change even 1 point?"
]
ACT_PROMPTS: List[str] = [
    "Finish: “I’m having the thought that …”. Say it once aloud. What changes when it’s ‘a thought’ not ‘the truth’?",
    "Pick one value (e.g., Courage, Honesty, Connection). Name one 2-minute action in service of it."
]
IFS_PROMPTS: List[str] = [
    "Find the part most stirred. Where do you sense it? How old does it feel? Let it know you’re here with curiosity.",
    "Ask that part: what are you afraid would happen if you didn’t show up now?"
]

def _prompts_for(label: TriageLabel) -> List[str]:
    if label == "SE": return SE_PROMPTS[:2]
    if label == "IFS": return IFS_PROMPTS[:2]
    return ACT_PROMPTS[:2]

@router.post("/classify", response_model=TriageResponse)
def classify(req: TriageRequest):
    label, confidence, rationale, second_choice = _pick_label(
        req.capture_text, req.distress_0_10
    )
    return TriageResponse(
        label=label,
        confidence=confidence,
        rationale=rationale,
        prompts=_prompts_for(label),
        second_choice=second_choice
    )
