(function (root) {
  "use strict";

  function boot(module) {
    if (module !== "coding") return;
    const api = root.RECONDocumentCoding;
    if (!api || typeof api.init !== "function") return;
    Promise.resolve(api.init()).catch((error) => {
      if (root.RECON && typeof root.RECON.reportFailure === "function") root.RECON.reportFailure(error);
      else console.error(error);
    });
  }

  // O evento recon:module que disparou o lazy-load já aconteceu antes de
  // document_coding_app.js existir. Por isso o bootstrap verifica a view ativa
  // imediatamente e também acompanha reaberturas posteriores do módulo.
  const view = root.document && root.document.querySelector('[data-module-view="coding"]');
  if (view && !view.hidden) boot("coding");

  root.addEventListener("recon:module", (event) => boot(event.detail && event.detail.module));
  root.addEventListener("recon:module-ready", (event) => boot(event.detail && event.detail.module));
})(window);