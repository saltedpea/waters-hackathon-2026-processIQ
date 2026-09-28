"""ProcessIQ Control Tower with a multi-agent assistant."""

from __future__ import annotations

import hmac
import io
import os
import re
import threading
import time
from collections import Counter

import joblib
import numpy as np
import pandas as pd
from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split

from processiq_crew import bind_state, run_assistant
from processiq_engine import FEATURES, MATURITY_LABELS, RULE_DESCRIPTIONS, compute, row_to_dict
from processiq_synth import make_live_row

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "processiq_v2_corrected_dataset.csv")
FALLBACK_DATA = os.path.join(BASE_DIR, "processiq_v2_corrected_dataset.csv")
MODEL_PATH = os.path.join(BASE_DIR, "model", "processiq_v2_maturity_model.pkl")

app = Flask(__name__)
app.secret_key = os.environ.get("PROCESSIQ_SECRET", "processiq-control-tower-dev-key")
ACCOUNT_USER = os.environ.get("PROCESSIQ_USER", "admin")
ACCOUNT_PASSWORD = os.environ.get("PROCESSIQ_PASSWORD", "processiq")
PUBLIC_ENDPOINTS = {"login", "static"}

STATE = {
    "df": None,
    "model": None,
    "ml_report": None,
    "feature_importance": None,
    "lock": threading.RLock(),
}
STREAM = {
    "running": False,
    "thread": None,
    "generated": 0,
    "last_process_id": None,
    "last_classified_level": None,
    "last_process_name": None,
}
bind_state(STATE)


def signed_in():
    return bool(session.get("user"))


@app.before_request
def require_login():
    if request.endpoint in PUBLIC_ENDPOINTS or signed_in():
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "sign in required"}), 401
    return redirect(url_for("login", next=request.path))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = (request.form.get("user") or "").strip()
        password = request.form.get("password") or ""
        ok = hmac.compare_digest(user, ACCOUNT_USER) and hmac.compare_digest(password, ACCOUNT_PASSWORD)
        if ok:
            session["user"] = user
            return redirect(request.args.get("next") or url_for("index"))
        return render_template("login.html", error="That username and password do not match."), 401
    if signed_in():
        return redirect(url_for("index"))
    return render_template("login.html", error=None)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def _id_sort_key(value):
    digits = re.findall(r"\d+", str(value))
    return int(digits[-1]) if digits else 0


def sort_frame(frame):
    ordered = frame.copy()
    ordered["_sort_id"] = ordered["process_id"].map(_id_sort_key)
    ordered = ordered.sort_values(["_sort_id", "process_id"], ascending=True).drop(columns="_sort_id")
    return ordered.reset_index(drop=True)


def next_sequence(frame):
    if frame is None or frame.empty:
        return 0
    return int(frame["process_id"].map(_id_sort_key).max())


def classify_and_store(raw):
    scored = compute(raw)
    model = STATE["model"]
    if model is not None:
        predicted = model.predict(scored[FEATURES])
        scored["classified_level"] = predicted.astype(int)
        scored["classified_label"] = scored["classified_level"].map(MATURITY_LABELS)
        scored["maturity_level"] = scored["classified_level"]
        scored["maturity_label"] = scored["classified_label"]
    else:
        scored["classified_level"] = scored["maturity_level"]
        scored["classified_label"] = scored["maturity_label"]
    with STATE["lock"]:
        current = STATE["df"]
        combined = scored if current is None or current.empty else pd.concat([current, scored], ignore_index=True)
        STATE["df"] = sort_frame(combined)
    return scored


def load_dataset(path=None):
    source = path or (DATA_PATH if os.path.exists(DATA_PATH) else FALLBACK_DATA)
    frame = sort_frame(compute(pd.read_csv(source)))
    if "classified_level" not in frame.columns:
        frame["classified_level"] = frame["maturity_level"]
        frame["classified_label"] = frame["maturity_label"]
    STATE["df"] = frame
    return frame


def train_model(frame):
    features = frame[FEATURES]
    labels = frame["maturity_level"]
    stratify = labels if labels.value_counts().min() >= 2 else None
    x_train, x_test, y_train, y_test = train_test_split(
        features, labels, test_size=0.2, random_state=42, stratify=stratify
    )
    model = RandomForestClassifier(
        n_estimators=300, max_depth=10, min_samples_leaf=3,
        random_state=42, class_weight="balanced",
    )
    model.fit(x_train, y_train)
    pred = model.predict(x_test)
    importance = sorted(zip(FEATURES, model.feature_importances_), key=lambda item: item[1], reverse=True)[:10]
    STATE["model"] = model
    STATE["ml_report"] = {
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "report": classification_report(y_test, pred, zero_division=0, output_dict=True),
        "test_size": len(y_test),
        "train_size": len(y_train),
    }
    STATE["feature_importance"] = [
        {"feature": name, "importance": round(float(value), 4)} for name, value in importance
    ]
    STATE["trained_at"] = time.time()
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    return model


