/* Nexora assistant — replaces static/js/assistant.js. Talks to /nx/chat (Next.js → Ollama, RAG + citations). */
(() => {
  const $ = (s) => document.querySelector(s);
  const panel = $("#assistant"), log = $("#assistant-log"), form = $("#assistant-form"),
    input = $("#assistant-input"), fab = $("#assistant-fab"), closeBtn = $("#assistant-close"),
    status = $("#assistant-status");
  if (!panel || !log || !form || !input) return;

  const raw = ($(".user-chip__name")?.textContent || "").trim();
  const name = raw
    ? raw.includes("@")
      ? raw.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
      : raw
    : "there";

  const history = [];
  let greeted = false, busy = false, mid = 0;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

  function message(role) {
    const root = el("div", `nx-msg nx-msg--${role}`);
    const body = el("div", "nx-body");
    root.append(body);
    log.append(root);
    toBottom();
    return { root, body, id: ++mid };
  }

  /* Text with [n] markers → clickable citation chips. */
  function render(m, text, sources) {
    m.body.textContent = "";
    text.split(/(\[\d+\])/g).forEach((part) => {
      const hit = part.match(/^\[(\d+)\]$/);
      const src = hit && sources.find((s) => s.id === +hit[1]);
      if (src) {
        const b = el("button", "nx-cite", hit[1]);
        b.type = "button";
        b.title = src.title;
        b.addEventListener("click", () => {
          const t = document.getElementById(`nx-src-${m.id}-${src.id}`);
          if (!t) return;
          t.scrollIntoView({ block: "nearest", behavior: "smooth" });
          t.classList.add("nx-flash");
          setTimeout(() => t.classList.remove("nx-flash"), 1400);
        });
        m.body.append(b);
      } else m.body.append(document.createTextNode(part));
    });
  }

  function showSources(m, sources) {
    const box = el("div", "nx-sources");
    box.append(el("div", "nx-sources__h", sources.length ? "Sources" : "No matching passages in the knowledge base."));
    sources.forEach((s) => {
      const row = el("div", "nx-src");
      row.id = `nx-src-${m.id}-${s.id}`;
      row.append(el("span", "nx-src__n", String(s.id)));
      const t = el("div", "nx-src__t");
      t.append(el("b", null, s.title), el("p", null, s.snippet + (s.snippet.length >= 280 ? "…" : "")));
      row.append(t);
      box.append(row);
    });
    m.root.append(box);
    toBottom();
  }

  function greet() {
    greeted = true;
    const m = message("bot");
    m.body.textContent = `Welcome, ${name}.`;
    m.root.append(el("p", "nx-hint", "Ask about a process, rule or gap. Answers come from your knowledge base, with sources."));
  }

  async function send(text) {
    busy = true;
    message("user").body.textContent = text;
    const m = message("bot");
    m.body.classList.add("nx-typing");
    let acc = "", sources = [];
    try {
      const r = await fetch("/nx/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, user: name }),
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const l of lines) {
          if (!l.trim()) continue;
          const j = JSON.parse(l);
          if (j.type === "sources") sources = j.sources;
          else if (j.type === "token") {
            acc += j.text;
            m.body.classList.remove("nx-typing");
            render(m, acc, sources);
            toBottom();
          }
        }
      }
      m.body.classList.remove("nx-typing");
      render(m, acc || "…", sources);
      showSources(m, sources);
      history.push({ role: "user", content: text }, { role: "assistant", content: acc });
    } catch (e) {
      m.body.classList.remove("nx-typing");
      m.body.textContent = e.message || "Something went wrong.";
      m.root.classList.add("nx-msg--err");
    }
    busy = false;
  }

  async function refreshStatus() {
    try {
      const j = await (await fetch("/nx/chat")).json();
      status.textContent = j.online ? `${j.model} · ${j.docs} document${j.docs === 1 ? "" : "s"}` : "Ollama offline";
    } catch { status.textContent = "Assistant unavailable"; }
  }

  const open = () => { panel.classList.add("nx-open"); fab?.classList.add("nx-hide"); if (!greeted) greet(); refreshStatus(); setTimeout(() => input.focus(), 250); };
  const close = () => { panel.classList.remove("nx-open"); fab?.classList.remove("nx-hide"); };

  fab?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t || busy) return;
    input.value = "";
    send(t);
  });
  window.NexoraAssistant = { open, close };
})();
