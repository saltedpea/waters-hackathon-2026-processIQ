/* Shell controller: navigation, breadcrumb, search, sidebar, status polling. */

const App = (() => {
  const NAV = [
    {
      label: "Control Tower",
      items: [
        { id: "overview", label: "Overview", icon: "layout-dashboard" },
        { id: "explorer", label: "Process Explorer", icon: "table-2" },
        { id: "assessment", label: "Maturity Assessment", icon: "layers" },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { id: "governance", label: "Data Governance", icon: "shield-check" },
        { id: "rules", label: "Rule Engine", icon: "git-branch" },
        { id: "recommendations", label: "Recommendations", icon: "lightbulb" },
        { id: "gates", label: "Readiness Gates", icon: "door-open" },
        { id: "analytics", label: "Analytics", icon: "bar-chart-3" },
      ],
    },
    {
      label: "Operations",
      items: [
        { id: "automation", label: "Automation", icon: "zap" },
        { id: "celonis", label: "Celonis Integration", icon: "link-2" },
        { id: "settings", label: "Settings", icon: "settings" },
      ],
    },
  ];

  const TITLES = {
    overview: "Overview",
    explorer: "Process Explorer",
    assessment: "Maturity Assessment",
    governance: "Data Governance",
    rules: "Rule Engine",
    recommendations: "Recommendations",
    gates: "Readiness Gates",
    analytics: "Analytics",
    automation: "Automation",
    celonis: "Celonis Integration",
    settings: "Settings",
  };

  let current = null;

  function buildNav() {
    document.getElementById("nav").innerHTML = NAV.map((group) => `
      <div class="nav-group">
        <div class="nav-group__label">${group.label}</div>
        ${group.items.map((item) => `
          <button class="nav-item" type="button" data-page="${item.id}" title="${item.label}">
            <i data-lucide="${item.icon}" class="i"></i><span>${item.label}</span>
            <span class="nav-item__count" data-count-for="${item.id}" hidden></span>
          </button>`).join("")}
      </div>`).join("");

    document.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => go(button.dataset.page));
    });
  }

  function go(page) {
    if (!Views.render[page]) return;
    current = page;

    document.querySelectorAll(".page").forEach((section) => { section.hidden = true; });
    const root = document.getElementById(`page-${page}`);
    root.hidden = false;

    document.querySelectorAll("[data-page]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.page === page);
    });
    document.getElementById("crumb").textContent = TITLES[page] || page;
    document.title = `${TITLES[page]} · ProcessIQ Control Tower`;
    if (location.hash.slice(1) !== page) history.replaceState(null, "", `#${page}`);

    document.getElementById("sidebar").classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    live.pageRendering();
    Promise.resolve(Views.render[page](root)).finally(() => live.pageRendered());
  }

  /* ---------- global search ---------- */
  function setupSearch() {
    const input = document.getElementById("search");
    const results = document.getElementById("search-results");
    let timer;

    function close() { results.classList.remove("is-open"); }

    async function run(query) {
      if (!query) { close(); return; }
      const target = query.toLowerCase();
      const hits = [];

      Object.keys(TITLES).forEach((page) => {
        if (TITLES[page].toLowerCase().includes(target)) {
          hits.push({ kind: "page", icon: "compass", title: TITLES[page], sub: "Navigate", action: () => go(page) });
        }
      });

      try {
        const data = await API.processes({ q: query });
        data.processes.slice(0, 6).forEach((row) => {
          hits.push({
            kind: "process",
            icon: "box",
            title: row.process_name,
            sub: `${row.process_id} · ${row.department} · Level ${row.maturity_level}`,
            action: () => Views.openAssessment(row.process_id),
          });
        });
      } catch (error) { /* search stays usable without results */ }

      if (Views.state.rules) {
        Views.state.rules.rules
          .filter((rule) => `${rule.code} ${rule.name}`.toLowerCase().includes(target))
          .slice(0, 4)
          .forEach((rule) => {
            hits.push({ kind: "rule", icon: "git-branch", title: `${rule.code} — ${rule.name}`,
                        sub: `${rule.count} detections`, action: () => go("rules") });
          });
      }

      results.innerHTML = hits.length
        ? hits.map((hit, index) => `
            <button class="search__item" type="button" data-hit="${index}">
              <i data-lucide="${hit.icon}" class="i"></i>
              <span><strong>${UI.esc(hit.title)}</strong><br /><small>${UI.esc(hit.sub)}</small></span>
            </button>`).join("")
        : `<div class="search__empty">No matches for “${UI.esc(query)}”</div>`;
      results.classList.add("is-open");
      UI.refreshIcons(results);

      results.querySelectorAll("[data-hit]").forEach((button) => {
        button.addEventListener("click", () => {
          hits[Number(button.dataset.hit)].action();
          close();
          input.value = "";
        });
      });
    }

    input.addEventListener("input", (event) => {
      clearTimeout(timer);
      timer = setTimeout(() => run(event.target.value.trim()), 220);
    });
    input.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); input.blur(); } });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search")) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
        event.preventDefault();
        input.focus();
      }
    });
  }

  /* ---------- live intake ----------
     One interval for the whole shell. It keeps every live control in sync
     (sidebar, top bar, Automation page) and, while the stream runs, refreshes
     whichever page is open through Views.live so nothing is re-rendered from a
     skeleton and no page-level interval is ever created. */
  const live = (() => {
    const TICK_MS = 2000;
    const IDLE_TICKS = 5;
    const PAGE_MS = { overview: 2000, explorer: 2000, automation: 2000 };
    const DEFAULT_PAGE_MS = 6000;
    /* These updaters swap data regions only, so the page keeps its own inputs.
       The rest re-render the whole page and must wait for the field to blur. */
    const IN_PLACE = ["overview", "explorer", "automation"];

    let status = { running: false, rows: 0, generated: 0, last_process_id: null, last_classified_level: null };
    let ticks = 0;
    let shownRows = -1;
    let shownAt = 0;
    let epoch = 0;
    let busy = false;
    let rendering = false;

    function statusLine() {
      if (!status.running) return `Idle · ${status.rows} rows`;
      const last = status.last_process_id
        ? ` · ${status.last_process_id} → L${status.last_classified_level}`
        : "";
      return `Live · ${status.rows} rows${last}`;
    }

    function paint() {
      document.querySelectorAll("[data-live-toggle]").forEach((input) => {
        if (input.checked !== status.running) input.checked = status.running;
      });
      document.querySelectorAll("[data-live-status]").forEach((node) => {
        node.textContent = statusLine();
      });
      document.querySelectorAll("[data-live-dot]").forEach((node) => {
        node.className = status.running ? "dot dot--ok dot--live" : "dot";
      });
      const pill = document.getElementById("live-pill");
      if (pill) {
        pill.hidden = !status.running;
        document.getElementById("live-pill-rows").textContent = status.rows;
      }
    }

    /* The open page is re-rendered only when the row count it was built from is
       stale, and never while the operator is typing into one of its fields. */
    async function refreshPage() {
      const page = current;
      const update = Views.live[page];
      const root = document.getElementById(`page-${page}`);
      if (!update || !root || busy || rendering) return;
      if (status.rows === shownRows) return;
      if (Date.now() - shownAt < (PAGE_MS[page] || DEFAULT_PAGE_MS)) return;

      const focused = document.activeElement;
      if (!IN_PLACE.includes(page) && focused && root.contains(focused)
          && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) return;

      const mine = epoch;
      busy = true;
      UI.setQuiet(true);
      try {
        await update(root);
        if (mine === epoch) {
          shownRows = status.rows;
          shownAt = Date.now();
        }
      } catch (error) {
        /* transient, the next tick retries */
      } finally {
        UI.setQuiet(false);
        busy = false;
      }
    }

    async function poll() {
      try {
        status = await API.streamStatus();
      } catch (error) {
        return;
      }
      paint();
      if (!document.hidden) await refreshPage();
    }

    /* A page that has just rendered is already current; do not refresh it again. */
    function pageRendering() {
      epoch += 1;
      rendering = true;
    }

    function pageRendered() {
      rendering = false;
      shownRows = status.rows;
      shownAt = Date.now();
      paint();
    }

    async function toggle(on) {
      const inputs = Array.from(document.querySelectorAll("[data-live-toggle]"));
      inputs.forEach((input) => { input.disabled = true; });
      try {
        status = on ? await API.streamStart() : await API.streamStop();
        UI.toast(on
          ? "Live intake started — one classified process every 4 seconds."
          : "Live intake stopped.");
        shownRows = -1;
      } catch (error) {
        UI.toast(error.message);
        await poll();
      } finally {
        inputs.forEach((input) => { input.disabled = false; });
        paint();
      }
    }

    function start() {
      document.addEventListener("change", (event) => {
        const input = event.target.closest("[data-live-toggle]");
        if (input) toggle(input.checked);
      });
      const pill = document.getElementById("live-pill");
      if (pill) pill.addEventListener("click", () => go("automation"));
      document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

      poll();
      setInterval(() => {
        ticks += 1;
        if (status.running || ticks % IDLE_TICKS === 0) poll();
      }, TICK_MS);
    }

    return { start, paint, pageRendering, pageRendered };
  })();

  /* ---------- status polling ---------- */
  async function pollStatus() {
    try {
      const [status, notifications] = await Promise.all([API.systemStatus(), API.notifications()]);
      const degraded = status.components.filter((item) => item.state === "degraded" || item.state === "not_configured");
      const mini = document.getElementById("sys-mini");
      if (degraded.length) {
        mini.innerHTML = `<span class="dot dot--warn"></span><span>${degraded.length} component${degraded.length === 1 ? "" : "s"} need attention</span>`;
      } else {
        mini.innerHTML = `<span class="dot dot--ok dot--live"></span><span>All systems operational</span>`;
      }

      const count = notifications.notifications.length;
      const badge = document.getElementById("notif-badge");
      badge.textContent = count > 9 ? "9+" : String(count);
      badge.hidden = count === 0;
    } catch (error) { /* transient, next tick retries */ }
  }

  function boot() {
    buildNav();
    setupSearch();

    document.getElementById("toggle-sidebar").addEventListener("click", () => {
      if (window.matchMedia("(max-width: 720px)").matches) {
        document.getElementById("sidebar").classList.toggle("is-open");
      } else {
        document.getElementById("shell").classList.toggle("is-collapsed");
      }
    });

    document.getElementById("open-notifications").addEventListener("click", () => go("automation"));
    document.getElementById("open-help").addEventListener("click", () => {
      if (window.askAssistant) window.askAssistant("what can you help me with?");
    });

    window.addEventListener("themechange", () => {
      UI.refreshIcons();
      if (current) Views.render[current](document.getElementById(`page-${current}`));
    });

    window.addEventListener("hashchange", () => {
      const page = location.hash.slice(1);
      if (page && page !== current) go(page);
    });

    UI.refreshIcons();
    live.start();
    go(location.hash.slice(1) || "overview");
    pollStatus();
    setInterval(pollStatus, 20000);
  }

  document.addEventListener("DOMContentLoaded", boot);

  return { go, live };
})();
