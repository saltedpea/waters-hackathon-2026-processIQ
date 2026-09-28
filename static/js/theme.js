/* Theme persistence. Runs before paint so there is no flash of the wrong theme. */
(() => {
  const KEY = "processiq-theme";
  const stored = localStorage.getItem(KEY);
  document.documentElement.setAttribute("data-theme", stored === "light" ? "light" : "dark");

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    document.querySelectorAll("[data-theme-label]").forEach((el) => {
      el.textContent = theme === "light" ? "Light" : "Dark";
    });
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  window.processiqTheme = {
    current: () => document.documentElement.getAttribute("data-theme") || "dark",
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
