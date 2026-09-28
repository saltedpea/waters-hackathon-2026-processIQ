"""Control Tower scoring: governance, maturity, gates, and rule hits."""

from __future__ import annotations

import ast

import pandas as pd

DG_WEIGHTS = {
    "data_completeness": 20,
    "data_accuracy": 20,
    "data_consistency": 15,
    "data_timeliness": 10,
    "data_lineage": 15,
    "data_ownership": 10,
    "metadata_completeness": 5,
    "data_access_compliance": 5,
}

DG_LABELS = {
    "data_completeness": "Data completeness",
    "data_accuracy": "Data accuracy",
    "data_consistency": "Data consistency",
    "data_timeliness": "Data timeliness",
    "data_lineage": "Data lineage",
    "data_ownership": "Data ownership",
    "metadata_completeness": "Metadata completeness",
    "data_access_compliance": "Data access/compliance",
}

MATURITY_LABELS = {
    1: "Initial",
    2: "Managed",
    3: "Defined",
    4: "Measured",
    5: "Optimized",
}

RULE_DESCRIPTIONS = {
    "DG01": {"name": "Data Completeness Rule", "condition": "Data completeness < 80%",
             "description": "Checks whether all required process data is available.",
             "action": "Improve data completeness"},
    "DG02": {"name": "Data Accuracy Rule", "condition": "Data accuracy < 80%",
             "description": "Checks whether process data accurately represents the business.",
             "action": "Improve data accuracy"},
    "DG03": {"name": "Data Consistency Rule", "condition": "Data consistency < 80%",
             "description": "Checks whether process data stays consistent across systems.",
             "action": "Standardize inconsistent data"},
    "DG04": {"name": "Data Timeliness Rule", "condition": "Data timeliness < 75%",
             "description": "Checks whether data is available in time.",
             "action": "Improve data timeliness"},
    "DG05": {"name": "Data Lineage Rule", "condition": "Data lineage < 70%",
             "description": "Checks whether data can be traced end to end.",
             "action": "Establish end-to-end data lineage"},
    "DG06": {"name": "Data Ownership Rule", "condition": "Data owner not assigned",
             "description": "Checks whether data accountability exists.",
             "action": "Assign a data owner/steward"},
    "DG07": {"name": "Metadata Completeness Rule", "condition": "Metadata completeness < 80%",
             "description": "Checks whether metadata is sufficient.",
             "action": "Complete required data metadata"},
    "DG08": {"name": "Data Access & Compliance Rule", "condition": "Data access/compliance < 80%",
             "description": "Checks access and compliance controls.",
             "action": "Review data access/compliance"},
    "P01": {"name": "Process Ownership Rule", "condition": "Process owner not assigned",
            "description": "Checks whether a process owner exists.",
            "action": "Assign a process owner"},
    "P02": {"name": "Process Roles Rule", "condition": "Roles defined < 75%",
            "description": "Checks whether roles are defined.",
            "action": "Clarify process roles"},
    "P03": {"name": "BPMN Compliance Rule", "condition": "BPMN compliance < 75%",
            "description": "Checks modelling standard quality.",
            "action": "Improve BPMN/process model quality"},
    "P04": {"name": "KPI Linkage Rule", "condition": "KPI linked = No",
            "description": "Checks whether KPIs are linked.",
            "action": "Define and link process KPIs"},
    "P05": {"name": "Execution Data Rule", "condition": "Event data unavailable",
            "description": "Checks whether execution data exists.",
            "action": "Establish reliable process execution data"},
    "P06": {"name": "Deviation Monitoring Rule", "condition": "Deviation monitoring = No",
            "description": "Checks whether deviations are monitored.",
            "action": "Enable deviation monitoring"},
    "PI01": {"name": "High Exception Rule", "condition": "Exception rate > 25%",
             "description": "Detects excessive exceptions.",
             "action": "Investigate high-frequency exceptions"},
    "PI02": {"name": "High Rework Rule", "condition": "Rework rate > 20%",
             "description": "Detects excessive rework.",
             "action": "Investigate rework drivers"},
    "PI03": {"name": "Manual Handling Rule", "condition": "Manual handling > 65%",
             "description": "Finds high manual effort.",
             "action": "Evaluate automation of manual work"},
    "GATE01": {"name": "Data Governance Gate", "condition": "Data Governance Score < 60",
               "description": "Blocks advanced AI/automation when governance is weak.",
               "action": "Prioritize data-governance remediation"},
    "GATE02": {"name": "Optimized Readiness Gate", "condition": "Optimized prerequisites failed",
               "description": "Blocks Optimized until prerequisites pass.",
               "action": "Satisfy optimized-readiness prerequisites"},
}

