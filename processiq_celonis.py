"""Celonis ODC client: OAuth2 client-credentials and Knowledge Model metrics."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping
from urllib.parse import quote

import requests

from processiq_config import FIXTURE_PATH, MAPPING_PATH, Settings
from processiq_core import ALL_CODES


DEFAULT_KPI_HINTS: Dict[str, tuple[str, ...]] = {
    "C2.1": ("bpmn", "modelled", "process model"),
    "C2.2": ("naming convention", "naming standard"),
    "C2.3": ("e2e owner", "domain owner", "category owner"),
    "C2.4": ("process owner",),
    "C2.5": ("subprocess owner",),
    "C3.1": ("raci",),
    "C3.2": ("input", "output"),
    "C3.3": ("system mapped", "systems"),
    "C3.4": ("org unit", "organizational"),
    "C3.5": ("kpi defined", "kpi definition"),
    "C3.6": ("standard", "policy"),
    "C3.7": ("risk", "control"),
    "C4.1": ("cockpit", "live kpi", "refresh", "celonis kpi"),
    "C4.2": ("pam", "conformance", "pig"),
    "C4.3": ("adherence", "deviation", "friction"),
    "C5.1": ("wave", "improvement", "ci initiative"),
    "C5.2": ("automation", "action flow", "orchestration"),
    "C5.3": ("kpi improved", "outcome", "value realized"),
}


@dataclass
class Metric:
    kpi_id: str
    name: str
    value: Any
    process_name: str = ""


@dataclass
class ProcessSnapshot:
    process_name: str
    metrics: List[Metric] = field(default_factory=list)
    results: Dict[str, bool] = field(default_factory=dict)
    evidence: Dict[str, str] = field(default_factory=dict)
    source: str = "celonis"


class CelonisError(RuntimeError):
    pass


class CelonisODCClient:
    """OAuth2 client for Celonis Intelligence / Knowledge Model APIs."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._token = ""
        self._token_expiry = 0.0

    @property
    def base_url(self) -> str:
        return self.settings.celonis_base_url.rstrip("/")

    def _request_token(self) -> Dict[str, Any]:
        url = f"{self.base_url}/oauth2/token"
        payload = {
            "client_id": self.settings.celonis_client_id,
            "client_secret": self.settings.celonis_client_secret,
            "grant_type": "client_credentials",
            "scope": self.settings.celonis_scope,
        }
        response = requests.post(url, data=payload, timeout=45)
        if response.status_code >= 400:
            raise CelonisError(f"OAuth token failed ({response.status_code}): {response.text[:300]}")
        return response.json()

    def access_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 30:
            return self._token
        data = self._request_token()
        self._token = str(data.get("access_token") or "")
        if not self._token:
            raise CelonisError("Celonis token response did not include access_token")
        self._token_expiry = time.time() + float(data.get("expires_in") or 300)
        return self._token

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token()}",
            "Accept": "application/json",
            "User-Agent": "ProcessIQ/1.0 (celonis-odc)",
        }

    def _get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        response = requests.get(url, headers=self._headers(), params=dict(params or {}), timeout=60)
        if response.status_code >= 400:
            raise CelonisError(f"Celonis GET {path} failed ({response.status_code}): {response.text[:300]}")
        if not response.content:
            return {}
        return response.json()

    def list_knowledge_models(self) -> List[Dict[str, Any]]:
        payload = self._get("/intelligence/api/knowledge-models")
        if isinstance(payload, list):
            return payload
        for key in ("content", "data", "items", "knowledgeModels"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        return []

    def list_kpis(self, km_id: str) -> List[Dict[str, Any]]:
        encoded = quote(km_id, safe=".-")
        payload = self._get(f"/intelligence/api/knowledge-models/{encoded}/kpis")
        if isinstance(payload, list):
            return payload
        for key in ("content", "data", "items", "kpis"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        return []

    def query_kpis(self, km_id: str, kpi_ids: List[str]) -> Dict[str, Any]:
        encoded = quote(km_id, safe=".-")
        params = {"page": 0, "pageSize": 50}
        if kpi_ids:
            params["kpis"] = ",".join(kpi_ids)
        return self._get(f"/intelligence/api/knowledge-models/{encoded}/query", params)


def load_mapping(path: Path = MAPPING_PATH) -> Dict[str, Any]:
    if not path.exists():
        return {"criteria": {}, "static_results": {}, "default_process_name": ""}
    return json.loads(path.read_text(encoding="utf-8"))


def _truthy_metric(value: Any, min_value: float | None = None) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        threshold = 0 if min_value is None else min_value
        return float(value) > float(threshold)
    text = str(value).strip().lower()
    if text in {"", "0", "false", "no", "none", "null"}:
        return False
    if text in {"1", "true", "yes", "y", "active", "live"}:
        return True
    try:
        number = float(text)
    except ValueError:
        return True
    threshold = 0 if min_value is None else min_value
    return number > float(threshold)


def _flatten_query_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("content", "data", "items", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    return [payload]


def map_metrics_to_results(
    metrics: List[Metric],
    mapping: Mapping[str, Any] | None = None,
) -> tuple[Dict[str, bool], Dict[str, str]]:
    mapping = mapping or {}
    criteria_map = mapping.get("criteria") or {}
    static_results = {code: bool(flag) for code, flag in (mapping.get("static_results") or {}).items()}
    results = {code: bool(static_results.get(code, False)) for code in ALL_CODES}
    evidence = {
        code: "Static mapping" if results[code] else "No Celonis evidence yet"
        for code in ALL_CODES
    }

    by_id = {metric.kpi_id.lower(): metric for metric in metrics}
    for code, rule in criteria_map.items():
        if code not in results:
            continue
        kpi_ids = [str(item).lower() for item in rule.get("kpi_ids", [])]
        min_value = rule.get("min_value")
        matched = [by_id[kpi_id] for kpi_id in kpi_ids if kpi_id in by_id]
        if matched and any(_truthy_metric(item.value, min_value) for item in matched):
            results[code] = True
            evidence[code] = f"KPI {matched[0].kpi_id} = {matched[0].value}"

    for metric in metrics:
        blob = f"{metric.kpi_id} {metric.name}".lower().replace("_", " ")
        for code, hints in DEFAULT_KPI_HINTS.items():
            if results[code]:
                continue
            if any(hint in blob for hint in hints) and _truthy_metric(metric.value):
                results[code] = True
                evidence[code] = f"{metric.name or metric.kpi_id} = {metric.value}"
    return results, evidence


def snapshots_from_payload(
    payload: Any,
    settings: Settings,
    mapping: Mapping[str, Any] | None = None,
) -> List[ProcessSnapshot]:
    mapping = mapping or load_mapping()
    process_name = settings.celonis_process_name or mapping.get("default_process_name") or "Celonis process"
    metrics: List[Metric] = []
    for row in _flatten_query_rows(payload):
        row_process = str(row.get("process_name") or row.get("processName") or process_name)
        if "kpis" in row and isinstance(row["kpis"], dict):
            items = row["kpis"].items()
        else:
            items = [
                (key, value) for key, value in row.items()
                if key not in {"process_name", "processName", "id"}
            ]
        for kpi_id, value in items:
            if isinstance(value, dict) and "value" in value:
                value = value.get("value")
            metrics.append(Metric(str(kpi_id), str(kpi_id), value, row_process))

    grouped: Dict[str, List[Metric]] = {}
    for metric in metrics:
        grouped.setdefault(metric.process_name or process_name, []).append(metric)
    if not grouped:
        grouped[process_name] = []

    snapshots = []
    for name, group in grouped.items():
        results, evidence = map_metrics_to_results(group, mapping)
        snapshots.append(ProcessSnapshot(name, group, results, evidence, "celonis"))
    return snapshots


def load_fixture(path: Path = FIXTURE_PATH) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def extract_snapshots(settings: Settings, dry_run: bool = False) -> List[ProcessSnapshot]:
    mapping = load_mapping()
    if dry_run or not settings.celonis_ready():
        return snapshots_from_payload(load_fixture(), settings, mapping)
    if not settings.celonis_km_id:
        raise CelonisError("CELONIS_KM_ID is required for a live pull")
    client = CelonisODCClient(settings)
    kpi_ids = settings.kpi_id_list()
    if not kpi_ids:
        discovered = client.list_kpis(settings.celonis_km_id)
        kpi_ids = [str(item.get("id") or item.get("name") or "") for item in discovered]
        kpi_ids = [item for item in kpi_ids if item]
    payload = client.query_kpis(settings.celonis_km_id, kpi_ids)
    return snapshots_from_payload(payload, settings, mapping)


def test_connection(settings: Settings) -> str:
    client = CelonisODCClient(settings)
    client.access_token()
    models = client.list_knowledge_models()
    return f"Connected. {len(models)} knowledge model(s) visible."
