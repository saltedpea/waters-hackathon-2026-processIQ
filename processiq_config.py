"""Shared ProcessIQ settings from environment, optional local file, and Streamlit secrets."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Dict, Mapping

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".processiq.env"
HISTORY_PATH = ROOT / "data" / "run_history.jsonl"
MAPPING_PATH = ROOT / "processiq_celonis_mapping.json"
FIXTURE_PATH = ROOT / "fixtures" / "celonis_sample.json"


@dataclass
class Settings:
    celonis_base_url: str = ""
    celonis_client_id: str = ""
    celonis_client_secret: str = ""
    celonis_scope: str = "intelligence.knowledge-models:read"
    celonis_km_id: str = ""
    celonis_kpi_ids: str = ""
    celonis_process_name: str = ""
    smtp_host: str = ""
    smtp_port: str = "587"
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_to: str = ""
    llm_base_url: str = "https://router.huggingface.co/v1"
    llm_api_key: str = ""
    llm_model: str = "openai/gpt-oss-20b"

    def smtp_port_int(self) -> int:
        try:
            return int(self.smtp_port or 587)
        except ValueError:
            return 587

    def kpi_id_list(self) -> list[str]:
        return [item.strip() for item in self.celonis_kpi_ids.split(",") if item.strip()]

    def recipients(self) -> list[str]:
        return [item.strip() for item in self.smtp_to.split(",") if item.strip()]

    def celonis_ready(self) -> bool:
        return bool(self.celonis_base_url and self.celonis_client_id and self.celonis_client_secret)

    def smtp_ready(self) -> bool:
        return bool(self.smtp_host and self.smtp_from and self.recipients())


ENV_KEYS = {
    "celonis_base_url": "CELONIS_BASE_URL",
    "celonis_client_id": "CELONIS_CLIENT_ID",
    "celonis_client_secret": "CELONIS_CLIENT_SECRET",
    "celonis_scope": "CELONIS_SCOPE",
    "celonis_km_id": "CELONIS_KM_ID",
    "celonis_kpi_ids": "CELONIS_KPI_IDS",
    "celonis_process_name": "CELONIS_PROCESS_NAME",
    "smtp_host": "SMTP_HOST",
    "smtp_port": "SMTP_PORT",
    "smtp_user": "SMTP_USER",
    "smtp_password": "SMTP_PASSWORD",
    "smtp_from": "SMTP_FROM",
    "smtp_to": "SMTP_TO",
    "llm_base_url": "LLM_BASE_URL",
    "llm_api_key": "LLM_API_KEY",
    "llm_model": "LLM_MODEL",
}


def _parse_env_file(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _streamlit_secret(name: str) -> str:
    try:
        import streamlit as st
        return str(st.secrets.get(name, "") or "")
    except Exception:
        return ""


def load_settings(overrides: Mapping[str, str] | None = None) -> Settings:
    file_values = _parse_env_file(ENV_PATH)
    data: Dict[str, str] = {}
    for field in fields(Settings):
        env_name = ENV_KEYS[field.name]
        data[field.name] = (
            (overrides or {}).get(field.name)
            or os.environ.get(env_name, "")
            or _streamlit_secret(env_name)
            or file_values.get(env_name, "")
            or str(getattr(Settings(), field.name))
        )
    if not data["llm_api_key"]:
        data["llm_api_key"] = (
            os.environ.get("HF_TOKEN")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("GROQ_API_KEY")
            or file_values.get("HF_TOKEN", "")
        )
    return Settings(**data)


def save_settings(settings: Settings) -> Path:
    lines = [f"{ENV_KEYS[key]}={value}" for key, value in asdict(settings).items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ENV_PATH
