(function () {
  "use strict";

  const links = [...document.querySelectorAll(".module-link[data-module]")];
  const views = [...document.querySelectorAll("[data-module-view]")];
  const KEY = "recon.active.module.v1";

  function activate(name) {
    const wanted = views.some((view) => view.dataset.moduleView === name) ? name : "relations";
    links.forEach((link) => {
      const active = link.dataset.module === wanted;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    views.forEach((view) => {
      const active = view.dataset.moduleView === wanted;
      view.hidden = !active;
      view.classList.toggle("active", active);
    });
    document.body.classList.toggle("recon-without-ld", wanted === "renamer" || wanted === "allocation" || wanted === "tags");
    try { window.sessionStorage.setItem(KEY, wanted); } catch (_) { /* conveniência */ }
    window.dispatchEvent(new CustomEvent("recon:module", { detail: { module: wanted } }));
  }

  links.forEach((link) => link.addEventListener("click", () => activate(link.dataset.module)));
  let initial = "relations";
  try { initial = window.sessionStorage.getItem(KEY) || initial; } catch (_) { /* conveniência */ }
  activate(initial);
  window.RECON = { activate };
})();
