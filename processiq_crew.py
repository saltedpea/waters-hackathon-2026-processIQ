"""Multi-agent assistant for the ProcessIQ Control Tower.

Facts always come from the dataset through the tool functions below. The model
(Ollama first, Cursor API second) only narrates those facts. If no model is
reachable the router still answers from the same facts.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import requests

from processiq_nlu import detect_intent, match_process, normalize, repair_message

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")
CURSOR_API_BASE = os.environ.get("CURSOR_API_BASE", "https://api.cursor.com/v1")
CURSOR_MODEL = os.environ.get("CURSOR_MODEL", "composer-2.5")
STATE_REF = None

GAP_WORDS = ("gap", "blocker", "blocking", "stuck", "issue", "problem", "wrong", "fail", "why", "weak")
NEXT_WORDS = ("next", "plan", "should", "improve", "fix", "action", "move", "recommend", "advice")
FLEET_WORDS = ("fleet", "overview", "how many", "distribution", "department", "summary", "everything", "all process")
REFERENTIAL = ("this process", "this one", "that process", "that one", "it ", " it", "its ", "same process", "this", "here")


def bind_state(state):
    global STATE_REF
    STATE_REF = state


def _state_df():
    if STATE_REF is not None:
        return STATE_REF.get("df")
    return None


# --------------------------------------------------------------------------
# tools: the only source of numbers
# --------------------------------------------------------------------------

def tool_fleet_overview(_: Dict[str, Any]) -> Dict[str, Any]:
    df = _state_df()
    if df is None or df.empty:
        return {"error": "No dataset loaded"}
    levels = {int(k): int(v) for k, v in df["maturity_level"].value_counts().sort_index().items()}
    weakest = None
    if "department" in df.columns:
        weakest = df.groupby("department")["maturity_score"].mean().sort_values().index[0]
    return {
        "total_processes": int(len(df)),
        "avg_maturity_score": round(float(df["maturity_score"].mean()), 1),
        "avg_governance_score": round(float(df["data_governance_score"].mean()), 1),
        "measured_gate_pct": round(float(df["pam_readiness_gate"].mean()) * 100, 1),
        "optimized_gate_pct": round(float(df["ai_readiness_gate"].mean()) * 100, 1),
        "maturity_level_counts": levels,
        "weakest_department": weakest,
    }


def tool_search_processes(args: Dict[str, Any]) -> Dict[str, Any]:
    df = _state_df()
    if df is None or df.empty:
        return {"error": "No dataset loaded"}
    view = df
    query = str(args.get("query") or "").strip()
    level = args.get("level")
    if query:
        cleaned = normalize(query)
        view = view[
            view["process_name"].str.lower().str.contains(cleaned, regex=False)
            | view["department"].astype(str).str.lower().str.contains(cleaned, regex=False)
        ]
    if level:
        view = view[view["maturity_level"] == int(level)]
    rows = [{
        "process_id": row["process_id"],
        "process_name": row["process_name"],
        "department": row.get("department", "Unassigned"),
        "maturity_level": int(row["maturity_level"]),
        "maturity_label": row["maturity_label"],
        "maturity_score": round(float(row["maturity_score"]), 1),
        "governance_status": row["data_governance_status"],
    } for _, row in view.head(12).iterrows()]
    return {"count": int(len(view)), "processes": rows}


def tool_process_detail(args: Dict[str, Any]) -> Dict[str, Any]:
    from processiq_engine import row_to_dict

    df = _state_df()
    if df is None or df.empty:
        return {"error": "No dataset loaded"}
    key = str(args.get("process_id") or args.get("process_name") or "").strip()
    if not key:
        return {"error": "Provide process_id or process_name"}
    catalog = [
        {"process_id": row["process_id"], "process_name": row["process_name"]}
        for _, row in df.iterrows()
    ]
    hit = match_process(repair_message(key, [item["process_name"] for item in catalog]), catalog)
    if not hit:
        return {"error": f"No process matched '{key}'"}
    match = df[df["process_id"].astype(str) == str(hit["process_id"])]
    return row_to_dict(match.iloc[0])


def tool_top_gaps(_: Dict[str, Any]) -> Dict[str, Any]:
    from collections import Counter
    from processiq_engine import RULE_DESCRIPTIONS

    df = _state_df()
    if df is None or df.empty:
        return {"error": "No dataset loaded"}
    counter: Counter[str] = Counter()
    for rules in df["triggered_rules"]:
        for code in str(rules).split("|"):
            if code and code != "None" and code in RULE_DESCRIPTIONS:
                counter[code] += 1
    return {"gaps": [
        {"code": code, "name": RULE_DESCRIPTIONS[code]["name"], "count": count,
         "action": RULE_DESCRIPTIONS[code]["action"]}
        for code, count in counter.most_common(8)
    ]}


def tool_next_move(args: Dict[str, Any]) -> Dict[str, Any]:
    detail = tool_process_detail(args)
    if "error" in detail:
        return detail
    recs = detail.get("recommendations") or []
    rules = detail.get("triggered_rules") or []
    first = rules[0] if rules else {}
    return {
        "process": detail.get("process_name"),
        "process_id": detail.get("process_id"),
        "level": detail.get("maturity", {}).get("level"),
        "label": detail.get("maturity", {}).get("label"),
        "target": detail.get("maturity", {}).get("target_next_state"),
        "first_action": first.get("action") or (recs[0] if recs else "No immediate action"),
        "first_rule": first.get("code"),
        "why": first.get("description") or "",
        "recommendations": recs[:5],
    }


TOOLS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "fleet_overview": tool_fleet_overview,
    "search_processes": tool_search_processes,
    "process_detail": tool_process_detail,
    "top_gaps": tool_top_gaps,
    "next_move": tool_next_move,
}


@dataclass
class AgentSpec:
    name: str
    role: str


AGENTS = {
    "supervisor": AgentSpec("supervisor", "You route the question and give a short, operational answer."),
    "fleet": AgentSpec("fleet", "You explain fleet health, the maturity mix and the most common gaps."),
    "coach": AgentSpec("coach", "You explain one process: its level, gates and what is holding it back."),
    "planner": AgentSpec("planner", "You give the next move. Step one is always the highest-priority rule action."),
}


def _cursor_key() -> str:
    if os.environ.get("CURSOR_API_KEY"):
        return os.environ["CURSOR_API_KEY"]
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".processiq.env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as handle:
            for raw in handle:
                if raw.startswith("CURSOR_API_KEY="):
                    return raw.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def pick_agent(message: str) -> str:
    return detect_intent(message)


# --------------------------------------------------------------------------
# routing: resolve what the user is talking about, then gather facts
# --------------------------------------------------------------------------

def _catalog():
    df = _state_df()
    if df is None or df.empty:
        return []
    return [
        {"process_id": row["process_id"], "process_name": row["process_name"]}
        for _, row in df.iterrows()
    ]


def _looks_referential(text: str) -> bool:
    cleaned = normalize(text)
    return any(word.strip() in cleaned for word in REFERENTIAL)


def _resolve_process(message: str, history: Optional[List[Dict[str, str]]]):
    """Find the process in this message, or the last one discussed."""
    catalog = _catalog()
    if not catalog:
        return None
    names = [item["process_name"] for item in catalog]
    hit = match_process(repair_message(message, names), catalog)
    if hit:
        return hit
    if not _looks_referential(message):
        return None
    for item in reversed((history or [])[-8:]):
        earlier = match_process(repair_message(str(item.get("content") or ""), names), catalog)
        if earlier:
            return earlier
    return None


def _has(text: str, words) -> bool:
    cleaned = normalize(text)
    return any(word in cleaned for word in words)


def _fleet_plan() -> Dict[str, Any]:
    overview = tool_fleet_overview({})
    if overview.get("error"):
        return {"agent": "fleet", "facts": overview, "text": f"I cannot read the fleet yet. {overview['error']}"}
    gaps = tool_top_gaps({}).get("gaps") or []
    top = gaps[0] if gaps else {}
    counts = overview["maturity_level_counts"]
    spread = ", ".join(f"L{level}: {count}" for level, count in sorted(counts.items()))
    text = (
        f"{overview['total_processes']} processes, average maturity {overview['avg_maturity_score']} "
        f"and average governance {overview['avg_governance_score']}. "
        f"Level spread — {spread}. "
        f"{overview['measured_gate_pct']}% clear the Measured gate and {overview['optimized_gate_pct']}% clear Optimized. "
        f"The most common blocker is {top.get('code', 'none')} ({top.get('count', 0)} processes) — {top.get('action', 'nothing outstanding')}. "
        f"Weakest department: {overview.get('weakest_department')}."
    )
    return {"agent": "fleet", "facts": {"overview": overview, "top_gaps": gaps[:5]}, "text": text}


def _gaps_plan(detail: Dict[str, Any]) -> Dict[str, Any]:
    rules = detail.get("triggered_rules") or []
    gaps = detail.get("gaps") or []
    maturity = detail.get("maturity", {})
    gates = detail.get("gates", {})
    if not rules and not gaps:
        text = (
            f"{detail['process_name']} ({detail['process_id']}) has no open gaps — "
            f"it is Level {maturity.get('level')} {maturity.get('label')} with every tracked rule passing."
        )
    else:
        listed = "; ".join(
            f"{rule['code']} {rule['name']} → {rule['action']}" for rule in rules[:5]
        ) or "; ".join(gaps[:5])
        text = (
            f"{detail['process_name']} ({detail['process_id']}) is Level {maturity.get('level')} "
            f"{maturity.get('label')} with {len(rules)} rule(s) triggered. "
            f"Key gaps: {listed}. "
            f"Measured gate {'passes' if gates.get('pam_ready') else 'fails'}, "
            f"Optimized gate {'passes' if gates.get('ai_ready') else 'fails'}. "
            f"Target: {maturity.get('target_next_state')}."
        )
    return {
        "agent": "coach",
        "facts": {
            "process_id": detail.get("process_id"),
            "process_name": detail.get("process_name"),
            "maturity": maturity,
            "gates": gates,
            "gaps": gaps,
            "triggered_rules": rules,
        },
        "text": text,
    }


def _next_move_plan(detail: Dict[str, Any]) -> Dict[str, Any]:
    move = tool_next_move({"process_id": detail.get("process_id")})
    steps = move.get("recommendations") or [move.get("first_action")]
    numbered = " ".join(f"{index + 1}. {step}." for index, step in enumerate(steps[:3]) if step)
    text = (
        f"{move['process']} ({move['process_id']}) is Level {move['level']} {move.get('label', '')}. "
        f"Next move: {move['first_action']}"
        + (f" (rule {move['first_rule']})." if move.get("first_rule") else ".")
        + f" Then: {numbered} Target: {move['target']}."
    )
    return {"agent": "planner", "facts": {"next_move": move}, "text": text}


def _detail_plan(detail: Dict[str, Any]) -> Dict[str, Any]:
    maturity = detail.get("maturity", {})
    governance = detail.get("governance", {})
    gates = detail.get("gates", {})
    indicators = detail.get("indicators", {})
    text = (
        f"{detail['process_name']} ({detail['process_id']}, {detail.get('department')}) is "
        f"Level {maturity.get('level')} {maturity.get('label')} with a maturity score of {maturity.get('score')} "
        f"and governance {governance.get('score')} ({governance.get('status')}). "
        f"Measured gate {'passes' if gates.get('pam_ready') else 'fails'}, "
        f"Optimized gate {'passes' if gates.get('ai_ready') else 'fails'}. "
        f"Exception rate {indicators.get('exception_rate')}%, rework {indicators.get('rework_rate')}%. "
        f"Target: {maturity.get('target_next_state')}."
    )
    return {
        "agent": "coach",
        "facts": {
            "process_id": detail.get("process_id"),
            "process_name": detail.get("process_name"),
            "department": detail.get("department"),
            "maturity": maturity,
            "governance": {"score": governance.get("score"), "status": governance.get("status")},
            "gates": gates,
            "indicators": indicators,
        },
        "text": text,
    }


def _help_plan() -> Dict[str, Any]:
    overview = tool_fleet_overview({})
    text = (
        "I can brief the whole fleet, open one process, list what is blocking it, or give its next move. "
        "Try \"where is the fleet weak?\", \"what should Order-to-Cash do next?\", or \"what are the gaps in PRC-002?\"."
    )
    return {"agent": "supervisor", "facts": {"overview": overview}, "text": text}


def build_plan(message: str, history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """Decide what the user wants and gather the facts that answer it."""
    df = _state_df()
    if df is None or df.empty:
        return {"agent": "supervisor", "facts": {"error": "No dataset loaded"}, "text": "No dataset is loaded yet."}

    process = _resolve_process(message, history)
    wants_fleet = _has(message, FLEET_WORDS)

    if process and not wants_fleet:
        detail = tool_process_detail({"process_id": process["process_id"]})
        if "error" not in detail:
            if _has(message, NEXT_WORDS):
                return _next_move_plan(detail)
            if _has(message, GAP_WORDS):
                return _gaps_plan(detail)
            return _detail_plan(detail)

    if wants_fleet or _has(message, GAP_WORDS):
        return _fleet_plan()
    if detect_intent(message) == "fleet":
        return _fleet_plan()
    return _help_plan()


# --------------------------------------------------------------------------
# narration
# --------------------------------------------------------------------------

NARRATOR_RULES = (
    "You are the ProcessIQ control-tower assistant. Answer the question using ONLY the JSON facts provided. "
    "Never invent process names, scores, levels or rule codes. Cite process ids and rule codes when they appear. "
    "Reply in 2-4 short sentences of plain prose. No preamble, no bullet lists, no markdown."
)


def ollama_models(base_url: str) -> List[str]:
    try:
        response = requests.get(base_url.replace("/v1", "") + "/api/tags", timeout=1.5)
        if not response.ok:
            return []
        return [str(item.get("name") or "") for item in response.json().get("models", [])]
    except Exception:
        return []


def ollama_reachable(base_url: str) -> bool:
    try:
        return requests.get(base_url.replace("/v1", "") + "/api/tags", timeout=1.5).ok
    except Exception:
        return False


def pick_installed(installed: List[str], preferred: str) -> Optional[str]:
    """Ollama answers 404 for a model it does not have, so only offer installed ones."""
    if not installed:
        return None
    for name in installed:
        if name == preferred or name.split(":")[0] == preferred.split(":")[0]:
            return name
    return installed[0]


def resolve_ollama_model(base_url: str, preferred: str) -> Optional[str]:
    return pick_installed(ollama_models(base_url), preferred)


def _chat(base_url: str, model: str, messages: List[Dict[str, str]], headers=None) -> str:
    response = requests.post(
        base_url.rstrip("/") + "/chat/completions",
        json={"model": model, "messages": messages, "temperature": 0.2, "stream": False},
        timeout=60,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"{response.status_code}: {response.text[:200]}")
    content = response.json()["choices"][0]["message"].get("content") or ""
    if not content.strip():
        raise RuntimeError("empty completion")
    return content.strip()


def _narrate(plan: Dict[str, Any], question: str, model: str, base_url: str):
    """Return (reply, provider, warning). Falls back to the routed facts text."""
    spec = AGENTS.get(plan["agent"], AGENTS["supervisor"])
    messages = [
        {"role": "system", "content": f"{NARRATOR_RULES} {spec.role}"},
        {"role": "user", "content": f"Question: {question}\n\nFacts (JSON):\n{json.dumps(plan['facts'], default=str)}"},
    ]
    warning = None

    installed = ollama_models(base_url)
    available = pick_installed(installed, model)
    if available:
        try:
            return _chat(base_url, available, messages), f"ollama:{available}", None
        except Exception as exc:
            warning = f"ollama failed ({exc})"
    elif ollama_reachable(base_url):
        warning = "Ollama is running but has no model installed (run: ollama pull llama3.2)"

    key = _cursor_key()
    if key:
        try:
            reply = _chat(CURSOR_API_BASE, CURSOR_MODEL, messages, {"Authorization": f"Bearer {key}"})
            return reply, "cursor", warning
        except Exception as exc:
            warning = f"{warning + '; ' if warning else ''}cursor failed ({exc})"

    return plan["text"], "rules", warning


def run_assistant(
    message: str,
    history: Optional[List[Dict[str, str]]] = None,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    df = _state_df()
    names = [] if df is None or df.empty else df["process_name"].astype(str).tolist()
    understood = repair_message(message, names)

    plan = build_plan(understood, history)
    reply, provider, warning = _narrate(
        plan, understood, model or OLLAMA_MODEL, base_url or OLLAMA_BASE
    )

    result = {
        "agent": plan["agent"],
        "reply": reply,
        "model": provider,
        "tools": sorted(plan["facts"].keys()) if isinstance(plan["facts"], dict) else [],
        "understood": understood,
        "grounded": plan["text"],
    }
    if warning:
        result["warning"] = warning
    return result
