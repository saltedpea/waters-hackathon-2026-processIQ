/* Thin client over the existing ProcessIQ endpoints. No business logic here. */

const API = (() => {
  async function request(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("sign in required");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  const json = (url, body) =>
    request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });

  return {
    overview: () => request("/api/overview"),
    processes: (params) => request("/api/processes?" + new URLSearchParams(params || {})),
    process: (id) => request(`/api/processes/${encodeURIComponent(id)}`),
    rules: () => request("/api/rules"),
    systemStatus: () => request("/api/system/status"),
    celonis: () => request("/api/celonis/status"),
    notifications: () => request("/api/notifications"),
    streamStatus: () => request("/api/stream/status"),
    streamStart: () => request("/api/stream/start", { method: "POST" }),
    streamStop: () => request("/api/stream/stop", { method: "POST" }),
    save: () => request("/api/save", { method: "POST" }),
    mail: (to) => json("/api/mail", { to }),
    reset: () => request("/api/reset", { method: "POST" }),
    upload: (file) => {
      const body = new FormData();
      body.append("file", file);
      return request("/api/upload", { method: "POST", body });
    },
    assistantHealth: () => request("/api/assistant/health"),
    assistantChat: (message, history) => json("/api/assistant/chat", { message, history }),
  };
})();