def bootstrap():
    train_model(load_dataset())


def dg_status_label(score):
    from processiq_engine import dg_status
    return dg_status(score)


def _rule_codes(value):
    return [code for code in str(value).split("|") if code and code != "None" and code in RULE_DESCRIPTIONS]


def _rule_counter(frame) -> Counter:
    counter: Counter[str] = Counter()
    for rules in frame["triggered_rules"]:
        counter.update(_rule_codes(rules))
    return counter


def _top_gaps(frame, limit=8):
    return [
        {"code": code, "name": RULE_DESCRIPTIONS[code]["name"],
         "count": count, "action": RULE_DESCRIPTIONS[code]["action"]}
        for code, count in _rule_counter(frame).most_common(limit)
    ]


@app.route("/")
def index():
    return render_template("index.html", user=session.get("user", "operator"))


@app.route("/api/overview")
def api_overview():
    frame = STATE["df"]
    return jsonify({
        "total_processes": int(len(frame)),
        "avg_maturity_score": round(float(frame["maturity_score"].mean()), 1),
        "avg_governance_score": round(float(frame["data_governance_score"].mean()), 1),
        "pam_ready_pct": round(float(frame["pam_readiness_gate"].mean()) * 100, 1),
        "ai_ready_pct": round(float(frame["ai_readiness_gate"].mean()) * 100, 1),
        "maturity_level_counts": {int(key): int(value) for key, value in frame["maturity_level"].value_counts().sort_index().items()},
        "governance_status_counts": {key: int(value) for key, value in frame["data_governance_status"].value_counts().items()},
        "avg_maturity_by_department": frame.groupby("department")["maturity_score"].mean().round(1).to_dict(),
        "governance_dimension_avg": {
            key: round(float(frame[key].mean()) * 100, 1)
            for key in ["data_completeness", "data_accuracy", "data_consistency", "data_timeliness",
                        "data_lineage", "data_ownership", "metadata_completeness", "data_access_compliance"]
        },
        "top_gaps": _top_gaps(frame),
        "active_issues": int(sum(len(_rule_codes(value)) for value in frame["triggered_rules"])),
        "processes_with_issues": int(sum(1 for value in frame["triggered_rules"] if _rule_codes(value))),
        "generated_at": time.time(),
    })


@app.route("/api/processes")
def api_processes():
    frame = STATE["df"]
    search = request.args.get("q", "").lower().strip()
    level = request.args.get("level")
    status = request.args.get("status")
    view = frame
    if search:
        view = view[view["process_name"].str.lower().str.contains(search) | view["department"].str.lower().str.contains(search)]
    if level:
        view = view[view["maturity_level"] == int(level)]
    if status:
        view = view[view["data_governance_status"] == status]
    rows = [{
        "process_id": row["process_id"],
        "process_name": row["process_name"],
        "department": row.get("department", "Unassigned"),
        "maturity_score": round(float(row["maturity_score"]), 1),
        "maturity_level": int(row["maturity_level"]),
        "maturity_label": row["maturity_label"],
        "governance_score": round(float(row["data_governance_score"]), 1),
        "governance_status": row["data_governance_status"],
        "pam_ready": bool(row["pam_readiness_gate"]),
        "ai_ready": bool(row["ai_readiness_gate"]),
        "exception_rate": round(float(row["exception_rate"]) * 100, 1),
        "rework_rate": round(float(row["rework_rate"]) * 100, 1),
        "owner_assigned": bool(row["owner_assigned"]),
        "issues": len(_rule_codes(row["triggered_rules"])),
        "classified_level": int(row["classified_level"]) if "classified_level" in row and pd.notna(row["classified_level"]) else int(row["maturity_level"]),
    } for _, row in view.iterrows()]
    rows.sort(key=lambda item: (_id_sort_key(item["process_id"]), item["process_id"]))
    return jsonify({"count": len(rows), "processes": rows})


