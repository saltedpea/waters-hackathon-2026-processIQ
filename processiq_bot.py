"""Scheduled ProcessIQ bot: pull Celonis metrics, classify, notify.

    python processiq_bot.py --once
    python processiq_bot.py --dry-run
    python processiq_bot.py --no-email
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import List

from processiq_celonis import ProcessSnapshot, extract_snapshots
from processiq_classifier import ClassificationResult, classify_snapshot
from processiq_config import load_settings
from processiq_notify import send_report
from processiq_store import append_run


def run_pipeline(
    *,
    dry_run: bool = False,
    send_email: bool = True,
) -> List[ClassificationResult]:
    settings = load_settings()
    snapshots: List[ProcessSnapshot] = extract_snapshots(settings, dry_run=dry_run)
    results = [classify_snapshot(snapshot, settings) for snapshot in snapshots]
    emailed = False
    error = ""
    if send_email and not dry_run:
        try:
            send_report(settings, results)
            emailed = True
        except Exception as exc:
            error = str(exc)
    append_run(results, dry_run=dry_run, emailed=emailed, error=error)
    if error and send_email and not dry_run:
        raise RuntimeError(error)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="ProcessIQ Celonis pull → classify → notify")
    parser.add_argument("--once", action="store_true", help="Run one pull/classify/notify cycle")
    parser.add_argument("--dry-run", action="store_true", help="Use sample Celonis fixture and skip email")
    parser.add_argument("--no-email", action="store_true", help="Classify without sending mail")
    args = parser.parse_args()
    if not (args.once or args.dry_run):
        args.once = True
    results = run_pipeline(dry_run=args.dry_run, send_email=not args.no_email and not args.dry_run)
    print(json.dumps([item.to_dict() for item in results], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
