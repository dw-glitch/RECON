(function () {
  "use strict";

  function notifyReconUi() {
    window.dispatchEvent(new CustomEvent("recon:ui-update"));
  }

  const C = window.TriagemCore;
  const L = window.ReconLdCompatibility;
  const R = window.CorporateRelationsCore;
  const Tasks = window.QualityTaskCenter;
  const DEFAULT_PAGE_SIZE = 100;
  const DRAFT_KEY = "recon.relations.filters.v2";
  const TYPE_NAMES = {
    sigem: "Status SIGEM",
    allocation_status: "Alocados e não alocados",
    allocation: "Documentos de uma alocação",
    databook: "Caminho Databook",
    comments: "Comentários da Fiscal",
    revisions: "Revisões atuais",
    grdt: "GRDTs relacionadas",
    missing: "Documentos não encontrados",
    custom: "Relação personalizada",
  };

  const state = {
    mode: "filter",
    ldFile: null,
    parsed: null,
    index: null,
    catalogRows: [],
    listFile: null,
    folderFiles: [],
    sourceRows: [],
    rows: [],
    columns: [],
    fields: [],
    search: "",
    busy: false,
    loadingLd: false,
    loadToken: 0,
    compatibilityBypassedForTitles: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    ld: $("#relations-ld"),
    ldMeta: $("#relations-ld-meta"),
    sourceState: $("#relations-source-state"),
    sourceCount: $("#relations-source-count"),
    compatibilityOpen: $("#ld-compatibility-open"),
    modeButtons: [...document.querySelectorAll("[data-mode]")],
    filterPanel: $("#filter-mode-panel"),
    documentsPanel: $("#documents-mode-panel"),
    type: $("#relations-type"),
    filterStatus: $("#filter-status"),
    filterSheet: $("#filter-sheet"),
    filterAllocationStatus: $("#filter-allocation-status"),
    filterDocumentType: $("#filter-document-type"),
    filterRevision: $("#filter-revision"),
    filterComments: $("#filter-comments"),
    filterAllocation: $("#filter-allocation"),
    filterQuery: $("#filter-query"),
    allocationOptions: $("#allocation-options"),
    text: $("#relations-text"),
    textCount: $("#relations-text-count"),
    clearText: $("#relations-clear-text"),
    folder: $("#relations-folder"),
    folderMeta: $("#relations-folder-meta"),
    clearFolder: $("#relations-clear-folder"),
    list: $("#relations-list"),
    listMeta: $("#relations-list-meta"),
    clearList: $("#relations-clear-list"),
    allocationField: $("#allocation-relation-field"),
    allocation: $("#relations-allocation"),
    customPanel: $("#custom-fields-panel"),
    customList: $("#custom-fields-list"),
    customCount: $("#custom-fields-count"),
    readyName: $("#relations-ready-name"),
    analyze: $("#relations-analyze"),
    progress: $("#relations-progress"),
    progressBar: $("#relations-progress-bar"),
    progressText: $("#relations-progress-text"),
    results: $("#relations-results"),
    resultSubtitle: $("#relations-result-subtitle"),
    countUniverse: $("#count-universe"),
    countSelected: $("#count-selected"),
    countFound: $("#count-found"),
    countMissing: $("#count-missing"),
    search: $("#relations-search"),
    resultMeta: $("#relations-result-meta"),
    export: $("#relations-export"),
    table: $("#relations-table"),
    head: $("#relations-head"),
    body: $("#relations-body"),
    empty: $("#relations-empty"),
    toast: $("#toast"),
    brandLogo: $("#brand-logo"),
    activeFilters: $("#relations-active-filters"),
    saveFilters: $("#relations-save-filters"),
    resetFilters: $("#relations-reset-filters"),
  };
  const pager = window.RECONPager && window.RECONPager.create("relations", els.resultMeta, () => renderResults(), DEFAULT_PAGE_SIZE);

  function escapeHtml(value) {
    return R.text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function showToast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = `toast show ${kind || ""}`.trim();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { els.toast.className = "toast"; }, 4200);
  }

  function setProgress(percent, message) {
    if (!els.progress) return;
    els.progress.hidden = false;
    if (els.progressBar) els.progressBar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if (els.progressText) els.progressText.textContent = message || "Processando…";
  }

  function hideProgress() {
    els.progress.hidden = true;
  }

  function yieldFrame() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  function activeModuleName() {
    const activeLink = document.querySelector('.module-link[data-module].active');
    if (activeLink && activeLink.dataset.module) return activeLink.dataset.module;
    try { return window.sessionStorage.getItem('recon.active.module.v1') || 'relations'; } catch (_) { return 'relations'; }
  }

  function titleAnalysisMode() {
    return activeModuleName() === 'titles';
  }

  function readDraft() {
    try { return JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch (_) { return {}; }
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        mode: state.mode,
        type: els.type.value,
        text: els.text.value,
        status: els.filterStatus.value,
        sheet: els.filterSheet.value,
        allocationStatus: els.filterAllocationStatus.value,
        documentType: els.filterDocumentType.value,
        revision: els.filterRevision.value,
        comments: els.filterComments.value,
        allocationFilter: els.filterAllocation.value,
        query: els.filterQuery.value,
        allocation: els.allocation.value,
        customFields: [...els.customList.querySelectorAll("input:checked")].map((input) => input.value),
      }));
    } catch (_) {
      // O armazenamento é apenas conveniência; nunca bloqueia o aplicativo.
    }
  }

  function validFolderFiles(fileList) {
    return [...(fileList || [])].filter((file) => {
      if (!file || /^~\$|^\./.test(file.name) || Number(file.size) === 0) return false;
      if (C.controlArtifactKind && C.controlArtifactKind(file.name)) return false;
      return /\.(?:pdf|docx?|xlsx?|xlsm|dwg|dgn|pptx?)$/i.test(file.name);
    });
  }

  function textLineCount() {
    return els.text.value.split(/\r?\n/).filter((line) => line.trim() && C.norm(line) !== "FIM").length;
  }

  function hasDocumentSource() {
    return Boolean(textLineCount() || state.listFile || state.folderFiles.length);
  }

  function selectedCustomFields() {
    const selected = new Set([...els.customList.querySelectorAll("input:checked")].map((input) => input.value));
    return state.fields.filter((field) => selected.has(field.key));
  }

  function selectedText(select) {
    const option = select && select.selectedOptions && select.selectedOptions[0];
    return option ? option.textContent.trim() : "";
  }

  function renderActiveFilters() {
    if (!els.activeFilters) return;
    const filters = appliedFilters().filter(([label, value]) => value && !["Origem", "Tipo de relação"].includes(label));
    els.activeFilters.innerHTML = filters.length
      ? `<span>Filtros ativos</span>${filters.map(([label, value]) => `<span class="relation-filter-chip" title="${escapeHtml(label)}: ${escapeHtml(value)}"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</span>`).join("")}`
      : '<span class="empty-filter-state">Nenhum filtro adicional aplicado</span>';
  }

  function resetRelationFilters() {
    els.filterStatus.value = "";
    els.filterAllocationStatus.value = "";
    els.filterDocumentType.value = "";
    els.filterRevision.value = "";
    els.filterComments.value = "";
    els.filterAllocation.value = "";
    els.filterQuery.value = "";
    els.search.value = "";
    state.search = "";
    if (state.mode === "documents") {
      els.text.value = "";
      state.folderFiles = [];
      state.listFile = null;
      els.folder.value = "";
      els.list.value = "";
    }
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    invalidateResults();
    updateControls();
    renderActiveFilters();
    showToast("Filtros limpos. A aba e o tipo de relação foram preservados.", "success");
  }

  function slug(value) {
    return R.text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  function compactStamp() {
    const date = new Date();
    const part = (value, size) => String(value).padStart(size || 2, "0");
    return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}_${part(date.getMilliseconds(), 3)}`;
  }

  function relationFileName(stamp) {
    const parts = ["Relacao", TYPE_NAMES[els.type.value] || "Corporativa"];
    if (state.mode === "filter" && els.filterStatus.value) parts.push(selectedText(els.filterStatus));
    if (els.type.value === "allocation" && els.allocation.value.trim()) parts.push(els.allocation.value.trim());
    return `${slug(parts.join("_"))}_${stamp || compactStamp()}.xlsx`;
  }

  function setSourceState(label, kind, detail) {
    els.sourceState.textContent = label;
    els.sourceState.className = `state-pill ${kind || "neutral"}`;
    els.sourceCount.textContent = detail || "—";
  }

  function updateControls() {
    const ldReady = Boolean(state.ldFile && state.index && state.catalogRows.length);
    const allocationMode = els.type.value === "allocation";
    const customMode = els.type.value === "custom";
    const allocationReady = !allocationMode || els.allocation.value.trim().length >= 4;
    const sheetReady = state.mode !== "filter" || allocationMode || Boolean(els.filterSheet.value);
    const inputReady = state.mode === "filter" || allocationMode || hasDocumentSource();
    const customReady = !customMode || selectedCustomFields().length > 0;
    els.filterPanel.hidden = state.mode !== "filter";
    els.documentsPanel.hidden = state.mode !== "documents";
    els.allocationField.hidden = !allocationMode;
    els.customPanel.hidden = !customMode;
    els.clearFolder.disabled = !state.folderFiles.length;
    els.clearList.disabled = !state.listFile;
    els.analyze.disabled = state.busy || !ldReady || !inputReady || !allocationReady || !customReady || !sheetReady;
    els.export.disabled = state.busy || !state.rows.length || !state.columns.length;
    els.textCount.textContent = `${textLineCount()} item${textLineCount() === 1 ? "" : "s"}`;
    els.folderMeta.textContent = state.folderFiles.length ? `${state.folderFiles.length} arquivo(s)` : "Opcional";
    els.listMeta.textContent = state.listFile ? state.listFile.name : "Opcional";
    els.customCount.textContent = `${selectedCustomFields().length} selecionada(s)`;
    renderActiveFilters();
    els.readyName.textContent = !state.ldFile ? "Aguardando LD" : !state.index ? "Lendo LD" : relationFileName();
    const missingOption = [...els.type.options].find((option) => option.value === "missing");
    if (missingOption) missingOption.disabled = state.mode === "filter";
  }

  function invalidateResults() {
    state.sourceRows = [];
    state.rows = [];
    state.columns = [];
    state.search = "";
    els.search.value = "";
    els.results.hidden = true;
    renderResults();
  }

  function optionHtml(value) {
    return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
  }

  function populateSelect(select, values, emptyLabel, savedValue) {
    const previous = savedValue !== undefined ? savedValue : select.value;
    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${(values || []).map(optionHtml).join("")}`;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function rowsInSelectedSheet() {
    const sheet = els.filterSheet.value;
    return sheet ? state.catalogRows.filter((row) => row.sheet === sheet) : [];
  }

  function populateDependentFilters(saved) {
    const scopedRows = rowsInSelectedSheet();
    const options = R.filterOptions(scopedRows);
    populateSelect(els.filterStatus, options.statuses, "Todos os status desta aba", saved && saved.status);
    populateSelect(els.filterAllocationStatus, options.allocationStatuses, "Todas as situações desta aba", saved && saved.allocationStatus);
    populateSelect(els.filterDocumentType, options.documentTypes, "Todos os tipos desta aba", saved && saved.documentType);
    populateSelect(els.filterRevision, options.revisions, "Todas as revisões desta aba", saved && saved.revision);
    els.allocationOptions.innerHTML = options.allocations.map(optionHtml).join("");
    const helper = document.getElementById("filter-sheet-help");
    if (helper) helper.textContent = els.filterSheet.value
      ? `${scopedRows.length.toLocaleString("pt-BR")} documento(s) disponíveis somente na aba ${els.filterSheet.value}.`
      : "Selecione primeiro a aba. Os demais filtros serão limitados a ela.";
  }

  function populateFilters(saved) {
    const sheets = R.filterOptions(state.catalogRows).sheets;
    const wanted = saved && sheets.includes(saved.sheet) ? saved.sheet : (sheets[0] || "");
    populateSelect(els.filterSheet, sheets, "Selecione uma aba", wanted);
    populateDependentFilters(saved);
  }

  function renderFieldOptions(saved) {
    state.fields = R.fieldOptions(state.parsed);
    const selected = new Set(saved && Array.isArray(saved.customFields) ? saved.customFields : []);
    const defaults = new Set(["document", "sheet", "title", "currentRevision", "sigemStatus"]);
    els.customList.innerHTML = state.fields.map((field) => {
      const checked = selected.size ? selected.has(field.key) : defaults.has(field.key);
      return `<label><input type="checkbox" value="${escapeHtml(field.key)}" ${checked ? "checked" : ""}><span title="${escapeHtml(field.label)}">${escapeHtml(field.label)}</span></label>`;
    }).join("");
  }

  async function readWorkbook(file) {
    if (window.RECONWorkbookWorker) return window.RECONWorkbookWorker.read(file, { cellDates: true, cellFormula: true });
    return XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, cellFormula: true });
  }

  async function buildCatalog(token) {
    if (token !== state.loadToken) return [];
    const options = { recentDays: 30, now: new Date() };
    if (window.RECONCompute) {
      setProgress(68, "Indexando relações fora da interface…");
      return window.RECONCompute.run("relations", "relations-catalog", { index: state.index, options });
    }
    return R.rowsFromIndex(state.index, options);
  }

  async function loadLd(file, interactive) {
    if (!file) return false;
    const bypassTitleAssociations = titleAnalysisMode();
    const token = ++state.loadToken;
    state.loadingLd = true;
    state.ldFile = file;
    state.parsed = null;
    state.index = null;
    state.catalogRows = [];
    els.ldMeta.textContent = file.name;
    setSourceState("Lendo LD", "loading", file.name);
    invalidateResults();
    updateControls();
    setProgress(7, "Reconhecendo a estrutura da LD…");
    try {
      if (L && !bypassTitleAssociations) {
        await L.prepare(file, { interactive: Boolean(interactive) });
        if (token !== state.loadToken) return false;
        els.compatibilityOpen.hidden = false;
        if (!L.ready(file)) {
          setSourceState("Confirmar estrutura", "loading", "Associações pendentes");
          hideProgress();
          updateControls();
          return false;
        }
      } else if (bypassTitleAssociations) {
        if (L) L.close();
        els.compatibilityOpen.hidden = true;
      }
      setProgress(34, "Lendo documentos e histórico fora da interface…");
      let parsed; let index;
      if (window.RECONWorkbookWorker && window.RECONWorkbookWorker.readLd) {
        const result = await window.RECONWorkbookWorker.readLd(file, {
          sourceName: file.name,
          sourceTimestamp: file.lastModified || 0,
          compatibilityProfile: bypassTitleAssociations ? null : (L && L.profileFor(file)),
          buildIndex: true,
        });
        parsed = result.parsed; index = result.index;
      } else {
        const workbook = !bypassTitleAssociations && L && L.workbookFor(file) || await readWorkbook(file);
        parsed = C.parseWorkbook(workbook, file.name, file.lastModified || 0, bypassTitleAssociations ? null : (L && L.profileFor(file)));
        index = C.buildIndex(parsed.records, parsed.history);
      }
      if (token !== state.loadToken) return false;
      if (!parsed.records.length) throw new Error("Nenhum documento técnico foi encontrado na LD.");
      state.parsed = parsed;
      state.index = index;
      state.compatibilityBypassedForTitles = bypassTitleAssociations;
      setProgress(54, `${state.index.documents.length} documentos localizados…`);
      state.catalogRows = await buildCatalog(token);
      if (token !== state.loadToken) return false;
      window.addEventListener("recon:module", (event) => {
    const module = event.detail && event.detail.module;
    if (module === "titles") {
      if (L) L.close();
      els.compatibilityOpen.hidden = true;
      if (state.ldFile && !state.index && !state.loadingLd) loadLd(state.ldFile, false);
      return;
    }
    if (state.ldFile && L && L.inspectionFor(state.ldFile)) els.compatibilityOpen.hidden = false;
    if ((module === "relations" || module === "databook") && state.compatibilityBypassedForTitles && state.ldFile && !state.loadingLd) {
      state.parsed = null;
      state.index = null;
      state.catalogRows = [];
      state.compatibilityBypassedForTitles = false;
      window.dispatchEvent(new CustomEvent("recon:ld-cleared", { detail: { file: state.ldFile, reason: "compatibility-required" } }));
      loadLd(state.ldFile, true);
    }
  });

  const draft = readDraft();
      populateFilters(draft);
      renderFieldOptions(draft);
      setProgress(100, "LD pronta para consulta");
      setSourceState(bypassTitleAssociations ? "LD pronta para títulos" : "LD pronta", "ready", `${state.catalogRows.length.toLocaleString("pt-BR")} documentos · ${parsed.history.length.toLocaleString("pt-BR")} registros SIGEM`);
      window.setTimeout(hideProgress, 500);
      updateControls();
      window.dispatchEvent(new CustomEvent("recon:ld-ready", { detail: {
        file: state.ldFile,
        parsed: state.parsed,
        index: state.index,
        catalogRows: state.catalogRows,
      } }));
      return true;
    } catch (error) {
      if (token !== state.loadToken) return false;
      state.parsed = null;
      state.index = null;
      state.catalogRows = [];
      hideProgress();
      setSourceState("Falha na leitura", "error", error.message || "Arquivo inválido");
      updateControls();
      window.dispatchEvent(new CustomEvent("recon:ld-cleared", { detail: { file: state.ldFile, error: error.message || "Arquivo inválido" } }));
      showToast(error.message || "A LD não pôde ser lida.", "error");
      return false;
    } finally {
      if (token === state.loadToken) state.loadingLd = false;
    }
  }

  function addEntry(target, seen, raw, origin, rowNumber) {
    const value = R.text(raw).replace(/^['"]|['"]$/g, "");
    if (!value || C.norm(value) === "FIM") return;
    const matches = state.index ? C.matchDocuments(value, state.index) : [];
    if (matches.length) {
      matches.forEach((match) => {
        if (seen.has(match.documentKey)) return;
        seen.add(match.documentKey);
        target.push({ raw: match.document, document: match.document, sheetName: origin, rowNumber });
      });
      return;
    }
    const rawKey = `raw::${C.norm(value)}`;
    if (seen.has(rawKey)) return;
    seen.add(rawKey);
    target.push({ raw: value, sheetName: origin, rowNumber });
  }

  function textEntries(target, seen) {
    els.text.value.replace(/\r/g, "").split("\n").forEach((line, index) => {
      const clean = line.trim().replace(/^\s*(?:[-•●▪◦]+\s*|\d+[.)-]\s+)/, "");
      if (!clean) return;
      const parts = clean.split(/[\t;|]+/).map((part) => part.trim()).filter(Boolean);
      (parts.length > 1 ? parts : [clean]).forEach((part) => addEntry(target, seen, part, "Entrada por texto", index + 1));
    });
  }

  function folderEntries(target, seen) {
    state.folderFiles.forEach((file, index) => addEntry(target, seen, file.name, file.webkitRelativePath || "Pasta documental", index + 1));
  }

  async function listEntries(target, seen) {
    if (!state.listFile) return;
    const workbook = await readWorkbook(state.listFile);
    (workbook.SheetNames || []).forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet["!ref"]) return;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      let headerRow = -1;
      let columns = [];
      for (let row = 0; row < Math.min(rows.length, 40); row += 1) {
        const found = (rows[row] || []).map((value, column) => ({ value: C.norm(value), column })).filter((item) => (
          item.value === "DOCUMENTO" || item.value === "NOMEDOCUMENTO" || item.value === "CODIGO" || item.value === "CODIGO DO DOCUMENTO"
          || item.value === "ARQUIVO" || item.value === "PDF" || item.value === "NOME DO ARQUIVO" || item.value === "NOME DO PDF"
        ));
        if (found.length) { headerRow = row; columns = found.map((item) => item.column); break; }
      }
      if (headerRow >= 0) {
        for (let row = headerRow + 1; row < rows.length; row += 1) columns.forEach((column) => addEntry(target, seen, rows[row] && rows[row][column], `${state.listFile.name} · ${sheetName}`, row + 1));
      } else {
        rows.forEach((row, rowIndex) => (row || []).forEach((value) => {
          if (state.index && C.matchDocuments(value, state.index).length) addEntry(target, seen, value, `${state.listFile.name} · ${sheetName}`, rowIndex + 1);
        }));
      }
    });
  }

  async function collectEntries() {
    const entries = [];
    const seen = new Set();
    textEntries(entries, seen);
    folderEntries(entries, seen);
    await listEntries(entries, seen);
    return entries;
  }

  function currentFilters() {
    return {
      status: els.filterStatus.value,
      sheet: els.filterSheet.value,
      allocationStatus: els.filterAllocationStatus.value,
      documentType: els.filterDocumentType.value,
      revision: els.filterRevision.value,
      comments: els.filterComments.value,
      allocation: els.filterAllocation.value.trim(),
      query: els.filterQuery.value.trim(),
    };
  }

  async function analyze() {
    if (state.busy || !state.index) return;
    state.busy = true;
    const taskId = Tasks ? Tasks.start("Gerar relação corporativa", state.ldFile && state.ldFile.name) : "";
    updateControls();
    setProgress(10, "Preparando a relação…");
    try {
      const type = els.type.value;
      let sourceRows = [];
      if (type === "allocation") {
        setProgress(48, "Localizando documentos da alocação…");
        sourceRows = window.RECONCompute ? await window.RECONCompute.run("relations", "relations-filter", { rows: state.catalogRows, filters: { allocation: els.allocation.value.trim() } }) : R.filterRows(state.catalogRows, { allocation: els.allocation.value.trim() });
      } else if (state.mode === "filter") {
        setProgress(52, "Aplicando filtros à LD…");
        sourceRows = window.RECONCompute ? await window.RECONCompute.run("relations", "relations-filter", { rows: state.catalogRows, filters: currentFilters() }) : R.filterRows(state.catalogRows, currentFilters());
      } else {
        setProgress(36, "Lendo texto, pasta e Excel…");
        const entries = await collectEntries();
        if (!entries.length) throw new Error("Informe ao menos um documento por texto, pasta ou Excel.");
        setProgress(66, `Consultando ${entries.length} item(ns) na LD…`);
        sourceRows = window.RECONCompute ? await window.RECONCompute.run("relations", "relations-resolve", { entries, index: state.index, options: { recentDays: 30, now: new Date() } }) : R.resolveEntries(entries, state.index, { recentDays: 30, now: new Date() });
      }
      state.sourceRows = sourceRows;
      state.rows = R.rowsForType(sourceRows, type);
      state.columns = R.columnsFor(type, selectedCustomFields());
      state.search = "";
      els.search.value = "";
      if (pager) pager.reset();
      els.results.hidden = false;
      renderResults();
      setProgress(100, "Relação pronta");
      window.setTimeout(hideProgress, 450);
      showToast(`${state.rows.length.toLocaleString("pt-BR")} linha(s) na relação.`, state.rows.length ? "success" : "warn");
      if (Tasks) Tasks.finish(taskId, `${state.rows.length.toLocaleString("pt-BR")} linha(s)`);
      saveDraft();
    } catch (error) {
      if (Tasks) Tasks.fail(taskId, error);
      hideProgress();
      invalidateResults();
      showToast(error.message || "Não foi possível gerar a relação.", "error");
    } finally {
      state.busy = false;
      updateControls();
    }
  }

  function visibleRows() {
    const query = C.norm(state.search);
    if (!query) return state.rows;
    return state.rows.filter((row) => C.norm(state.columns.map((column) => column.value(row)).join(" ")).includes(query));
  }

  function statusClass(value) {
    const kind = C.statusKind(value);
    if (kind === "not_posted" || kind === "closed") return "ready";
    if (kind === "analysis") return "analysis";
    if (kind === "advance") return "feedback";
    return "neutral";
  }

  function renderResults() {
    const found = state.sourceRows.filter((row) => row.found).length;
    const missing = state.sourceRows.filter((row) => !row.found).length;
    const universe = state.mode === "filter" ? rowsInSelectedSheet().length : state.catalogRows.length;
    els.countUniverse.textContent = universe.toLocaleString("pt-BR");
    els.countSelected.textContent = state.sourceRows.length.toLocaleString("pt-BR");
    els.countFound.textContent = found.toLocaleString("pt-BR");
    els.countMissing.textContent = missing.toLocaleString("pt-BR");
    els.resultSubtitle.textContent = `${TYPE_NAMES[els.type.value] || "Relação"} · ${state.mode === "filter" ? `aba ${els.filterSheet.value || "não selecionada"}` : "por documentos"}`;
    els.head.innerHTML = state.columns.length ? `<tr>${state.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>` : "";
    const visible = visibleRows();
    const preview = pager ? pager.slice(visible) : visible.slice(0, DEFAULT_PAGE_SIZE);
    els.body.innerHTML = preview.map((row) => `<tr class="${row.found ? "" : "missing"}">${state.columns.map((column) => {
      const raw = column.value(row);
      const value = raw || "—";
      const isStatus = column.key === "sigemStatus" || column.key === "nextStatus" || column.key === "allocationStatus";
      return `<td>${isStatus && raw ? `<span class="status-value ${statusClass(raw)}" title="${escapeHtml(value)}">${escapeHtml(value)}</span>` : `<span title="${escapeHtml(value)}">${escapeHtml(value)}</span>`}</td>`;
    }).join("")}</tr>`).join("");
    els.empty.hidden = preview.length > 0;
    els.resultMeta.textContent = `${visible.length.toLocaleString("pt-BR")} linha${visible.length === 1 ? "" : "s"} · relatório Excel completo`;
    els.table.style.minWidth = `${Math.max(900, state.columns.length * 170)}px`;
    updateControls();
  
    notifyReconUi();
  }

  function excelColumnLetter(number) {
    let value = Number(number);
    let result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  async function logoDefinition(workbook) {
    if (window.RECONBrand?.addReportLogo) return window.RECONBrand.addReportLogo(workbook);
    try {
      const response = await window.fetch("recon-logo-report.png", { cache: "no-store" });
      if (response.ok) return workbook.addImage({ buffer: await response.arrayBuffer(), extension: "png" });
    } catch (_) {
      // O relatório continua íntegro mesmo sem imagem.
    }
    return null;
  }

  function appliedFilters() {
    const filters = [["Origem", state.mode === "filter" ? "LD inteira por filtros" : "Lista de documentos"], ["Tipo de relação", TYPE_NAMES[els.type.value] || els.type.value]];
    if (state.mode === "filter") {
      if (els.filterStatus.value) filters.push(["Status SIGEM", selectedText(els.filterStatus)]);
      if (els.filterSheet.value) filters.push(["Aba LD", selectedText(els.filterSheet)]);
      if (els.filterAllocationStatus.value) filters.push(["Situação de alocação", selectedText(els.filterAllocationStatus)]);
      if (els.filterDocumentType.value) filters.push(["Tipo de documento", selectedText(els.filterDocumentType)]);
      if (els.filterRevision.value) filters.push(["Revisão", selectedText(els.filterRevision)]);
      if (els.filterComments.value) filters.push(["Comentário da Fiscal", selectedText(els.filterComments)]);
      if (els.filterAllocation.value.trim()) filters.push(["Alocação contém", els.filterAllocation.value.trim()]);
      if (els.filterQuery.value.trim()) filters.push(["Documento ou título contém", els.filterQuery.value.trim()]);
    } else {
      if (textLineCount()) filters.push(["Entrada por texto", `${textLineCount()} item(s)`]);
      if (state.folderFiles.length) filters.push(["Pasta documental", `${state.folderFiles.length} arquivo(s)`]);
      if (state.listFile) filters.push(["Lista Excel", state.listFile.name]);
    }
    if (els.type.value === "allocation") filters.push(["Alocação da relação", els.allocation.value.trim()]);
    return filters;
  }

  function statusDistribution() {
    const counts = new Map();
    state.rows.forEach((row) => {
      const value = R.text(row.sigemStatus) || "Não informado";
      const normalized = C.norm(value);
      if (!counts.has(normalized)) counts.set(normalized, { label: value, count: 0 });
      counts.get(normalized).count += 1;
    });
    return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"));
  }

  function fillRange(sheet, range, argb) {
    const decoded = XLSX.utils.decode_range(range);
    for (let row = decoded.s.r + 1; row <= decoded.e.r + 1; row += 1) for (let column = decoded.s.c + 1; column <= decoded.e.c + 1; column += 1) {
      sheet.getCell(row, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    }
  }

  function mergeCard(sheet, range, label, value, accent) {
    sheet.mergeCells(range);
    const start = range.split(":")[0];
    const cell = sheet.getCell(start);
    cell.value = { richText: [
      { font: { name: "Aptos", size: 9, bold: true, color: { argb: "FF6F7E8C" } }, text: `${label}\n` },
      { font: { name: "Aptos Display", size: 19, bold: true, color: { argb: accent } }, text: String(value) },
    ] };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    fillRange(sheet, range, "FFF5F8FA");
    cell.border = { left: { style: "medium", color: { argb: accent } } };
  }

  function workbookValue(column, value) {
    const raw = R.text(value);
    if (!raw) return null;
    if (/DATA/.test(C.norm(column.label))) {
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return Math.floor(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000) + 25569;
    }
    return raw;
  }

  async function buildWorkbook(outputName) {
    if (!state.rows.length || !state.columns.length) throw new Error("Gere uma prévia com resultados antes de baixar.");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RECON";
    workbook.lastModifiedBy = "RECON";
    workbook.company = "CONSAG Engenharia";
    workbook.subject = TYPE_NAMES[els.type.value] || "Relação corporativa";
    workbook.title = (outputName || relationFileName()).replace(/\.xlsx$/i, "");
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    const logoId = await logoDefinition(workbook);

    const summary = workbook.addWorksheet("Resumo", { properties: { defaultRowHeight: 18 } });
    summary.views = [{ showGridLines: false, zoomScale: 100, zoomScaleNormal: 100 }];
    summary.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: .3, right: .3, top: .45, bottom: .45, header: .2, footer: .2 } };
    summary.mergeCells("C1:H2");
    fillRange(summary, "A1:H3", "FF153A5C");
    const summaryTitle = summary.getCell("C1");
    summaryTitle.value = `RECON · ${TYPE_NAMES[els.type.value] || "Relação corporativa"}`;
    summaryTitle.font = { name: "Aptos Display", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
    summaryTitle.alignment = { vertical: "middle", horizontal: "left" };
    summary.mergeCells("A4:H4");
    summary.getCell("A4").value = `LD: ${state.ldFile.name}  ·  Gerado em ${new Date().toLocaleString("pt-BR")}`;
    summary.getCell("A4").font = { name: "Aptos", size: 9, color: { argb: "FF52687B" } };
    summary.getCell("A4").alignment = { vertical: "middle", horizontal: "left" };
    summary.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0F4" } };
    summary.getRow(1).height = 29;
    summary.getRow(2).height = 29;
    summary.getRow(3).height = 8;
    summary.getRow(4).height = 24;
    if (logoId !== null) summary.addImage(logoId, { tl: { col: .12, row: .18 }, ext: { width: 158, height: 58 } });
    mergeCard(summary, "A6:B8", "UNIVERSO DA LD", state.catalogRows.length.toLocaleString("pt-BR"), "FF246FA3");
    mergeCard(summary, "C6:D8", "SELECIONADOS", state.sourceRows.length.toLocaleString("pt-BR"), "FF246FA3");
    mergeCard(summary, "E6:F8", "LOCALIZADOS", state.sourceRows.filter((row) => row.found).length.toLocaleString("pt-BR"), "FF0C7657");
    mergeCard(summary, "G6:H8", "NÃO ENCONTRADOS", state.sourceRows.filter((row) => !row.found).length.toLocaleString("pt-BR"), "FFA56812");

    summary.mergeCells("A10:D10");
    summary.getCell("A10").value = "CRITÉRIOS APLICADOS";
    summary.getCell("A10").font = { name: "Aptos", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    summary.getCell("A10").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24689A" } };
    summary.mergeCells("F10:H10");
    summary.getCell("F10").value = "DISTRIBUIÇÃO POR STATUS";
    summary.getCell("F10").font = { name: "Aptos", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    summary.getCell("F10").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24689A" } };
    const filters = appliedFilters();
    filters.forEach(([label, value], index) => {
      const row = 11 + index;
      summary.mergeCells(`A${row}:B${row}`);
      summary.mergeCells(`C${row}:D${row}`);
      summary.getCell(`A${row}`).value = label;
      summary.getCell(`C${row}`).value = value;
      summary.getCell(`A${row}`).font = { name: "Aptos", size: 9, bold: true, color: { argb: "FF53697B" } };
      summary.getCell(`C${row}`).font = { name: "Aptos", size: 9, color: { argb: "FF263E52" } };
      summary.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF7F9FB" : "FFFFFFFF" } };
      summary.getCell(`C${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF7F9FB" : "FFFFFFFF" } };
    });
    statusDistribution().slice(0, 12).forEach((item, index) => {
      const row = 11 + index;
      summary.mergeCells(`F${row}:G${row}`);
      summary.getCell(`F${row}`).value = item.label;
      summary.getCell(`H${row}`).value = item.count;
      summary.getCell(`F${row}`).font = { name: "Aptos", size: 9, color: { argb: "FF2D4559" } };
      summary.getCell(`H${row}`).font = { name: "Aptos", size: 9, bold: true, color: { argb: "FF153A5C" } };
      summary.getCell(`H${row}`).numFmt = "#,##0";
      summary.getCell(`H${row}`).alignment = { horizontal: "right" };
      ["F", "H"].forEach((column) => { summary.getCell(`${column}${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF7F9FB" : "FFFFFFFF" } }; });
    });
    [15, 15, 22, 22, 3, 23, 23, 12].forEach((width, index) => { summary.getColumn(index + 1).width = width; });
    summary.headerFooter.oddFooter = "&LRECON&C&P de &N&R&D";

    const relation = workbook.addWorksheet("Relação", { properties: { defaultRowHeight: 18 } });
    relation.views = [{ state: "frozen", ySplit: 6, activeCell: "A7", showGridLines: false, zoomScale: 90, zoomScaleNormal: 90 }];
    relation.pageSetup = { orientation: state.columns.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .25, right: .25, top: .45, bottom: .45, header: .2, footer: .2 } };
    const lastColumn = excelColumnLetter(state.columns.length);
    fillRange(relation, `A1:${lastColumn}3`, "FF153A5C");
    const titleStart = state.columns.length >= 3 ? "C1" : "A1";
    relation.mergeCells(`${titleStart}:${lastColumn}2`);
    relation.getCell(titleStart).value = `RECON · ${TYPE_NAMES[els.type.value] || "Relação corporativa"}`;
    relation.getCell(titleStart).font = { name: "Aptos Display", size: 17, bold: true, color: { argb: "FFFFFFFF" } };
    relation.getCell(titleStart).alignment = { vertical: "middle", horizontal: "left" };
    relation.mergeCells(`A4:${lastColumn}4`);
    relation.getCell("A4").value = `${state.rows.length.toLocaleString("pt-BR")} linha(s)  ·  LD: ${state.ldFile.name}  ·  ${appliedFilters().map(([label, value]) => `${label}: ${value}`).join("  |  ")}`;
    relation.getCell("A4").font = { name: "Aptos", size: 9, color: { argb: "FF536679" } };
    relation.getCell("A4").alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    relation.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0F4" } };
    relation.getRow(1).height = 28;
    relation.getRow(2).height = 28;
    relation.getRow(3).height = 7;
    relation.getRow(4).height = 34;
    relation.getRow(5).height = 8;
    if (logoId !== null && state.columns.length >= 3) relation.addImage(logoId, { tl: { col: .12, row: .18 }, ext: { width: 158, height: 58 } });

    const seenHeaders = new Map();
    const headers = state.columns.map((column) => {
      const base = column.label;
      const normalized = C.norm(base);
      const count = (seenHeaders.get(normalized) || 0) + 1;
      seenHeaders.set(normalized, count);
      return count === 1 ? base : `${base} (${count})`;
    });
    const rows = state.rows.map((row) => state.columns.map((column) => workbookValue(column, column.value(row))));
    relation.addTable({
      name: "TabelaRelacaoRECON",
      ref: "A6",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
      columns: headers.map((name) => ({ name, filterButton: true })),
      rows,
    });
    relation.getRow(6).height = 32;
    relation.getRow(6).eachCell((cell) => {
      cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });
    const statusColumns = state.columns.map((column, index) => ({ key: column.key, index: index + 1 })).filter((item) => ["sigemStatus", "nextStatus", "allocationStatus"].includes(item.key));
    for (let index = 0; index < state.rows.length; index += 1) {
      const excelRow = relation.getRow(index + 7);
      excelRow.height = 28;
      excelRow.eachCell((cell) => {
        cell.font = { name: "Aptos", size: 9.5, color: { argb: state.rows[index].found ? "FF263C50" : "FF8D4136" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = { bottom: { style: "hair", color: { argb: "FFD9E1E8" } } };
        if (!state.rows[index].found) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF1ED" } };
      });
      statusColumns.forEach((statusColumn) => {
        const cell = excelRow.getCell(statusColumn.index);
        const kind = statusClass(cell.value);
        const palette = kind === "ready" ? ["FFEAF7F1", "FF0C7657"] : kind === "analysis" ? ["FFFFEEE7", "FFA1492C"] : kind === "feedback" ? ["FFFFF5DF", "FFA56812"] : ["FFEDF2F5", "FF617383"];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette[0] } };
        cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: palette[1] } };
      });
    }
    state.columns.forEach((column, index) => {
      const sample = state.rows.slice(0, 800).map((row) => R.text(column.value(row)));
      const longest = Math.max(column.label.length, ...sample.map((value) => Math.min(70, value.length)));
      const normalized = C.norm(column.label);
      let minimum = 14;
      let maximum = 32;
      if (/TITULO|CAMINHO|COMENTARIO|OBSERVACAO|MOTIVO|DESCRICAO/.test(normalized)) maximum = 46;
      else if (/DOCUMENTO|ARQUIVO|GRDT|ALOCACAO/.test(normalized)) maximum = 32;
      else if (/DATA/.test(normalized)) { minimum = 16; maximum = 18; }
      else if (/STATUS|REVISAO|ITEM|EAP|NIVEL/.test(normalized)) maximum = 20;
      relation.getColumn(index + 1).width = Math.max(minimum, Math.min(maximum, longest + 2));
      if (/DATA/.test(normalized)) relation.getColumn(index + 1).numFmt = "dd/mm/yyyy";
    });
    relation.pageSetup.printTitlesRow = "6:6";
    relation.pageSetup.horizontalCentered = true;
    relation.headerFooter.oddFooter = "&LRECON · Relação&C&P de &N&R&D";
    return workbook.xlsx.writeBuffer();
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

  async function exportWorkbook() {
    if (state.busy) return;
    state.busy = true;
    updateControls();
    const original = els.export.textContent;
    els.export.textContent = "Gerando…";
    const taskId = Tasks ? Tasks.start("Exportar relação corporativa", `${state.rows.length} linha(s)`) : "";
    try {
      const outputName = relationFileName(compactStamp());
      const buffer = await buildWorkbook(outputName);
      downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), outputName);
      showToast("Excel profissional gerado com resumo e filtros.", "success");
      if (Tasks) Tasks.finish(taskId, "Excel profissional gerado");
    } catch (error) {
      if (Tasks) Tasks.fail(taskId, error);
      showToast(error.message || "Não foi possível gerar o Excel.", "error");
    } finally {
      state.busy = false;
      els.export.textContent = original;
      updateControls();
    }
  }

  function setMode(mode, persist) {
    state.mode = mode === "documents" ? "documents" : "filter";
    els.modeButtons.forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (state.mode === "filter" && els.type.value === "missing") els.type.value = "sigem";
    invalidateResults();
    updateControls();
    if (persist !== false) saveDraft();
  }

  let autoTimer = 0;
  function scheduleAutoAnalyze(delay) {
    if (state.mode !== "filter" || !state.index || state.busy) return;
    window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(() => { if (!els.analyze.disabled) analyze(); }, delay || 160);
  }

  els.ld.addEventListener("change", () => loadLd(els.ld.files && els.ld.files[0] || null, true));
  els.compatibilityOpen.addEventListener("click", () => { if (state.ldFile && L) L.open(state.ldFile); });
  els.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  els.filterSheet.addEventListener("change", () => {
    invalidateResults();
    populateDependentFilters({});
    saveDraft();
    updateControls();
    scheduleAutoAnalyze(120);
  });
  [els.filterStatus, els.filterAllocationStatus, els.filterDocumentType, els.filterRevision, els.filterComments].forEach((select) => select.addEventListener("change", () => { invalidateResults(); saveDraft(); scheduleAutoAnalyze(120); }));
  [els.filterAllocation, els.filterQuery].forEach((input) => input.addEventListener("input", () => { invalidateResults(); saveDraft(); scheduleAutoAnalyze(360); }));
  els.type.addEventListener("change", () => { invalidateResults(); updateControls(); saveDraft(); if (state.mode === "filter") scheduleAutoAnalyze(120); });
  els.allocation.addEventListener("input", () => { invalidateResults(); updateControls(); saveDraft(); scheduleAutoAnalyze(360); });
  els.text.addEventListener("input", () => { invalidateResults(); updateControls(); saveDraft(); });
  els.clearText.addEventListener("click", () => { els.text.value = ""; invalidateResults(); updateControls(); saveDraft(); els.text.focus(); });
  els.folder.addEventListener("change", () => { state.folderFiles = validFolderFiles(els.folder.files); invalidateResults(); updateControls(); });
  els.clearFolder.addEventListener("click", () => { els.folder.value = ""; state.folderFiles = []; invalidateResults(); updateControls(); });
  els.list.addEventListener("change", () => { state.listFile = els.list.files && els.list.files[0] || null; invalidateResults(); updateControls(); });
  els.clearList.addEventListener("click", () => { els.list.value = ""; state.listFile = null; invalidateResults(); updateControls(); });
  els.customList.addEventListener("change", () => { invalidateResults(); updateControls(); saveDraft(); scheduleAutoAnalyze(120); });
  els.analyze.addEventListener("click", analyze);
  els.search.addEventListener("input", () => { state.search = els.search.value; if (pager) pager.reset(); renderResults(); });
  els.export.addEventListener("click", exportWorkbook);
  if (els.saveFilters) els.saveFilters.addEventListener("click", () => { saveDraft(); renderActiveFilters(); showToast("Combinação de filtros salva neste navegador.", "success"); });
  if (els.resetFilters) els.resetFilters.addEventListener("click", resetRelationFilters);
  document.addEventListener("recon:ld-compatibility", (event) => {
    if (titleAnalysisMode()) return;
    if (!event.detail || event.detail.file !== state.ldFile) return;
    if (event.detail.ready && !state.index && !state.loadingLd) loadLd(event.detail.file, false);
    else updateControls();
  });

  window.addEventListener("recon:module", (event) => {
    const module = event.detail && event.detail.module;
    if (module === "titles") {
      if (L) L.close();
      els.compatibilityOpen.hidden = true;
      if (state.ldFile && !state.index && !state.loadingLd) loadLd(state.ldFile, false);
      return;
    }
    if (state.ldFile && L && L.inspectionFor(state.ldFile)) els.compatibilityOpen.hidden = false;
    if ((module === "relations" || module === "databook") && state.compatibilityBypassedForTitles && state.ldFile && !state.loadingLd) {
      state.parsed = null;
      state.index = null;
      state.catalogRows = [];
      state.compatibilityBypassedForTitles = false;
      window.dispatchEvent(new CustomEvent("recon:ld-cleared", { detail: { file: state.ldFile, reason: "compatibility-required" } }));
      loadLd(state.ldFile, true);
    }
  });

  const draft = readDraft();
  if ([...els.type.options].some((option) => option.value === draft.type)) els.type.value = draft.type;
  els.text.value = R.text(draft.text);
  els.filterComments.value = ["yes", "no"].includes(draft.comments) ? draft.comments : "";
  els.filterAllocation.value = R.text(draft.allocationFilter);
  els.filterQuery.value = R.text(draft.query);
  els.allocation.value = R.text(draft.allocation);
  setMode(draft.mode, false);
  updateControls();
  renderActiveFilters();
  renderResults();

  window.RECONOutputPreviewProviders = window.RECONOutputPreviewProviders || {};
  window.RECONOutputPreviewProviders.relations = () => ({
    title: "Linhas que entrarão na relação",
    summary: `${state.rows.length} linha(s) no Excel`,
    // A relação pode ser um recorte intencional (por exemplo, somente os
    // documentos não encontrados). A conferência deve comparar a saída com o
    // resultado filtrado, não com todas as linhas lidas da LD.
    expectedInputs: state.rows.length,
    accountedInputs: state.rows.length,
    requireUniqueTargets: false,
    counts: [
      { label: "Linhas consultadas", value: state.sourceRows.length },
      { label: "Linhas na relação", value: state.rows.length },
    ],
    items: state.rows.map((row, index) => {
      const document = R.text(row.document || row.record && row.record.document || row.input || `Linha ${index + 1}`);
      return { primary: document, secondary: "Relação em Excel", meta: row.found === false ? "Não encontrado na LD" : "Localizado" };
    }),
  });

  window.RECONRelations = { state, loadLd, analyze, buildWorkbook, collectEntries, appliedFilters };
})();