GATE_CONDITIONS = {
    "pam_ready": [
        ("Data governance score", "data_governance_score", 60, "score"),
        ("Event data available", "event_data_available", 1, "flag"),
        ("Execution data quality", "execution_data_quality", 0.75, "ratio"),
        ("Process adherence", "process_adherence", 0.75, "ratio"),
        ("Deviation monitoring", "deviation_monitoring", 1, "flag"),
    ],
    "ai_ready": [
        ("Data governance score", "data_governance_score", 80, "score"),
        ("Data completeness", "data_completeness", 0.80, "ratio"),
        ("Data lineage", "data_lineage", 0.70, "ratio"),
        ("Metadata completeness", "metadata_completeness", 0.80, "ratio"),
        ("AI data readiness", "ai_data_readiness", 0.75, "ratio"),
        ("Process adherence", "process_adherence", 0.75, "ratio"),
        ("Deviation monitoring", "deviation_monitoring", 1, "flag"),
    ],
}


def _gate_conditions(row):
    """Per-condition readout of the gates the engine already evaluated.

    The engine stays the authority for the gate result; this only surfaces
    which individual requirement passed so the UI can explain the outcome.
    """
    readout = {}
    for gate, specs in GATE_CONDITIONS.items():
        rows = []
        for label, column, threshold, kind in specs:
            raw = float(row[column])
            if kind == "ratio":
                value, target, passed = round(raw * 100, 1), round(threshold * 100), raw >= threshold
                display, target_display = f"{value}%", f"≥ {target}%"
            elif kind == "score":
                value, passed = round(raw, 1), raw >= threshold
                display, target_display = f"{value}", f"≥ {threshold}"
            else:
                value, passed = int(raw), int(raw) == threshold
                display, target_display = ("Yes" if value else "No"), "Required"
            rows.append({
                "label": label,
                "value": display,
                "requirement": target_display,
                "passed": bool(passed),
            })
        readout[gate] = rows
    return readout


@app.route("/api/processes/<process_id>")
def api_process_detail(process_id):
    match = STATE["df"][STATE["df"]["process_id"] == process_id]
    if match.empty:
        return jsonify({"error": "process not found"}), 404
    row = match.iloc[0]
    payload = row_to_dict(row)
    payload["gate_conditions"] = _gate_conditions(row)
    payload["owner_assigned"] = bool(row["owner_assigned"])
    return jsonify(payload)


@app.route("/api/rules")
def api_rules():
    """Full rule catalogue with live trigger counts. Reads the engine, changes nothing."""
    frame = STATE["df"]
    counter = _rule_counter(frame)
    total = int(len(frame)) or 1
    families = {"DG": "Data Governance", "P0": "Process Governance", "PI": "Performance", "GA": "Readiness Gate"}
    rules = []
    for code, meta in RULE_DESCRIPTIONS.items():
        count = int(counter.get(code, 0))
        rules.append({
            "code": code,
            "name": meta["name"],
            "condition": meta["condition"],
            "description": meta["description"],
            "action": meta["action"],
            "count": count,
            "coverage_pct": round(count / total * 100, 1),
            "triggered": count > 0,
            "family": families.get(code[:2], "Other"),
        })
    rules.sort(key=lambda item: (-item["count"], item["code"]))
    return jsonify({
        "rules": rules,
        "total_rules": len(rules),
        "triggered_rules": sum(1 for item in rules if item["triggered"]),
        "total_detections": int(sum(counter.values())),
    })


@app.route("/api/system/status")
def api_system_status():
    from processiq_config import load_settings
    from processiq_crew import _cursor_key, ollama_models, ollama_reachable

    frame = STATE["df"]
    settings = load_settings()
    base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
    assistant_ready = bool(ollama_models(base)) if ollama_reachable(base) else bool(_cursor_key())
    return jsonify({
        "components": [
            {"key": "api", "label": "API", "state": "operational", "detail": "Flask service"},
            {"key": "ml", "label": "ML Engine", "state": "operational" if STATE.get("model") is not None else "degraded",
             "detail": "RandomForest classifier"},
            {"key": "rules", "label": "Rule Engine", "state": "operational",
             "detail": f"{len(RULE_DESCRIPTIONS)} rules loaded"},
            {"key": "celonis", "label": "Celonis Connection",
             "state": "connected" if settings.celonis_ready() else "not_configured",
             "detail": "OAuth 2.0 client credentials"},
            {"key": "pipeline", "label": "Data Pipeline",
             "state": "streaming" if STREAM["running"] else "operational",
             "detail": f"{int(len(frame))} processes loaded"},
            {"key": "assistant", "label": "Assistant",
             "state": "operational" if assistant_ready else "degraded",
             "detail": "Multi-agent narration"},
        ],
        "last_model_run": STATE.get("trained_at"),
        "model_accuracy": (STATE.get("ml_report") or {}).get("accuracy"),
        "rows": int(len(frame)),
        "stream_running": STREAM["running"],
        "server_time": time.time(),
    })


