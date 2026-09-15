(function () {
  "use strict";

  function installDocumentCodingModule() {
    if (document.querySelector('[data-module="coding"]')) return;

    const preferences = document.getElementById("recon-preferences-open");
    if (preferences && preferences.parentNode) {
      const button = document.createElement("button");
      button.className = "module-link";
      button.dataset.module = "coding";
      button.type = "button";
      button.title = "Codificação de Documentos — gerar código, capa Petrobras e PDF final";
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h4"></path><path d="M4 8h4M4 12h4"></path></svg><span><strong>Codificar documentos</strong><small>Código, capa e PDF final</small></span>';
      preferences.parentNode.insertBefore(button, preferences);
    }

    const taskGrid = document.querySelector(".p1-task-grid");
    if (taskGrid && !taskGrid.querySelector('[data-p1-open="coding"]')) {
      const task = document.createElement("button");
      task.dataset.p1Open = "coding";
      task.type = "button";
      task.innerHTML = '<span><strong>Codificar documentos técnicos</strong><small>Leia PDF/DOCX, confira norma e LD, gere a capa Petrobras e o PDF final.</small><em>Normas + LD + rastreabilidade</em></span>';
      taskGrid.appendChild(task);
    }

    const main = document.getElementById("app-main");
    if (main && !document.querySelector('[data-module-view="coding"]')) {
      const section = document.createElement("section");
      section.className = "module-view coding-module";
      section.dataset.moduleView = "coding";
      section.id = "module-coding";
      section.hidden = true;
      section.setAttribute("aria-labelledby", "recon-module-title-coding");
      section.innerHTML = '<header class="module-heading"><div><span>CODIFICAÇÃO</span><h2 id="recon-module-title-coding">Codificação de Documentos</h2></div><p>Interpretação documental, regras Petrobras, sequência real das LDs, capa oficial e PDF final auditável.</p></header><div class="workspace module-workspace" id="module-coding-body"><section class="card"><p>Carregando motor de codificação…</p></section></div>';
      main.appendChild(section);
    }
  }

  // A interface do módulo é criada antes de capturarmos links e views. Isso
  // mantém index.html enxuto e deixa o carregador lazy responsável pelo código
  // pesado apenas quando o usuário realmente abrir Codificação de Documentos.
  installDocumentCodingModule();

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
    document.body.classList.toggle("recon-without-ld", wanted === "renamer" || wanted === "allocation" || wanted === "tags" || wanted === "bases" || wanted === "coding");
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