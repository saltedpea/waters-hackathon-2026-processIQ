"""Rules scoring plus optional LLM narrative. Scores always come from processiq_core."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List

import requests

from processiq_celonis import ProcessSnapshot
from processiq_config import Settings
from processiq_core import (
    ALL_CODES,
    CRITERION_INDEX,
    PASS_THRESHOLD,
    assess_process,
    next_actions,
)


@dataclass
class ClassificationResult:
    process_name: str
    level: int
    label: str
    scores: Dict[int, float]
    blocked_by: List[str]
    results: Dict[str, bool]
    evidence: Dict[str, str]
    actions: List[str]
    narrative: str
    source: str = "rules"

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["scores"] = {str(key): value for key, value in self.scores.items()}
        return payload


def template_narrative(result: ClassificationResult) -> str:
    score_line = ", ".join(f"L{level} {score:.0f}%" for level, score in result.scores.items())
    actions = result.actions[:3] or ["No immediate gated gaps."]
    met = [code for code, flag in result.results.items() if flag]
    return (
        f"{result.process_name} is classified as Level {result.level} — {result.label}. "
        f"Every process starts at Level 1 and advances only when a level scores at least "
        f"{PASS_THRESHOLD:.0f}% and all prior levels have passed. Current scores: {score_line}. "
        f"{len(met)} of {len(ALL_CODES)} criteria are met. "
        f"Next actions: {' '.join(actions)}"
    )


def llm_narrative(result: ClassificationResult, settings: Settings) -> str:
    if not settings.llm_api_key:
        return template_narrative(result)
    catalog = []
    for code in ALL_CODES:
        level, criterion = CRITERION_INDEX[code]
        status = "met" if result.results.get(code) else "not met"
        catalog.append(f"{code} (L{level}, {criterion.weight}%): {status}. {result.evidence.get(code, '')}")
    prompt = (
        "Write a 120-180 word operational briefing for a process-intelligence lead. "
        "Do not change the maturity level or invent scores. Use only the facts below.\n"
        f"Process: {result.process_name}\n"
        f"Official level: {result.level} {result.label}\n"
        f"Scores: {result.scores}\n"
        f"Blocked by: {result.blocked_by}\n"
        f"Criteria:\n" + "\n".join(catalog)
    )
    response = requests.post(
        settings.llm_base_url.rstrip("/") + "/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
            "User-Agent": "ProcessIQ/1.0 (classifier)",
        },
        json={
            "model": settings.llm_model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": "You write concise process-maturity briefings. Never invent scores."},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=60,
    )
    if response.status_code >= 400:
        return template_narrative(result) + f" LLM narrative skipped ({response.status_code})."
    text = (((response.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return text or template_narrative(result)


def classify_snapshot(snapshot: ProcessSnapshot, settings: Settings | None = None) -> ClassificationResult:
    assessment = assess_process(snapshot.results)
    result = ClassificationResult(
        process_name=snapshot.process_name,
        level=int(assessment["level"]),
        label=str(assessment["label"]),
        scores=dict(assessment["scores"]),
        blocked_by=list(assessment["blocked_by"]),
        results=dict(snapshot.results),
        evidence=dict(snapshot.evidence),
        actions=next_actions(snapshot.results, int(assessment["level"])),
        narrative="",
        source=snapshot.source,
    )
    try:
        result.narrative = llm_narrative(result, settings or Settings())
    except Exception:
        result.narrative = template_narrative(result)
    return result
