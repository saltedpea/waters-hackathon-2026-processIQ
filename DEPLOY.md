# ProcessIQ deployment

ProcessIQ pulls Celonis ODC metrics, classifies maturity with the official 80% sequential rules, writes an LLM narrative, and emails an HTML report. The Streamlit app is the control panel. GitHub Actions is the weekday scheduler.

## What runs where

| Piece | Command | Host |
| --- | --- | --- |
| Control panel | `streamlit run processiq_app.py` | local or Streamlit Community Cloud |
| One-shot bot | `python processiq_bot.py --once` | laptop, VM, or GitHub Actions |
| Sample pull | `python processiq_bot.py --dry-run` | no Celonis or SMTP needed |

Classification never comes from the LLM. `processiq_core.assess_process()` is the only scorer.

## 1. Celonis OAuth client

1. In Celonis, create an OAuth 2.0 client with grant type **Client credentials**.
2. Scope: `intelligence.knowledge-models:read`.
3. On the Studio package that contains the Knowledge Model, grant the client at least **USE PACKAGE**.
4. Publish the Knowledge Model.
5. Copy:
   - team URL, for example `https://your-team.eu-1.celonis.cloud`
   - client id
   - client secret
   - Knowledge Model id, for example `order-to-cash.otc-km`

Optional: edit `processiq_celonis_mapping.json` to bind KPI ids to criterion codes.

## 2. Local secrets

Do not commit secrets. Create `.processiq.env` in this folder:

```
CELONIS_BASE_URL=https://your-team.eu-1.celonis.cloud
CELONIS_CLIENT_ID=...
CELONIS_CLIENT_SECRET=...
CELONIS_SCOPE=intelligence.knowledge-models:read
CELONIS_KM_ID=order-to-cash.otc-km
CELONIS_KPI_IDS=COCKPIT_ACTIVE,LIVE_KPI_FEED,PAM_ACTIVE
CELONIS_PROCESS_NAME=Order to Cash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=processiq@your-company.com
SMTP_TO=pi-team@your-company.com
LLM_BASE_URL=https://router.huggingface.co/v1
LLM_API_KEY=...
LLM_MODEL=openai/gpt-oss-20b
```

The control panel can write this file after you paste values.

## 3. Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python processiq_bot.py --dry-run
streamlit run processiq_app.py
```

In the app, open **Control panel**:

1. Save Celonis, SMTP, and LLM settings.
2. Click **Test Celonis**.
3. Click **Run now (sample)** first, then **Run now (live)** when the token works.
4. Check **Run history** and the inbox.

## 4. Streamlit Community Cloud

1. Push this repo to GitHub. Main file: `processiq_app.py`.
2. Python version: **3.12**.
3. App settings → Secrets:

```toml
CELONIS_BASE_URL = "https://your-team.eu-1.celonis.cloud"
CELONIS_CLIENT_ID = "..."
CELONIS_CLIENT_SECRET = "..."
CELONIS_KM_ID = "..."
SMTP_HOST = "smtp.office365.com"
SMTP_PORT = "587"
SMTP_USER = "..."
SMTP_PASSWORD = "..."
SMTP_FROM = "processiq@your-company.com"
SMTP_TO = "pi-team@your-company.com"
LLM_API_KEY = "..."
```

4. If the URL asks for login, make the app **public**.
5. Cloud secrets are environment variables for the bot code, but the weekday email job should run in GitHub Actions, not only when someone opens the web app.

## 5. GitHub Actions cron

The workflow `.github/workflows/processiq-cron.yml` runs weekdays at 06:00 UTC and on **Run workflow**.

Add repository secrets with the same names as the env keys above. `CELONIS_SCOPE` can be omitted; the client defaults to `intelligence.knowledge-models:read`.

To test without Celonis or mail, run the workflow with `dry_run=true`.

## 6. Troubleshooting

- **OAuth 401**: client id/secret or team URL is wrong.
- **Knowledge Model 403**: client lacks USE PACKAGE on that Studio package.
- **Empty metrics**: publish the KM and set `CELONIS_KPI_IDS` or confirm `/kpis` returns ids.
- **SMTP failure**: office365 needs the mailbox user and an app password or SMTP AUTH enabled.
- **LLM skipped**: narrative falls back to the rules template; the level is unchanged.
