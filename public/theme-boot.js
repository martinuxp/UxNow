// Applies the saved theme before first paint so the window never flashes the
// wrong palette. Kept in sync with src/lib/theme.ts (same storage key and values).
(function () {
  var preference = "system";
  try { preference = localStorage.getItem("uxnow-theme") || "system"; } catch { /* storage unavailable */ }
  var dark = preference === "dark" || (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.add(dark ? "dark" : "light");
  root.dataset.theme = dark ? "dark" : "light";
})();
