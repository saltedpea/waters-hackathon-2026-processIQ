/* Assistant dock: narration over fleet facts. Provider is resolved server-side. */

(() => {
  const dock = document.getElementById("assistant");
  const fab = document.getElementById("assistant-fab");
  const closeBtn = document.getElementById("assistant-close");
  const log = document.getElementById("assistant-log");
  const form = document.getElementById("assistant-form");
  const input = document.getElementById("assistant-input");
  const statusEl = document.getElementById("assistant-status");
  const history = [];

  function open() {
    dock.classList.add("is-open");
    fab.style.display = "none";
    input.focus();
  }

  function close() {
    dock.classList.remove("is-open");
    fab.style.display = "";
  }

  fab.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  function bubble(role, text, meta) {
    const wrap = document.createElement("div");
    wrap.className = `assistant__bubble assistant__bubble--${role === "user" ? "user" : "agent"}`;
    if (meta) {
      const who = document.createElement("div");
      who.className = "assistant__who";
      who.textContent = meta;
      wrap.appendChild(who);
    }
    wrap.appendChild(document.createTextNode(text));
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  const simplify = (text) =>
    (text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  async function send(message) {
    bubble("user", message);
    history.push({ role: "user", content: message });
    const pending = bubble("agent", "Reading the fleet…", "working");

    try {
      const data = await API.assistantChat(message, history);
      pending.remove();
      const parts = [data.agent || "assistant"];
      if (data.model) parts.push(data.model);
      if (data.understood && simplify(data.understood) !== simplify(message)) {
        parts.push(`heard: ${data.understood}`);
      }
      bubble("agent", data.reply || "No reply", parts.join(" · "));
      history.push({ role: "assistant", content: data.reply || "" });
    } catch (error) {
      pending.remove();
      bubble("agent", `The assistant could not answer: ${error.message}`, "error");
    }
  }

  window.askAssistant = (message) => {
    open();
    send(message);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    send(message);
  });

  async function health() {
    try {
      const data = await API.assistantHealth();
      if (data.provider === "ollama") statusEl.textContent = `Ollama · ${data.default}`;
      else if (data.provider === "cursor") statusEl.textContent = "Cursor API · narrating fleet facts";
      else statusEl.textContent = data.hint || "Answering from fleet data";
    } catch (error) {
      statusEl.textContent = "Assistant unavailable";
    }
  }

  bubble(
    "agent",
    "I read the live assessment. Ask for a fleet briefing, open a process, or get the next move — typos are fine.",
    "supervisor"
  );
  health();
  setInterval(health, 15000);
})();
