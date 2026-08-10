// @ts-check
(function () {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const num = (selector) => Number(String($(selector)?.textContent || "0").replace(/\D/g, "")) || 0;
  const label = (selector) => String($(selector)?.textContent || "").trim();
  const value = (selector) => String($(selector)?.value || "").trim();
  const Audit = window.CorporateOutputAudit;
  const escapeHtml = (input) => String(input == null ? "" : input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const moduleNames = {
    relations: "Gerar relação de documentos",
    allocation: "Gerar alocação documental",
    tags: "Conferir TAGs antes da LD",
    databook: "Revisar caminho do Databook",
    titles: "Corrigir títulos da LD",
    renamer: "Renomear PDFs",
    bases: "Conferir as bases de referência",
  };

  const state = { bypass: new Set(), confirmAction: null, dirty: false, auditBlocked: false };
  const els = {
    home: $("#p1-task-home"),
    homeButton: $("#p1-home-button"),
    context: $("#p1-recon-context"),
    contextTask: $("#p1-context-task"),
    contextLd: $("#p1-context-ld"),
    contextSheet: $("#p1-context-sheet"),
    changeLd: $("#p1-change-ld"),
    backHome: $("#p1-back-home"),
    sourceCard: $(".recon-source"),
    overlay: $("#p1-confirm-overlay"),
    dialog: $("#p1-confirm-dialog"),
    confirmTitle: $("#p1-confirm-title"),
    confirmMessage: $("#p1-confirm-message"),
    confirmFacts: $("#p1-confirm-facts"),
    cancel: $("#p1-confirm-cancel"),
    confirm: $("#p1-confirm-ok"),
    audit: $("#p1-output-audit"),
    auditSummary: $("#p1-output-audit-summary"),
    auditState: $("#p1-output-audit-state"),
    auditList: $("#p1-output-audit-list"),
    auditMore: $("#p1-output-audit-more"),
  };

  function activeModule() {
    return $(".module-link.active[data-module]")?.dataset.module || "relations";
  }

  function ldLoaded() {
    const meta = label("#relations-ld-meta").toLowerCase();
    return Boolean(meta && !/nenhum arquivo|selecionar|aguardando/.test(meta));
  }

  function currentSheet(module) {
    if (module === "databook") return value("#databook-sheet") || "Selecione uma aba";
    if (module === "titles") return value("#title-sheet") || "Selecione uma aba";
    if (module === "relations") return value("#filter-sheet") || "Selecione uma aba";
    if (module === "allocation" || module === "tags") return "Não se aplica";
    return "Não se aplica";
  }

  function showHome() {
    document.body.classList.add("p1-home-mode");
    $$(".module-link").forEach((node) => node.classList.remove("active"));
    els.homeButton?.classList.add("active");
    els.homeButton?.setAttribute("aria-current", "page");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openTask(module) {
    document.body.classList.remove("p1-home-mode");
    els.homeButton?.classList.remove("active");
    els.homeButton?.removeAttribute("aria-current");
    if (window.RECON?.activate) window.RECON.activate(module);
    else $(`.module-link[data-module="${module}"]`)?.click();
    updateAll();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function updateContext() {
    const module = activeModule();
    if (!els.context) return;
    els.context.hidden = document.body.classList.contains("p1-home-mode");
    if (els.contextTask) els.contextTask.textContent = moduleNames[module] || module;
    if (els.contextLd) {
      els.contextLd.textContent = module === "renamer"
        ? label("#renamer-file-meta") || "Nenhum PDF selecionado"
        : module === "allocation"
          ? label("#allocation-ld-meta") || "Nenhuma LD selecionada"
          : module === "tags"
            ? label("#tag-reference-meta") || "Base de TAGs incorporada"
          : ldLoaded() ? label("#relations-ld-meta") : "Nenhuma LD selecionada";
    }
    if (els.contextSheet) els.contextSheet.textContent = currentSheet(module);
    if (els.changeLd) els.changeLd.hidden = module === "renamer" || module === "allocation" || module === "tags";
    els.sourceCard?.classList.toggle("p1-loaded", ldLoaded());
  }


  function updateDirty() {
    state.dirty = num('[data-title-count="approved"]') > 0
      || num('[data-db-count="approved"]') > 0
      || (Boolean($("#renamer-results") && !$("#renamer-results").hidden) && num('[data-renamer-count="selected"]') > 0)
      || (Boolean($("#allocation-results") && !$("#allocation-results").hidden) && num("#allocation-selected-count") > 0);
  }

  function updateAll() {
    updateContext();
    updateDirty();
  }

  function previewFor(name) {
    return window.RECONOutputPreviewProviders?.[name]?.() || null;
  }

  function allocationNumberFact() {
    const plan = window.RECONAllocation?.batchPlan?.();
    if (plan && plan.groups && plan.groups.length > 1) return `${plan.groups.length} alocações: ${plan.firstCode} até ${plan.lastCode}`;
    return `Número: ${value("#allocation-code") || "não informado"}`;
  }

  function renderOutputAudit(raw) {
    if (!els.audit || !Audit || !raw) {
      if (els.audit) els.audit.hidden = true;
      state.auditBlocked = false;
      return null;
    }
    const audit = Audit.analyze(raw);
    const preview = audit.items.slice(0, 12);
    els.audit.hidden = false;
    els.auditSummary.textContent = audit.summary;
    els.auditState.textContent = audit.valid ? "Entradas e saídas conferidas" : audit.issues.join(" ");
    els.auditState.classList.toggle("error", !audit.valid);
    els.auditList.innerHTML = preview.map((item) => `<div class="p1-output-audit-item"><div><strong title="${escapeHtml(item.primary)}">${escapeHtml(item.primary || "—")}</strong><span>${escapeHtml(item.meta)}</span></div><b aria-hidden="true">→</b><div><strong title="${escapeHtml(item.secondary)}">${escapeHtml(item.secondary || "—")}</strong></div></div>`).join("");
    els.auditMore.textContent = audit.items.length > preview.length ? `Mais ${audit.items.length - preview.length} item(ns) conferido(s) na mesma saída.` : "Todos os itens da saída foram contabilizados.";
    state.auditBlocked = !audit.valid;
    return audit;
  }

  function openConfirm(config) {
    if (!els.dialog || !els.overlay) {
      config.onConfirm?.();
      return;
    }
    els.confirmTitle.textContent = config.title;
    els.confirmMessage.textContent = config.message;
    // Os fatos incluem nome de arquivo e nome de aba vindos da planilha aberta
    // pelo usuário, então precisam do mesmo escape aplicado no resto do app.
    els.confirmFacts.innerHTML = (config.facts || []).map((fact) => `<li>${escapeHtml(fact)}</li>`).join("");
    els.confirm.textContent = config.confirmLabel || "Confirmar";
    const auditSource = typeof config.audit === "function" ? config.audit() : config.audit;
    renderOutputAudit(auditSource);
    els.confirm.disabled = state.auditBlocked;
    state.confirmAction = config.onConfirm;
    els.overlay.hidden = false;
    els.dialog.hidden = false;
    document.body.classList.add("p1-modal-open");
    window.setTimeout(() => els.confirm.focus(), 0);
  }

  function closeConfirm() {
    els.overlay && (els.overlay.hidden = true);
    els.dialog && (els.dialog.hidden = true);
    document.body.classList.remove("p1-modal-open");
    if (els.audit) els.audit.hidden = true;
    if (els.confirm) els.confirm.disabled = false;
    state.auditBlocked = false;
    state.confirmAction = null;
  }

  function protect(id, buildConfig, clearsDirty) {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("click", (event) => {
      if (state.bypass.has(id)) {
        state.bypass.delete(id);
        return;
      }
      if (button.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const config = buildConfig();
      openConfirm({ ...config, onConfirm: () => {
        closeConfirm();
        state.bypass.add(id);
        if (clearsDirty) state.dirty = false;
        button.click();
      }});
    }, true);
  }

  function installConfirmations() {
    protect("relations-export", () => ({
      title: "Confirmar a relação",
      message: "Confira a aba e a quantidade de linhas antes de baixar o Excel.",
      facts: [
        `Aba: ${currentSheet("relations")}`,
        `${num("#count-selected")} linha(s) na relação`,
        `${num("#count-missing")} documento(s) não encontrado(s)`,
        "A LD original não será alterada.",
      ],
      confirmLabel: "Baixar relação em Excel",
      audit: () => previewFor("relations"),
    }));
    protect("databook-export", () => ({
      title: "Confirmar relatório do Databook",
      message: "O relatório mostrará as sugestões e as decisões feitas nesta sessão.",
      facts: [
        `Aba: ${currentSheet("databook")}`,
        `${num('[data-db-count="all"]')} documento(s) analisado(s)`,
        `${num('[data-db-count="approved"]')} sugestão(ões) aprovada(s)`,
        "Nenhum caminho será alterado na LD.",
      ],
      confirmLabel: "Baixar relatório",
      audit: () => previewFor("databook"),
    }));
    protect("databook-apply-ld", () => ({
      title: "Confirmar preenchimento do Caminho Databook",
      message: "Somente caminhos encontrados na confirmação de alocação ou no arquivo da mesma alocação e do mesmo ano serão copiados para uma nova LD.",
      facts: [
        `LD: ${ldLoaded() ? label("#relations-ld-meta") : "não informada"}`,
        `Aba em análise: ${currentSheet("databook")}`,
        `${num('[data-db-count="approved"]')} caminho(s) aprovado(s) nesta sessão`,
        "A confirmação de alocação tem prioridade sobre o arquivo de alocação.",
        "O texto do Caminho Databook será copiado sem correção ou normalização.",
        "O arquivo original não será sobrescrito.",
      ],
      confirmLabel: "Baixar cópia da LD preenchida",
      audit: () => previewFor("databookApply"),
    }), true);
    protect("databook-apply-ld-inplace", () => ({
      title: "Confirmar gravação no arquivo original",
      message: "Isto substitui o conteúdo do arquivo aberto — não é gerada uma cópia nova.",
      facts: [
        `Arquivo: ${ldLoaded() ? label("#relations-ld-meta") : "não informado"}`,
        `Aba em análise: ${currentSheet("databook")}`,
        `${num('[data-db-count="approved"]')} caminho(s) aprovado(s) nesta sessão`,
        "Confirme que nenhuma outra pessoa está editando este arquivo agora.",
        "Recomendado manter um backup antes de salvar por cima do original.",
      ],
      confirmLabel: "Salvar no arquivo original",
      audit: () => previewFor("databookApply"),
    }), true);
    protect("title-export", () => ({
      title: "Confirmar relatório de títulos",
      message: "O relatório mostrará o título atual, a sugestão e a decisão tomada.",
      facts: [
        `Aba: ${currentSheet("titles")}`,
        `${num('[data-title-count="all"]')} título(s) analisado(s)`,
        `${num('[data-title-count="approved"]')} título(s) aprovado(s)`,
        "A LD original não será alterada.",
      ],
      confirmLabel: "Baixar relatório",
      audit: () => previewFor("titles"),
    }));
    protect("title-apply-ld", () => ({
      title: "Confirmar a cópia da LD revisada",
      message: "Somente os títulos aprovados serão alterados em uma nova cópia da LD.",
      facts: [
        `LD: ${ldLoaded() ? label("#relations-ld-meta") : "não informada"}`,
        `Aba em análise: ${currentSheet("titles")}`,
        `${num('[data-title-count="approved"]')} título(s) será(ão) alterado(s)`,
        "Fórmulas, macros, validações, estilos e títulos não aprovados devem permanecer intactos.",
        "O arquivo original não será sobrescrito.",
      ],
      confirmLabel: "Baixar cópia da LD revisada",
      audit: () => previewFor("titlesApply"),
    }), true);
    protect("title-apply-ld-inplace", () => ({
      title: "Confirmar gravação no arquivo original",
      message: "Isto substitui o conteúdo do arquivo aberto — não é gerada uma cópia nova.",
      facts: [
        `Arquivo: ${ldLoaded() ? label("#relations-ld-meta") : "não informado"}`,
        `Aba em análise: ${currentSheet("titles")}`,
        `${num('[data-title-count="approved"]')} título(s) será(ão) alterado(s)`,
        "Fórmulas, macros, validações, estilos e títulos não aprovados devem permanecer intactos.",
        "Confirme que nenhuma outra pessoa está editando este arquivo agora.",
        "Recomendado manter um backup antes de salvar por cima do original.",
      ],
      confirmLabel: "Salvar no arquivo original",
      audit: () => previewFor("titlesApply"),
    }), true);
    protect("allocation-export-file", () => ({
      title: "Confirmar arquivo de alocação",
      message: "Confira as disciplinas, os números e a quantidade de documentos antes de baixar.",
      facts: [
        allocationNumberFact(),
        `${num("#allocation-selected-count")} documento(s) selecionado(s)`,
        "O controle original não será alterado.",
      ],
      confirmLabel: "Baixar arquivo de alocação",
      audit: () => previewFor("allocation"),
    }));
    protect("allocation-export-control", () => ({
      title: "Confirmar linhas da Central de Alocação",
      message: "Será criado um Excel separado com as linhas prontas para levar ao controle.",
      facts: [
        allocationNumberFact(),
        `${num("#allocation-selected-count")} documento(s) selecionado(s)`,
        "Nenhuma planilha original será sobrescrita.",
      ],
      confirmLabel: "Baixar linhas do controle",
      audit: () => previewFor("allocation"),
    }));
    protect("allocation-export-package", () => ({
      title: "Confirmar pacote da alocação",
      message: "O pacote reunirá o arquivo de alocação e as linhas da Central.",
      facts: [
        allocationNumberFact(),
        `${num("#allocation-selected-count")} documento(s) selecionado(s)`,
        "Os arquivos originais não serão alterados.",
      ],
      confirmLabel: "Baixar pacote da alocação",
      audit: () => previewFor("allocation"),
    }), true);
    protect("renamer-download", () => ({
      title: "Confirmar os novos nomes",
      message: "Revise os arquivos com erro ou pendência antes de criar o pacote.",
      facts: [
        `${num('[data-renamer-count="all"]')} PDF(s) analisado(s)`,
        `${num('[data-renamer-count="selected"]')} PDF(s) no pacote`,
        `${num('[data-renamer-count="blocked"]')} arquivo(s) com erro`,
        `${num('[data-renamer-count="review"]')} arquivo(s) para conferir`,
        "Os PDFs originais não serão alterados.",
      ],
      confirmLabel: "Baixar pacote com novos nomes",
      audit: () => previewFor("renamer"),
    }), true);
  }

  function installNavigation() {
    els.homeButton?.addEventListener("click", showHome);
    els.backHome?.addEventListener("click", showHome);
    $$("[data-p1-open]").forEach((card) => card.addEventListener("click", () => openTask(card.dataset.p1Open)));
    $$(".module-link[data-module]").forEach((link) => link.addEventListener("click", () => {
      document.body.classList.remove("p1-home-mode");
      els.homeButton?.classList.remove("active");
      els.homeButton?.removeAttribute("aria-current");
      scheduleUpdate(0);
    }));
    els.changeLd?.addEventListener("click", () => $("#relations-ld")?.click());
    window.addEventListener("recon:module", updateAll);
  }

  function installEvents() {
    els.cancel?.addEventListener("click", closeConfirm);
    els.overlay?.addEventListener("click", closeConfirm);
    els.confirm?.addEventListener("click", () => state.confirmAction?.());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && els.dialog && !els.dialog.hidden) closeConfirm(); });
    document.addEventListener("click", (event) => {
      if (event.target.closest("#title-approve-selected,#title-keep-selected,#databook-approve-selected,#databook-keep-selected,#renamer-confirm")) { scheduleUpdate(0); scheduleUpdate(250); }
    });
    document.addEventListener("change", (event) => {
      if (event.target.matches("#relations-ld,#filter-sheet,#databook-sheet,#title-sheet,#renamer-files,#renamer-folder,#allocation-ld-input,#allocation-control-input,#allocation-list-input")) { scheduleUpdate(0); scheduleUpdate(350); }
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  let updateTimer = 0;
  function scheduleUpdate(delay) {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateAll, Number(delay) || 0);
  }

  function installStateEvents() {
    window.addEventListener("recon:ui-update", () => scheduleUpdate(0));
    window.addEventListener("recon:module", () => scheduleUpdate(0));
  }

  function init() {
    installNavigation();
    installConfirmations();
    installEvents();
    installStateEvents();
    showHome();
    updateAll();
    document.documentElement.dataset.p1Ux = "enabled";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
