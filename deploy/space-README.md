---
title: ProcessIQ Control Tower
emoji: "\U0001F4CA"
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Process maturity assessment and readiness control tower
---

# ProcessIQ — Control Tower

Process maturity assessment across a five-level model: Initial, Managed,
Defined, Measured, Optimized. A process advances only when the weighted score
for the target level reaches 80% and every preceding level has also passed.

Classification comes from the rule engine and a RandomForest classifier trained
at boot. The assistant narrates those results and never produces a score.

## Access

The app is behind a sign-in wall. Credentials are supplied to the container as
Space secrets (`PROCESSIQ_USER`, `PROCESSIQ_PASSWORD`).

## Configuration

| Variable | Purpose |
| --- | --- |
| `PROCESSIQ_USER` | Sign-in username |
| `PROCESSIQ_PASSWORD` | Sign-in password |
| `PROCESSIQ_SECRET` | Flask session signing key |
| `LLM_API_KEY` | Token for the hosted narrator (falls back to `HF_TOKEN`) |
| `LLM_BASE_URL` | OpenAI-compatible endpoint, defaults to the HF router |
| `LLM_MODEL` | Narrator model, defaults to `openai/gpt-oss-20b` |

If no narrator token is present the assistant still answers, using the same
rule-engine facts rendered as text.

## Runtime notes

The dataset, the trained model and the live-intake thread live in process
memory, so the container runs a single Gunicorn worker. Uploaded CSVs and
generated records are therefore lost whenever the Space restarts or sleeps.
