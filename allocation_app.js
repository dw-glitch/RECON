(function () {
  "use strict";

  function notifyReconUi() {
    window.dispatchEvent(new CustomEvent("recon:ui-update"));
  }

  const C = window.TriagemCore;
  const L = window.ReconLdCompatibility;
  const A = window.AllocationCore;
  const P = window.RECONAllocationConfirmations;
  const B = window.RECONAllocationBatches;
  const W = window.AllocationWorkbook;
  const Q = window.ReconAllocationTitleQuality;
  const TaskCenter = window.QualityTaskCenter;
  const workspaceTasks = new Map();
  const Workspace = {
    start(key, label) { if (!TaskCenter) return; workspaceTasks.set(key, TaskCenter.start(label || key)); },
    finish(key) { const id = workspaceTasks.get(key); if (id && TaskCenter) TaskCenter.finish(id); workspaceTasks.delete(key); },
    setDraft(key, value) { try { sessionStorage.setItem(`recon.allocation.draft.${key}`, String(value || "")); } catch (_) {} },
    draft(key, fallback) { try { const value = sessionStorage.getItem(`recon.allocation.draft.${key}`); return value === null ? fallback : value; } catch (_) { return fallback; } },
    clearDraft(key) { try { sessionStorage.removeItem(`recon.allocation.draft.${key}`); } catch (_) {} },
    setPreference(key, value) { try { localStorage.setItem(`recon.allocation.preference.${key}`, String(value || "")); } catch (_) {} },
    preference(key, fallback) { try { return localStorage.getItem(`recon.allocation.preference.${key}`) || fallback; } catch (_) { return fallback; } },
  };
  const DEFAULT_PAGE_SIZE = 100;
  const DEFAULT_STATUS = "PENDENTE ENVIO DE LD";

  const state = {
    ldFiles: [],
    controlFile: null,
    listFile: null,
    databookFile: null,
    historyFiles: [],
    confirmationFiles: [],
    control: null,
    controlSource: "",
    results: [],
    selected: new Set(),
    duplicateCount: 0,
    search: "",
    columnFilters: {},
    databookFilter: "all",
    decisionFilter: "all",
    groupingMode: "discipline",
    compactMode: false,
    densityManual: false,
    busy: false,
    codeAutomatic: true,
    catalogEntries: [],
    assistantDocumentKey: "",
    assistantDocumentKeys: [],
    analysisRun: 0,
    progressTimer: 0,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    ldInput: $("#allocation-ld-input"),
    controlInput: $("#allocation-control-input"),
    listInput: $("#allocation-list-input"),
    databookInput: $("#allocation-databook-input"),
    historyInput: $("#allocation-history-input"),
    confirmationInput: $("#allocation-confirmation-input"),
    mainLdInput: $("#relations-ld"),
    ldMeta: $("#allocation-ld-meta"),
    controlMeta: $("#allocation-control-meta"),
    listMeta: $("#allocation-list-meta"),
    databookMeta: $("#allocation-databook-meta"),
    historyMeta: $("#allocation-history-meta"),
    confirmationMeta: $("#allocation-confirmation-meta"),
    evidenceMeta: $("#allocation-evidence-meta"),
    code: $("#allocation-code"),
    date: $("#allocation-date"),
    analyze: $("#allocation-analyze"),
    text: $("#allocation-text"),
    textCount: $("#allocation-text-count"),
    clear: $("#allocation-clear"),
    readyName: $("#allocation-ready-name"),
    progress: $("#allocation-progress"),
    progressBar: $("#allocation-progress-bar"),
    progressText: $("#allocation-progress-text"),
    results: $("#allocation-results"),
    batchPlan: $("#allocation-batch-plan"),
    batchMeta: $("#allocation-batch-meta"),
    batchList: $("#allocation-batch-list"),
    batchWarning: $("#allocation-batch-warning"),
    batchEyebrow: $("#allocation-batch-eyebrow"),
    batchTitle: $("#allocation-batch-title"),
    groupingHelp: $("#allocation-grouping-help"),
    groupModeRadios: [...document.querySelectorAll('input[name="allocation-group-mode"]')],
    tbody: $("#allocation-results-body"),
    empty: $("#allocation-empty"),
    countTotal: $("#allocation-count-total"),
    countReady: $("#allocation-count-ready"),
    countSkip: $("#allocation-count-skip"),
    countReview: $("#allocation-count-review"),
    search: $("#allocation-search"),
    columnFilterRow: $("#allocation-column-filters"),
    clearColumnFilters: $("#allocation-clear-column-filters"),
    databookFilter: $("#allocation-databook-filter"),
    decisionFilter: $("#allocation-decision-filter"),
    selectAll: $("#allocation-select-all"),
    selectedCount: $("#allocation-selected-count"),
    batchDatabook: $("#allocation-databook-batch"),
    density: $("#allocation-density"),
    exportReport: $("#allocation-export-report"),
    exportFile: $("#allocation-export-file"),
    exportControl: $("#allocation-export-control"),
    exportPackage: $("#allocation-export-package"),
    previewLimit: $("#allocation-preview-limit"),
    assistantOverlay: $("#databook-assistant-overlay"),
    assistantDrawer: $("#databook-assistant-drawer"),
    assistantClose: $("#databook-assistant-close"),
    assistantSubtitle: $("#databook-assistant-subtitle"),
    reviewPanel: $("#databook-review-panel"),
    reviewDocument: $("#databook-review-document"),
    reviewSource: $("#databook-review-source"),
    reviewConfidence: $("#databook-review-confidence"),
    comparison: $("#databook-comparison"),
    comparisonCurrent: $("#databook-comparison-current"),
    comparisonProposed: $("#databook-comparison-proposed"),
    reviewTitleField: $("#databook-review-title-field"),
    reviewTitle: $("#databook-review-title"),
    reviewTitleQuality: $("#databook-review-title-quality"),
    reviewPath: $("#databook-review-path"),
    pathOptions: $("#databook-path-options"),
    reviewLevels: $("#databook-review-levels"),
    reviewMessage: $("#databook-review-message"),
    assistantCancel: $("#databook-assistant-cancel"),
    assistantApply: $("#databook-assistant-apply"),
    assistantReviewFooter: $(".databook-review-footer"),
    toast: $("#toast"),
  };
  const pager = window.RECONPager && window.RECONPager.create("allocation", els.previewLimit, () => renderResults(), DEFAULT_PAGE_SIZE);

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showToast(message, kind) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.className = `toast show ${kind || ""}`.trim();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { els.toast.className = "toast"; }, 4200);
  }

  function localDateValue(date) {
    const value = date || new Date();
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function relationLineCount() {
    return els.text.value.split(/\r?\n/).filter((line) => line.trim() && A.norm(line) !== "FIM").length;
  }

  function refreshAllocationDate() {
    const today = localDateValue();
    if (els.date.value !== today) {
      els.date.value = today;
      if (state.control && state.codeAutomatic) els.code.value = A.suggestAllocationCode(state.control, Number(today.slice(0, 4)));
    }
    return today;
  }

  function currentLdFiles() {
    if (state.ldFiles.length) return state.ldFiles.slice();
    const selected = els.ldInput.files ? Array.from(els.ldInput.files) : [];
    if (selected.length) return selected;
    const shared = els.mainLdInput && els.mainLdInput.files ? Array.from(els.mainLdInput.files) : [];
    return shared.slice(0, 1);
  }

  function currentLdFile() {
    return currentLdFiles()[0] || null;
  }

  function ldFileLabel(files) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return "Selecionar uma ou mais LDs";
    if (list.length === 1) return list[0].name;
    return `${list.length} LDs selecionadas`;
  }

  function hasRelation() {
    return Boolean(state.listFile || (els.listInput.files && els.listInput.files[0]) || relationLineCount());
  }

  function codeIsValid() {
    return Boolean(A.parseAllocationCode(els.code.value));
  }

  async function prepareLdCompatibility(file) {
    if (!file || !L) return true;
    await L.prepare(file, { interactive: false });
    L.close();
    updateInputs();
    return true;
  }

  async function prepareLdFiles(files) {
    for (const file of files) await prepareLdCompatibility(file);
    return true;
  }

  // O botão "Analisar" depende de cinco condições. Quando alguma falta ele
  // simplesmente fica cinza, e quem colou a relação e clicou não recebe
  // nenhuma explicação — parece que o app travou. Esta lista diz, com as
  // mesmas palavras dos campos da tela, o que ainda falta.
  function missingRequirements() {
    const missing = [];
    if (!currentLdFiles().length) missing.push("LDs controladas");
    if (!state.controlFile) missing.push("controle de solicitações");
    if (!hasRelation()) missing.push("relação de documentos");
    if (!els.date.value) missing.push("data da alocação");
    if (!codeIsValid()) missing.push("número da alocação válido");
    return missing;
  }

  function updateReadyName() {
    const parsed = A.parseAllocationCode(els.code.value);
    const missing = missingRequirements();

    if (state.busy) {
      els.readyName.textContent = "Analisando…";
      els.readyName.classList.remove("warning");
      return;
    }
    if (missing.length) {
      els.readyName.textContent = missing.length === 1
        ? `Falta ${missing[0]} para analisar`
        : `Faltam ${missing.slice(0, -1).join(", ")} e ${missing[missing.length - 1]} para analisar`;
      els.readyName.classList.add("warning");
      els.readyName.title = "O botão Analisar só habilita quando todos estes itens estiverem preenchidos.";
      return;
    }
    els.readyName.textContent = parsed ? `${parsed.code}.xlsx` : "Número da alocação inválido";
    els.readyName.classList.toggle("warning", !parsed);
    els.readyName.title = "";
  }

  function updateInputs() {
    refreshAllocationDate();
    const ldFiles = currentLdFiles();
    els.ldMeta.textContent = ldFileLabel(ldFiles);
    els.ldMeta.title = ldFiles.map((file) => file.name).join("\n");
    els.controlMeta.textContent = state.controlFile ? state.controlFile.name : "Selecionar arquivo";
    els.listMeta.textContent = state.listFile ? state.listFile.name : "Excel ou texto";
    els.databookMeta.textContent = state.databookFile ? state.databookFile.name : "Base incluída";
    const historyCount = state.historyFiles.length;
    const confirmationCount = state.confirmationFiles.length;
    els.historyMeta.textContent = historyCount ? `${historyCount} alocação${historyCount === 1 ? "" : "ões"}` : "Selecionar pasta";
    if (els.confirmationMeta) els.confirmationMeta.textContent = confirmationCount ? `${confirmationCount} arquivo${confirmationCount === 1 ? "" : "s"} de retorno` : "Selecionar pasta";
    const evidenceParts = [`Mapa ${state.databookFile ? "atualizado" : "automático"}`];
    if (confirmationCount) evidenceParts.push(`${confirmationCount} confirmação${confirmationCount === 1 ? "" : "ões"}`);
    if (historyCount) evidenceParts.push(`${historyCount} histórico${historyCount === 1 ? "" : "s"}`);
    els.evidenceMeta.textContent = evidenceParts.join(" · ");
    const textCount = relationLineCount();
    els.textCount.textContent = `${textCount} ${textCount === 1 ? "item" : "itens"}`;
    els.analyze.disabled = state.busy || !ldFiles.length || !state.controlFile || !hasRelation() || !els.date.value || !codeIsValid();
    updateReadyName();
  }

  function invalidateResults() {
    state.results = [];
    state.selected.clear();
    state.duplicateCount = 0;
    els.results.hidden = true;
    renderResults();
  }

  function abortError(message) {
    try { return new DOMException(message || "Análise substituída.", "AbortError"); }
    catch (_) { const error = new Error(message || "Análise substituída."); error.name = "AbortError"; return error; }
  }

  function ensureCurrentAnalysis(runId) {
    if (runId !== state.analysisRun) throw abortError("Esta análise foi limpa ou substituída por outra.");
  }

  function cancelAllocationAnalysis() {
    state.analysisRun += 1;
    if (window.RECONCompute) window.RECONCompute.cancel("allocation");
    if (window.RECONWorkbookWorker) window.RECONWorkbookWorker.cancelAll();
    if (state.progressTimer) window.clearTimeout(state.progressTimer);
    state.progressTimer = 0;
    state.busy = false;
    if (Workspace) Workspace.finish("allocation-analysis");
    if (els.progress) els.progress.hidden = true;
  }

  function resetAllocationAnalysis(options) {
    const config = { clearRelation: true, notify: true, ...(options || {}) };
    const previousList = state.listFile;
    cancelAllocationAnalysis();
    if (previousList && window.RECONWorkbookWorker) window.RECONWorkbookWorker.clear(previousList);
    if (previousList && window.RECONFileAccess) window.RECONFileAccess.clear(previousList);

    state.results = [];
    state.selected = new Set();
    state.duplicateCount = 0;
    state.search = "";
    state.columnFilters = {};
    state.databookFilter = "all";
    state.decisionFilter = "all";
    state.assistantDocumentKey = "";
    state.assistantDocumentKeys = [];
    if (pager) pager.reset();
    if (config.clearRelation) {
      els.text.value = "";
      els.listInput.value = "";
      state.listFile = null;
      if (Workspace) Workspace.clearDraft("allocationText");
    }
    els.search.value = "";
    if (els.databookFilter) els.databookFilter.value = "all";
    if (els.decisionFilter) els.decisionFilter.value = "all";
    if (els.columnFilterRow) els.columnFilterRow.querySelectorAll("input").forEach((input) => { input.value = ""; });
    if (els.clearColumnFilters) els.clearColumnFilters.hidden = true;
    if (els.selectAll) els.selectAll.checked = false;
    closeDatabookAssistant();
    els.results.hidden = true;
    renderResults();
    updateInputs();
    if (config.clearRelation) els.text.focus();
    if (config.notify) showToast("Análise limpa. Carregue outra relação e analise novamente.", "success");
  }

  function setProgress(percent, message) {
    if (!els.progress) return;
    els.progress.hidden = false;
    if (els.progressBar) els.progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if (els.progressText) els.progressText.textContent = message || "Processando…";
  }

  function yieldFrame() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  async function readWorkbook(file) {
    if (window.RECONWorkbookWorker) return window.RECONWorkbookWorker.read(file, { cellDates: true, cellFormula: true });
    const buffer = window.RECONFileAccess ? await window.RECONFileAccess.readArrayBuffer(file) : await file.arrayBuffer();
    return XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
  }

  function allocationHistoryFiles(fileList) {
    return [...(fileList || [])].filter((file) => !/^~\$/.test(file.name) && Number(file.size) > 0
      && /C1O-ALOC-CM-\d{4}-\d{4}.*\.(?:xlsx|xlsm|xls)$/i.test(file.name));
  }

  function allocationConfirmationFiles(fileList) {
    return [...(fileList || [])].filter((file) => !/^~\$/.test(file.name) && Number(file.size) > 0
      && /\.(?:xlsx|xlsm|xls)$/i.test(file.name));
  }

  // Cache separado para o catálogo offline (não depende de arquivo do usuário).
  // Evita re-parsear os ~340 KB de base64 a cada clique em "Analisar".
  let offlineCatalogCache = null;
  let offlineCatalogFileRef = null; // Referência ao databookFile que gerou o cache atual.

  async function loadDatabookCatalog() {
    if (state.databookFile) {
      // Catálogo personalizado: re-parseia só se o arquivo mudou.
      if (offlineCatalogFileRef === state.databookFile && state.catalogEntries.length) {
        return state.catalogEntries;
      }
      const workbook = await readWorkbook(state.databookFile);
      state.catalogEntries = A.parseDatabookWorkbook(workbook, XLSX).entries;
      offlineCatalogFileRef = state.databookFile;
      offlineCatalogCache = null; // Invalida cache offline quando há arquivo custom.
      return state.catalogEntries;
    }
    // Sem arquivo personalizado: usa o catálogo offline já parseado se disponível.
    if (offlineCatalogCache !== null) {
      state.catalogEntries = offlineCatalogCache;
      return state.catalogEntries;
    }
    offlineCatalogFileRef = null;
    try {
      let buffer;
      const offline = window.RECONOfflineResources;
      if (!offline || !(offline.has("Caminho data book_Rev.C.xlsx") || await offline.ensure("Caminho data book_Rev.C.xlsx"))) throw new Error("Base Databook indisponível");
      buffer = offline.arrayBuffer("Caminho data book_Rev.C.xlsx");
      const workbook = window.RECONWorkbookWorker ? await window.RECONWorkbookWorker.readBuffer(buffer, "databook-rev-c", { cellDates: true }) : XLSX.read(buffer, { type: "array", cellDates: true });
      state.catalogEntries = A.parseDatabookWorkbook(workbook, XLSX).entries;
      offlineCatalogCache = state.catalogEntries; // Guarda para próximas análises.
      return state.catalogEntries;
    } catch (_) {
      try {
        const buffer = window.RECONOfflineResources?.arrayBuffer("Caminho data book_Rev.C.xlsx");
        if (buffer) {
          const workbook = window.RECONWorkbookWorker ? await window.RECONWorkbookWorker.readBuffer(buffer, "databook-rev-c-offline", { cellDates: true }) : XLSX.read(buffer, { type: "array", cellDates: true });
          state.catalogEntries = A.parseDatabookWorkbook(workbook, XLSX).entries;
          offlineCatalogCache = state.catalogEntries;
          return state.catalogEntries;
        }
      } catch (_) { /* contingência incorporada indisponível */ }
      state.catalogEntries = [];
      offlineCatalogCache = []; // Não tenta de novo se não disponível.
      return [];
    }
  }


  async function loadHistoricalAllocations(files) {
    const rows = [];
    for (let index = 0; index < files.length; index += 1) {
      if (index % 4 === 0) {
        setProgress(50 + Math.round((index / Math.max(1, files.length)) * 16), `Lendo histórico ${index + 1} de ${files.length}…`);
        await yieldFrame();
      }
      try {
        const workbook = await readWorkbook(files[index]);
        rows.push(...A.parseHistoricalAllocationWorkbook(workbook, XLSX, files[index].name).rows);
      } catch (error) {
        console.warn(`Histórico ignorado: ${files[index].name}`, error);
      }
    }
    const unique = new Map();
    rows.forEach((row) => {
      const evidenceKey = [A.key(row.document), A.pathKey(row.databook), A.norm(row.allocation), A.norm(row.status), A.norm(row.fiscalComment), A.norm(row.returnDate), (row.levels || []).map(A.norm).join("|")].join("::");
      unique.set(evidenceKey, row);
    });
    return [...unique.values()];
  }


  async function loadConfirmationRows(files) {
    const rows = [];
    for (let index = 0; index < files.length; index += 1) {
      if (index % 4 === 0) await yieldFrame();
      try {
        const file = files[index];
        const workbook = await readWorkbook(file);
        const parsed = P && P.parseWorkbook ? P.parseWorkbook(workbook, XLSX, {
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
          lastModified: file.lastModified || 0,
        }) : { rows: [] };
        rows.push(...(parsed.rows || []));
      } catch (error) {
        console.warn(`Confirmação ignorada: ${files[index].name}`, error);
      }
    }
    const unique = new Map();
    rows.forEach((row) => {
      const evidenceKey = [A.key(row.document), A.norm(row.allocation), A.norm(row.status), A.norm(row.comment), row.source, row.sourceSheet, row.sourceRow].join("::");
      unique.set(evidenceKey, row);
    });
    return [...unique.values()];
  }

  async function loadControl(file, quiet) {
    const workbook = await readWorkbook(file);
    const parsed = A.parseControlWorkbook(workbook, XLSX);
    state.control = parsed;
    state.controlSource = file.name;
    if (state.codeAutomatic || !A.parseAllocationCode(els.code.value)) {
      const year = Number((els.date.value || localDateValue()).slice(0, 4));
      els.code.value = A.suggestAllocationCode(parsed, year);
      state.codeAutomatic = true;
    }
    updateInputs();
    if (!quiet) showToast("Controle lido e próxima alocação sugerida.", "success");
    return parsed;
  }

  function allocationStatusLabel(result) {
    if (result.decision === A.READY && result.reallocationRequired) return "Nova alocação";
    if (result.decision === A.READY) return "Pronto";
    if (result.decision === A.SKIP) return "Já alocado";
    return "Revisar";
  }

  function allocationStatusClass(result) {
    if (result.decision === A.READY) return "ready";
    if (result.decision === A.SKIP) return "skip";
    return "review";
  }

  function canSelectForAllocation(result) {
    return A.canSelectForAllocation ? A.canSelectForAllocation(result) : Boolean(result && result.document && result.record && result.output);
  }

  function defaultSelectedForAllocation(result) {
    return A.defaultSelectedForAllocation ? A.defaultSelectedForAllocation(result) : Boolean(canSelectForAllocation(result) && result.decision === A.READY);
  }

  function setResultSelection(result, selected) {
    if (!canSelectForAllocation(result)) return;
    const documentKey = A.key(result.document);
    if (selected) state.selected.add(documentKey);
    else state.selected.delete(documentKey);
    result.userSelected = Boolean(selected);
    result.manualOverride = Boolean(selected && result.decision !== A.READY);
  }

  function resultCounts() {
    return state.results.reduce((counts, result) => {
      counts.total += 1;
      if (result.decision === A.READY) counts.ready += 1;
      else if (result.decision === A.SKIP) counts.skip += 1;
      else counts.review += 1;
      return counts;
    }, { total: 0, ready: 0, skip: 0, review: 0 });
  }

  function databookUiState(result) {
    const output = result && result.output;
    const evidence = output && output.databookEvidence || result && result.databookInference || {};
    if (evidence.conflict || result && result.databookInference && result.databookInference.conflict) return "conflict";
    if (!output) return "other";
    const path = A.text(output.databook);
    if (!path) return "missing";
    if (["history", "ld", "catalog", "manual", "discipline-fallback"].includes(evidence.sourceType)) return "suggested";
    return "exact";
  }

  function databookFilterCounts() {
    return state.results.reduce((counts, result) => {
      const status = databookUiState(result);
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, { missing: 0, suggested: 0, conflict: 0, approved: 0 });
  }

  function renderDatabookFilter() {
    const counts = databookFilterCounts();
    const labels = {
      all: `Todos (${state.results.length})`,
      missing: `Sem caminho (${counts.missing})`,
      suggested: `Sugeridos (${counts.suggested})`,
      conflict: `Conflitantes (${counts.conflict})`,
      approved: `Aprovados (${counts.approved})`,
    };
    [...els.databookFilter.options].forEach((option) => { option.textContent = labels[option.value] || option.textContent; });
    els.databookFilter.value = state.databookFilter;
  }

  function formatDateBR(value) {
    const parsed = C && C.parseDate ? C.parseDate(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return A.text(value);
    return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
  }

  const ALLOCATION_COLUMN_FILTERS = Object.freeze([
    ["selection", "Seleção"], ["situation", "Situação"], ["diagnosis", "Diagnóstico"], ["document", "NomeDocumento"], ["ldSource", "Arquivo LD"], ["sheet", "Aba LD"], ["ldVersion", "Versão da LD"], ["allocationStatus", "Confirmação na LD"], ["confirmationOutcome", "Resultado da confirmação"], ["confirmationComment", "Comentário da confirmação"], ["confirmationSource", "Fonte da confirmação"], ["previousAllocation", "Alocação anterior"], ["allocationReason", "Motivo"], ["grdt", "Número da GRDT"], ["effectiveDate", "Data efetiva"], ["postingStatus", "Situação de postagem"], ["plannedDate", "Data prevista"], ["workflow", "Workflow"], ["action", "Ação"], ["purpose", "Propósito"], ["databook", "Caminho Data Book"], ["n1", "N1"], ["n2", "N2"], ["n3", "N3"], ["n4", "N4"], ["n5", "N5"], ["n6", "N6"], ["conflict", "Conflito na LD"], ["history", "Alocação / Histórico"],
  ]);

  function allocationHistoryText(result) {
    const output = result.output || {}; const evidence = output.databookEvidence || {};
    const evidenceText = evidence.source ? `${evidence.source}${evidence.support > 1 ? ` · ${evidence.support} registros` : ""}${evidence.allocation ? ` · ${evidence.allocation}` : ""}` : "";
    return result.existingAllocation ? `${result.existingAllocation}${result.history && result.history.status ? ` · ${result.history.status}` : ""}` : result.history && result.history.allocation ? `${result.history.allocation}${result.history.status ? ` · ${result.history.status}` : ""}` : evidenceText || result.reason;
  }

  function allocationColumnValue(result, keyName) {
    const output=result&&result.output||{}, record=result&&result.record||{}, levels=output.levels||[];
    const selectable=canSelectForAllocation(result), selected=selectable&&state.selected.has(A.key(result.document));
    const selection=!selectable?"Indisponível":selected?(result.manualOverride?"Selecionado manualmente":"Selecionado automaticamente"):"Desmarcado";
    const values={selection,situation:allocationStatusLabel(result),diagnosis:result&&result.allocationDiagnosis||result&&result.allocationDiagnosisDetail,document:result&&result.document,ldSource:result&&result.ldSource||record.source,sheet:result&&result.sheet,ldVersion:result&&result.ldVersion||record.ldVersion,allocationStatus:result&&result.allocationStatus||record.allocationStatus,confirmationOutcome:result&&result.confirmationOutcome,confirmationComment:result&&result.confirmationComment||result&&result.fiscalComment,confirmationSource:result&&result.confirmationSource,previousAllocation:result&&result.previousAllocation,allocationReason:result&&result.allocationReason||result&&result.reason,grdt:result&&result.grdt||record.grdt,effectiveDate:formatDateBR(result&&result.effectiveDate||record.effectiveDate),postingStatus:result&&result.postingStatus,plannedDate:formatDateBR(output.plannedDate),workflow:output.workflow,action:output.action,purpose:output.purpose,databook:output.databook,n1:levels[0],n2:levels[1],n3:levels[2],n4:levels[3],n5:levels[4],n6:levels[5],conflict:result&&result.conflictLd||"NÃO",history:allocationHistoryText(result)};
    return values[keyName]||"";
  }
  function activeColumnFilters(){return Object.entries(state.columnFilters||{}).filter(([,value])=>A.norm(value));}
  function initializeColumnFilters(){if(!els.columnFilterRow||els.columnFilterRow.dataset.ready==="true")return;els.columnFilterRow.innerHTML=ALLOCATION_COLUMN_FILTERS.map(([keyName,label])=>`<th scope="col"><input type="search" data-column-filter="${keyName}" aria-label="Filtrar ${escapeHtml(label)}" placeholder="Filtrar…" autocomplete="off"></th>`).join("");els.columnFilterRow.dataset.ready="true";els.columnFilterRow.addEventListener("input",event=>{const input=event.target.closest("[data-column-filter]");if(!input)return;if(input.value.trim())state.columnFilters[input.dataset.columnFilter]=input.value;else delete state.columnFilters[input.dataset.columnFilter];if(els.clearColumnFilters)els.clearColumnFilters.hidden=activeColumnFilters().length===0;window.clearTimeout(els.columnFilterRow._filterTimer);els.columnFilterRow._filterTimer=window.setTimeout(renderResults,110);});}
  function clearColumnFilters(){state.columnFilters={};if(els.columnFilterRow)els.columnFilterRow.querySelectorAll("input").forEach(input=>{input.value="";});if(els.clearColumnFilters)els.clearColumnFilters.hidden=true;renderResults();}

  function allocationDecisionKind(result) {
    if (result.decision === A.READY && result.reallocationRequired) return "reallocation";
    if (result.decision === A.READY) return "ready";
    if (result.decision === A.SKIP) return "skip";
    return "review";
  }

  function visibleResults() {
    const search = A.norm(state.search);
    const columnFilters = activeColumnFilters();
    return state.results.filter((result) => {
      if (state.decisionFilter !== "all" && allocationDecisionKind(result) !== state.decisionFilter) return false;
      if (state.databookFilter !== "all" && databookUiState(result) !== state.databookFilter) return false;
      for (const [keyName, value] of columnFilters) if (!A.norm(allocationColumnValue(result, keyName)).includes(A.norm(value))) return false;
      if (!search) return true;
      return A.norm([
        result.document,
        result.ldSource,
        result.sheet,
        result.reason,
        result.output && result.output.workflow,
        result.output && result.output.databook,
        result.output && result.output.databookEvidence && result.output.databookEvidence.source,
        result.history && result.history.allocation,
        result.allocationReason,
        result.allocationDiagnosis,
        result.allocationDiagnosisDetail,
        result.confirmationOutcome,
        result.confirmationComment,
        result.confirmationSource,
        result.previousAllocation,
        result.grdt,
        result.effectiveDate,
        result.postingStatus,
        result.sigemStatus,
      ].join(" ")).includes(search);
    });
  }

  function rowCell(value, extraClass) {
    const display = A.text(value) || "—";
    return `<span class="allocation-value ${extraClass || ""}" title="${escapeHtml(display)}">${escapeHtml(display)}</span>`;
  }

  function databookCell(result, output, evidence, inferred) {
    if (!result.output) return rowCell("");
    const path = A.text(output.databook);
    const status = databookUiState(result);
    const label = status === "approved" ? "Aprovado"
      : status === "conflict" ? "Conflito"
        : status === "missing" ? "Definir"
          : status === "suggested" ? "Sugerido" : "Conferir";
    return `<div class="allocation-databook-cell ${status}">
      ${rowCell(path, !path && result.decision === A.READY ? "warning" : inferred ? "inferred" : "")}
      <button class="databook-assistant-pill ${status}" data-databook-review type="button" title="Abrir o Assistente de Databook">${escapeHtml(label)}</button>
    </div>`;
  }

  function evidenceLine(label, value, tone) {
    const clean = A.text(value);
    return clean ? `<div class="allocation-evidence-line ${tone || ""}"><span>${escapeHtml(label)}</span><strong title="${escapeHtml(clean)}">${escapeHtml(clean)}</strong></div>` : "";
  }

  function renderTable() {
    const visible = visibleResults();
    const preview = pager ? pager.slice(visible) : visible.slice(0, DEFAULT_PAGE_SIZE);
    els.empty.hidden = preview.length > 0;
    els.tbody.innerHTML = preview.map((result) => {
      const output = result.output || {};
      const record = result.record || {};
      const selected = state.selected.has(A.key(result.document));
      const canSelect = canSelectForAllocation(result);
      const manualOverride = Boolean(selected && result.decision !== A.READY);
      const version = result.ldVersion || A.recordVersion(record, state.control && state.control.latestLdVersion);
      const evidence = output.databookEvidence || {};
      const inferred = ["history", "ld", "catalog", "discipline-fallback"].includes(evidence.sourceType);
      const history = allocationHistoryText(result);
      const decisionKind = allocationDecisionKind(result);
      const warnings = (result.warnings || []).join(" · ");
      const workflowDisplay = output.workflow || (A.isAsBuiltPurpose(output.purpose) ? "Não se aplica — Conforme Construído" : "Definir");
      const selectionLabel = canSelect ? `Selecionar ${result.document} para a alocação` : `${result.document} não possui dados suficientes para gerar a linha de alocação`;
      return `<tr class="allocation-result-row decision-${decisionKind} ${selected ? "selected" : ""} ${manualOverride ? "manual-override" : ""}" data-allocation-document="${escapeHtml(A.key(result.document))}">
        <td><div class="allocation-situation decision-first"><input class="allocation-check" type="checkbox" aria-label="${escapeHtml(selectionLabel)}" title="${escapeHtml(selectionLabel)}" ${selected ? "checked" : ""} ${canSelect ? "" : "disabled"}><span class="allocation-status ${allocationStatusClass(result)}">${allocationStatusLabel(result)}</span>${result.reallocationRequired ? '<small>Após recusa</small>' : ''}${manualOverride ? '<span class="allocation-manual-pill">Inclusão manual</span>' : ''}</div></td>
        <td><div class="allocation-document-card"><strong title="${escapeHtml(result.document)}">${escapeHtml(result.document)}</strong><span>${escapeHtml(result.ldSource || record.source || "LD não identificada")} · ${escapeHtml(result.sheet || "Aba não informada")} · versão ${escapeHtml(version || "não informada")}</span>${result.ldSources && result.ldSources.length > 1 ? `<small class="evidence-warning">Encontrado em ${escapeHtml(result.ldSources.join(" · "))}</small>` : ""}${result.conflictLd && result.conflictLd !== "NÃO" ? `<small class="evidence-warning">Conflito na LD: ${escapeHtml(result.conflictLd)}</small>` : ""}</div></td>
        <td><div class="allocation-evidence-stack">${evidenceLine("Diagnóstico", result.allocationDiagnosis || result.allocationDiagnosisDetail || "Sem diagnóstico")}${evidenceLine("Resultado", result.confirmationOutcome || "Sem confirmação externa", result.reallocationRequired ? "warning" : "")}${evidenceLine("Fonte", result.confirmationSource || "LD / controle")}${evidenceLine("Fiscal", result.confirmationComment || result.fiscalComment || "Sem comentário")}${evidenceLine("Alocação anterior", result.previousAllocation)}</div></td>
        <td><div class="allocation-evidence-stack">${evidenceLine("SIGEM", result.postingStatus || result.sigemStatus || "Sem evidência na LD")}${evidenceLine("GRDT", result.grdt || record.grdt)}${evidenceLine("Data efetiva", formatDateBR(result.effectiveDate || record.effectiveDate))}${evidenceLine("Revisão", record.revision || result.revision)}</div></td>
        <td>${databookCell(result, output, evidence, inferred)}</td>
        <td><div class="allocation-reason-card"><strong>${escapeHtml(result.allocationDiagnosisDetail || result.allocationReason || result.reason || "Sem motivo registrado")}</strong><details><summary>Ver evidências completas</summary>${evidenceLine("Motivo completo", result.allocationReason)}${evidenceLine("Histórico", history)}${evidenceLine("Workflow", workflowDisplay)}${evidenceLine("Propósito", output.purpose)}${evidenceLine("Ação", output.action)}${evidenceLine("Alertas", warnings, warnings ? "warning" : "")}</details></div></td>
        <td><div class="allocation-output-card">${evidenceLine("Workflow", workflowDisplay)}${evidenceLine("Ação", output.action || "—")}${evidenceLine("Propósito", output.purpose || "—")}${evidenceLine("Data prevista", formatDateBR(output.plannedDate) || "—")}</div></td>
      </tr>`;
    }).join("");
    els.previewLimit.hidden = false;
    els.previewLimit.textContent = `${visible.length.toLocaleString("pt-BR")} resultado(s) filtrado(s) · exportações usam todos os selecionados`;
    notifyReconUi();
  }

  function renderResults() {
    const counts = resultCounts();
    els.countTotal.textContent = counts.total;
    els.countReady.textContent = counts.ready;
    els.countSkip.textContent = counts.skip;
    els.countReview.textContent = counts.review;
    renderDatabookFilter();
    if (els.decisionFilter) els.decisionFilter.value = state.decisionFilter;
    els.results.classList.toggle("compact-mode", state.compactMode);
    els.density.setAttribute("aria-pressed", String(state.compactMode));
    els.density.textContent = state.compactMode ? "Expandir" : "Compactar";
    renderTable();

    const eligibleKeys = state.results.filter(canSelectForAllocation).map((result) => A.key(result.document));
    const selected = selectedResults();
    const selectedKeys = new Set(selected.map((result) => A.key(result.document)));
    const selectedEligible = eligibleKeys.filter((documentKey) => selectedKeys.has(documentKey));
    const manualCount = selected.filter((result) => result.manualOverride).length;
    const plan = batchPlan();
    renderBatchPlan(plan);
    els.selectAll.disabled = eligibleKeys.length === 0;
    els.selectAll.checked = eligibleKeys.length > 0 && selectedEligible.length === eligibleKeys.length;
    els.selectAll.indeterminate = selectedEligible.length > 0 && selectedEligible.length < eligibleKeys.length;
    els.selectedCount.textContent = `${selected.length} selecionado${selected.length === 1 ? "" : "s"}${manualCount ? ` · ${manualCount} inclusão${manualCount === 1 ? "" : "ões"} manual${manualCount === 1 ? "" : "is"}` : ""}${plan.groups.length ? ` · ${plan.groups.length} alocação${plan.groups.length === 1 ? "" : "ões"}` : ""}${plan.errors.length ? " · agrupamento pendente" : ""}`;
    els.batchDatabook.disabled = selected.length < 2 || state.busy;
    els.batchDatabook.textContent = selected.length >= 2 ? `Databook em lote (${selected.length})` : "Databook em lote";
    const canExport = selected.length > 0 && codeIsValid() && Boolean(els.date.value) && plan.valid && !state.busy;
    els.exportReport.disabled = !state.results.length || state.busy;
    els.exportFile.disabled = !canExport;
    els.exportControl.disabled = !canExport;
    els.exportPackage.disabled = !canExport;
  }

  function assistantResults() {
    const wanted = new Set(state.assistantDocumentKeys.length ? state.assistantDocumentKeys : [state.assistantDocumentKey].filter(Boolean));
    return state.results.filter((result) => wanted.has(A.key(result.document)) && result.output);
  }

  function assistantResult() {
    return assistantResults()[0] || null;
  }

  function assistantLevels() {
    return [...els.reviewLevels.querySelectorAll("input")].map((input) => input.value.trim());
  }

  function titleQualityMarkup(quality) {
    const label = quality.status === "reserved" ? "Reservado" : `Qualidade ${quality.score}`;
    const issues = quality.issues.length
      ? quality.issues.map((issue) => `<li class="${escapeHtml(issue.severity)}">${escapeHtml(issue.label)}</li>`).join("")
      : "<li>Padronização adequada</li>";
    return `<div><strong>Qualidade do título</strong><span class="title-quality-badge ${escapeHtml(quality.status)}">${escapeHtml(label)}</span></div><ul>${issues}</ul>`;
  }

  function renderReviewTitleQuality() {
    if (!Q) return;
    const quality = Q.titleQuality(els.reviewTitle.value, els.reviewDocument.textContent);
    els.reviewTitleQuality.innerHTML = titleQualityMarkup(quality);
  }

  function exactDatabookForResult(result) {
    const record = result && result.record || {};
    return A.recordValue(record, ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"])
      || result && result.history && result.history.databook || "";
  }

  function renderAssistantComparison() {
    const results = assistantResults();
    if (!results.length) return;
    const currentPaths = [...new Set(results.map(exactDatabookForResult).filter(Boolean))];
    const missing = results.length - results.filter((result) => exactDatabookForResult(result)).length;
    const currentText = results.length === 1
      ? currentPaths[0] || "Sem caminho na LD ou no controle"
      : currentPaths.length === 1 && !missing
        ? currentPaths[0]
        : `${currentPaths.length} caminho(s) atual(is) · ${missing} sem caminho`;
    const proposed = els.reviewPath.value.trim();
    els.comparisonCurrent.textContent = currentText;
    els.comparisonCurrent.title = currentPaths.join(" · ") || currentText;
    els.comparisonProposed.textContent = proposed || "Defina o caminho para aplicar";
    els.comparisonProposed.title = proposed;
    const unchanged = proposed && currentPaths.length === 1 && !missing && A.pathKey(currentPaths[0]) === A.pathKey(proposed);
    els.comparison.classList.toggle("changed", Boolean(proposed && !unchanged));
  }

  function pathLevels(path) {
    const wanted = A.pathKey(path);
    if (!wanted) return [];
    if (state.control && state.control.levelsByDatabook) {
      for (const [candidate, levels] of state.control.levelsByDatabook.entries()) {
        if (A.pathKey(candidate) === wanted && (levels || []).some(Boolean)) return levels.slice(0, 10);
      }
    }
    return [];
  }

  function fillAssistantLevels(levels) {
    const values = Array.from({ length: 10 }, (_, index) => A.text(levels && levels[index]));
    els.reviewLevels.innerHTML = values.map((value, index) => (
      `<label>N${index + 1}<input data-databook-level="${index}" type="text" value="${escapeHtml(value)}" autocomplete="off" spellcheck="false"></label>`
    )).join("");
  }

  function renderPathOptions() {
    const options = new Map();
    state.catalogEntries.forEach((entry) => {
      if (A.completeDatabook(entry.databook)) options.set(A.pathKey(entry.databook), entry.databook);
    });
    els.pathOptions.innerHTML = [...options.values()].sort((left, right) => left.localeCompare(right, "pt-BR"))
      .map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  }

  function populateAssistantReview(result) {
    const output = result.output || {};
    const record = result.record || {};
    const evidence = output.databookEvidence || result.databookInference || {};
    els.reviewDocument.textContent = result.document || "—";
    els.reviewSource.textContent = evidence.source || (output.databook ? "LD ou controle" : "Sem sugestão");
    els.reviewConfidence.textContent = evidence.confidence || (output.databook ? "confirmada" : "—");
    els.reviewTitleField.hidden = false;
    els.reviewTitleQuality.hidden = false;
    els.reviewTitle.value = record.title || "";
    els.reviewPath.value = output.databook || "";
    fillAssistantLevels(output.levels || []);
    renderReviewTitleQuality();
    renderAssistantComparison();
    renderPathOptions();
    const conflict = Boolean((result.databookInference || {}).conflict || evidence.conflict);
    const related = (evidence.relatedDocuments || []).filter(Boolean).slice(0, 4);
    const notices = [];
    if (conflict) notices.push("Há caminhos aprovados diferentes para documentos semelhantes. Escolha o caminho correto antes de aplicar.");
    else if (!output.databook) notices.push("Nenhum caminho seguro foi localizado. Selecione um caminho e confira os níveis.");
    if (related.length) notices.push(`Referências: ${related.join(" · ")}`);
    els.reviewMessage.hidden = !notices.length;
    els.reviewMessage.textContent = notices.join(" ");
    const complete = A.completeDatabook(els.reviewPath.value);
    els.assistantApply.disabled = !result.output || !complete;
    els.assistantApply.textContent = "Aplicar nesta análise";
  }

  function commonBatchLevels(results) {
    const serialized = results.map((result) => Array.from({ length: 10 }, (_, index) => (
      A.text(result.output && result.output.levels && result.output.levels[index])
    )).join("\u001f"));
    return new Set(serialized).size === 1 ? serialized[0].split("\u001f") : [];
  }

  function populateAssistantBatch(results) {
    const paths = [...new Set(results.map((result) => A.text(result.output && result.output.databook)).filter(Boolean))];
    const conflicts = results.filter((result) => databookUiState(result) === "conflict").length;
    const missing = results.filter((result) => databookUiState(result) === "missing").length;
    els.reviewDocument.textContent = `${results.length} documentos selecionados`;
    els.reviewSource.textContent = paths.length === 1 ? "Caminho comum" : "Seleção em lote";
    els.reviewConfidence.textContent = "Conferência manual";
    els.reviewTitleField.hidden = true;
    els.reviewTitleQuality.hidden = true;
    els.reviewTitle.value = "";
    els.reviewPath.value = paths.length === 1 ? paths[0] : "";
    fillAssistantLevels(commonBatchLevels(results));
    renderPathOptions();
    renderAssistantComparison();
    const notices = [];
    if (paths.length > 1) notices.push(`${paths.length} caminhos diferentes foram encontrados. O novo caminho substituirá todos somente nesta seleção.`);
    if (missing) notices.push(`${missing} documento(s) estão sem caminho.`);
    if (conflicts) notices.push(`${conflicts} documento(s) possuem conflito e exigem confirmação.`);
    els.reviewMessage.hidden = !notices.length;
    els.reviewMessage.textContent = notices.join(" ");
    const complete = A.completeDatabook(els.reviewPath.value);
    els.assistantApply.disabled = !complete;
    els.assistantApply.textContent = `Aplicar a ${results.length}`;
  }

  async function ensureDatabookCatalog() {
    if (!state.catalogEntries.length) await loadDatabookCatalog();
    renderPathOptions();
  }

  async function openAssistantForResult(result) {
    if (!result || !result.output) return;
    state.assistantDocumentKey = A.key(result.document);
    state.assistantDocumentKeys = [state.assistantDocumentKey];
    await ensureDatabookCatalog();
    populateAssistantReview(result);
    els.assistantOverlay.hidden = false;
    els.assistantDrawer.hidden = false;
    els.assistantDrawer.inert = false;
    els.assistantDrawer.classList.add("open");
    els.assistantDrawer.setAttribute("aria-hidden", "false");
  }

  async function openAssistantForBatch(results) {
    const valid = (results || []).filter(canSelectForAllocation);
    if (valid.length < 2) {
      showToast("Selecione pelo menos dois documentos para revisar o Databook em lote.", "warn");
      return;
    }
    state.assistantDocumentKey = "";
    state.assistantDocumentKeys = valid.map((result) => A.key(result.document));
    await ensureDatabookCatalog();
    populateAssistantBatch(valid);
    els.assistantOverlay.hidden = false;
    els.assistantDrawer.hidden = false;
    els.assistantDrawer.inert = false;
    els.assistantDrawer.classList.add("open");
    els.assistantDrawer.setAttribute("aria-hidden", "false");
  }

  function closeDatabookAssistant() {
    els.assistantDrawer.classList.remove("open");
    els.assistantDrawer.setAttribute("aria-hidden", "true");
    els.assistantDrawer.inert = true;
    els.assistantDrawer.hidden = true;
    els.assistantOverlay.hidden = true;
    state.assistantDocumentKey = "";
    state.assistantDocumentKeys = [];
  }

  function applyAssistantReview() {
    const results = assistantResults();
    if (!results.length) return;
    const databook = els.reviewPath.value.trim();
    if (!A.completeDatabook(databook)) {
      showToast("Informe um Caminho Data Book completo.", "error");
      return;
    }
    const levels = assistantLevels();
    results.forEach((result) => {
      result.output.databook = databook;
      result.output.levels = levels.slice();
      result.output.databookEvidence = {
        source: "Ajuste nesta análise",
        sourceType: "manual",
        confidence: "manual",
        support: results.length,
        allocation: A.text(els.code.value),
        relatedDocuments: results.slice(0, 8).map((item) => item.document),
      };
      result.output.levelsSource = "Ajuste nesta análise";
      result.warnings = (result.warnings || []).filter((warning) => !/Caminho Data Book vazio|Níveis N1 a N6 vazios|Databook por/i.test(warning));
      result.reason = result.warnings.length ? result.warnings.join(" · ") : "Dados prontos para a alocação.";
    });
    renderResults();
    closeDatabookAssistant();
    showToast(`${results.length} caminho(s) aplicado(s) nesta análise.`, "success");
  }

  async function addLogo(workbook, worksheet) {
    try {
      let image;
      if (window.RECONBrand?.addReportLogo) image = window.RECONBrand.addReportLogo(workbook);
      else {
        const response = await window.fetch("recon-logo-report.png", { cache: "no-store" });
        if (!response.ok) throw new Error("Logo indisponível");
        image = workbook.addImage({ buffer: await response.arrayBuffer(), extension: "png" });
      }
      worksheet.addImage(image, { tl: { col: 0.12, row: 0.12 }, ext: { width: 155, height: 57 } });
    } catch (_) {
      // O conteúdo permanece íntegro sem a imagem.
    }
  }

  async function analyzeAllocation() {
    if (state.busy) return;
    const allocationDate = refreshAllocationDate();
    const ldFiles = currentLdFiles();
    const controlFile = state.controlFile;
    if (!ldFiles.length || !controlFile || !hasRelation()) return;
    if (!codeIsValid()) {
      showToast("Informe o número no formato C1O-ALOC-CM-0000-2026.", "error");
      return;
    }
    const runId = ++state.analysisRun;
    state.busy = true;
    if (Workspace) Workspace.start("allocation-analysis", "Análise de alocação");
    if (state.progressTimer) window.clearTimeout(state.progressTimer);
    state.progressTimer = 0;
    updateInputs();
    setProgress(5, "Lendo a LD…");
    try {
      await prepareLdFiles(ldFiles);
      ensureCurrentAnalysis(runId);
      const parsedSources = [];
      for (let index = 0; index < ldFiles.length; index += 1) {
        const ldFile = ldFiles[index];
        setProgress(5 + Math.round((index / Math.max(ldFiles.length, 1)) * 28), `Lendo LD ${index + 1} de ${ldFiles.length}…`);
        let parsed;
        if (window.RECONWorkbookWorker && window.RECONWorkbookWorker.readLd) {
          parsed = (await window.RECONWorkbookWorker.readLd(ldFile, {
            sourceName: ldFile.name,
            sourceTimestamp: ldFile.lastModified || 0,
            compatibilityProfile: L && L.profileFor(ldFile),
            buildIndex: false,
          })).parsed;
        } else {
          const ldWorkbook = L && L.workbookFor(ldFile) || await readWorkbook(ldFile);
          parsed = C.parseWorkbook(ldWorkbook, ldFile.name, ldFile.lastModified || 0, L && L.profileFor(ldFile));
        }
        ensureCurrentAnalysis(runId);
        if (!parsed.records.length) throw new Error(`Nenhuma linha técnica foi encontrada em ${ldFile.name}.`);
        parsedSources.push({ file: ldFile, parsed });
        await yieldFrame();
      }
      const parsedLd = {
        records: parsedSources.flatMap((source) => source.parsed.records),
        history: parsedSources.flatMap((source) => source.parsed.history),
        sources: parsedSources.map((source) => ({
          name: source.file.name,
          records: source.parsed.records.length,
          history: source.parsed.history.length,
          ldVersion: source.parsed.ldVersion || "",
        })),
      };
      await yieldFrame();
      setProgress(38, "Lendo o controle…");
      const control = state.control && state.controlSource === controlFile.name ? state.control : await loadControl(controlFile, true);
      ensureCurrentAnalysis(runId);

      await yieldFrame();
      setProgress(46, "Preparando Databook e níveis…");
      const catalogEntries = await loadDatabookCatalog();
      ensureCurrentAnalysis(runId);
      const historyRows = state.historyFiles.length ? await loadHistoricalAllocations(state.historyFiles) : [];
      ensureCurrentAnalysis(runId);
      const confirmationRows = state.confirmationFiles.length ? await loadConfirmationRows(state.confirmationFiles) : [];
      ensureCurrentAnalysis(runId);

      await yieldFrame();
      setProgress(68, "Lendo a relação…");
      let entries = [];
      if (state.listFile) {
        const relationWorkbook = await readWorkbook(state.listFile);
        ensureCurrentAnalysis(runId);
        entries = entries.concat(A.parseRelationWorkbook(relationWorkbook, XLSX).entries);
      }
      if (relationLineCount()) entries = entries.concat(A.parseTextRelation(els.text.value).entries);
      if (!entries.length) throw new Error("A relação não contém documentos reconhecíveis.");

      await yieldFrame();
      setProgress(82, `Conferindo ${entries.length} itens…`);
      const analysisOptions = { allocationDate, catalogEntries, historyRows, confirmationRows, ldHistory: parsedLd.history, ldSourceNames: ldFiles.map((file) => file.name) };
      const analyzed = window.RECONCompute ? await window.RECONCompute.run("allocation", "allocation-analyze", { entries, records: parsedLd.records, control, options: analysisOptions }) : A.analyze(entries, parsedLd.records, control, analysisOptions);
      ensureCurrentAnalysis(runId);
      state.results = analyzed.results.map((result) => ({
        ...result,
        ldSource: result.ldSource || result.record && result.record.source || "",
        ldSources: result.ldSources && result.ldSources.length ? result.ldSources : (result.record && result.record.source ? [result.record.source] : []),
      }));
      if (pager) pager.reset();
      if (!state.densityManual && state.results.length > 500) state.compactMode = true;
      state.duplicateCount = analyzed.duplicateCount;
      state.selected = new Set();
      state.results.forEach((result) => setResultSelection(result, defaultSelectedForAllocation(result)));
      els.results.hidden = false;
      renderResults();
      setProgress(100, "Concluído");
      const counts = resultCounts();
      const inferredCount = state.results.filter((result) => result.output && result.output.databook
        && ["history", "ld", "catalog", "discipline-fallback"].includes(result.output.databookEvidence && result.output.databookEvidence.sourceType)).length;
      const duplicateSuffix = analyzed.duplicateCount ? ` · ${analyzed.duplicateCount} duplicado(s) removido(s)` : "";
      const inferredSuffix = inferredCount ? ` · ${inferredCount} Databook${inferredCount === 1 ? "" : "s"} recuperado${inferredCount === 1 ? "" : "s"}` : "";
      const plan = batchPlan();
      const splitSuffix = plan.groups.length ? ` · ${plan.groups.length} alocação${plan.groups.length === 1 ? "" : "ões"}` : "";
      const planWarning = plan.errors.length ? ` ${plan.errors[0]}` : "";
      showToast(`${counts.ready} documento(s) pronto(s)${splitSuffix}${inferredSuffix}${duplicateSuffix}.${planWarning}`, counts.ready && !plan.errors.length ? "success" : "warn");
      state.progressTimer = window.setTimeout(() => {
        if (runId === state.analysisRun) els.progress.hidden = true;
        state.progressTimer = 0;
      }, 500);
    } catch (error) {
      if (runId !== state.analysisRun || error && error.name === "AbortError") return;
      if (error && error.name === "RECONFileReadError") console.warn(error.message);
      else console.error(error);
      els.progress.hidden = true;
      invalidateResults();
      showToast(error.message || "Não foi possível analisar a alocação.", "error");
    } finally {
      if (runId === state.analysisRun) {
        state.busy = false;
        if (Workspace) Workspace.finish("allocation-analysis");
        updateInputs();
        renderResults();
      }
    }
  }

  function selectedResults() {
    return A.selectedReady(state.results, state.selected);
  }

  function batchPlan(results) {
    return B.build(Array.isArray(results) ? results : selectedResults(), els.code.value, { mode: state.groupingMode });
  }

  function renderBatchPlan(plan) {
    const show = Boolean(plan && plan.groups && plan.groups.length);
    els.batchPlan.hidden = !show;
    const plural = Boolean(plan && plan.groups && plan.groups.length > 1);
    els.exportFile.textContent = plural ? "Baixar alocações oficiais (ZIP)" : "Baixar alocação oficial";
    els.exportControl.textContent = plural ? "Baixar linhas por alocação (ZIP)" : "Baixar linhas do controle";
    els.exportPackage.textContent = plural ? "Gerar pacote das alocações" : "Gerar pacote";
    if (els.groupingHelp) els.groupingHelp.textContent = state.groupingMode === "single"
      ? "Todos os itens marcados usarão o mesmo número de alocação."
      : "Os itens marcados serão separados por disciplina/workflow.";
    if (els.batchEyebrow) els.batchEyebrow.textContent = state.groupingMode === "single" ? "ALOCAÇÃO ÚNICA" : "SEPARAÇÃO POR DISCIPLINA";
    if (els.batchTitle) els.batchTitle.textContent = state.groupingMode === "single" ? "Todos os selecionados no mesmo número" : "Uma alocação para cada disciplina/workflow";
    if (!show) return;
    els.readyName.textContent = `${plan.groups.length} alocação${plan.groups.length === 1 ? "" : "ões"} · ${plan.firstCode}${plan.lastCode !== plan.firstCode ? ` a ${plan.lastCode}` : ""}`;
    els.batchMeta.textContent = `${plan.groups.length} alocação${plan.groups.length === 1 ? "" : "ões"} · ${plan.firstCode}${plan.lastCode !== plan.firstCode ? ` até ${plan.lastCode}` : ""}`;
    els.batchList.innerHTML = plan.groups.map((group) => `<article class="allocation-batch-item ${group.blocking ? "error" : ""}"><div><strong>${escapeHtml(group.label)}</strong><span>${group.results.length} documento${group.results.length === 1 ? "" : "s"} · ${escapeHtml(group.sheets.join(" · ") || "LD")}</span></div><small>${escapeHtml(group.allocationCode)}</small></article>`).join("");
    els.batchWarning.hidden = !plan.errors.length;
    els.batchWarning.textContent = plan.errors.join(" ");
  }

  async function ensureExportLibraries() {
    if (window.RECONModuleLoader) await window.RECONModuleLoader.ensure("export");
    if (!window.ExcelJS || !window.JSZip) throw new Error("Bibliotecas de exportação indisponíveis.");
  }

  function allocationMeta(allocationCode) {
    const allocationDate = refreshAllocationDate();
    const parsed = A.parseAllocationCode(allocationCode || els.code.value);
    if (!parsed) throw new Error("Número da alocação inválido.");
    return { allocationCode: parsed.code, allocationDate, status: DEFAULT_STATUS };
  }

  async function generateFiles() {
    await ensureExportLibraries();
    const results = selectedResults();
    if (!results.length) throw new Error("Nenhum documento está selecionado para a alocação.");
    const plan = batchPlan(results);
    if (!plan.valid) throw new Error(plan.errors[0] || "Não foi possível montar o agrupamento escolhido.");
    const groups = [];
    for (const group of plan.groups) {
      const meta = allocationMeta(group.allocationCode);
      const allocation = await W.buildAllocation(group.results, window.ExcelJS, meta);
      const control = await W.buildControlLines(group.results, meta, window.ExcelJS);
      await W.verify({ allocation, control }, group.results, meta.allocationCode, window.ExcelJS);
      groups.push({
        ...group,
        meta,
        allocation,
        control,
        allocationName: `${meta.allocationCode}.xlsx`,
        controlName: `Linhas_Central_de_Alocacao_${meta.allocationCode}.xlsx`,
      });
    }
    return {
      results,
      plan,
      groups,
    };
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportAnalysisReport() {
    if (state.busy || !state.results.length) return;
    await ensureExportLibraries();
    state.busy = true;
    updateInputs();
    renderResults();
    const previous = els.exportReport.textContent;
    els.exportReport.textContent = "Gerando…";
    if (Workspace) Workspace.start("allocation-analysis-report", "Relatório da análise de alocação");
    try {
      const ldFiles = currentLdFiles();
      const buffer = await W.buildAnalysisReport(state.results, {
        ldName: ldFiles.map((file) => file.name).join(" · "),
        generatedAt: new Date().toLocaleString("pt-BR"),
        groupingMode: state.groupingMode,
      }, window.ExcelJS);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
      downloadBlob(new Blob([buffer], { type: W.MIME }), `Relatorio_RECON_Analise_Alocacao_${stamp}.xlsx`);
      showToast(`Relatório gerado com ${state.results.length} documento(s).`, "success");
    } catch (error) {
      if (error && error.name === "RECONFileReadError") console.warn(error.message);
      else console.error(error);
      showToast(error.message || "Não foi possível gerar o relatório da análise.", "error");
    } finally {
      state.busy = false;
      if (Workspace) Workspace.finish("allocation-analysis-report");
      els.exportReport.textContent = previous;
      updateInputs();
      renderResults();
    }
  }

  async function runExport(kind) {
    if (state.busy) return;
    state.busy = true;
    if (Workspace) Workspace.start("allocation-export", "Geração de alocação");
    updateInputs();
    renderResults();
    const button = kind === "allocation" ? els.exportFile : kind === "control" ? els.exportControl : els.exportPackage;
    const previous = button.textContent;
    button.textContent = "Gerando…";
    try {
      const generated = await generateFiles();
      const multiple = generated.groups.length > 1;
      if (kind === "allocation" && !multiple) {
        downloadBlob(new Blob([generated.groups[0].allocation], { type: W.MIME }), generated.groups[0].allocationName);
      } else if (kind === "control" && !multiple) {
        downloadBlob(new Blob([generated.groups[0].control], { type: W.MIME }), generated.groups[0].controlName);
      } else {
        const zip = new JSZip();
        generated.groups.forEach((group) => {
          if (kind !== "control") zip.file(group.allocationName, group.allocation);
          if (kind !== "allocation") zip.file(group.controlName, group.control);
        });
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
        const range = generated.plan.firstCode === generated.plan.lastCode ? generated.plan.firstCode : `${generated.plan.firstCode}_a_${generated.plan.lastCode}`;
        const prefix = kind === "allocation" ? "Alocacoes" : kind === "control" ? "Linhas_Central" : "Pacote_Alocacoes";
        downloadBlob(blob, `${prefix}_${range}.zip`);
      }
      showToast(`${generated.results.length} documento(s) separado(s) em ${generated.groups.length} alocação${generated.groups.length === 1 ? "" : "ões"} e verificado(s).`, "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Não foi possível gerar os arquivos.", "error");
    } finally {
      state.busy = false;
      if (Workspace) Workspace.finish("allocation-export");
      button.textContent = previous;
      updateInputs();
      renderResults();
    }
  }

  window.addEventListener("recon:module", (event) => {
    if (!event.detail || event.detail.module !== "allocation") return;
    if (!state.ldFiles.length && els.mainLdInput && els.mainLdInput.files && els.mainLdInput.files[0]) {
      state.ldFiles = [els.mainLdInput.files[0]];
      updateInputs();
      prepareLdFiles(state.ldFiles).catch((error) => showToast(error.message || "A LD não pôde ser lida.", "error"));
    }
  });

  els.ldInput.addEventListener("change", async () => {
    cancelAllocationAnalysis();
    state.ldFiles = els.ldInput.files ? Array.from(els.ldInput.files) : [];
    invalidateResults();
    updateInputs();
    try {
      await prepareLdFiles(state.ldFiles);
    } catch (error) {
      showToast(error.message || "Uma das LDs não pôde ser lida.", "error");
    }
  });
  if (els.mainLdInput) els.mainLdInput.addEventListener("change", async () => {
    if (els.ldInput.files && els.ldInput.files.length) return;
    cancelAllocationAnalysis();
    state.ldFiles = els.mainLdInput.files && els.mainLdInput.files[0] ? [els.mainLdInput.files[0]] : [];
    invalidateResults();
    updateInputs();
    try {
      await prepareLdFiles(state.ldFiles);
    } catch (error) {
      showToast(error.message || "A LD não pôde ser lida.", "error");
    }
  });
  document.addEventListener("recon:ld-compatibility", (event) => {
    if (event.detail && currentLdFiles().includes(event.detail.file)) updateInputs();
  });
  els.controlInput.addEventListener("change", async () => {
    cancelAllocationAnalysis();
    state.controlFile = els.controlInput.files && els.controlInput.files[0] || null;
    state.control = null;
    state.controlSource = "";
    invalidateResults();
    updateInputs();
    if (!state.controlFile) return;
    try {
      await loadControl(state.controlFile, false);
    } catch (error) {
      if (error && error.name === "RECONFileReadError") console.warn(error.message);
      else console.error(error);
      state.controlFile = null;
      state.control = null;
      els.controlInput.value = "";
      updateInputs();
      showToast(error.message || "O controle não pôde ser lido.", "error");
    }
  });
  els.listInput.addEventListener("change", () => {
    cancelAllocationAnalysis();
    state.listFile = els.listInput.files && els.listInput.files[0] || null;
    invalidateResults();
    updateInputs();
  });
  els.databookInput.addEventListener("change", () => {
    cancelAllocationAnalysis();
    state.databookFile = els.databookInput.files && els.databookInput.files[0] || null;
    state.catalogEntries = [];
    invalidateResults();
    updateInputs();
  });
  if (els.confirmationInput) els.confirmationInput.addEventListener("change", () => {
    cancelAllocationAnalysis();
    state.confirmationFiles = allocationConfirmationFiles(els.confirmationInput.files);
    invalidateResults();
    updateInputs();
    if (els.confirmationInput.files && els.confirmationInput.files.length && !state.confirmationFiles.length) {
      showToast("A pasta selecionada não contém planilhas de confirmação reconhecíveis.", "warn");
    }
  });

  els.historyInput.addEventListener("change", () => {
    cancelAllocationAnalysis();
    state.historyFiles = allocationHistoryFiles(els.historyInput.files);
    invalidateResults();
    updateInputs();
    if (els.historyInput.files && els.historyInput.files.length && !state.historyFiles.length) {
      showToast("A pasta selecionada não contém arquivos de alocação reconhecidos.", "warn");
    }
  });
  els.text.addEventListener("input", () => {
    cancelAllocationAnalysis();
    if (Workspace) Workspace.setDraft("allocationText", els.text.value);
    invalidateResults();
    updateInputs();
  });
  els.clear.addEventListener("click", () => resetAllocationAnalysis());
  els.code.addEventListener("input", () => {
    cancelAllocationAnalysis();
    state.codeAutomatic = false;
    updateInputs();
    renderResults();
  });
  els.date.addEventListener("change", () => {
    cancelAllocationAnalysis();
    if (state.control && state.codeAutomatic) {
      const year = Number(els.date.value.slice(0, 4));
      els.code.value = A.suggestAllocationCode(state.control, year);
    }
    invalidateResults();
    updateInputs();
  });
  els.analyze.addEventListener("click", analyzeAllocation);
  if (els.clearColumnFilters) els.clearColumnFilters.addEventListener("click", clearColumnFilters);
  els.search.addEventListener("input", () => {
    state.search = els.search.value;
    if (pager) pager.reset();
    renderResults();
  });
  els.databookFilter.addEventListener("change", () => {
    state.databookFilter = els.databookFilter.value;
    if (pager) pager.reset();
    renderResults();
  });
  if (els.decisionFilter) els.decisionFilter.addEventListener("change", () => {
    state.decisionFilter = els.decisionFilter.value || "all";
    if (Workspace) Workspace.setPreference("allocationDecisionFilter", state.decisionFilter);
    if (pager) pager.reset();
    renderResults();
  });
  els.density.addEventListener("click", () => {
    state.compactMode = !state.compactMode;
    state.densityManual = true;
    if (Workspace) Workspace.setPreference("allocationCompact", state.compactMode ? "compact" : "comfortable");
    renderResults();
  });
  els.batchDatabook.addEventListener("click", () => {
    const selected = selectedResults();
    openAssistantForBatch(selected).catch((error) => showToast(error.message || "O assistente em lote não pôde ser aberto.", "error"));
  });
  els.selectAll.addEventListener("change", () => {
    state.results.filter(canSelectForAllocation).forEach((result) => setResultSelection(result, els.selectAll.checked));
    renderResults();
  });
  els.tbody.addEventListener("change", (event) => {
    if (!event.target.classList.contains("allocation-check")) return;
    const row = event.target.closest("[data-allocation-document]");
    if (!row) return;
    const result = state.results.find((item) => A.key(item.document) === row.dataset.allocationDocument);
    setResultSelection(result, event.target.checked);
    renderResults();
  });
  els.tbody.addEventListener("click", (event) => {
    if (!event.target.closest("[data-databook-review]")) return;
    const row = event.target.closest("[data-allocation-document]");
    if (!row) return;
    const result = state.results.find((item) => A.key(item.document) === row.dataset.allocationDocument);
    openAssistantForResult(result).catch((error) => showToast(error.message || "O assistente não pôde ser aberto.", "error"));
  });
  els.assistantClose.addEventListener("click", closeDatabookAssistant);
  els.assistantCancel.addEventListener("click", closeDatabookAssistant);
  els.assistantOverlay.addEventListener("click", closeDatabookAssistant);
  els.reviewTitle.addEventListener("input", renderReviewTitleQuality);
  els.reviewPath.addEventListener("input", () => {
    const complete = Boolean(assistantResults().length && A.completeDatabook(els.reviewPath.value));
    els.assistantApply.disabled = !complete;
    renderAssistantComparison();
  });
  els.reviewPath.addEventListener("change", () => {
    const levels = pathLevels(els.reviewPath.value);
    if (levels.some(Boolean)) fillAssistantLevels(levels);
  });
  els.assistantApply.addEventListener("click", applyAssistantReview);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.assistantDrawer.classList.contains("open")) closeDatabookAssistant();
  });
  els.exportReport.addEventListener("click", exportAnalysisReport);
  els.exportFile.addEventListener("click", () => runExport("allocation"));
  els.exportControl.addEventListener("click", () => runExport("control"));
  els.exportPackage.addEventListener("click", () => runExport("package"));
  els.groupModeRadios.forEach((radio) => radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.groupingMode = radio.value === "single" ? "single" : "discipline";
    if (Workspace) Workspace.setPreference("allocationGroupingMode", state.groupingMode);
    renderResults();
  }));

  if (Workspace) {
    els.text.value = String(Workspace.draft("allocationText", "") || "");
    const savedDensity = Workspace.preference("allocationCompact", "");
    state.decisionFilter = Workspace.preference("allocationDecisionFilter", "all");
    state.groupingMode = Workspace.preference("allocationGroupingMode", "discipline");
    if (!["all", "ready", "reallocation", "skip", "review"].includes(state.decisionFilter)) state.decisionFilter = "all";
    if (!["discipline", "single"].includes(state.groupingMode)) state.groupingMode = "discipline";
    if (els.decisionFilter) els.decisionFilter.value = state.decisionFilter;
    els.groupModeRadios.forEach((radio) => { radio.checked = radio.value === state.groupingMode; });
    if (savedDensity === "compact" || savedDensity === "comfortable") {
      state.compactMode = savedDensity === "compact";
      state.densityManual = true;
    }
  }
  els.date.value = localDateValue();
  updateInputs();
  renderResults();
  window.RECONOutputPreviewProviders = window.RECONOutputPreviewProviders || {};
  window.RECONOutputPreviewProviders.allocation = () => {
    const selected = selectedResults();
    const plan = batchPlan(selected);
    return {
      title: "Documentos que entrarão na alocação",
      summary: `${selected.length} documento(s) · ${plan.groups.length} alocação(ões)`,
      expectedInputs: state.results.length,
      accountedInputs: state.results.length,
      requireUniqueTargets: true,
      items: plan.groups.flatMap((group) => group.results.map((result) => ({ primary: result.document, secondary: `${group.allocationCode} · ${result.document}`, meta: state.groupingMode === "single" ? "Alocação única" : `Disciplina ${group.label}` }))),
    };
  };
  window.RECONAllocation = { state, currentLdFiles, analyzeAllocation, resetAnalysis: resetAllocationAnalysis, renderResults, batchPlan, generateFiles, exportAnalysisReport };
})();