FEATURES = [
    "data_completeness", "data_accuracy", "data_consistency",
    "data_timeliness", "data_lineage", "data_ownership",
    "metadata_completeness", "data_access_compliance",
    "owner_assigned", "roles_defined", "hierarchy_alignment",
    "bpmn_compliance", "standardized_definition",
    "kpi_linked", "system_linked", "event_data_available",
    "deviation_monitoring", "execution_data_quality",
    "process_adherence", "execution_visibility",
    "process_standardization", "automation_opportunity",
    "decision_structure", "ai_data_readiness",
    "improvement_actions_defined", "monitoring_capability",
    "feedback_availability", "remediation_tracking",
    "cycle_time_hours", "waiting_time_hours", "exception_rate",
    "rework_rate", "manual_handling_rate", "handoff_count",
]


def dg_status(score):
    if score < 40:
        return "Critical"
    if score < 60:
        return "Needs Improvement"
    if score < 80:
        return "Managed"
    return "Strong"


def maturity_level_from_score(score):
    if score <= 20:
        return 1
    if score <= 40:
        return 2
    if score <= 60:
        return 3
    if score <= 80:
        return 4
    return 5


def _rule_hits(row):
    hits, gaps = [], []

    def check(rule_id, condition, gap_text):
        if condition:
            hits.append(rule_id)
            gaps.append(gap_text)

    check("DG01", row["data_completeness"] < 0.80, f"Data completeness at {row['data_completeness']*100:.0f}%")
    check("DG02", row["data_accuracy"] < 0.80, f"Data accuracy at {row['data_accuracy']*100:.0f}%")
    check("DG03", row["data_consistency"] < 0.80, f"Data consistency at {row['data_consistency']*100:.0f}%")
    check("DG04", row["data_timeliness"] < 0.75, f"Data timeliness at {row['data_timeliness']*100:.0f}%")
    check("DG05", row["data_lineage"] < 0.70, f"Data lineage at {row['data_lineage']*100:.0f}%")
    check("DG06", row["data_ownership"] < 0.80, f"Data ownership at {row['data_ownership']*100:.0f}%")
    check("DG07", row["metadata_completeness"] < 0.80, f"Metadata completeness at {row['metadata_completeness']*100:.0f}%")
    check("DG08", row["data_access_compliance"] < 0.80, f"Access/compliance at {row['data_access_compliance']*100:.0f}%")
    check("P01", row["owner_assigned"] == 0, "No process owner assigned")
    check("P02", row["roles_defined"] < 0.75, f"Roles only {row['roles_defined']*100:.0f}% defined")
    check("P03", row["bpmn_compliance"] < 0.75, f"BPMN compliance at {row['bpmn_compliance']*100:.0f}%")
    check("P04", row["kpi_linked"] == 0, "No KPIs linked")
    check("P05", row["event_data_available"] == 0, "No execution/event data")
    check("P06", row["deviation_monitoring"] == 0, "Deviation monitoring not enabled")
    check("PI01", row["exception_rate"] > 0.25, f"Exception rate {row['exception_rate']*100:.0f}%")
    check("PI02", row["rework_rate"] > 0.20, f"Rework rate {row['rework_rate']*100:.0f}%")
    check("PI03", row["manual_handling_rate"] > 0.65, f"Manual handling {row['manual_handling_rate']*100:.0f}%")
    check("GATE01", row["data_governance_score"] < 60, f"Governance score {row['data_governance_score']:.1f} below 60")
    check("GATE02", not row["ai_readiness_gate"], "Optimized prerequisites not satisfied")
    return hits, gaps


