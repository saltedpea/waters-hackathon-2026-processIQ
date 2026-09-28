"""ProcessIQ process-maturity assessment app.

Run with:
    streamlit run processiq_app.py
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from processiq_agents import (
    PROVIDERS,
    AgentSession,
    Notification,
    apply_autofill,
    classify_and_notify,
    create_notification,
    evidence_table,
    resolve_api_key,
    run_agent_turn,
    seed_manual_evidence,
    welcome_message,
)

try:
    from processiq_agents import PROVIDER_MODELS
except ImportError:
    PROVIDER_MODELS = {
        "OpenAI": ("gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"),
        "Groq": ("openai/gpt-oss-20b", "openai/gpt-oss-120b"),
        "Hugging Face": ("openai/gpt-oss-20b", "openai/gpt-oss-120b"),
        "OpenRouter": ("openai/gpt-4o-mini", "openai/gpt-oss-20b"),
    }
from processiq_core import (
    CRITERIA,
    LEVELS,
    PASS_THRESHOLD,
    catalog_rows,
    csv_template,
    evaluate_batch,
    next_actions,
    score_level,
)
from processiq_bot import run_pipeline
from processiq_celonis import test_connection
from processiq_config import Settings, load_settings, save_settings
from processiq_store import load_history
from processiq_text import TEMPLATES, parse_description


def _session() -> AgentSession:
    if "agent" not in st.session_state:
        agent = AgentSession()
        agent.messages = []
        st.session_state.agent = agent
        st.session_state.chat_log = [
            {"role": "assistant", "content": welcome_message()},
        ]
    return st.session_state.agent


def _secret(name: str) -> str:
    try:
        return str(st.secrets.get(name, "") or "")
    except Exception:
        return ""


def _queue_notification(notification: Notification) -> None:
    st.session_state.pending_notification_id = notification.id
    st.toast(notification.title)


def _render_browser_notification(notification: Notification) -> None:
    safe_title = (
        notification.title.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    )
    safe_body = (
        notification.body.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    )
    components.html(
        f"""
        <script>
        const title = `{safe_title}`;
        const body = `{safe_body}`;
        if (window.Notification) {{
          const fire = () => new Notification(title, {{ body }});
          if (Notification.permission === "granted") {{
            fire();
          }} else if (Notification.permission !== "denied") {{
            Notification.requestPermission().then((status) => {{
              if (status === "granted") fire();
            }});
          }}
        }}
        </script>
        """,
        height=0,
    )


def _render_assessment(process_name: str, assessment: Dict[str, object], results: Dict[str, bool]) -> None:
    level = int(assessment["level"])
    st.success(f"{process_name}: Level {level} — {assessment['label']}")
    score_columns = st.columns(4)
    for column, scored_level in zip(score_columns, range(2, 6)):
        score = assessment["scores"][scored_level]
        column.metric(
            f"Level {scored_level}",
            f"{score:.0f}%",
            "PASS" if score >= PASS_THRESHOLD else "Below 80%",
        )
    actions = next_actions(results, level)
    if actions:
        st.warning("Next actions:\n\n- " + "\n- ".join(actions))
    blocked = assessment.get("blocked_by") or []
    if blocked:
        st.caption("Gates: " + " · ".join(str(item) for item in blocked))


def _render_notifications(agent: AgentSession) -> None:
    unread = agent.unread_count()
    st.subheader(f"Notifications ({unread} unread)")
    if not agent.notifications:
        st.caption("Classification alerts will appear here.")
        return
    if st.button("Mark all read", width="stretch"):
        for item in agent.notifications:
            item.read = True
        st.rerun()
    for item in agent.notifications:
        marker = "● " if not item.read else ""
        with st.expander(f"{marker}{item.title}", expanded=not item.read):
            st.write(item.body)
            st.caption(item.created_at)
            if item.webhook_ok is True:
                st.caption("Webhook delivered.")
            elif item.webhook_ok is False:
                st.caption("Webhook failed.")
            if st.button("Mark read", key=f"read_{item.id}", disabled=item.read):
                item.read = True
                st.rerun()


def render_criterion_checklist(level: int, defaults: Dict[str, bool] | None = None) -> Dict[str, bool]:
    values: Dict[str, bool] = {}
    for criterion in CRITERIA[level]:
        default = bool(defaults.get(criterion.code, False)) if defaults else False
        values[criterion.code] = st.checkbox(
            f"{criterion.code} — {criterion.name} ({criterion.weight}%)",
            value=default,
            help=criterion.evidence,
            key=f"criterion_{criterion.code}",
        )
    return values


def _render_llm_setup() -> Dict[str, str]:
    current = st.session_state.setdefault("llm", {})
    default_provider = current.get("provider") or "Hugging Face"
    provider_names = list(PROVIDERS)
    provider_index = provider_names.index(default_provider) if default_provider in PROVIDERS else 1
    preset = PROVIDERS[provider_names[provider_index]]
    existing_key = current.get("api_key") or resolve_api_key() or _secret("OPENAI_API_KEY") or _secret("HF_TOKEN")

    with st.container(border=True):
        st.markdown("**Step 1 — paste an LLM API key**")
        st.caption(
            "This is not a ProcessIQ login. Hugging Face is the default. "
            "Paste a token, or just describe a process — autocorrect and autofill still run."
        )
        cols = st.columns((1, 2, 2))
        provider = cols[0].selectbox("Provider", provider_names, index=provider_index, key="llm_provider")
        preset = PROVIDERS[provider]
        api_key = cols[1].text_input(
            "API key",
            value=existing_key,
            type="password",
            placeholder="Paste key here, then click into the chat",
            key="llm_api_key",
        )
        choices = list(PROVIDER_MODELS.get(provider, ()))
        preferred = preset["model"]
        saved = current.get("model") or preferred
        retired_groq = {
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "llama3-70b-8192",
            "llama3-8b-8192",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
            "gpt-4o-mini",
            "gpt-4o",
        }
        if provider == "Groq" and saved in retired_groq:
            saved = preferred
        if not choices:
            model = cols[2].text_input("Model", value=preferred, key=f"llm_model_{provider}")
        else:
            default_index = choices.index(saved) if saved in choices else 0
            model = cols[2].selectbox(
                "Model",
                choices,
                index=default_index,
                key=f"llm_model_{provider}",
            )
        with st.expander("Advanced endpoint and webhook", expanded=False):
            base_url = st.text_input(
                "Base URL",
                value=current.get("base_url") or preset["base_url"] or "https://api.openai.com/v1",
                key="llm_base_url",
            )
            webhook = st.text_input(
                "Notification webhook (optional)",
                value=current.get("webhook") or _secret("PROCESSIQ_WEBHOOK_URL"),
                key="llm_webhook",
            )
        if provider == "Groq":
            st.markdown("Get a free key: [console.groq.com/keys](https://console.groq.com/keys)")
        elif provider == "OpenAI":
            st.markdown("Get a key: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)")
        elif provider == "Hugging Face":
            st.markdown("Get a key: [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)")
        elif provider == "OpenRouter":
            st.markdown("Get a key: [openrouter.ai/keys](https://openrouter.ai/keys)")
        if api_key.strip():
            st.success("API key saved for this browser session. You can chat below.")
        else:
            st.info("No model key yet. Autocorrect and autofill still work. Add a Hugging Face token for follow-up questions.")

    settings = {
        "provider": provider,
        "api_key": api_key.strip(),
        "base_url": base_url.strip() or preset["base_url"],
        "model": model.strip() or preset["model"],
        "webhook": webhook.strip(),
    }
    st.session_state.llm = settings
    return settings


def _apply_parsed_message(agent: AgentSession, text: str) -> Tuple[str, List[str]]:
    parsed = parse_description(text)
    notes: List[str] = []
    if parsed.corrections:
        shown = ", ".join(f"{item.original} → {item.replacement}" for item in parsed.corrections[:8])
        notes.append(f"Autocorrected: {shown}.")
    if parsed.process_name:
        agent.process_name = parsed.process_name
        notes.append(f"Process name filled: **{parsed.process_name}**.")
    applied = apply_autofill(agent, parsed.fills)
    if applied:
        notes.append("Autofilled " + ", ".join(applied) + ".")
    return parsed.corrected_text, notes


def render_chatbot(agent: AgentSession) -> None:
    st.subheader("AI assessment agent")
    st.caption(
        "Describe the process in natural language. Typos are corrected, matching criteria "
        "are filled, the official 80% gated model classifies it, and a notification is raised."
    )
    settings = _render_llm_setup()

    st.markdown("**Autofill a process**")
    template_cols = st.columns(len(TEMPLATES))
    chosen_template = ""
    for column, name in zip(template_cols, TEMPLATES):
        if column.button(name, width="stretch"):
            chosen_template = TEMPLATES[name]

    col_chat, col_board = st.columns((1.35, 1))

    with col_chat:
        for message in st.session_state.chat_log:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])
                if message.get("trace"):
                    st.caption("Tools: " + " · ".join(message["trace"]))

        prompt = st.chat_input("Describe the process, paste evidence, or say 'classify now'")
        action_cols = st.columns(3)
        classify_clicked = action_cols[0].button("Classify now", width="stretch")
        reset_clicked = action_cols[1].button("Reset chat", width="stretch")
        if action_cols[2].button("Enable browser alerts", width="stretch"):
            components.html(
                """
                <script>
                if (window.Notification && Notification.permission !== "granted") {
                  Notification.requestPermission();
                }
                </script>
                """,
                height=0,
            )
            st.toast("Browser will ask for notification permission.")

        if reset_clicked:
            st.session_state.agent = AgentSession()
            st.session_state.chat_log = [{"role": "assistant", "content": welcome_message()}]
            st.rerun()

        api_key = (
            resolve_api_key(settings.get("api_key", ""))
            or _secret("HF_TOKEN")
            or _secret("HUGGINGFACE_API_KEY")
            or _secret("OPENAI_API_KEY")
            or _secret("GROQ_API_KEY")
        )
        base_url = settings.get("base_url") or PROVIDERS["Hugging Face"]["base_url"]
        model = settings.get("model") or PROVIDERS["Hugging Face"]["model"]
        webhook_url = settings.get("webhook", "") or _secret("PROCESSIQ_WEBHOOK_URL")

        if classify_clicked:
            result = classify_and_notify(agent, webhook_url)
            summary = (
                f"Official classification for **{result['process_name']}**: "
                f"Level {result['level']} — {result['label']}."
            )
            st.session_state.chat_log.append({"role": "assistant", "content": summary})
            if agent.notifications:
                _queue_notification(agent.notifications[0])
            st.rerun()

        incoming = chosen_template or prompt
        if incoming:
            corrected, notes = _apply_parsed_message(agent, incoming)
            st.session_state.chat_log.append({"role": "user", "content": incoming})
            auto_reply = "\n\n".join(notes) if notes else "I recorded that description."
            if agent.process_name and notes:
                scored = classify_and_notify(agent, webhook_url)
                auto_reply += (
                    f"\n\nOfficial score: **{scored['process_name']}** is "
                    f"Level {scored['level']} — {scored['label']}."
                )
                if agent.notifications:
                    _queue_notification(agent.notifications[0])
            if api_key:
                follow_up = (
                    corrected
                    + "\n\nScoring already ran from autofill. Do not call classify_process. "
                    "Ask only for remaining unmet criteria."
                )
                try:
                    turn = run_agent_turn(
                        agent,
                        follow_up,
                        api_key=api_key,
                        base_url=base_url,
                        model=model,
                        webhook_url=webhook_url,
                    )
                except Exception as exc:
                    st.session_state.chat_log.append({
                        "role": "assistant",
                        "content": auto_reply + f"\n\nChat model skipped: {exc}",
                    })
                else:
                    st.session_state.chat_log.append({
                        "role": "assistant",
                        "content": auto_reply + "\n\n" + turn.assistant_text,
                        "trace": turn.tool_trace,
                    })
                    if turn.notification:
                        _queue_notification(turn.notification)
            else:
                st.session_state.chat_log.append({"role": "assistant", "content": auto_reply})
            st.rerun()

    with col_board:
        st.markdown(f"**Process:** {agent.process_name or 'Not named yet'}")
        if agent.last_assessment:
            _render_assessment(agent.process_name or "Unnamed process", agent.last_assessment, agent.results())
        st.dataframe(pd.DataFrame(evidence_table(agent)), width="stretch", hide_index=True)


def render_manual() -> None:
    st.subheader("Single-process assessment")
    process_name = st.text_input("Process name", placeholder="e.g., Customer Onboarding")
    st.info("Level 1 — Initial is the default classification. Mark only criteria supported by current evidence.")

    results: Dict[str, bool] = {}
    for level in range(2, 6):
        with st.expander(f"Level {level} — {dict(LEVELS)[level]}", expanded=level == 2):
            results.update(render_criterion_checklist(level))
            current_score = score_level(CRITERIA[level], results)
            st.progress(
                int(current_score),
                text=f"Weighted score: {current_score:.0f}% / {PASS_THRESHOLD:.0f}% required",
            )

    if st.button("Classify process", type="primary", disabled=not process_name.strip()):
        agent = _session()
        agent.process_name = process_name.strip()
        seed_manual_evidence(agent, results)
        payload = classify_and_notify(agent, results=results)
        _render_assessment(process_name, agent.last_assessment or payload, results)
        if agent.notifications:
            _queue_notification(agent.notifications[0])


def render_control_panel() -> None:
    st.subheader("Control panel")
    st.caption("Connect Celonis ODC, run pull → classify → notify, and review history.")
    current = load_settings()
    with st.form("connections"):
        cols = st.columns(2)
        with cols[0]:
            st.markdown("**Celonis**")
            current.celonis_base_url = st.text_input("Team URL", current.celonis_base_url)
            current.celonis_client_id = st.text_input("Client id", current.celonis_client_id)
            current.celonis_client_secret = st.text_input("Client secret", current.celonis_client_secret, type="password")
            current.celonis_km_id = st.text_input("Knowledge Model id", current.celonis_km_id)
            current.celonis_kpi_ids = st.text_input("KPI ids", current.celonis_kpi_ids)
            current.celonis_process_name = st.text_input("Process name", current.celonis_process_name)
        with cols[1]:
            st.markdown("**Notify**")
            current.smtp_host = st.text_input("SMTP host", current.smtp_host)
            current.smtp_port = st.text_input("SMTP port", current.smtp_port)
            current.smtp_user = st.text_input("SMTP user", current.smtp_user)
            current.smtp_password = st.text_input("SMTP password", current.smtp_password, type="password")
            current.smtp_from = st.text_input("From", current.smtp_from)
            current.smtp_to = st.text_input("To", current.smtp_to)
            current.llm_api_key = st.text_input("LLM API key", current.llm_api_key, type="password")
            current.llm_model = st.text_input("LLM model", current.llm_model)
        saved = st.form_submit_button("Save connections")
    if saved:
        save_settings(current)
        st.success("Saved connections to `.processiq.env`.")

    actions = st.columns(4)
    if actions[0].button("Test Celonis", width="stretch"):
        try:
            st.success(test_connection(load_settings()))
        except Exception as exc:
            st.error(str(exc))
    if actions[1].button("Run now (fixture)", width="stretch"):
        results = run_pipeline(dry_run=True, send_email=False)
        st.success(f"Classified {len(results)} process(es) from the fixture.")
        st.json([item.to_dict() for item in results])
    if actions[2].button("Run now (live)", width="stretch"):
        try:
            results = run_pipeline(dry_run=False, send_email=True)
            st.success(f"Live run complete for {len(results)} process(es).")
            st.json([item.to_dict() for item in results])
        except Exception as exc:
            st.error(str(exc))
    if actions[3].button("Classify only (no email)", width="stretch"):
        try:
            results = run_pipeline(dry_run=False, send_email=False)
            st.success(f"Classified {len(results)} process(es). Email skipped.")
            st.json([item.to_dict() for item in results])
        except Exception as exc:
            st.error(str(exc))

    st.subheader("Run history")
    history = load_history()
    if not history:
        st.caption("No scheduled or manual runs yet.")
        return
    summary = [
        {
            "When": row["run_at"],
            "Processes": row["count"],
            "Dry run": row["dry_run"],
            "Emailed": row["emailed"],
            "Error": row.get("error") or "",
            "First result": (
                f"{row['results'][0]['process_name']} L{row['results'][0]['level']}"
                if row.get("results") else ""
            ),
        }
        for row in history
    ]
    st.dataframe(pd.DataFrame(summary), width="stretch", hide_index=True)
    with st.expander("Latest report"):
        st.json(history[0])


def render_batch() -> None:
    st.subheader("Batch assessment")
    st.write(
        "Use `true`, `yes`, `1`, `y`, `pass` for a met criterion; any other value is treated as not met."
    )
    uploaded = st.file_uploader("Upload assessment CSV", type="csv")
    if not uploaded:
        return
    try:
        output = evaluate_batch(uploaded)
    except (ValueError, pd.errors.ParserError) as exc:
        st.error(str(exc))
        return
    st.dataframe(output, width="stretch", hide_index=True)
    st.download_button(
        "Download scored results",
        output.to_csv(index=False),
        "processiq_scored_results.csv",
        "text/csv",
    )
    agent = _session()
    for _, row in output.iterrows():
        agent.process_name = str(row["process_name"])
        assessment = {
            "level": int(row["maturity_level"]),
            "label": row["maturity_label"],
            "scores": {level: float(row[f"{level}_score"]) for level in range(2, 6)},
            "blocked_by": [],
        }
        agent.last_assessment = assessment
        create_notification(agent, assessment)
    if agent.notifications:
        _queue_notification(agent.notifications[0])
        st.info(f"{len(output)} processes classified. Notifications are in the sidebar.")


def main() -> None:
    st.set_page_config(page_title="ProcessIQ", page_icon="📈", layout="wide")
    agent = _session()
    pending_id = st.session_state.pop("pending_notification_id", None)
    if pending_id:
        match = next((item for item in agent.notifications if item.id == pending_id), None)
        if match:
            _render_browser_notification(match)

    st.title("ProcessIQ")
    st.caption("Process maturity classification using evidence-based weighted gates")

    with st.sidebar:
        st.header("Assessment mode")
        mode = st.radio(
            "Choose a workspace",
            ("Control panel", "AI chatbot", "Single process", "Batch CSV"),
        )
        st.divider()
        if mode == "AI chatbot":
            key_set = bool((st.session_state.get("llm") or {}).get("api_key"))
            st.caption(
                "LLM key: ready" if key_set else "LLM key: paste it in the box at the top of the page"
            )
            st.divider()
        st.markdown("**Classification rule**")
        st.write(
            "Every process starts at Level 1 — Initial. A level is attained only "
            "when its weighted score is at least 80% and all prior levels have passed. "
            "The chatbot records evidence; it does not invent the score."
        )
        st.download_button(
            "Download CSV template",
            data=csv_template(),
            file_name="processiq_assessment_template.csv",
            mime="text/csv",
        )
        st.divider()
        _render_notifications(agent)

    if mode == "Control panel":
        render_control_panel()
    elif mode == "AI chatbot":
        render_chatbot(agent)
    elif mode == "Batch CSV":
        render_batch()
    else:
        render_manual()

    with st.expander("Methodology and criterion definitions"):
        for level, label in LEVELS[1:]:
            st.markdown(f"**Level {level} — {label}**")
            st.table(pd.DataFrame([
                row for row in catalog_rows() if row["Level"] == level
            ]))


if __name__ == "__main__":
    main()
