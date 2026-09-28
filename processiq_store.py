"""JSONL history of scheduled and manual ProcessIQ runs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List

from processiq_classifier import ClassificationResult
from processiq_config import HISTORY_PATH


def append_run(
    results: List[ClassificationResult],
    *,
    dry_run: bool = False,
    emailed: bool = False,
    error: str = "",
) -> Dict[str, Any]:
    record = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dry_run": dry_run,
        "emailed": emailed,
        "error": error,
        "count": len(results),
        "results": [item.to_dict() for item in results],
    }
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with HISTORY_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return record


def load_history(limit: int = 50) -> List[Dict[str, Any]]:
    if not HISTORY_PATH.exists():
        return []
    rows = []
    for line in HISTORY_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return list(reversed(rows[-limit:]))
