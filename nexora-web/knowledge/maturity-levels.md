# Process maturity levels and gates

Nexora classifies every process into one of five maturity levels:

1. Level 1 - Initial
2. Level 2 - Managed
3. Level 3 - Defined
4. Level 4 - Measured
5. Level 5 - Optimized

## How a level is awarded

Every process starts at Level 1. Each criterion is binary: it is either met or not met.
A level's score is the sum of the weights of the criteria that are met, as a percentage (0-100).

A process advances to a level only when both conditions hold:

- the weighted score for that level is at least 80% (the pass threshold), and
- every preceding level has already passed. Levels are sequential, so Level 4 cannot be
  reached while Level 3 is failing.

If a level is not reached, the process is "blocked" and the reason is reported, for example
"Level 3 score is 62% (requires 80%)" or "Level 4 requires Level 3 first".

The scoring model alone decides the level. The AI assistant only explains results; it never
assigns or changes a score.

## Criteria by level

### Level 2 - Managed
- C2.1 Process modelled per BPMN standard (25%): a BPMN-compliant model exists and has passed system checks.
- C2.2 Naming convention followed (25%): the process name matches the naming rules, confirmed by the PI team and the Quality Manager.
- C2.3 Ownership at domain and end-to-end level (17%): a responsible owner is named for the category and E2E scenario.
- C2.4 Ownership at main process level (17%): the Process Owner field is populated.
- C2.5 Ownership at subprocess level (16%): the Subprocess Owner field is populated.

### Level 3 - Defined
- C3.1 RACI defined (16%)
- C3.2 Inputs and outputs defined (16%)
- C3.3 Systems mapped (16%)
- C3.4 Organizational units mapped (16%)
- C3.5 KPIs defined (16%): the definition is enough at this level.
- C3.6 Standards linked (10%): standards or policies are linked to the process.
- C3.7 Risks and controls defined (10%)

### Level 4 - Measured
- C4.1 Process Cockpit active and KPIs connected to Celonis (50%): a live KPI feed refreshes periodically.
- C4.2 PAM active where applicable (30%): PAM is linked, and conformance, PIG and relevant KPIs are tracked.
- C4.3 Process adherence tracked and deviations identified (20%): the cockpit shows deviations and friction areas.

### Level 5 - Optimized
- C5.1 Improvement opportunities identified (35%): at least one open continuous-improvement initiative is linked in WAVE.
- C5.2 Automation opportunities tracked (35%): at least one automation opportunity is logged using Celonis Action Flow, Orchestration Flow or AI.
- C5.3 Measurable business outcome realized (30%): a KPI has improved and the improvement is visible on the Process Cockpit or PAM dashboards.

## Readiness gates on the dashboard

- Measured Gate: the share of processes that clear the Level 4 gate.
- Optimized Gate: the share of processes that clear the Level 5 gate.
