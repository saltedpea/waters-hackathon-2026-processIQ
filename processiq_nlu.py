"""Typo-tolerant intent and process matching for the Control Tower assistant."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

WORD_FIXES = {
    "fleat": "fleet", "flet": "fleet", "fleets": "fleet", "flit": "fleet",
    "week": "weak", "wek": "weak", "weeak": "weak",
    "wher": "where", "whear": "where", "whre": "where", "were": "where",
    "wat": "what", "wht": "what", "waht": "what",
    "shud": "should", "shold": "should", "shoud": "should", "shld": "should",
    "nxt": "next", "nex": "next", "improv": "improve", "improvment": "improve",
    "overveiw": "overview", "overiew": "overview", "ovreview": "overview",
    "proccess": "process", "proces": "process", "prossess": "process",
    "depatment": "department", "departmant": "department", "dept": "department",
    "ordr": "order", "oder": "order", "cach": "cash", "cashe": "cash",
    "clasify": "classify", "classfy": "classify",
    "goverance": "governance", "govrnance": "governance",
    "maturty": "maturity", "maturaty": "maturity",
    "howmany": "how many", "wats": "what",
    "fixfirst": "fix first", "nextmove": "next move",
}

INTENT_HINTS = {
    "fleet": ("fleet", "overview", "how many", "distribution", "department", "weak", "gap", "mix"),
    "planner": ("plan", "next", "should", "improve", "fix", "action", "move"),
    "coach": ("process", "owner", "this", "detail", "level", "gate"),
}


def normalize(text: str) -> str:
    raw = re.sub(r"[^a-z0-9\s\-#/]", " ", (text or "").lower())
    parts: List[str] = []
    for word in raw.split():
        parts.append(WORD_FIXES.get(word, word))
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _ratio(left: str, right: str) -> float:
    return SequenceMatcher(None, left, right).ratio()


def closest_word(word: str, lexicon: List[str], cutoff: float = 0.78) -> Optional[str]:
    if not word or len(word) < 3:
        return None
    ranked = sorted((( _ratio(word, item), item) for item in lexicon), reverse=True)
    if ranked and ranked[0][0] >= cutoff:
        return ranked[0][1]
    return None


def repair_message(text: str, lexicon: Optional[List[str]] = None) -> str:
    cleaned = normalize(text)
    extra = lexicon or []
    repaired = []
    for word in cleaned.split():
        hit = closest_word(word, extra, 0.84) if extra else None
        repaired.append(hit or word)
    return " ".join(repaired)


def detect_intent(text: str) -> str:
    cleaned = normalize(text)
    scores = {name: 0.0 for name in INTENT_HINTS}
    tokens = cleaned.split()
    for intent, hints in INTENT_HINTS.items():
        for hint in hints:
            if hint in cleaned:
                scores[intent] += 2.0
            else:
                for token in tokens:
                    if _ratio(token, hint) >= 0.8:
                        scores[intent] += 1.0
    if re.search(r"\b((?:prc[-_]?)?\d{3,}|p\d{3,})\b", cleaned):
        scores["coach"] += 2.5
        scores["planner"] += 1.0
    best = max(scores, key=scores.get)
    return best if scores[best] >= 1.5 else "supervisor"


def match_process(text: str, rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    cleaned = normalize(text)
    token = re.search(r"\b((?:prc[-_]?)?\d{3,}|p\d{3,})\b", cleaned)
    if token:
        needle = token.group(1).lower()
        for row in rows:
            if str(row.get("process_id", "")).lower() == needle:
                return row
    best = None
    best_score = 0.0
    for row in rows:
        name = str(row.get("process_name", "")).lower()
        spaced = re.sub(r"[^a-z0-9]+", " ", name).strip()
        compact = re.sub(r"[^a-z0-9]+", "", name)
        query = re.sub(r"[^a-z0-9]+", "", cleaned)
        score = max(_ratio(cleaned, name), _ratio(cleaned, spaced), _ratio(query, compact) if compact else 0)
        if name and name in cleaned:
            score = max(score, 0.93)
        if spaced and spaced in cleaned:
            score = max(score, 0.94)
        if compact and compact in query:
            score = max(score, 0.92)
        if score > best_score:
            best, best_score = row, score
    return best if best and best_score >= 0.58 else None
