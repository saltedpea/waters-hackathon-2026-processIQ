/* Theme persistence. Runs before paint so there is no flash of the wrong theme.
   Shares the "nx-theme" key with the Next.js app so both stay in sync. Light is the default. */
(() => {
  const KEY = "nx-theme";
  const read = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const stored = read();
  document.documentElement.setAttribute("data-theme", stored === "dark" ? "dark" : "light");
  document.documentElement.classList.toggle("dark", stored === "dark");

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem(KEY, theme); } catch { /* storage blocked: theme still applies for this page */ }
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      el.textContent = theme === "light" ? "Light" : "Dark";
    });
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  window.processiqTheme = {
    current: () => document.documentElement.getAttribute("data-theme") || "light",
    set: apply,
    toggle: () => apply(window.processiqTheme.current() === "light" ? "dark" : "light"),
  };

  document.addEventListener("DOMContentLoaded", () => {
    apply(window.processiqTheme.current());
    document.querySelectorAll("#theme-toggle, [data-theme-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => window.processiqTheme.toggle());
    });
  });
})();