@app.route("/api/celonis/status")
def api_celonis_status():
    """Connection posture only. Never returns client ids, secrets or tokens."""
    from urllib.parse import urlparse
    from processiq_config import load_settings

    settings = load_settings()
    host = ""
    if settings.celonis_base_url:
        host = urlparse(settings.celonis_base_url).netloc or settings.celonis_base_url
    last_sync = None
    try:
        from processiq_store import load_history
        history = load_history(1)
        if history:
            last_sync = history[0].get("run_at")
    except Exception:
        last_sync = None
    return jsonify({
        "configured": settings.celonis_ready(),
        "team_host": host,
        "auth_method": "OAuth 2.0 client credentials",
        "scope": settings.celonis_scope,
        "knowledge_model_configured": bool(settings.celonis_km_id),
        "kpi_count": len(settings.kpi_id_list()),
        "notifications_configured": settings.smtp_ready(),
        "last_sync": last_sync,
        "processes_available": int(len(STATE["df"])),
    })


@app.route("/api/notifications")
def api_notifications():
    """Intelligence feed built from run history plus the current assessment."""
    items = []
    try:
        from processiq_store import load_history
        for record in load_history(8):
            items.append({
                "kind": "error" if record.get("error") else "success",
                "title": "Scheduled assessment failed" if record.get("error") else "Scheduled assessment completed",
                "body": record.get("error") or f"{record.get('count', 0)} process(es) classified.",
                "meta": "Dry run" if record.get("dry_run") else ("Emailed" if record.get("emailed") else "Stored"),
                "at": record.get("run_at"),
            })
    except Exception:
        pass

    frame = STATE["df"]
    if frame is not None and not frame.empty:
        governance = round(float(frame["data_governance_score"].mean()), 1)
        items.append({
            "kind": "success" if governance >= 80 else "warning",
            "title": "Data governance assessment completed",
            "body": f"Fleet score {governance} / 100 — {dg_status_label(governance)}.",
            "meta": f"{int(len(frame))} processes",
            "at": None,
        })
        worst = frame.assign(_issues=frame["triggered_rules"].map(lambda value: len(_rule_codes(value))))
        worst = worst.sort_values("_issues", ascending=False).head(3)
        for _, row in worst.iterrows():
            if int(row["_issues"]) == 0:
                continue
            items.append({
                "kind": "warning",
                "title": "Process maturity assessment completed",
                "body": (
                    f"{row['process_name']} — maturity {round(float(row['maturity_score']), 1)}, "
                    f"Level {int(row['maturity_level'])}. {int(row['_issues'])} improvement areas detected."
                ),
                "meta": row["process_id"],
                "at": None,
            })
    return jsonify({"notifications": items})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "file" not in request.files:
        return jsonify({"error": "no file uploaded"}), 400
    try:
        raw = pd.read_csv(io.StringIO(request.files["file"].stream.read().decode("utf-8")))
        stop_stream()
        frame = sort_frame(compute(raw))
        if "classified_level" not in frame.columns:
            frame["classified_level"] = frame["maturity_level"]
            frame["classified_label"] = frame["maturity_label"]
        STATE["df"] = frame
        train_model(frame)
        return jsonify({"ok": True, "rows": len(frame)})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/reset", methods=["POST"])
def api_reset():
    stop_stream()
    bootstrap()
    return jsonify({"ok": True, "rows": len(STATE["df"])})


def stream_status():
    with STATE["lock"]:
        count = 0 if STATE["df"] is None else int(len(STATE["df"]))
    return {
        "running": STREAM["running"],
        "generated": STREAM["generated"],
        "last_process_id": STREAM["last_process_id"],
        "last_process_name": STREAM["last_process_name"],
        "last_classified_level": STREAM["last_classified_level"],
        "rows": count,
        "interval_seconds": 4,
    }


def stream_loop():
    rng = np.random.default_rng()
    while STREAM["running"]:
        with STATE["lock"]:
            seq = next_sequence(STATE["df"])
        scored = classify_and_store(pd.DataFrame([make_live_row(seq, rng)]))
        row = scored.iloc[0]
        STREAM["generated"] += 1
        STREAM["last_process_id"] = str(row["process_id"])
        STREAM["last_process_name"] = str(row["process_name"])
        STREAM["last_classified_level"] = int(row["classified_level"])
        for _ in range(40):
            if not STREAM["running"]:
                break
            time.sleep(0.1)


