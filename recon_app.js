(function () {
  "use strict";

  const links = [...document.querySelectorAll(".module-link[data-module]")];
  const views = [...document.querySelectorAll("[data-module-view]")];
  const KEY = "recon.active.module.v1";

  function known(name) {
    return views.some((view) => view.dataset.moduleView === name) ? name : "";
  }

  // Os atalhos declarados no manifest.json apontam para index.html#relations,
  // #allocation, #tags, etc. Sem leitura do hash eles não faziam nada.
  function moduleFromHash() {
    const raw = String(window.location.hash || "").replace(/^#/, "").trim();
    return known(raw.toLowerCase());
  }

  function writeHash(name) {
    const target = `#${name}`;
    if (window.location.hash === target) return;
    try {
      // replaceState evita encher o histórico a cada troca de módulo.
      window.history.replaceState(null, "", target);
    } catch (_) {
      // Em file:// alguns navegadores recusam replaceState; o hash direto serve.
      window.location.hash = target;
    }
  }

  function activate(name) {
    const wanted = known(name) || "relations";
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
    document.body.classList.toggle("recon-without-ld", wanted === "renamer" || wanted === "allocation" || wanted === "tags" || wanted === "bases");
    try { window.sessionStorage.setItem(KEY, wanted); } catch (_) { /* conveniência */ }
    writeHash(wanted);
    window.dispatchEvent(new CustomEvent("recon:module", { detail: { module: wanted } }));
  }

  links.forEach((link) => link.addEventListener("click", () => activate(link.dataset.module)));

  // Atalho do sistema operacional, ou link com #modulo colado na aba já aberta.
  window.addEventListener("hashchange", () => {
    const fromHash = moduleFromHash();
    if (fromHash) activate(fromHash);
  });

  // Precedência: hash da URL > último módulo da sessão > relações.
  let initial = moduleFromHash();
  if (!initial) {
    try { initial = known(window.sessionStorage.getItem(KEY)) || "relations"; } catch (_) { initial = "relations"; }
  }
  activate(initial);

  // ===================== REDE DE SEGURANÇA DE ERROS =====================
  // Sem isto, qualquer exceção inesperada deixava a interface travada (botão
  // desabilitado, barra de progresso girando) sem nenhuma mensagem ao usuário.

  let lastNotice = 0;

  function isUserCancellation(error) {
    return Boolean(error && (error.name === "AbortError" || /cancelad/i.test(String(error.message || ""))));
  }

  function releaseStuckUi() {
    document.body.classList.remove("recon-module-loading");
    document.body.dataset.reconLoadingCount = "0";
    document.querySelectorAll("[data-module-loading]").forEach((node) => {
      node.removeAttribute("data-module-loading");
      node.setAttribute("aria-busy", "false");
    });
    const status = document.getElementById("runtime-status-text");
    if (status) status.textContent = "Ocorreu um erro — confira a mensagem";
  }

  function reportFailure(error) {
    if (isUserCancellation(error)) return;

    const now = Date.now();
    // Um erro em laço não pode virar uma cascata de avisos na tela.
    if (now - lastNotice < 4000) return;
    lastNotice = now;

    releaseStuckUi();

    const toast = document.getElementById("toast");
    if (!toast) return;
    const detail = String((error && error.message) || error || "erro desconhecido");
    toast.textContent = `Algo deu errado: ${detail}. Nenhum arquivo seu foi alterado. Se continuar, recarregue a página.`;
    toast.className = "toast show error";
    window.setTimeout(() => { toast.className = "toast"; }, 9000);
  }

  window.addEventListener("error", (event) => {
    // Falhas de carregamento de <script>/<img> não têm event.error e já são
    // tratadas por quem as inseriu (recon_module_loader.js).
    if (!event.error) return;
    reportFailure(event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportFailure(event.reason);
  });

  window.RECON = { activate, reportFailure };
})();