def compute(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.copy()
    df["data_governance_score"] = df.apply(
        lambda row: sum(row[col] * weight for col, weight in DG_WEIGHTS.items()), axis=1
    )
    df["data_governance_status"] = df["data_governance_score"].apply(dg_status)
    df["pam_readiness_gate"] = (
        (df["data_governance_score"] >= 60)
        & (df["event_data_available"] == 1)
        & (df["execution_data_quality"] >= 0.75)
        & (df["process_adherence"] >= 0.75)
        & (df["deviation_monitoring"] == 1)
    )
    df["ai_readiness_gate"] = (
        (df["data_governance_score"] >= 80)
        & (df["data_completeness"] >= 0.80)
        & (df["data_lineage"] >= 0.70)
        & (df["metadata_completeness"] >= 0.80)
        & (df["ai_data_readiness"] >= 0.75)
        & (df["process_adherence"] >= 0.75)
        & (df["deviation_monitoring"] == 1)
    )
    df["data_governance_points"] = df["data_governance_score"] / 100 * 20
    df["maturity_score"] = (
        df["data_governance_points"]
        + df["process_governance_score"]
        + df["process_measurement_score"]
        + df["pam_readiness_score"]
        + df["ai_readiness_score"]
        + df["continuous_improvement_score"]
    ).clip(0, 100).round(2)
    if "maturity_level" not in df.columns:
        df["maturity_level"] = df["maturity_score"].apply(maturity_level_from_score)
    df.loc[(df["maturity_level"] == 5) & (~df["ai_readiness_gate"]), "maturity_level"] = 4
    df.loc[(df["maturity_level"] == 4) & (~df["pam_readiness_gate"]), "maturity_level"] = 3
    df["maturity_label"] = df["maturity_level"].map(MATURITY_LABELS)
    if not {"all_gaps", "triggered_rules", "recommendations"}.issubset(df.columns):
        rules_col, gaps_col, recs_col = [], [], []
        for _, row in df.iterrows():
            hits, gaps = _rule_hits(row)
            recs = list(dict.fromkeys(RULE_DESCRIPTIONS[hit]["action"] for hit in hits))
            rules_col.append("|".join(hits) if hits else "None")
            gaps_col.append(str(gaps) if gaps else "[]")
            recs_col.append("|".join(recs) if recs else "No immediate action required")
        df["triggered_rules"] = rules_col
        df["all_gaps"] = gaps_col
        df["recommendations"] = recs_col
    if "target_next_state" not in df.columns:
        target_map = {1: "Level 2 — Managed", 2: "Level 3 — Defined",
                      3: "Level 4 — Measured", 4: "Level 5 — Optimized"}
        df["target_next_state"] = df["maturity_level"].map(lambda level: target_map.get(level, "Maintain Optimized"))
    if "process_id" not in df.columns:
        df["process_id"] = [f"PRC-{index+1:03d}" for index in range(len(df))]
    if "department" not in df.columns:
        df["department"] = "Unassigned"
    return df


def parse_gaps(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return [item.strip() for item in value.split("|") if item.strip()]
    return []


def row_to_dict(row):
    triggered = [item for item in str(row["triggered_rules"]).split("|") if item and item != "None"]
    return {
        "process_id": row["process_id"],
        "process_name": row["process_name"],
        "department": row.get("department", "Unassigned"),
        "governance": {
            "score": round(float(row["data_governance_score"]), 1),
            "status": row["data_governance_status"],
            "dimensions": [
                {"key": key, "label": DG_LABELS[key], "value": round(float(row[key]) * 100, 1)}
                for key in DG_WEIGHTS
            ],
        },
        "maturity": {
            "score": round(float(row["maturity_score"]), 1),
            "level": int(row["maturity_level"]),
            "label": row["maturity_label"],
            "target_next_state": row["target_next_state"],
        },
        "gates": {
            "pam_ready": bool(row["pam_readiness_gate"]),
            "ai_ready": bool(row["ai_readiness_gate"]),
        },
        "gaps": parse_gaps(row["all_gaps"]),
        "triggered_rules": [{"code": code, **RULE_DESCRIPTIONS[code]} for code in triggered if code in RULE_DESCRIPTIONS],
        "recommendations": [item for item in str(row["recommendations"]).split("|") if item],
        "indicators": {
            "cycle_time_hours": round(float(row["cycle_time_hours"]), 1),
            "waiting_time_hours": round(float(row["waiting_time_hours"]), 1),
            "exception_rate": round(float(row["exception_rate"]) * 100, 1),
            "rework_rate": round(float(row["rework_rate"]) * 100, 1),
            "manual_handling_rate": round(float(row["manual_handling_rate"]) * 100, 1),
            "handoff_count": int(row["handoff_count"]),
        },
    }