def start_stream():
    if STREAM["running"]:
        return stream_status()
    STREAM["running"] = True
    STREAM["thread"] = threading.Thread(target=stream_loop, daemon=True)
    STREAM["thread"].start()
    return stream_status()


def stop_stream():
    STREAM["running"] = False
    thread = STREAM.get("thread")
    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join(timeout=1.2)
    STREAM["thread"] = None
    return stream_status()


@app.route("/api/stream/start", methods=["POST"])
def api_stream_start():
    return jsonify(start_stream())


@app.route("/api/stream/stop", methods=["POST"])
def api_stream_stop():
    return jsonify(stop_stream())


@app.route("/api/stream/status")
def api_stream_status():
    return jsonify(stream_status())


@app.route("/api/assistant/chat", methods=["POST"])
def api_assistant():
    payload = request.get_json(force=True) or {}
    message = str(payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400
    result = run_assistant(
        message,
        history=payload.get("history") or [],
        model=payload.get("model") or os.environ.get("OLLAMA_MODEL", "llama3.2"),
        base_url=payload.get("base_url") or os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"),
    )
    return jsonify(result)


@app.route("/api/save", methods=["POST"])
def api_save():
    frame = STATE["df"]
    if frame is None or frame.empty:
        return jsonify({"error": "nothing to save"}), 400
    path = os.path.join(BASE_DIR, "data", "processiq_saved.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frame.to_csv(path, index=False)
    return jsonify({"ok": True, "path": path, "rows": int(len(frame))})


@app.route("/api/download")
def api_download():
    frame = STATE["df"]
    if frame is None or frame.empty:
        return jsonify({"error": "nothing to download"}), 400
    buffer = io.StringIO()
    frame.to_csv(buffer, index=False)
    buffer.seek(0)
    return send_file(
        io.BytesIO(buffer.getvalue().encode("utf-8")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="processiq_fleet.csv",
    )


@app.route("/api/mail", methods=["POST"])
def api_mail():
    from urllib.parse import quote
    payload = request.get_json(silent=True) or {}
    to_addr = str(payload.get("to") or "").strip()
    frame = STATE["df"]
    if frame is None or frame.empty:
        return jsonify({"error": "nothing to mail"}), 400
    overview = api_overview().get_json()
    lines = [
        f"ProcessIQ fleet: {overview['total_processes']} processes",
        f"Avg maturity {overview['avg_maturity_score']}, Measured gate {overview['pam_ready_pct']}%",
        "Sorted by process ID.",
    ]
    for _, row in frame.head(12).iterrows():
        lines.append(f"{row['process_id']} {row['process_name']} L{int(row['maturity_level'])} {row['maturity_label']}")
    body = "\n".join(lines)
    subject = "ProcessIQ fleet briefing"
    mailto = f"mailto:{to_addr}?subject={quote(subject)}&body={quote(body)}"
    sent = None
    try:
        from processiq_config import load_settings
        settings = load_settings({"smtp_to": to_addr} if to_addr else None)
        if settings.smtp_ready():
            message_from_app = True  # noqa: F841
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from
            msg["To"] = ", ".join(settings.recipients())
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port_int(), timeout=20) as smtp:
                smtp.ehlo()
                try:
                    smtp.starttls()
                except smtplib.SMTPException:
                    pass
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.sendmail(settings.smtp_from, settings.recipients(), msg.as_string())
            sent = ", ".join(settings.recipients())
    except Exception:
        sent = None
    return jsonify({"ok": True, "mailto": mailto, "sent": sent, "preview": body})


@app.route("/api/assistant/health")
def api_assistant_health():
    from processiq_crew import _cursor_key, ollama_models, ollama_reachable, pick_installed

    base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
    preferred = os.environ.get("OLLAMA_MODEL", "llama3.2")
    reachable = ollama_reachable(base)
    models = ollama_models(base) if reachable else []
    chosen = pick_installed(models, preferred)
    cursor = bool(_cursor_key())
    provider = "ollama" if chosen else ("cursor" if cursor else "rules")
    return jsonify({
        "ollama": reachable,
        "model_ready": bool(chosen),
        "cursor": cursor,
        "provider": provider,
        "models": models,
        "default": chosen or preferred,
        "hint": None if chosen else (
            f"Ollama is running but has no model. Run: ollama pull {preferred}" if reachable
            else "Ollama is not running."
        ),
    })


if __name__ == "__main__":
    bootstrap()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False, use_reloader=False)
