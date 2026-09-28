# ProcessIQ

ProcessIQ classifies process maturity using the requested five-level model:

1. **Initial**
2. **Managed**
3. **Defined**
4. **Measured**
5. **Optimized**

Every process starts at Level 1. A process advances only when the weighted score
for the target level is at least 80% and every preceding level has also passed.
Each criterion is binary: met = 1, not met = 0.

## Control Tower assistant (Flask + Ollama)

The prototype at `http://127.0.0.1:5000/` is now a Control Tower with a
multi-agent Ask dock. Four specialists share tools over the live dataset:

- **supervisor** — routes the question and writes the short answer
- **fleet** — mix, gates, and hottest gaps
- **coach** — one process, gates, and why it is stuck
- **planner** — three-step next move from triggered rules

Scores never come from the model. Agents call tools (`fleet_overview`,
`search_processes`, `process_detail`, `top_gaps`, `next_move`). If Ollama is
offline, the same tools still answer through a rules fallback.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Optional, for a full LLM briefing instead of the rules agent:

```powershell
ollama pull llama3.2
ollama serve
```

`OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434/v1`. `OLLAMA_MODEL`
defaults to `llama3.2`.

## Streamlit control panel

```powershell
streamlit run processiq_app.py
```

The Streamlit app is a control panel for Celonis ODC connections, on-demand
runs, and history. It still includes the chatbot, checklist, and batch CSV
modes. The weekday bot is `python processiq_bot.py --once`.

The chatbot and LLM write narrative only. The official 80% sequential model
still assigns the level. See `DEPLOY.md` for Celonis OAuth, SMTP, Streamlit
Cloud, and the GitHub Actions cron.
