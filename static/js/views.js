/* Page renderers. Every number comes from the existing ProcessIQ endpoints. */

const Views = (() => {
  const state = {
    overview: null,
    processes: [],
    rules: null,
    selected: null,
    filters: { q: "", level: "", status: "", readiness: "" },
    sort: { key: "process_id", dir: "asc" },
  };

  const el = (id) => document.getElementById(id);

  function pageHead(title, subtitle, actionsHtml, stampHtml) {
    return `<div class="page-head">
      <div>
        <h1>${UI.esc(title)}</h1>
        <p>${UI.esc(subtitle)}</p>
      </div>
      <div class="page-head__actions">
        ${stampHtml || ""}
        ${actionsHtml || ""}
      </div>
    </div>`;
  }

  /* ==================== OVERVIEW ==================== */
  const PIPELINE = [
    ["database", "Process Data"],
    ["shield-check", "Data Governance"],
    ["layers", "Maturity Assessment"],
    ["door-open", "Readiness Gates"],
    ["git-branch", "Rule Engine"],
    ["triangle-alert", "Key Gaps"],
    ["lightbulb", "Recommendations"],
    ["target", "Target State"],
    ["activity", "Automated Monitoring"],
  ];

  function pipelineHtml() {
    return `<div class="pipeline">
      ${PIPELINE.map((step, index) => `
        <div class="pipeline__step">
          <span class="pipeline__i">${UI.icon(step[0])}</span>
          <span class="pipeline__n">${String(index + 1).padStart(2, "0")}</span>
          <div class="pipeline__t">${UI.esc(step[1])}</div>
        </div>`).join("")}
    </div>`;
  }

  function landscapeHtml(counts, total) {
    const max = Math.max(1, ...Object.values(counts || {}));
    const rows = [1, 2, 3, 4, 5].map((level) => {
      const count = Number((counts || {})[level] || 0);
      const share = total ? (count / total) * 100 : 0;
      return `<button class="mat-row${state.filters.level === String(level) ? " is-active" : ""}"
                      type="button" data-level="${level}">
        <span class="mat-row__label">
          <span class="mat-row__tier">L${level}</span>
          <span class="mat-row__name">${UI.esc(UI.levelName(level))}</span>
        </span>
        <span class="mat-row__bar">
          <span class="mat-row__fill" data-width="${(count / max) * 100}"
                style="background: var(--ramp-${level})"></span>
        </span>
        <span class="mat-row__meta"><b>${count}</b> · ${share.toFixed(0)}%</span>
      </button>`;
    });
    return `<div class="landscape">${rows.join("")}</div>
      <div class="mat-legend">
        <span>${UI.icon("mouse-pointer-click")} Select a level to filter the Process Explorer</span>
        <span class="spacer"></span>
        <span class="mono">${total} processes assessed</span>
      </div>`;
  }

  function dimensionsHtml(dimensions) {
    return Object.keys(UI.DIMENSIONS).map((key) => {
      const value = Number(dimensions[key] || 0);
      const threshold = UI.THRESHOLDS[key];
      const weak = value < threshold;
      const tone = weak ? (value < threshold - 10 ? "crit" : "warn") : "ok";
      return `<div class="dim">
        <div class="dim__top">
          <span class="dim__name">${UI.esc(UI.DIMENSIONS[key])}</span>
          <span class="dim__value" style="color: var(--${tone === "ok" ? "text" : tone})">${value.toFixed(1)}%</span>
        </div>
        ${UI.meter(value, tone)}
        ${weak ? `<div class="dim__flag">${UI.icon("alert-triangle")} Attention required — threshold ${threshold}%</div>` : ""}
      </div>`;
    }).join("");
  }

  function systemHtml(status) {
    return `<div class="sys-list">
      ${status.components.map((item) => {
        const tone = item.state === "operational" || item.state === "connected" || item.state === "streaming"
          ? "ok" : item.state === "degraded" ? "warn" : "muted";
        return `<div class="sys-row">
          <span class="dot dot--${tone === "muted" ? "" : tone} ${item.state === "streaming" ? "dot--live" : ""}"></span>
          <div>
            <div class="sys-row__label">${UI.esc(item.label)}</div>
            <div class="sys-row__detail">${UI.esc(item.detail)}</div>
          </div>
          <span class="sys-row__state" style="color: var(--${tone === "muted" ? "text-3" : tone})">
            ${UI.esc(item.state.replace("_", " "))}
          </span>
        </div>`;
      }).join("")}
      <div class="sys-row">
        <span class="dot dot--info"></span>
        <div>
          <div class="sys-row__label">Last Model Run</div>
          <div class="sys-row__detail">RandomForest retrain</div>
        </div>
        <span class="sys-row__state mono">${UI.relativeTime(status.last_model_run)}</span>
      </div>
    </div>`;
  }

  function topGapsHtml(overview) {
    return (overview.top_gaps || []).slice(0, 5).map((gap) => `
      <div class="metric-row">
        <span><b class="mono" style="color:var(--accent)">${UI.esc(gap.code)}</b> ${UI.esc(gap.name)}</span>
        <span class="metric-row__v">${gap.count}</span>
      </div>`).join("") || UI.empty("No rules triggered", "Every tracked rule is currently passing.", "check-circle");
  }

  async function renderOverview(root) {
    root.innerHTML = pageHead(
      "ProcessIQ Control Tower",
      "Enterprise Process Governance & Maturity Intelligence",
      `<button class="btn btn--primary" id="refresh-assessment">${UI.icon("rotate-cw")}Refresh Assessment</button>`,
      `<div class="page-head__stamp"><b>Last refreshed</b><span id="refresh-stamp">Today, ${UI.clockLabel()}</span></div>`
    ) + `<div class="kpi-grid">${UI.skeleton("kpi", 6)}</div>
         <div class="split"><div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div></div>`;
    UI.refreshIcons(root);

    let overview;
    let status;
    try {
      [overview, status] = await Promise.all([API.overview(), API.systemStatus()]);
    } catch (error) {
      root.querySelector(".kpi-grid").outerHTML = UI.errorState(error.message, "retry-overview");
      UI.refreshIcons(root);
      const retry = el("retry-overview");
      if (retry) retry.addEventListener("click", () => renderOverview(root));
      return;
    }
    state.overview = overview;

    const dgTone = UI.scoreTone(overview.avg_governance_score);
    const issueTone = overview.active_issues > overview.total_processes ? "crit" : "warn";
    const weakDims = Object.keys(UI.DIMENSIONS)
      .filter((key) => Number(overview.governance_dimension_avg[key]) < UI.THRESHOLDS[key]).length;

    root.innerHTML = pageHead(
      "ProcessIQ Control Tower",
      "Enterprise Process Governance & Maturity Intelligence",
      `<button class="btn btn--primary" id="refresh-assessment">${UI.icon("rotate-cw")}Refresh Assessment</button>`,
      `<div class="page-head__stamp"><b>Last refreshed</b><span>Today, ${UI.clockLabel()}</span></div>`
    ) + `
      <div class="kpi-grid">
        ${UI.kpi({ key: "total_processes", label: "Processes Assessed", value: overview.total_processes, icon: "boxes",
                   foot: `${Object.keys(overview.avg_maturity_by_department || {}).length} departments` })}
        ${UI.kpi({ key: "avg_governance_score", label: "Data Governance", value: overview.avg_governance_score, decimals: 1, icon: "shield-check",
                   tone: dgTone, suffix: "", foot: "of 100 average" })}
        ${UI.kpi({ key: "avg_maturity_score", label: "Average Maturity", value: overview.avg_maturity_score, decimals: 1, icon: "layers",
                   tone: UI.scoreTone(overview.avg_maturity_score, 50, 70), foot: "of 100 average" })}
        ${UI.kpi({ key: "pam_ready_pct", label: "Measured Gate", value: overview.pam_ready_pct, decimals: 1, suffix: "%", icon: "door-open",
                   tone: overview.pam_ready_pct >= 50 ? "ok" : "warn", foot: "clear the Level 4 gate" })}
        ${UI.kpi({ key: "ai_ready_pct", label: "Optimized Gate", value: overview.ai_ready_pct, decimals: 1, suffix: "%", icon: "brain-circuit",
                   tone: overview.ai_ready_pct >= 30 ? "ok" : "warn", foot: "clear the Level 5 gate" })}
        ${UI.kpi({ key: "active_issues", label: "Active Issues", value: overview.active_issues, icon: "triangle-alert", tone: issueTone,
                   foot: `${overview.processes_with_issues} processes affected` })}
      </div>

      <div class="stack">
        <section class="card">
          <div class="section-head">
            <div>
              <h2>Process Maturity Landscape</h2>
              <p>Distribution across the five gated maturity levels.</p>
            </div>
            <span class="badge badge--info">${UI.icon("filter")} Click to filter</span>
          </div>
          <div id="ov-landscape">${landscapeHtml(overview.maturity_level_counts, overview.total_processes)}</div>
        </section>

        <div class="split">
          <section class="card">
            <div class="section-head">
              <div>
                <h2>Data Governance Health</h2>
                <p>Eight weighted dimensions across the assessed fleet.</p>
              </div>
            </div>
            <div class="score-hero">
              <span class="score-hero__value" data-count="${overview.avg_governance_score}" data-decimals="1"
                    style="color: var(--${dgTone})">0</span>
              <span class="score-hero__max">/ 100</span>
              <span class="spacer"></span>
              ${UI.badge(dgTone === "ok" ? "STRONG" : dgTone === "warn" ? "MANAGED" : "NEEDS IMPROVEMENT", dgTone)}
            </div>
            <p class="faint" style="font-size:12px;margin:6px 0 14px">
              ${weakDims} of 8 dimensions below threshold.
            </p>
            ${dimensionsHtml(overview.governance_dimension_avg)}
          </section>

          <div class="stack">
            <section class="card">
              <div class="section-head"><div><h2>System Status</h2><p>Live platform components.</p></div></div>
              <div id="ov-system">${systemHtml(status)}</div>
            </section>
            <section class="card">
              <div class="section-head"><div><h2>Top Detections</h2><p>Most frequently triggered rules.</p></div></div>
              <div id="ov-gaps">${topGapsHtml(overview)}</div>
            </section>
          </div>
        </div>

        <section class="card">
          <div class="section-head">
            <div>
              <h2>Intelligence Pipeline</h2>
              <p>How ProcessIQ turns raw process data into a recommended next move.</p>
            </div>
          </div>
          ${pipelineHtml()}
        </section>
      </div>`;

    UI.hydrate(root);
    bindLandscape(root);
    el("refresh-assessment").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerHTML = `${UI.icon("loader-circle")}Refreshing…`;
      UI.refreshIcons(button);
      await renderOverview(root);
      UI.toast("Assessment refreshed from the scoring engine.");
    });
  }

  function bindLandscape(root) {
    root.querySelectorAll(".mat-row").forEach((row) => {
      row.addEventListener("click", () => {
        state.filters.level = row.dataset.level;
        App.go("explorer");
      });
    });
  }

  function setKpi(root, key, value) {
    const node = root.querySelector(`[data-kpi="${key}"]`);
    if (!node) return;
    node.dataset.count = value;
    node.textContent = Number(value).toFixed(Number(node.dataset.decimals || 0)) + (node.dataset.suffix || "");
  }

  /* Patches the numbers in place while live intake runs — a full re-render here
     would replay every count-up and drop the operator's scroll position. */
  async function liveOverview(root) {
    if (!root.querySelector(".kpi-grid")) return renderOverview(root);
    const [overview, status] = await Promise.all([API.overview(), API.systemStatus()]);
    state.overview = overview;

    ["total_processes", "avg_governance_score", "avg_maturity_score",
     "pam_ready_pct", "ai_ready_pct", "active_issues"].forEach((key) => setKpi(root, key, overview[key]));

    const landscape = el("ov-landscape");
    if (landscape) {
      landscape.innerHTML = landscapeHtml(overview.maturity_level_counts, overview.total_processes);
      UI.hydrate(landscape);
      bindLandscape(landscape);
    }
    const system = el("ov-system");
    if (system) {
      system.innerHTML = systemHtml(status);
      UI.refreshIcons(system);
    }
    const gaps = el("ov-gaps");
    if (gaps) {
      gaps.innerHTML = topGapsHtml(overview);
      UI.refreshIcons(gaps);
    }
    return undefined;
  }

  /* ==================== PROCESS EXPLORER ==================== */
  const COLUMNS = [
    { key: "process_id", label: "ID", mono: true },
    { key: "process_name", label: "Process" },
    { key: "department", label: "Department" },
    { key: "owner_assigned", label: "Owner" },
    { key: "maturity_level", label: "Maturity" },
    { key: "governance_score", label: "DG Score", mono: true },
    { key: "pam_ready", label: "Measured" },
    { key: "ai_ready", label: "Optimized" },
    { key: "issues", label: "Issues", mono: true },
  ];

  /* Set by renderExplorer so live intake can refresh only the table body,
     leaving the filter inputs and their focus untouched. */
  let explorerReload = null;

  function sortRows(rows) {
    const { key, dir } = state.sort;
    const factor = dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
    });
  }

  function applyReadiness(rows) {
    if (state.filters.readiness === "pam") return rows.filter((row) => row.pam_ready);
    if (state.filters.readiness === "ai") return rows.filter((row) => row.ai_ready);
    if (state.filters.readiness === "blocked") return rows.filter((row) => !row.pam_ready);
    return rows;
  }

  function explorerTable(rows) {
    if (!rows.length) {
      return UI.empty("No processes match these filters", "Clear a filter or widen the search.", "search-x");
    }
    return `<div class="table-wrap"><table class="table">
      <thead><tr>${COLUMNS.map((col) => `
        <th><button class="table__sort" data-sort="${col.key}">${UI.esc(col.label)}
          ${state.sort.key === col.key ? UI.icon(state.sort.dir === "asc" ? "chevron-up" : "chevron-down") : ""}
        </button></th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `
        <tr data-id="${UI.esc(row.process_id)}">
          <td class="mono faint">${UI.esc(row.process_id)}</td>
          <td><b>${UI.esc(row.process_name)}</b></td>
          <td class="muted">${UI.esc(row.department)}</td>
          <td>${row.owner_assigned
                ? `<span class="badge badge--muted">Assigned</span>`
                : `<span class="badge badge--warn">Unassigned</span>`}</td>
          <td><span class="badge badge--muted" style="color: var(--ramp-${row.maturity_level})">
            L${row.maturity_level} · ${UI.esc(UI.levelName(row.maturity_level))}</span></td>
          <td class="mono">${row.governance_score}</td>
          <td>${UI.gateBadge(row.pam_ready)}</td>
          <td>${UI.gateBadge(row.ai_ready)}</td>
          <td class="mono" style="color: var(--${row.issues > 5 ? "crit" : row.issues ? "warn" : "ok"})">${row.issues}</td>
        </tr>`).join("")}
      </tbody></table></div>`;
  }

  async function renderExplorer(root) {
    root.innerHTML = pageHead(
      "Process Explorer",
      "Search, filter and drill into every assessed process.",
      `<button class="btn" id="clear-filters">${UI.icon("filter-x")}Clear filters</button>`
    ) + `
      <div class="filters">
        <input class="input" type="search" id="ex-q" placeholder="Search process or department…" value="${UI.esc(state.filters.q)}" />
        <select class="select" id="ex-level">
          <option value="">All maturity levels</option>
          ${[1, 2, 3, 4, 5].map((level) => `<option value="${level}" ${state.filters.level === String(level) ? "selected" : ""}>
            Level ${level} — ${UI.levelName(level)}</option>`).join("")}
        </select>
        <select class="select" id="ex-status">
          <option value="">All governance statuses</option>
          ${["Critical", "Needs Improvement", "Managed", "Strong"].map((status) =>
            `<option ${state.filters.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <select class="select" id="ex-readiness">
          <option value="">All readiness</option>
          <option value="pam" ${state.filters.readiness === "pam" ? "selected" : ""}>Measured gate passed</option>
          <option value="ai" ${state.filters.readiness === "ai" ? "selected" : ""}>Optimized gate passed</option>
          <option value="blocked" ${state.filters.readiness === "blocked" ? "selected" : ""}>Blocked at Measured gate</option>
        </select>
        <span class="filter-count" id="ex-count">Loading…</span>
      </div>
      <section class="card card--flush" id="ex-table">${UI.skeleton("block")}</section>`;
    UI.refreshIcons(root);

    async function load() {
      const params = {};
      if (state.filters.q) params.q = state.filters.q;
      if (state.filters.level) params.level = state.filters.level;
      if (state.filters.status) params.status = state.filters.status;
      try {
        const data = await API.processes(params);
        state.processes = data.processes;
        const rows = sortRows(applyReadiness(data.processes));
        const previous = el("ex-table").querySelector(".table-wrap");
        const offset = previous ? [previous.scrollTop, previous.scrollLeft] : null;
        el("ex-table").innerHTML = explorerTable(rows);
        const wrap = el("ex-table").querySelector(".table-wrap");
        if (wrap && offset) {
          wrap.scrollTop = offset[0];
          wrap.scrollLeft = offset[1];
        }
        el("ex-count").textContent = `${rows.length} of ${data.count} processes`;
        UI.refreshIcons(el("ex-table"));
        bindTable();
      } catch (error) {
        el("ex-table").innerHTML = UI.errorState(error.message);
        UI.refreshIcons(el("ex-table"));
      }
    }

    explorerReload = load;

    function bindTable() {
      el("ex-table").querySelectorAll("tr[data-id]").forEach((row) => {
        row.addEventListener("click", () => openAssessment(row.dataset.id));
      });
      el("ex-table").querySelectorAll("[data-sort]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.sort;
          state.sort = { key, dir: state.sort.key === key && state.sort.dir === "asc" ? "desc" : "asc" };
          load();
        });
      });
    }

    let timer;
    el("ex-q").addEventListener("input", (event) => {
      state.filters.q = event.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(load, 240);
    });
    ["level", "status", "readiness"].forEach((key) => {
      el(`ex-${key}`).addEventListener("change", (event) => {
        state.filters[key] = event.target.value;
        load();
      });
    });
    el("clear-filters").addEventListener("click", () => {
      state.filters = { q: "", level: "", status: "", readiness: "" };
      renderExplorer(root);
    });

    load();
  }

  /* ==================== PROCESS ASSESSMENT ==================== */
  function openAssessment(id) {
    state.selected = id;
    App.go("assessment");
  }

  function conditionsHtml(rows) {
    return rows.map((row) => `<div class="cond">
      <span class="cond__i cond__i--${row.passed ? "pass" : "fail"}">${UI.icon(row.passed ? "check-circle-2" : "x-circle")}</span>
      <span>${UI.esc(row.label)}</span>
      <span class="cond__req">${UI.esc(row.requirement)}</span>
      <span class="cond__val" style="color: var(--${row.passed ? "ok" : "crit"})">${UI.esc(row.value)}</span>
    </div>`).join("");
  }

  function gateBlock(key, title, subtitle, passed, conditions) {
    const failed = conditions.filter((row) => !row.passed).length;
    return `<div class="gate" data-gate="${key}">
      <button class="gate__head" type="button">
        <span class="dot dot--${passed ? "ok" : "crit"}"></span>
        <span>
          <span class="gate__title">${UI.esc(title)}</span>
          <div class="gate__sub">${UI.esc(subtitle)}</div>
        </span>
        <span class="spacer"></span>
        ${UI.gateBadge(passed)}
        <span class="gate__chev">${UI.icon("chevron-down")}</span>
      </button>
      <div class="gate__body">
        <div class="gate__why">${passed ? "All requirements met" : `Why — ${failed} requirement${failed === 1 ? "" : "s"} not met`}</div>
        ${conditionsHtml(conditions)}
      </div>
    </div>`;
  }

  async function renderAssessment(root) {
    if (!state.selected) {
      root.innerHTML = pageHead("Process Assessment", "Select a process to open its full assessment.")
        + `<section class="card">${UI.empty("No process selected", "Open the Process Explorer and choose a process.", "mouse-pointer-click")}</section>`;
      UI.refreshIcons(root);
      return;
    }

    root.innerHTML = `<div class="skeleton skeleton--block"></div>`;
    let detail;
    try {
      detail = await API.process(state.selected);
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    const level = detail.maturity.level;
    const next = UI.targetLevel(level);
    const future = UI.targetLevel(next);
    const dims = {};
    detail.governance.dimensions.forEach((dim) => { dims[dim.key] = dim.value; });

    root.innerHTML = `
      <button class="btn btn--sm btn--ghost" id="back-explorer" style="margin-bottom:16px">
        ${UI.icon("arrow-left")}Back to Process Explorer
      </button>

      <div class="assess-head">
        <div>
          <div class="assess-head__id mono">${UI.esc(detail.process_id)}</div>
          <h2>${UI.esc(detail.process_name)}</h2>
          <div class="row wrap">
            <span class="badge badge--ok"><span class="dot dot--ok"></span>Active</span>
            <span class="muted">${UI.esc(detail.department)}</span>
            <span class="faint">·</span>
            <span class="muted">${detail.owner_assigned ? "Owner assigned" : "No process owner"}</span>
          </div>
        </div>
        <div class="page-head__actions">
          <button class="btn" id="ask-about">${UI.icon("sparkles")}Ask the assistant</button>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${UI.kpi({ label: "Maturity Score", value: detail.maturity.score, decimals: 1, icon: "layers",
                   tone: UI.scoreTone(detail.maturity.score, 50, 70), foot: "of 100" })}
        ${UI.kpi({ label: "Governance Score", value: detail.governance.score, decimals: 1, icon: "shield-check",
                   tone: UI.scoreTone(detail.governance.score), foot: detail.governance.status })}
        ${UI.kpi({ label: "Exception Rate", value: detail.indicators.exception_rate, decimals: 1, suffix: "%",
                   icon: "triangle-alert", tone: detail.indicators.exception_rate > 25 ? "crit" : "ok",
                   foot: "threshold 25%" })}
        ${UI.kpi({ label: "Open Detections", value: detail.triggered_rules.length, icon: "git-branch",
                   tone: detail.triggered_rules.length > 5 ? "crit" : detail.triggered_rules.length ? "warn" : "ok",
                   foot: "rules triggered" })}
      </div>

      <div class="stack">
        <section class="card">
          <div class="section-head"><div><h2>Maturity Trajectory</h2>
            <p>Where this process sits today and what it is working toward.</p></div></div>
          <div class="state-flow">
            <div class="state-node state-node--current">
              <div class="state-node__k">Current</div>
              <div class="state-node__v">Level ${level}</div>
              <div class="state-node__s">${UI.esc(UI.levelName(level))}</div>
            </div>
            <div class="state-arrow">${UI.icon("arrow-right")}</div>
            <div class="state-node">
              <div class="state-node__k">Target</div>
              <div class="state-node__v">${next ? `Level ${next}` : "Sustain"}</div>
              <div class="state-node__s">${next ? UI.esc(UI.levelName(next)) : "Maintain Optimized"}</div>
            </div>
            <div class="state-arrow">${UI.icon("arrow-right")}</div>
            <div class="state-node state-node--future">
              <div class="state-node__k">Future</div>
              <div class="state-node__v">${future ? `Level ${future}` : "Level 5"}</div>
              <div class="state-node__s">${UI.esc(UI.levelName(future || 5))}</div>
            </div>
          </div>
        </section>

        <div class="split">
          <div class="stack">
            <section class="card">
              <div class="section-head"><div><h2>Readiness Gates</h2>
                <p>Each gate lists the exact requirement that passed or failed.</p></div></div>
              ${gateBlock("pam", "Measured Gate", "Level 4 prerequisite", detail.gates.pam_ready, detail.gate_conditions.pam_ready)}
              ${gateBlock("ai", "Optimized Gate", "Level 5 prerequisite", detail.gates.ai_ready, detail.gate_conditions.ai_ready)}
            </section>

            <section class="card">
              <div class="section-head"><div><h2>Triggered Intelligence</h2>
                <p>${detail.triggered_rules.length} rule${detail.triggered_rules.length === 1 ? "" : "s"} fired for this process.</p></div></div>
              ${detail.triggered_rules.length
                ? detail.triggered_rules.map((rule) => ruleCard(rule)).join("")
                : UI.empty("No rules triggered", "This process passes every tracked rule.", "check-circle")}
            </section>
          </div>

          <div class="stack">
            <section class="card">
              <div class="section-head"><div><h2>Data Governance</h2>
                <p>${UI.esc(detail.governance.status)} · ${detail.governance.score} / 100</p></div></div>
              ${dimensionsHtml(dims)}
            </section>

            <section class="card">
              <div class="section-head"><div><h2>Performance Indicators</h2></div></div>
              <div class="metric-row"><span>Cycle time</span><span class="metric-row__v">${detail.indicators.cycle_time_hours} h</span></div>
              <div class="metric-row"><span>Waiting time</span><span class="metric-row__v">${detail.indicators.waiting_time_hours} h</span></div>
              <div class="metric-row"><span>Exception rate</span><span class="metric-row__v">${detail.indicators.exception_rate}%</span></div>
              <div class="metric-row"><span>Rework rate</span><span class="metric-row__v">${detail.indicators.rework_rate}%</span></div>
              <div class="metric-row"><span>Manual handling</span><span class="metric-row__v">${detail.indicators.manual_handling_rate}%</span></div>
              <div class="metric-row"><span>Handoffs</span><span class="metric-row__v">${detail.indicators.handoff_count}</span></div>
            </section>

            <section class="card">
              <div class="section-head"><div><h2>Recommended Actions</h2></div></div>
              ${detail.recommendations.length
                ? detail.recommendations.map((action, index) => `
                  <div class="metric-row">
                    <span>${UI.badge(index === 0 ? "HIGH" : index < 3 ? "MEDIUM" : "LOW", index === 0 ? "crit" : index < 3 ? "warn" : "muted")}
                    ${UI.esc(action)}</span>
                  </div>`).join("")
                : UI.empty("Nothing outstanding", "No remediation actions are required.", "check-circle")}
            </section>
          </div>
        </div>

        <section class="card">
          <div class="section-head"><div><h2>Process Improvement Opportunities</h2>
            <p>Gaps detected against the engine thresholds.</p></div></div>
          ${gapCards(detail, dims)}
        </section>
      </div>`;

    UI.hydrate(root);
    el("back-explorer").addEventListener("click", () => App.go("explorer"));
    el("ask-about").addEventListener("click", () => {
      if (window.askAssistant) window.askAssistant(`what should ${detail.process_name} do next?`);
    });
    root.querySelectorAll(".gate__head").forEach((head) => {
      head.addEventListener("click", () => head.parentElement.classList.toggle("is-open"));
    });
  }

  function ruleCard(rule) {
    return `<div class="rule-card" style="margin-bottom:12px">
      <div class="rule-card__head">
        <span class="rule-card__code">${UI.esc(rule.code)}</span>
        <span class="rule-card__name">${UI.esc(rule.name)}</span>
        <span class="spacer"></span>
        ${UI.badge("TRIGGERED", "crit")}
      </div>
      <div class="rule-card__body">
        <div class="rule-flow">
          <div class="rule-flow__step"><span class="rule-flow__k">Condition</span>
            <span class="rule-flow__v mono">${UI.esc(rule.condition)}</span></div>
          <div class="rule-flow__step"><span class="rule-flow__k">Detected issue</span>
            <span class="rule-flow__v">${UI.esc(rule.description)}</span></div>
          <div class="rule-flow__step"><span class="rule-flow__k">Recommended action</span>
            <span class="rule-flow__v is-action">${UI.esc(rule.action)}</span></div>
        </div>
      </div>
    </div>`;
  }

  function gapCards(detail, dims) {
    const cards = Object.keys(UI.DIMENSIONS)
      .map((key) => ({ key, value: Number(dims[key] || 0), threshold: UI.THRESHOLDS[key] }))
      .filter((item) => item.value < item.threshold)
      .sort((a, b) => (a.value - a.threshold) - (b.value - b.threshold));

    if (!cards.length && !detail.gaps.length) {
      return UI.empty("No open gaps", "Every governance dimension is above threshold.", "check-circle");
    }

    return `<div class="gap-grid">
      ${cards.map((item) => {
        const severe = item.value < item.threshold - 10;
        return `<div class="gap-card ${severe ? "gap-card--crit" : ""}">
          <div class="gap-card__top">
            <div>
              <div class="gap-card__name">${UI.esc(UI.DIMENSIONS[item.key])}</div>
              <div class="gap-card__thresh">Threshold ${item.threshold}%</div>
            </div>
            ${UI.badge(severe ? "CRITICAL" : "NEEDS ATTENTION", severe ? "crit" : "warn")}
          </div>
          <div class="gap-card__value" style="color: var(--${severe ? "crit" : "warn"})">${item.value.toFixed(1)}%</div>
          ${UI.meter(item.value, severe ? "crit" : "warn")}
          <div class="gap-card__action"><b>Impact</b>${UI.esc(gapImpact(item.key))}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function gapImpact(key) {
    const impacts = {
      data_completeness: "Missing fields weaken every downstream metric and block AI readiness.",
      data_accuracy: "Inaccurate records distort maturity scoring and reporting.",
      data_consistency: "Divergent records across systems break cross-system analytics.",
      data_timeliness: "Late data delays detection of process deviations.",
      data_lineage: "Untraceable data blocks audit and AI-readiness prerequisites.",
      data_ownership: "No accountable owner slows remediation.",
      metadata_completeness: "Incomplete metadata blocks automated interpretation.",
      data_access_compliance: "Access gaps carry audit and compliance exposure.",
    };
    return impacts[key] || "Reduces confidence in the assessment.";
  }

  /* ==================== DATA GOVERNANCE ==================== */
  async function renderGovernance(root, quiet) {
    if (!quiet) {
      root.innerHTML = pageHead("Data Governance", "Eight-dimension governance scoring across the fleet.")
        + `<div class="skeleton skeleton--block"></div>`;
    }
    let overview;
    try {
      overview = await API.overview();
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    const tone = UI.scoreTone(overview.avg_governance_score);
    const statuses = overview.governance_status_counts || {};
    root.innerHTML = pageHead("Data Governance", "Eight-dimension governance scoring across the fleet.") + `
      <div class="split">
        <section class="card">
          <div class="section-head"><div><h2>Data Governance Health</h2>
            <p>Weighted average across every assessed process.</p></div></div>
          <div class="score-hero">
            <span class="score-hero__value" data-count="${overview.avg_governance_score}" data-decimals="1"
                  style="color: var(--${tone})">0</span>
            <span class="score-hero__max">/ 100</span>
            <span class="spacer"></span>
            ${UI.badge(tone === "ok" ? "STRONG" : tone === "warn" ? "MANAGED" : "NEEDS IMPROVEMENT", tone)}
          </div>
          <div style="margin-top:18px">${dimensionsHtml(overview.governance_dimension_avg)}</div>
        </section>
        <div class="stack">
          <section class="card">
            <div class="section-head"><div><h2>Status Distribution</h2></div></div>
            <div class="chart-box"><canvas id="chart-status"></canvas></div>
          </section>
          <section class="card">
            <div class="section-head"><div><h2>Governance by Status</h2></div></div>
            ${["Strong", "Managed", "Needs Improvement", "Critical"].map((name) => `
              <div class="metric-row">
                <span class="row"><span class="dot dot--${UI.statusTone(name)}"></span>${name}</span>
                <span class="metric-row__v">${statuses[name] || 0}</span>
              </div>`).join("")}
          </section>
        </div>
      </div>`;

    UI.hydrate(root);
    const theme = UI.chartTheme();
    const order = ["Critical", "Needs Improvement", "Managed", "Strong"];
    UI.drawChart("status", "chart-status", {
      type: "doughnut",
      data: {
        labels: order,
        datasets: [{
          data: order.map((name) => statuses[name] || 0),
          backgroundColor: [theme.crit, theme.warn, theme.accent, theme.ok],
          borderColor: theme.card,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "64%",
        plugins: { legend: { position: "bottom", labels: { color: theme.text, font: theme.font, padding: 14, boxWidth: 10 } } },
      },
    });
  }

  /* ==================== RULE ENGINE ==================== */
  async function renderRules(root, quiet) {
    if (!quiet) {
      root.innerHTML = pageHead("Rule Engine", "Triggered Intelligence — every detection explained from rule to action.")
        + `<div class="skeleton skeleton--block"></div>`;
    }
    let data;
    try {
      data = await API.rules();
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }
    state.rules = data;

    const triggered = data.rules.filter((rule) => rule.triggered);
    const clearRules = data.rules.filter((rule) => !rule.triggered);

    root.innerHTML = pageHead(
      "Rule Engine",
      "Triggered Intelligence — every detection explained from rule to action.",
      "",
      `<div class="page-head__stamp"><b>${data.total_detections} detections</b>
       <span>${data.triggered_rules} of ${data.total_rules} rules firing</span></div>`
    ) + `
      <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${UI.kpi({ label: "Rules Loaded", value: data.total_rules, icon: "git-branch", foot: "in the engine" })}
        ${UI.kpi({ label: "Rules Firing", value: data.triggered_rules, icon: "zap", tone: "warn", foot: "at least one process" })}
        ${UI.kpi({ label: "Total Detections", value: data.total_detections, icon: "triangle-alert", tone: "crit", foot: "across the fleet" })}
        ${UI.kpi({ label: "Rules Clear", value: data.total_rules - data.triggered_rules, icon: "check-circle", tone: "ok", foot: "nothing detected" })}
      </div>

      <section class="card" style="margin-bottom:16px">
        <div class="section-head"><div><h2>Triggered Intelligence</h2>
          <p>Ordered by how many processes each rule affects.</p></div></div>
        <div class="rule-grid">
          ${triggered.map((rule) => `
            <div class="rule-card">
              <div class="rule-card__head">
                <span class="rule-card__code">${UI.esc(rule.code)}</span>
                <span class="rule-card__name">${UI.esc(rule.name)}</span>
                <span class="spacer"></span>
                ${UI.badge(`${rule.count}×`, rule.coverage_pct > 40 ? "crit" : "warn")}
              </div>
              <div class="rule-card__body">
                <div class="rule-flow">
                  <div class="rule-flow__step"><span class="rule-flow__k">Condition</span>
                    <span class="rule-flow__v mono">${UI.esc(rule.condition)}</span></div>
                  <div class="rule-flow__step"><span class="rule-flow__k">Detected issue</span>
                    <span class="rule-flow__v">${UI.esc(rule.description)}</span></div>
                  <div class="rule-flow__step"><span class="rule-flow__k">Business impact</span>
                    <span class="rule-flow__v">${rule.coverage_pct}% of assessed processes affected.</span></div>
                  <div class="rule-flow__step"><span class="rule-flow__k">Recommended action</span>
                    <span class="rule-flow__v is-action">${UI.esc(rule.action)}</span></div>
                </div>
              </div>
            </div>`).join("") || UI.empty("No rules triggered", "The fleet passes every tracked rule.", "check-circle")}
        </div>
      </section>

      <section class="card">
        <div class="section-head"><div><h2>Rules Clear</h2>
          <p>Loaded and evaluated, nothing detected.</p></div></div>
        <div class="gap-grid">
          ${clearRules.map((rule) => `
            <div class="gap-card gap-card--ok">
              <div class="gap-card__top">
                <div>
                  <div class="gap-card__name"><span class="mono" style="color:var(--ok)">${UI.esc(rule.code)}</span> ${UI.esc(rule.name)}</div>
                  <div class="gap-card__thresh">${UI.esc(rule.condition)}</div>
                </div>
                ${UI.badge("CLEAR", "ok")}
              </div>
            </div>`).join("") || UI.empty("Every rule is firing", "No rule is currently clear.", "zap")}
        </div>
      </section>`;
    UI.hydrate(root);
  }

  /* ==================== RECOMMENDATIONS ==================== */
  async function renderRecommendations(root, quiet) {
    if (!quiet) {
      root.innerHTML = pageHead("Recommendations", "Prioritised remediation derived from the rule engine.")
        + `<div class="skeleton skeleton--block"></div>`;
    }
    let data;
    try {
      data = !quiet && state.rules ? state.rules : await API.rules();
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    const triggered = data.rules.filter((rule) => rule.triggered);
    const priority = (rule) => (rule.coverage_pct >= 40 ? "HIGH" : rule.coverage_pct >= 15 ? "MEDIUM" : "LOW");
    const tone = (label) => (label === "HIGH" ? "crit" : label === "MEDIUM" ? "warn" : "muted");

    root.innerHTML = pageHead(
      "Recommendations",
      "Prioritised remediation derived from the rule engine.",
      "",
      `<div class="page-head__stamp"><b>${triggered.length} actions</b><span>ranked by fleet impact</span></div>`
    ) + `
      <section class="card">
        ${triggered.length ? triggered.map((rule) => {
          const label = priority(rule);
          return `<div class="rec">
            <div>${UI.badge(label, tone(label))}</div>
            <div>
              <div class="rec__title">${UI.esc(rule.action)}</div>
              <div class="rec__outcome"><b>Issue:</b> ${UI.esc(rule.name)} (${UI.esc(rule.code)}) ·
                ${rule.count} process${rule.count === 1 ? "" : "es"} affected</div>
              <div class="rec__outcome" style="margin-top:4px"><b>Expected outcome:</b> ${UI.esc(outcomeFor(rule.code))}</div>
            </div>
            <div class="rec__actions">
              <button class="btn btn--sm" data-rule="${UI.esc(rule.code)}">${UI.icon("eye")}View Details</button>
              <button class="btn btn--sm" disabled title="Workflow tracking is not enabled in this deployment">
                ${UI.icon("play")}Mark as In Progress</button>
              <button class="btn btn--sm" disabled title="Workflow tracking is not enabled in this deployment">
                ${UI.icon("check")}Resolve</button>
            </div>
          </div>`;
        }).join("") : UI.empty("Nothing to remediate", "No rule is currently triggered across the fleet.", "check-circle")}
      </section>`;

    UI.hydrate(root);
    root.querySelectorAll("[data-rule]").forEach((button) => {
      button.addEventListener("click", () => App.go("rules"));
    });
  }

  function outcomeFor(code) {
    const outcomes = {
      DG01: "Improved data reliability and downstream process analytics.",
      DG02: "Scores and reporting reflect the real business position.",
      DG03: "Consistent records across systems enable cross-system analysis.",
      DG04: "Deviations are detected while they can still be corrected.",
      DG05: "End-to-end traceability unlocks audit and AI readiness.",
      DG06: "Clear accountability shortens remediation cycles.",
      DG07: "Complete metadata enables automated interpretation.",
      DG08: "Reduced audit and compliance exposure.",
      P01: "A named owner accountable for process performance.",
      P02: "Clear role boundaries reduce handoff failures.",
      P03: "Standards-compliant models enable reliable mining.",
      P04: "Linked KPIs make performance measurable.",
      P05: "Execution data unlocks the Measured maturity level.",
      P06: "Deviations surface automatically instead of by exception.",
      PI01: "Fewer exceptions and lower cost to serve.",
      PI02: "Less rework and shorter cycle times.",
      PI03: "Automation candidates identified and effort reduced.",
      GATE01: "Governance lifted above the automation threshold.",
      GATE02: "Optimized-readiness prerequisites satisfied.",
    };
    return outcomes[code] || "Improved process maturity and readiness.";
  }

  /* ==================== READINESS GATES ==================== */
  async function renderGates(root, quiet) {
    if (!quiet) {
      root.innerHTML = pageHead("Readiness Gates", "Which processes clear the Measured and Optimized gates, and what blocks the rest.")
        + `<div class="skeleton skeleton--block"></div>`;
    }
    let overview;
    let list;
    try {
      [overview, list] = await Promise.all([API.overview(), API.processes({})]);
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    const rows = list.processes;
    const pamPass = rows.filter((row) => row.pam_ready);
    const aiPass = rows.filter((row) => row.ai_ready);
    const blocked = rows.filter((row) => !row.pam_ready);

    root.innerHTML = pageHead("Readiness Gates", "Which processes clear the Measured and Optimized gates, and what blocks the rest.") + `
      <div class="kpi-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${UI.kpi({ label: "Measured Gate", value: pamPass.length, icon: "door-open", tone: "ok", foot: `${overview.pam_ready_pct}% of fleet` })}
        ${UI.kpi({ label: "Optimized Gate", value: aiPass.length, icon: "brain-circuit", tone: "ok", foot: `${overview.ai_ready_pct}% of fleet` })}
        ${UI.kpi({ label: "Blocked at Measured", value: blocked.length, icon: "shield-x", tone: "crit", foot: "cannot reach Level 4" })}
        ${UI.kpi({ label: "Assessed", value: rows.length, icon: "boxes", foot: "processes evaluated" })}
      </div>

      <section class="card card--flush">
        <div style="padding:20px 24px 0">
          <div class="section-head"><div><h2>Gate Status by Process</h2>
            <p>Open any process to see the exact requirement that failed.</p></div></div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>ID</th><th>Process</th><th>Maturity</th><th>Measured Gate</th><th>Optimized Gate</th><th>Detections</th></tr></thead>
          <tbody>${rows.map((row) => `
            <tr data-id="${UI.esc(row.process_id)}">
              <td class="mono faint">${UI.esc(row.process_id)}</td>
              <td><b>${UI.esc(row.process_name)}</b></td>
              <td><span class="badge badge--muted" style="color: var(--ramp-${row.maturity_level})">L${row.maturity_level}</span></td>
              <td>${UI.gateBadge(row.pam_ready)}</td>
              <td>${UI.gateBadge(row.ai_ready)}</td>
              <td class="mono">${row.issues}</td>
            </tr>`).join("")}
          </tbody></table></div>
      </section>`;

    UI.hydrate(root);
    root.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => openAssessment(row.dataset.id));
    });
  }

  /* ==================== ANALYTICS ==================== */
  async function renderAnalytics(root, quiet) {
    if (!quiet) {
      root.innerHTML = pageHead("Analytics", "Distribution and departmental views of the current assessment.")
        + `<div class="skeleton skeleton--block"></div>`;
    }
    let overview;
    try {
      overview = await API.overview();
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    root.innerHTML = pageHead("Analytics", "Distribution and departmental views of the current assessment.") + `
      <div class="split--even split">
        <section class="card">
          <div class="section-head"><div><h2>Maturity Distribution</h2>
            <p>Processes per maturity level.</p></div></div>
          <div class="chart-box"><canvas id="chart-maturity"></canvas></div>
        </section>
        <section class="card">
          <div class="section-head"><div><h2>Average Maturity by Department</h2></div></div>
          <div class="chart-box"><canvas id="chart-dept"></canvas></div>
        </section>
        <section class="card">
          <div class="section-head"><div><h2>Governance Dimensions</h2>
            <p>Fleet average against each threshold.</p></div></div>
          <div class="chart-box"><canvas id="chart-radar"></canvas></div>
        </section>
        <section class="card">
          <div class="section-head"><div><h2>Detections by Rule</h2>
            <p>How many processes each rule affects.</p></div></div>
          <div class="chart-box"><canvas id="chart-gaps"></canvas></div>
        </section>
      </div>`;
    UI.hydrate(root);

    const theme = UI.chartTheme();
    UI.drawChart("maturity", "chart-maturity", {
      type: "bar",
      data: {
        labels: [1, 2, 3, 4, 5].map((level) => `L${level} · ${UI.levelName(level)}`),
        datasets: [{
          data: [1, 2, 3, 4, 5].map((level) => overview.maturity_level_counts[level] || 0),
          backgroundColor: theme.ramp, borderRadius: 4, maxBarThickness: 54,
        }],
      },
      options: UI.gridOptions(theme),
    });

    const depts = Object.entries(overview.avg_maturity_by_department || {}).sort((a, b) => b[1] - a[1]);
    UI.drawChart("dept", "chart-dept", {
      type: "bar",
      data: {
        labels: depts.map((item) => item[0]),
        datasets: [{ data: depts.map((item) => item[1]), backgroundColor: theme.accent, borderRadius: 4 }],
      },
      options: { ...UI.gridOptions(theme), indexAxis: "y" },
    });

    UI.drawChart("radar", "chart-radar", {
      type: "radar",
      data: {
        labels: Object.values(UI.DIMENSIONS).map((name) => name.replace("Data ", "")),
        datasets: [{
          data: Object.keys(UI.DIMENSIONS).map((key) => overview.governance_dimension_avg[key]),
          backgroundColor: "rgba(46,168,255,0.14)", borderColor: theme.accent,
          pointBackgroundColor: theme.accent, borderWidth: 1.6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            suggestedMin: 0, suggestedMax: 100,
            angleLines: { color: theme.grid }, grid: { color: theme.grid },
            pointLabels: { color: theme.text, font: { size: 10.5 } },
            ticks: { color: theme.text, backdropColor: "transparent", font: { size: 9 } },
          },
        },
      },
    });

    const gaps = overview.top_gaps || [];
    UI.drawChart("gaps", "chart-gaps", {
      type: "bar",
      data: {
        labels: gaps.map((gap) => gap.code),
        datasets: [{ data: gaps.map((gap) => gap.count), backgroundColor: theme.warn, borderRadius: 4 }],
      },
      options: UI.gridOptions(theme),
    });
  }

  /* ==================== AUTOMATION ==================== */
  function notificationsHtml(notifications) {
    return notifications.notifications.length
      ? notifications.notifications.map((item) => `
        <div class="notif">
          <span class="notif__i notif__i--${item.kind}">
            ${UI.icon(item.kind === "success" ? "check" : item.kind === "error" ? "x" : "triangle-alert")}
          </span>
          <div>
            <div class="notif__title">${UI.esc(item.title)}</div>
            <div class="notif__body">${UI.esc(item.body)}</div>
            <div class="notif__meta">
              <span>${UI.esc(item.meta || "")}</span>
              ${item.at ? `<span>${UI.esc(item.at)}</span>` : ""}
            </div>
          </div>
        </div>`).join("")
      : UI.empty("No notifications yet", "Run an assessment to populate the feed.", "bell-off");
  }

  async function renderAutomation(root) {
    root.innerHTML = pageHead("Automation", "Live intake and the intelligence notification feed.")
      + `<div class="skeleton skeleton--block"></div>`;
    let notifications;
    let stream;
    try {
      [notifications, stream] = await Promise.all([API.notifications(), API.streamStatus()]);
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    root.innerHTML = pageHead("Automation", "Live intake and the intelligence notification feed.") + `
      <div class="split">
        <section class="card">
          <div class="section-head"><div><h2>Intelligence Notifications</h2>
            <p>Assessment events from the scoring and rule engines.</p></div></div>
          <div id="auto-notifs">${notificationsHtml(notifications)}</div>
        </section>

        <div class="stack">
          <section class="card">
            <div class="section-head"><div><h2>Live Intake</h2>
              <p>Classify a new process every four seconds.</p></div></div>
            <div class="setting-row">
              <div class="setting-row__text">
                <div class="setting-row__title">
                  <span class="dot" data-live-dot></span> Continuous classification
                </div>
                <div class="setting-row__desc mono" data-live-status>
                  ${stream.running ? "Live" : "Idle"} · ${stream.rows} rows
                </div>
              </div>
              <label class="switch" title="Classify one new process every 4 seconds">
                <input type="checkbox" data-live-toggle aria-label="Toggle live intake"
                       ${stream.running ? "checked" : ""} />
                <span class="switch__track"></span>
              </label>
            </div>
          </section>
          <section class="card">
            <div class="section-head"><div><h2>Delivery</h2>
              <p>Send the current assessment out of the tower.</p></div></div>
            <div class="setting-row">
              <div class="setting-row__text">
                <div class="setting-row__title">Email briefing</div>
                <div class="setting-row__desc">Uses SMTP when configured, otherwise opens your mail client.</div>
              </div>
              <div class="setting-row__control">
                <input class="input" id="mail-to" type="email" placeholder="name@company.com" style="width:210px" />
                <button class="btn" id="btn-mail">${UI.icon("mail")}Send</button>
              </div>
            </div>
          </section>
        </div>
      </div>`;

    UI.hydrate(root);
    App.live.paint();
    el("btn-mail").addEventListener("click", async () => {
      try {
        const result = await API.mail(el("mail-to").value.trim());
        if (result.sent) UI.toast(`Briefing sent to ${result.sent}`);
        else if (result.mailto) window.location.href = result.mailto;
      } catch (error) {
        UI.toast(error.message);
      }
    });
  }

  async function liveAutomation(root) {
    const list = el("auto-notifs");
    if (!list) return renderAutomation(root);
    list.innerHTML = notificationsHtml(await API.notifications());
    UI.refreshIcons(list);
    return undefined;
  }

  /* ==================== CELONIS ==================== */
  const ARCH = [
    ["database", "Celonis", "Execution data source"],
    ["key-round", "OAuth 2.0", "Client-credentials grant"],
    ["download", "Process Data", "Knowledge Model KPIs"],
    ["radar", "ProcessIQ", "Ingestion and normalisation"],
    ["layers", "Maturity Engine", "Five gated levels"],
    ["git-branch", "Rule Engine", "Threshold detections"],
    ["lightbulb", "Recommendations", "Prioritised actions"],
    ["bell", "Notification", "Email and feed delivery"],
  ];

  async function renderCelonis(root) {
    root.innerHTML = pageHead("Celonis Integration", "Connection posture and the data path into ProcessIQ.")
      + `<div class="skeleton skeleton--block"></div>`;
    let info;
    try {
      info = await API.celonis();
    } catch (error) {
      root.innerHTML = UI.errorState(error.message);
      UI.refreshIcons(root);
      return;
    }

    const connected = info.configured;
    root.innerHTML = pageHead(
      "Celonis Integration",
      "Connection posture and the data path into ProcessIQ.",
      "",
      `<span class="badge badge--${connected ? "ok" : "muted"}">
        <span class="dot dot--${connected ? "ok" : ""}"></span>${connected ? "Connected" : "Not configured"}</span>`
    ) + `
      <section class="card" style="margin-bottom:16px">
        <div class="section-head"><div><h2>Connection</h2>
          <p>Credentials are held server-side and are never returned to the browser.</p></div></div>
        <div class="conn-grid">
          <div class="conn-item"><div class="conn-item__k">Connection Status</div>
            <div class="conn-item__v"><span class="dot dot--${connected ? "ok" : ""}"></span>${connected ? "Connected" : "Not configured"}</div></div>
          <div class="conn-item"><div class="conn-item__k">Authentication</div>
            <div class="conn-item__v">${UI.esc(info.auth_method)}</div></div>
          <div class="conn-item"><div class="conn-item__k">Data Source</div>
            <div class="conn-item__v mono">${UI.esc(info.team_host || "—")}</div></div>
          <div class="conn-item"><div class="conn-item__k">Knowledge Model</div>
            <div class="conn-item__v">${info.knowledge_model_configured ? "Configured" : "Not set"}</div></div>
          <div class="conn-item"><div class="conn-item__k">Scope</div>
            <div class="conn-item__v mono">${UI.esc(info.scope || "—")}</div></div>
          <div class="conn-item"><div class="conn-item__k">KPIs Mapped</div>
            <div class="conn-item__v mono">${info.kpi_count}</div></div>
          <div class="conn-item"><div class="conn-item__k">Last Synchronisation</div>
            <div class="conn-item__v mono">${UI.esc(info.last_sync || "No run recorded")}</div></div>
          <div class="conn-item"><div class="conn-item__k">Processes Available</div>
            <div class="conn-item__v mono">${info.processes_available}</div></div>
          <div class="conn-item"><div class="conn-item__k">Notifications</div>
            <div class="conn-item__v">${info.notifications_configured ? "SMTP configured" : "Not configured"}</div></div>
        </div>
      </section>

      <section class="card">
        <div class="section-head"><div><h2>Integration Architecture</h2>
          <p>The path every process record travels.</p></div></div>
        <div class="arch">
          ${ARCH.map((node, index) => `
            <div class="arch__node">
              ${UI.icon(node[0])}
              <div>
                <div class="arch__label">${UI.esc(node[1])}</div>
                <div class="arch__sub">${UI.esc(node[2])}</div>
              </div>
            </div>
            ${index < ARCH.length - 1 ? `<div class="arch__link"></div>` : ""}`).join("")}
        </div>
      </section>`;
    UI.hydrate(root);
  }

  /* ==================== SETTINGS ==================== */
  async function renderSettings(root) {
    root.innerHTML = pageHead("Settings", "Appearance, dataset and export controls.") + `
      <div class="stack">
        <section class="card">
          <div class="section-head"><div><h2>Appearance</h2></div></div>
          <div class="setting-row">
            <div class="setting-row__text">
              <div class="setting-row__title">Colour theme</div>
              <div class="setting-row__desc">Dark is the default control-room theme. Light is tuned for printing and projectors.</div>
            </div>
            <div class="setting-row__control">
              <button class="btn" data-theme-toggle>${UI.icon("sun-moon")}<span data-theme-label>Dark</span></button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-head"><div><h2>Dataset</h2>
            <p>Uploading replaces the working set and retrains the classifier.</p></div></div>
          <div class="setting-row">
            <div class="setting-row__text">
              <div class="setting-row__title">Upload assessment CSV</div>
              <div class="setting-row__desc" id="dataset-detail">Loading…</div>
            </div>
            <div class="setting-row__control">
              <label class="btn">${UI.icon("upload")}Upload CSV
                <input type="file" id="csv-upload" accept=".csv" hidden /></label>
              <button class="btn" id="btn-reset">${UI.icon("rotate-ccw")}Reset to bundled data</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-head"><div><h2>Export</h2></div></div>
          <div class="setting-row">
            <div class="setting-row__text">
              <div class="setting-row__title">Current assessment</div>
              <div class="setting-row__desc">Save server-side, download as CSV, or print the active view.</div>
            </div>
            <div class="setting-row__control">
              <button class="btn" id="btn-save">${UI.icon("save")}Save</button>
              <button class="btn" id="btn-download">${UI.icon("download")}Download CSV</button>
              <button class="btn" id="btn-print">${UI.icon("printer")}Print</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-head"><div><h2>Session</h2></div></div>
          <div class="setting-row">
            <div class="setting-row__text">
              <div class="setting-row__title">Sign out</div>
              <div class="setting-row__desc">End this Control Tower session.</div>
            </div>
            <div class="setting-row__control">
              <a class="btn" href="/logout">${UI.icon("log-out")}Sign out</a>
            </div>
          </div>
        </section>
      </div>`;
    UI.hydrate(root);

    API.streamStatus()
      .then((status) => { el("dataset-detail").textContent = `${status.rows} processes loaded · sorted by process ID`; })
      .catch(() => { el("dataset-detail").textContent = "Dataset status unavailable"; });

    el("csv-upload").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const result = await API.upload(file);
        UI.toast(`Dataset replaced — ${result.rows} processes loaded.`);
        el("dataset-detail").textContent = `${result.rows} processes loaded · sorted by process ID`;
      } catch (error) {
        UI.toast(`Upload failed: ${error.message}`);
      }
    });
    el("btn-reset").addEventListener("click", async () => {
      const result = await API.reset();
      UI.toast(`Reset to bundled dataset — ${result.rows} processes.`);
      el("dataset-detail").textContent = `${result.rows} processes loaded · sorted by process ID`;
    });
    el("btn-save").addEventListener("click", async () => {
      try {
        const result = await API.save();
        UI.toast(`Saved ${result.rows} rows.`);
      } catch (error) {
        UI.toast(error.message);
      }
    });
    el("btn-download").addEventListener("click", () => { window.location.href = "/api/download"; });
    el("btn-print").addEventListener("click", () => window.print());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => window.processiqTheme.toggle());
    });
  }

  /* Called by the shell every live-intake tick for whichever page is open.
     Each entry updates data in place instead of re-rendering from a skeleton. */
  const live = {
    overview: liveOverview,
    explorer: (root) => (explorerReload ? explorerReload() : renderExplorer(root)),
    governance: (root) => renderGovernance(root, true),
    rules: (root) => renderRules(root, true),
    recommendations: (root) => renderRecommendations(root, true),
    gates: (root) => renderGates(root, true),
    analytics: (root) => renderAnalytics(root, true),
    automation: liveAutomation,
  };

  return {
    state,
    live,
    openAssessment,
    render: {
      overview: renderOverview,
      explorer: renderExplorer,
      assessment: renderAssessment,
      governance: renderGovernance,
      rules: renderRules,
      recommendations: renderRecommendations,
      gates: renderGates,
      analytics: renderAnalytics,
      automation: renderAutomation,
      celonis: renderCelonis,
      settings: renderSettings,
    },
  };
})();
