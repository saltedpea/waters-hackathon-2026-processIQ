/* Shared rendering helpers: formatting, states, meters, charts. */

const UI = (() => {
  /* Mirrors MATURITY_LABELS in processiq_engine.py. */
  const LEVELS = {
    1: "Initial",
    2: "Managed",
    3: "Defined",
    4: "Measured",
    5: "Optimized",
  };

  const DIMENSIONS = {
    data_completeness: "Data Completeness",
    data_accuracy: "Data Accuracy",
    data_consistency: "Data Consistency",
    data_timeliness: "Data Timeliness",
    data_lineage: "Data Lineage",
    data_ownership: "Data Ownership",
    metadata_completeness: "Metadata Completeness",
    data_access_compliance: "Access / Compliance",
  };

  /* Thresholds mirror the rule engine so the UI explains the same numbers. */
  const THRESHOLDS = {
    data_completeness: 80,
    data_accuracy: 80,
    data_consistency: 80,
    data_timeliness: 75,
    data_lineage: 70,
    data_ownership: 80,
    metadata_completeness: 80,
    data_access_compliance: 80,
  };

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );

  const levelName = (level) => LEVELS[Number(level)] || "Unclassified";
  const levelTag = (level) => `Level ${Number(level)} — ${levelName(level)}`;

  function targetLevel(level) {
    const next = Number(level) + 1;
    return next > 5 ? null : next;
  }

  function scoreTone(value, warn = 70, ok = 80) {
    if (value >= ok) return "ok";
    if (value >= warn) return "warn";
    return "crit";
  }

  function statusTone(status) {
    if (status === "Strong") return "ok";
    if (status === "Managed") return "info";
    if (status === "Needs Improvement") return "warn";
    return "crit";
  }

  function icon(name, cls) {
    return `<i data-lucide="${name}" class="i ${cls || ""}"></i>`;
  }

  function refreshIcons(root) {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons({ nameAttr: "data-lucide", root: root || document });
    }
  }

  function relativeTime(epochSeconds) {
    if (!epochSeconds) return "—";
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} d ago`;
  }

  function clockLabel(date) {
    const when = date || new Date();
    return when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  /* ---------- states ---------- */
  function skeleton(kind, count) {
    return Array.from({ length: count || 1 })
      .map(() => `<div class="skeleton skeleton--${kind}"></div>`)
      .join("");
  }

  function empty(title, body, iconName) {
    return `<div class="empty">
      ${icon(iconName || "inbox")}
      <div class="empty__title">${esc(title)}</div>
      ${body ? `<p>${esc(body)}</p>` : ""}
    </div>`;
  }

  function errorState(message, retryId) {
    return `<div class="error-state">
      ${icon("alert-triangle")}
      <div class="error-state__title">Could not load this section</div>
      <p>${esc(message)}</p>
      ${retryId ? `<button class="btn btn--sm" id="${retryId}">${icon("rotate-cw")}Retry</button>` : ""}
    </div>`;
  }

  /* ---------- animation ---------- */
  function countUp(node, target, decimals, suffix) {
    const end = Number(target);
    if (!Number.isFinite(end)) {
      node.textContent = "—";
      return;
    }
    const duration = 620;
    const start = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = (end * eased).toFixed(decimals || 0) + (suffix || "");
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* Live refreshes re-render while the operator is reading. Replaying the
     count-up and bar sweeps on every tick would read as flicker, so quiet mode
     paints the final values straight away. */
  let quiet = false;
  const setQuiet = (value) => { quiet = Boolean(value); };

  function animateMeters(root) {
    (root || document).querySelectorAll(".meter__fill[data-width], .mat-row__fill[data-width]").forEach((bar) => {
      if (quiet) {
        bar.style.transition = "none";
        bar.style.width = `${bar.dataset.width}%`;
        return;
      }
      requestAnimationFrame(() => {
        bar.style.width = `${bar.dataset.width}%`;
      });
    });
  }

  function animateNumbers(root) {
    (root || document).querySelectorAll("[data-count]").forEach((node) => {
      const decimals = Number(node.dataset.decimals || 0);
      const suffix = node.dataset.suffix || "";
      if (quiet) {
        const value = Number(node.dataset.count);
        node.textContent = Number.isFinite(value) ? value.toFixed(decimals) + suffix : "—";
        return;
      }
      countUp(node, node.dataset.count, decimals, suffix);
    });
  }

  function hydrate(root) {
    refreshIcons(root);
    animateMeters(root);
    animateNumbers(root);
  }

  /* ---------- components ---------- */
  function meter(valuePct, tone) {
    const width = Math.max(0, Math.min(100, Number(valuePct) || 0));
    return `<div class="meter"><div class="meter__fill meter__fill--${tone}" data-width="${width}"></div></div>`;
  }

  function kpi(options) {
    const tone = options.tone ? ` kpi--${options.tone}` : "";
    const trend = options.trend
      ? `<span class="kpi__trend kpi__trend--${options.trend.dir}">
           ${icon(options.trend.dir === "up" ? "trending-up" : options.trend.dir === "down" ? "trending-down" : "minus")}
           ${esc(options.trend.text)}
         </span>`
      : "";
    return `<article class="kpi${tone}">
      <div class="kpi__top">
        <span class="kpi__label">${esc(options.label)}</span>
        <span class="kpi__icon">${icon(options.icon)}</span>
      </div>
      <div class="kpi__value"${options.key ? ` data-kpi="${options.key}"` : ""} data-count="${options.value}" data-decimals="${options.decimals || 0}" data-suffix="${options.suffix || ""}">0</div>
      <div class="kpi__foot">${trend}<span>${esc(options.foot || "")}</span></div>
    </article>`;
  }

  function badge(text, tone) {
    return `<span class="badge badge--${tone}">${esc(text)}</span>`;
  }

  function gateBadge(passed) {
    return passed
      ? `<span class="badge badge--ok">PASS</span>`
      : `<span class="badge badge--crit">FAIL</span>`;
  }

  /* ---------- charts ---------- */
  const charts = {};

  function chartTheme() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    return {
      text: read("--text-2", "#93a6bf"),
      grid: read("--grid-line", "rgba(36,54,77,0.55)"),
      accent: read("--accent", "#2ea8ff"),
      accent2: read("--accent-2", "#17c9c0"),
      ok: read("--ok", "#2fb67c"),
      warn: read("--warn", "#e0a33c"),
      crit: read("--crit", "#e05c58"),
      card: read("--card", "#101e31"),
      ramp: [1, 2, 3, 4, 5].map((step) => read(`--ramp-${step}`, "#2ea8ff")),
      font: { family: "'IBM Plex Mono', monospace", size: 11 },
    };
  }

  function drawChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    if (charts[key]) charts[key].destroy();
    charts[key] = new Chart(canvas, quiet ? { ...config, options: { ...config.options, animation: false } } : config);
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      delete charts[key];
    }
  }

  function gridOptions(theme) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: theme.text, font: theme.font }, grid: { color: theme.grid, drawBorder: false } },
        y: { beginAtZero: true, ticks: { color: theme.text, font: theme.font }, grid: { color: theme.grid, drawBorder: false } },
      },
      plugins: { legend: { display: false } },
    };
  }

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  return {
    LEVELS, DIMENSIONS, THRESHOLDS,
    esc, icon, refreshIcons, hydrate, setQuiet, levelName, levelTag, targetLevel,
    scoreTone, statusTone, relativeTime, clockLabel,
    skeleton, empty, errorState, meter, kpi, badge, gateBadge,
    chartTheme, drawChart, destroyChart, gridOptions, toast, countUp,
  };
})();
