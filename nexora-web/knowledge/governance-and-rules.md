# Data governance scoring and rule engine

## Governance score

The Data Governance score (0-100) is a weighted blend of eight dimensions. The weights add up to 100:

| Dimension | Weight | Rule threshold |
| --- | --- | --- |
| Data completeness | 20 | below 80% triggers DG01 |
| Data accuracy | 20 | below 80% triggers DG02 |
| Data consistency | 15 | below 80% triggers DG03 |
| Data timeliness | 10 | below 75% triggers DG04 |
| Data lineage | 15 | below 70% triggers DG05 |
| Data ownership | 10 | no assigned owner triggers DG06 |
| Metadata completeness | 5 | below 80% triggers DG07 |
| Data access and compliance | 5 | below 80% triggers DG08 |

The dashboard flags a dimension as "attention required" when it falls below its threshold.

## Rules and recommended actions

Each rule checks one condition. When it triggers, it adds a recommended action to the process.

### Data governance rules
- DG01 Data Completeness: improve data completeness.
- DG02 Data Accuracy: improve data accuracy.
- DG03 Data Consistency: standardize inconsistent data.
- DG04 Data Timeliness: improve data timeliness.
- DG05 Data Lineage: establish end-to-end data lineage.
- DG06 Data Ownership: assign a data owner or steward.
- DG07 Metadata Completeness: complete the required data metadata.
- DG08 Data Access and Compliance: review data access and compliance controls.

### Process rules
- P01 Process Ownership (no process owner assigned): assign a process owner.
- P02 Process Roles (roles defined below 75%): clarify process roles.
- P03 BPMN Compliance (below 75%): improve BPMN and process model quality.
- P04 KPI Linkage (KPI not linked): define and link process KPIs.
- P05 Execution Data (event data unavailable): establish reliable process execution data.
- P06 Deviation Monitoring (not enabled): enable deviation monitoring.

### Process indicator rules
- PI01 High Exception (exception rate above 25%): investigate high-frequency exceptions.
- PI02 High Rework (rework rate above 20%): investigate rework drivers.
- PI03 Manual Handling (manual handling above 65%): evaluate automation of manual work.

### Gates
- GATE01 Data Governance Gate (governance score below 60): blocks advanced AI and automation. Prioritize data-governance remediation.
- GATE02 Optimized Readiness Gate (Optimized prerequisites failed): blocks Level 5 until the prerequisites pass.

## Reading the dashboard

- Top Detections lists the rules that trigger most often across all processes.
- Active Issues counts every triggered rule; "processes affected" counts the distinct processes with at least one.
- A process's next target is the level directly above its current one, for example Level 2 aims for Level 3 - Defined.
