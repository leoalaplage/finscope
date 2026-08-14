const params = new URLSearchParams(window.location.search);
const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
};

if (params.get("embedded") === "1") document.documentElement.classList.add("embedded");
applyTheme(params.get("theme"));

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "finscope-theme") return;
  applyTheme(event.data.theme);
});

window.parent?.postMessage({ type: "qs-ready" }, window.location.origin);
