/* RECON 1.26.24 — busca de títulos por TAG + EAP em duas bases, com fallback controlado. */
(function () {
  "use strict";

  function notifyReconUi() {
    window.dispatchEvent(new CustomEvent("recon:ui-update"));
  }

  const Q = window.RECONAuditCore;
  const C = window.TriagemCore;
  const A = window.AllocationCore;
  const Tasks = window.QualityTaskCenter;
  const TitleWriter = window.RECONTitleWriter;
  const Contracts = window.RECONContracts;
  const ExportGuard = window.RECONExportGuard;
  const PendingCore = window.RECONPendingCore;
  const AllocationSources = window.RECONDatabookAllocationSources;
  const DatabookWriter = window.RECONDatabookWriter;
  const DEFAULT_PAGE_SIZE = 100;
  const TITLE_FILTER_KEY = "recon.titles.filters.v2";
  try { window.localStorage.removeItem("recon.audit.decisions.v1"); } catch (_) { /* limpeza de versão anterior */ }

  const state = {
    file: null,
    fileHandle: null,
    parsed: null,
    index: null,
    catalog: [...(window.RECON_DATABOOK_CATALOG || [])],
    databookReferenceFile: null,
    titleReferenceFile: null,
    titleReferences: null,
    titleSupplementalReferences: null,
    sconEscopoTitleReferences: null,
    tagReferenceTitleReferences: null,
    sconReferenceFile: null,
    sconTitleReferences: null,
    titleBaseLoading: true,
    titleScopeMode: "all",
    titleSourceMode: "auto",
    titleCodeFile: null,
    titleCodeFileEntries: [],
    titleRequestedCodes: [],
    titleMatchedCodes: [],
    titleUnmatchedCodes: [],
    databookRows: [],
    databookSourceRows: { confirmation: [], allocation: [] },
    databookSourceRejected: { confirmation: [], allocation: [] },
    databookSourceIndex: AllocationSources ? AllocationSources.buildIndex([]) : null,
    databookSourceFiles: { confirmation: [], allocation: [] },
    titleRows: [],
    databookSelected: new Set(),
    titleSelected: new Set(),
    busyKinds: new Set(),
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    toast: $("#toast"),
    logo: $("#brand-logo"),
    dbReference: $("#databook-reference"), dbReferenceMeta: $("#databook-reference-meta"), dbBaseStatus: $("#databook-base-status"),
    dbConfirmationFolder: $("#databook-confirmation-folder"), dbConfirmationMeta: $("#databook-confirmation-meta"),
    dbAllocationFolder: $("#databook-allocation-folder"), dbAllocationMeta: $("#databook-allocation-meta"), dbControlledStatus: $("#databook-controlled-status"),
    dbAnalyze: $("#databook-analyze"), dbReady: $("#databook-ready-name"), dbProgress: $("#databook-progress"), dbProgressBar: $("#databook-progress-bar"), dbProgressText: $("#databook-progress-text"),
    dbResults: $("#databook-results"), dbExport: $("#databook-export"), dbApplyLd: $("#databook-apply-ld"), dbApplyLdInplace: $("#databook-apply-ld-inplace"), dbSearch: $("#databook-search"), dbIssue: $("#databook-issue"), dbSheet: $("#databook-sheet"), dbConfidence: $("#databook-confidence"), dbMeta: $("#databook-result-meta"), dbBody: $("#databook-body"), dbEmpty: $("#databook-empty"),
    dbSelectVisible: $("#databook-select-visible"), dbSelectedCount: $("#databook-selected-count"), dbApproveSelected: $("#databook-approve-selected"), dbKeepSelected: $("#databook-keep-selected"),
    titleReference: $("#title-reference"), titleReferenceMeta: $("#title-reference-meta"), titleBaseStatus: $("#title-base-status"),
    titleSconReference: $("#title-scon-reference"), titleSconReferenceMeta: $("#title-scon-reference-meta"),
    titleMemoryCount: $("#title-memory-count"), titleMemoryClear: $("#title-memory-clear"),
    titleScopeRadios: [...document.querySelectorAll('input[name="title-scope-mode"]')], titleSourceRadios: [...document.querySelectorAll('input[name="title-source-mode"]')], titleCodeLoader: $("#title-code-loader"), titleCodeText: $("#title-code-text"), titleCodeFile: $("#title-code-file"), titleCodeFileMeta: $("#title-code-file-meta"), titleCodeMeta: $("#title-code-meta"), titleCodeClear: $("#title-code-clear"), titleCodePrepare: $("#title-code-prepare"),
    titleAnalyze: $("#title-analyze"), titleReady: $("#title-ready-name"), titleProgress: $("#title-progress"), titleProgressBar: $("#title-progress-bar"), titleProgressText: $("#title-progress-text"),
    titleResults: $("#title-results"), titleExport: $("#title-export"), titleApplyLd: $("#title-apply-ld"), titleApplyLdInplace: $("#title-apply-ld-inplace"), titleSearch: $("#title-search"), titleIssue: $("#title-issue"), titleSheet: $("#title-sheet"), titleSource: $("#title-source-filter"), titleConfidence: $("#title-confidence"), titleMeta: $("#title-result-meta"), titleBody: $("#title-body"), titleEmpty: $("#title-empty"),
    titleSelectVisible: $("#title-select-visible"), titleSelectedCount: $("#title-selected-count"), titleApproveSelected: $("#title-approve-selected"), titleKeepSelected: $("#title-keep-selected"),
  };
  const dbPager = window.RECONPager && window.RECONPager.create("databook", els.dbMeta, () => renderDatabook(), DEFAULT_PAGE_SIZE);
  const titlePager = window.RECONPager && window.RECONPager.create("titles", els.titleMeta, () => renderTitles(), DEFAULT_PAGE_SIZE);

  function escapeHtml(value) {
    return Q.text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function compactStamp() {
    const date = new Date();
    const part = (value, size) => String(value).padStart(size || 2, "0");
    return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}_${part(date.getMilliseconds(), 3)}`;
  }

  function safeStem(value) {
    return Q.text(value).replace(/\.(?:xlsx|xlsm|xls)$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "LD";
  }

  function showToast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = `toast show ${kind || ""}`.trim();
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { els.toast.className = "toast"; }, 4200);
  }

  function setProgress(kind, percent, message) {
    const progress = kind === "databook" ? els.dbProgress : els.titleProgress;
    const bar = kind === "databook" ? els.dbProgressBar : els.titleProgressBar;
    const textNode = kind === "databook" ? els.dbProgressText : els.titleProgressText;
    if (!progress) return;
    progress.hidden = false;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    if (textNode) textNode.textContent = message || "Processando…";
  }

  function hideProgress(kind) {
    (kind === "databook" ? els.dbProgress : els.titleProgress).hidden = true;
  }

  function yieldFrame() {
    return new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  async function readWorkbook(file) {
    if (window.RECONWorkbookWorker) return window.RECONWorkbookWorker.read(file, { cellDates: true, cellFormula: true });
    const buffer = window.RECONFileAccess ? await window.RECONFileAccess.readArrayBuffer(file) : await file.arrayBuffer();
    return XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
  }

  function titleScopeSpecific() {
    return state.titleScopeMode === "specific";
  }

  function cleanRequestedCode(value) {
    return Q.text(value)
      .replace(/^[\'"`]+|[\'"`]+$/g, "")
      .replace(/^.*[\\/]/, "")
      .replace(/\.(?:pdf|docx?|xlsx?|xlsm|dwg|dgn|pptx?|csv|txt)$/i, "")
      .trim();
  }

  function splitRequestedCodes(value) {
    const seen = new Set();
    const result = [];
    String(value || "").split(/[\r\n;\t]+/).forEach((part) => {
      const clean = cleanRequestedCode(part);
      const key = C.key(clean);
      if (!clean || key.length < 6 || seen.has(key)) return;
      seen.add(key);
      result.push(clean);
    });
    return result;
  }

  function titleScopeCandidates() {
    const textCodes = splitRequestedCodes(els.titleCodeText && els.titleCodeText.value);
    const all = [...state.titleCodeFileEntries, ...textCodes];
    const seen = new Set();
    return all.filter((value) => {
      const key = C.key(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function matchRequestedCode(requestedCode) {
    if (!state.index) return [];
    const requestedKey = C.key(requestedCode);
    if (!requestedKey) return [];
    const reverseMatches = (state.index.documents || []).filter((item) => {
      const source = C.key(item.documentKey || item.document);
      let position = source.indexOf(requestedKey);
      while (position >= 0) {
        const before = position > 0 ? source[position - 1] : "";
        const afterPosition = position + requestedKey.length;
        const after = afterPosition < source.length ? source[afterPosition] : "";
        if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return true;
        position = source.indexOf(requestedKey, position + 1);
      }
      return false;
    });
    const directMatches = C.matchDocuments(requestedCode, state.index) || [];
    const unique = new Map();
    [...reverseMatches, ...directMatches].forEach((item) => unique.set(item.documentKey, item));
    const candidates = [...unique.values()];
    return candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate
      && other.documentKey.length < candidate.documentKey.length
      && candidate.documentKey.includes(other.documentKey)
      && other.documentKey.includes(requestedKey)
    )));
  }

  function resolveTitleScope() {
    const requested = titleScopeCandidates();
    const matched = [];
    const unmatched = [];
    requested.forEach((requestedCode) => {
      const matches = matchRequestedCode(requestedCode);
      if (matches.length === 1) {
        matched.push({ requestedCode, document: matches[0].document, documentKey: matches[0].documentKey, sheet: matches[0].group && matches[0].group.records && matches[0].group.records[0] && matches[0].group.records[0].sheet || "" });
      } else if (matches.length > 1) {
        unmatched.push({ requestedCode, reason: "Mais de um documento da LD corresponde ao código informado." });
      } else {
        unmatched.push({ requestedCode, reason: "Código não encontrado na LD carregada." });
      }
    });
    const unique = new Map();
    matched.forEach((item) => { if (!unique.has(item.documentKey)) unique.set(item.documentKey, item); });
    state.titleRequestedCodes = requested;
    state.titleMatchedCodes = [...unique.values()];
    state.titleUnmatchedCodes = unmatched;
    if (els.titleCodeMeta) {
      els.titleCodeMeta.textContent = requested.length
        ? `${requested.length.toLocaleString("pt-BR")} código(s) carregado(s) · ${state.titleMatchedCodes.length.toLocaleString("pt-BR")} localizado(s) · ${unmatched.length.toLocaleString("pt-BR")} não localizado(s)`
        : "Nenhum código preparado";
    }
    updateReady();
    return { requested, matched: state.titleMatchedCodes, unmatched };
  }

  async function loadTitleCodeFile(file) {
    state.titleCodeFile = file || null;
    state.titleCodeFileEntries = [];
    if (!file) {
      if (els.titleCodeFileMeta) els.titleCodeFileMeta.textContent = "Excel, CSV ou TXT";
      resolveTitleScope();
      return;
    }
    try {
      const extension = String(file.name || "").split(".").pop().toLowerCase();
      if (extension === "txt" || extension === "csv") {
        state.titleCodeFileEntries = splitRequestedCodes(await file.text());
      } else {
        const workbook = await readWorkbook(file);
        const values = [];
        workbook.SheetNames.forEach((sheetName) => {
          const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
          matrix.forEach((row) => {
            const cells = Array.isArray(row) ? row : [];
            const resolved = cells.map(cleanRequestedCode).filter(Boolean).find((candidate) => matchRequestedCode(candidate).length === 1);
            if (resolved) values.push(resolved);
            else if (cells.length) {
              const first = cleanRequestedCode(cells[0]);
              if (first && !/^(DOCUMENTO|CODIGO|CÓDIGO|TITULO|TÍTULO)$/i.test(first)) values.push(first);
            }
          });
        });
        state.titleCodeFileEntries = splitRequestedCodes(values.join("\n"));
      }
      if (els.titleCodeFileMeta) els.titleCodeFileMeta.textContent = `${file.name} · ${state.titleCodeFileEntries.length.toLocaleString("pt-BR")} código(s)`;
      resolveTitleScope();
      showToast("Relação de códigos carregada.", "success");
    } catch (error) {
      state.titleCodeFile = null;
      state.titleCodeFileEntries = [];
      if (els.titleCodeFile) els.titleCodeFile.value = "";
      if (els.titleCodeFileMeta) els.titleCodeFileMeta.textContent = "Arquivo não pôde ser lido";
      showToast(error.message || "Não foi possível ler a relação de códigos.", "error");
    }
  }

  function clearTitleCodes() {
    state.titleCodeFile = null;
    state.titleCodeFileEntries = [];
    state.titleRequestedCodes = [];
    state.titleMatchedCodes = [];
    state.titleUnmatchedCodes = [];
    if (els.titleCodeText) els.titleCodeText.value = "";
    if (els.titleCodeFile) els.titleCodeFile.value = "";
    if (els.titleCodeFileMeta) els.titleCodeFileMeta.textContent = "Excel, CSV ou TXT";
    if (els.titleCodeMeta) els.titleCodeMeta.textContent = "Nenhum código preparado";
    state.titleRows = [];
    state.titleSelected.clear();
    if (els.titleResults) els.titleResults.hidden = true;
    updateReady();
  }

  function updateReady() {
    const ready = Boolean(state.file && state.index);
    const specificReady = !titleScopeSpecific() || titleScopeCandidates().length > 0;
    els.dbAnalyze.disabled = !ready || state.busyKinds.has("databook");
    els.titleAnalyze.disabled = !ready || !specificReady || state.busyKinds.has("title") || state.titleBaseLoading;
    const label = !state.file ? "Aguardando LD" : !state.index ? "Lendo LD" : `${state.file.name} · ${Q.currentRecords(state.index).length.toLocaleString("pt-BR")} documentos`;
    els.dbReady.textContent = label;
    els.titleReady.textContent = titleScopeSpecific() && ready
      ? `${label} · ${titleScopeCandidates().length.toLocaleString("pt-BR")} código(s) solicitado(s)`
      : label;
  }

  const TITLE_MEMORY_STORE = "title_corrections";

  // TAG é a chave preferida: a mesma TAG reaparece em vários documentos
  // (relatório, certificado, PIT...) e uma correção feita num deles vale
  // para os outros. Sem TAG confirmada, cai para o documento específico.
  function titleMemoryKey(row) {
    if (row.tag && row.discipline) return `TAG::${Q.norm(row.discipline)}::${Q.norm(row.tag)}`;
    return `DOC::${row.documentKey}`;
  }

  function shouldRememberCorrection(row) {
    const finalText = Q.text(row.proposed).trim();
    if (!finalText) return false;
    return Q.norm(finalText) !== Q.norm(Q.text(row.autoProposed));
  }

  function rememberTitleCorrection(row) {
    if (!window.RECONDB) return;
    window.RECONDB.put(TITLE_MEMORY_STORE, {
      key: titleMemoryKey(row),
      title: row.proposed,
      auto: row.autoProposed || "",
      document: row.document,
      discipline: row.discipline || "",
      tag: row.tag || "",
      updatedAt: Date.now(),
    }).then(updateTitleMemoryStatus)
      .catch((error) => console.warn("RECON: não foi possível salvar a memória de correção.", error));
  }

  function storeDecision(row, decision) {
    row.decision = decision;
    if (decision === "approved" && row.kind === "title" && shouldRememberCorrection(row)) {
      rememberTitleCorrection(row);
    }
  }

  async function loadTitleMemory() {
    if (!window.RECONDB) return new Map();
    try {
      const entries = await window.RECONDB.getAll(TITLE_MEMORY_STORE);
      return new Map((entries || []).map((entry) => [entry.key, entry]));
    } catch (error) {
      console.warn("RECON: memória de correções indisponível.", error);
      return new Map();
    }
  }

  // Só preenche a lacuna quando a análise automática não teve uma sugestão
  // segura — nunca substitui o que o SCON/Apêndice já confirmaram com
  // confiança. Isso mantém a hierarquia: base controlada primeiro, memória
  // pessoal como último recurso antes de "sem sugestão".
  function applyTitleMemory(rows, memory) {
    if (!memory || !memory.size) return rows;
    rows.forEach((row) => {
      if (row.issue === "ok" || row.proposed) return;
      const entry = memory.get(titleMemoryKey(row));
      if (!entry || !entry.title) return;
      if (Q.norm(row.current || "") === Q.norm(entry.title)) return;
      row.proposed = entry.title;
      row.learnedTitle = true;
      if (row.confidence === "nenhuma") row.confidence = "media";
      row.reason = `${row.reason} Sugestão baseada numa correção sua anterior para ${row.tag ? "a mesma TAG" : "este documento"}.`;
    });
    return rows;
  }

  async function updateTitleMemoryStatus() {
    if (!els.titleMemoryCount) return;
    if (!window.RECONDB) { els.titleMemoryCount.textContent = "indisponível neste navegador"; return; }
    try {
      const entries = await window.RECONDB.getAll(TITLE_MEMORY_STORE);
      const count = (entries || []).length;
      els.titleMemoryCount.textContent = count
        ? `${count.toLocaleString("pt-BR")} correção(ões) salva(s)`
        : "nenhuma correção salva ainda";
      if (els.titleMemoryClear) els.titleMemoryClear.hidden = count === 0;
    } catch (_) {
      els.titleMemoryCount.textContent = "indisponível neste navegador";
    }
  }

  function emptyTitleReferences() {
    return { entries: [], byDocument: new Map(), byTagDiscipline: new Map(), scon: null };
  }

  function mergeIndexedReferences(...sources) {
    const entries = [];
    const byDocument = new Map();
    const byTagDiscipline = new Map();
    sources.filter(Boolean).forEach((source) => {
      (source.entries || []).forEach((entry) => entries.push(entry));
      if (source.byDocument) source.byDocument.forEach((entry, key) => byDocument.set(key, entry));
      if (source.byTagDiscipline) source.byTagDiscipline.forEach((items, key) => {
        const current = byTagDiscipline.get(key) || [];
        const unique = new Map([...current, ...(items || [])].map((item) => [`${item.documentKey || ""}|${Q.norm(item.description || item.title || "")}`, item]));
        byTagDiscipline.set(key, [...unique.values()]);
      });
    });
    return { entries, byDocument, byTagDiscipline };
  }

  function mergedTitleReferences() {
    const merged = mergeIndexedReferences(state.titleReferences, state.titleSupplementalReferences);
    merged.scon = state.sconTitleReferences || null;
    merged.sconEscopo = state.sconEscopoTitleReferences || null;
    merged.tagReference = state.tagReferenceTitleReferences || null;
    return merged;
  }

  function updateTitleReferenceStatus() {
    const baseCount = state.titleReferences && state.titleReferences.entries ? state.titleReferences.entries.length : 0;
    const extraCount = state.titleSupplementalReferences && state.titleSupplementalReferences.entries ? state.titleSupplementalReferences.entries.length : 0;
    const sconCount = state.sconTitleReferences && state.sconTitleReferences.entries ? state.sconTitleReferences.entries.length : 0;
    const sconEscopoCount = state.sconEscopoTitleReferences && state.sconEscopoTitleReferences.uniqueTagCount || 0;
    const appendixCount = state.tagReferenceTitleReferences && state.tagReferenceTitleReferences.uniqueTagCount || 0;
    const sconEscopoEapCount = state.sconEscopoTitleReferences && state.sconEscopoTitleReferences.uniqueEapCount || 0;
    const baseText = `${baseCount.toLocaleString("pt-BR")} conclusões controladas`;
    const sconText = sconCount ? `${sconCount.toLocaleString("pt-BR")} códigos SCON TAG SGP` : "SCON TAG SGP sob demanda";
    const sconEscopoText = sconEscopoCount ? `${sconEscopoCount.toLocaleString("pt-BR")} TAGs · ${sconEscopoEapCount.toLocaleString("pt-BR")} EAPs no SCON ESCOPO` : "SCON ESCOPO indisponível";
    const appendixText = appendixCount ? `${appendixCount.toLocaleString("pt-BR")} TAGs no Apêndice 3 Rev.B` : "Apêndice 3 Rev.B indisponível";
    const extraText = extraCount ? ` · ${extraCount.toLocaleString("pt-BR")} referências adicionais` : "";
    els.titleBaseStatus.textContent = `${baseText} · ${sconText} · ${sconEscopoText} · ${appendixText}${extraText}`;
    if (els.titleSconReferenceMeta && !state.sconReferenceFile) {
      els.titleSconReferenceMeta.textContent = sconCount ? `Base incorporada · ${sconCount.toLocaleString("pt-BR")} códigos` : "Base incorporada indisponível";
    }
  }

  function populateSheetSelect(select, rows) {
    const previous = select.value;
    const sheets = [...new Set((rows || []).map((row) => row.sheet).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    select.innerHTML = `<option value="">Todas as abas · ${(rows || []).length.toLocaleString("pt-BR")} item(ns)</option>${sheets.map((sheet) => {
      const count = rows.filter((row) => row.sheet === sheet).length;
      return `<option value="${escapeHtml(sheet)}">${escapeHtml(sheet)} · ${count.toLocaleString("pt-BR")} item(ns)</option>`;
    }).join("")}`;
    select.value = sheets.includes(previous) ? previous : "";
  }

  function titleSourceCategory(row) {
    if (!row) return "without_evidence";
    if (row.issue === "ok") return "already_correct";
    if (row.learnedTitle) return "learned_memory";
    if (/^SCON TAG SGP \+ SCON ESCOPO \+ Apêndice/i.test(row.descriptionSource || "")) return "all_tag_bases";
    if (/^SCON TAG SGP \+ Apêndice/i.test(row.descriptionSource || "")) return "scon_appendix";
    if (row.descriptionSource === "SCON TAG SGP + SCON ESCOPO") return "scon_combined";
    if (row.descriptionSource === "SCON ESCOPO + Apêndice 3 Rev.B") return "tag_eap_dual";
    if (/^Apêndice 3 Rev.B/i.test(row.descriptionSource || "")) return "appendix";
    if (row.sconEscopoMatch === "SIM" && /^SCON ESCOPO/i.test(row.descriptionSource || "")) {
      if (row.sconEscopoTagFallback || /EAP \+ ATIVIDADE DOCUMENTAL/i.test(row.descriptionSource || "")) return "scon_escopo_activity";
      if (row.sconEscopoEapFallback || /FALLBACK.*OUTRO EAP/i.test(row.sconEscopoMatchMode || "")) return "scon_escopo_fallback";
      return /DENTRO DO GRUPO 7|PARTES DO GRUPO 7/i.test(row.sconEscopoMatchMode || "") ? "scon_escopo_component" : "scon_escopo_exact";
    }
    if (row.sconMatch === "AMBÍGUO") return "scon_ambiguous";
    if (row.sconMatch === "SIM") {
      const mode = Q.norm(row.sconMatchMode || "");
      return /CODIGO SGP DO SCON/.test(mode)
        ? "scon_sgp_tag"
        : /DENTRO DO GRUPO 7/.test(mode)
          ? "scon_component"
          : /NORMAL|PONTUAC/.test(mode) ? "scon_normalized" : "scon_exact";
    }
    if (row.sconEscopoMatch === "AMBÍGUO" && (!row.descriptionSource || row.descriptionSource === "Título atual")) return "scon_escopo_ambiguous";
    if (row.descriptionSource && !/SEM|NAO LOCALIZ|NÃO LOCALIZ/i.test(row.descriptionSource)) return "controlled";
    return "without_evidence";
  }

  function readTitleFilters() {
    try { return JSON.parse(localStorage.getItem(TITLE_FILTER_KEY) || "{}") || {}; } catch (_) { return {}; }
  }

  function saveTitleFilters() {
    try {
      localStorage.setItem(TITLE_FILTER_KEY, JSON.stringify({
        issue: els.titleIssue && els.titleIssue.value,
        confidence: els.titleConfidence && els.titleConfidence.value,
        source: els.titleSource && els.titleSource.value,
        search: els.titleSearch && els.titleSearch.value,
      }));
    } catch (_) {}
  }

  function visibleRows(kind) {
    const rows = kind === "databook" ? state.databookRows : state.titleRows;
    const search = Q.norm(kind === "databook" ? els.dbSearch.value : els.titleSearch.value);
    const issue = (kind === "databook" ? els.dbIssue : els.titleIssue).value;
    const sheet = (kind === "databook" ? els.dbSheet : els.titleSheet).value;
    const confidence = (kind === "databook" ? els.dbConfidence : els.titleConfidence).value;
    const source = kind === "title" && els.titleSource ? els.titleSource.value : "";
    return rows.filter((row) => {
      if (issue && row.issue !== issue) return false;
      if (sheet && row.sheet !== sheet) return false;
      if (confidence && row.confidence !== confidence) return false;
      if (kind === "title" && source && titleSourceCategory(row) !== source) return false;
      if (search && !Q.norm(`${row.document} ${row.sheet} ${row.allocation || ""} ${row.controlledSourceKind || ""} ${row.controlledSourceFile || ""} ${row.title || ""} ${row.current} ${row.proposed} ${row.tag || ""} ${row.sconEscopoLookupTag || ""} ${row.sconEscopoDocumentEap || ""} ${(row.sconEscopoCandidateEaps || []).join(" ")} ${row.description || ""} ${row.descriptionSource || ""} ${row.sconTitleComplement || ""} ${row.sconFullDescription || ""} ${row.sconEscopoTitle || ""} ${(row.sconEscopoCandidateTitles || []).join(" ")} ${row.appendixTitle || ""} ${(row.appendixMatchedTags || []).join(" ")} ${(row.appendixCandidateTitles || []).join(" ")} ${row.reason}`).includes(search)) return false;
      return true;
    });
  }

  function decisionHtml(row) {
    if (row.ldConflict && row.ldConflict.hasConflict) return '<span class="decision-pill pending">Conferir linhas da LD</span>';
    if (row.issue === "ok") return '<span class="decision-pill approved">Sem alteração</span>';
    if (!row.proposed) return '<span class="decision-pill pending">Análise manual</span>';
    return `<div class="decision-control"><button class="approve ${row.decision === "approved" ? "active" : ""}" type="button" data-action="approve" data-id="${escapeHtml(row.id)}">Aprovar</button><button class="keep ${row.decision === "kept" ? "active" : ""}" type="button" data-action="keep" data-id="${escapeHtml(row.id)}">Manter</button></div>`;
  }

  function confidenceHtml(value) {
    const label = value === "nenhuma" ? "Sem sugestão" : value;
    return `<span class="confidence-pill ${escapeHtml(value)}">${escapeHtml(label)}</span>`;
  }

  function conclusionLabel(row) {
    const labels = {
      ok: "Adequado",
      confirmed_error: "Erro confirmado",
      suggestion: "Sugestão",
      insufficient: "Informação insuficiente",
    };
    return labels[row && row.classification] || "Informação insuficiente";
  }

  function conclusionHtml(row) {
    return `<span class="conclusion-pill ${escapeHtml(row.classification || "insufficient")}">${escapeHtml(conclusionLabel(row))}</span>`;
  }

  function auditRowClass(row) {
    return `row-${row.classification || (row.issue === "ok" ? "ok" : row.proposed ? "suggestion" : "insufficient")}`;
  }

  function messageHtml(row) {
    const message = row.userMessage || (Contracts ? Contracts.enrichAuditRow(row).userMessage : null);
    if (!message) return `<span title="${escapeHtml(row.evidence)}">${escapeHtml(row.reason)}</span>`;
    return `<div class="audit-message ${escapeHtml(message.severity || "warning")}" title="${escapeHtml(row.evidence || row.reason)}">
      <strong>${escapeHtml(message.title)}</strong>
      <span>${escapeHtml(message.explanation)}</span>
      ${message.nextAction ? `<small>${escapeHtml(message.nextAction)}</small>` : ""}
      ${row.reasonCode ? `<code>${escapeHtml(row.reasonCode)}</code>` : ""}
    </div>`;
  }

  function renderSummary(kind) {
    const allRows = kind === "databook" ? state.databookRows : state.titleRows;
    const selectedSheet = (kind === "databook" ? els.dbSheet : els.titleSheet).value;
    const rows = selectedSheet ? allRows.filter((row) => row.sheet === selectedSheet) : allRows;
    const summary = Q.summarize(rows);
    const prefix = kind === "databook" ? "db" : "title";
    Object.entries(summary).forEach(([key, value]) => {
      const target = document.querySelector(`[data-${prefix}-count="${key}"]`);
      if (target) target.textContent = value.toLocaleString("pt-BR");
    });
    // "Salvar no arquivo original" só aparece quando a LD foi aberta com
    // permissão de escrita (botão "Abrir com edição direta") e o navegador
    // ainda oferece a API — em Firefox/Safari, ou numa LD aberta pelo upload
    // comum, o botão fica oculto e só existe a opção de baixar uma cópia.
    const canInplace = Boolean(state.fileHandle && window.RECONFileHandles && window.RECONFileHandles.isSupported());
    const controlledDatabook = state.databookRows.filter((row) => row.decision === "approved" && row.proposed && row.controlledSource).length;
    if (els.dbApplyLd) {
      els.dbApplyLd.disabled = controlledDatabook === 0 || !state.file;
      els.dbApplyLd.textContent = controlledDatabook ? `Gerar LD com ${controlledDatabook} caminho(s) confirmado(s)` : "Gerar LD com caminhos confirmados";
    }
    if (els.dbApplyLdInplace) {
      els.dbApplyLdInplace.hidden = !canInplace;
      els.dbApplyLdInplace.disabled = controlledDatabook === 0 || !state.file || !canInplace;
    }
    const approvedTitles = state.titleRows.filter((row) => row.decision === "approved" && row.proposed).length;
    if (els.titleApplyLd) { els.titleApplyLd.disabled = approvedTitles === 0 || !state.file; els.titleApplyLd.textContent = approvedTitles ? `Gerar cópia da LD com ${approvedTitles} título(s)` : "Gerar cópia da LD revisada"; }
    if (els.titleApplyLdInplace) {
      els.titleApplyLdInplace.hidden = !canInplace;
      els.titleApplyLdInplace.disabled = approvedTitles === 0 || !state.file || !canInplace;
    }
  }

  function renderDatabook() {
    renderSummary("databook");
    const visible = visibleRows("databook");
    const preview = dbPager ? dbPager.slice(visible) : visible.slice(0, DEFAULT_PAGE_SIZE);
    els.dbBody.innerHTML = preview.map((row) => `<tr class="${auditRowClass(row)}">
      <td>${row.issue !== "ok" && row.proposed ? `<input class="audit-check" type="checkbox" data-select-id="${escapeHtml(row.id)}" ${state.databookSelected.has(row.id) ? "checked" : ""}>` : ""}</td>
      <td><span title="${escapeHtml(row.document)}">${escapeHtml(row.document)}</span></td><td><span>${escapeHtml(row.sheet)}</span></td>
      <td><span title="${escapeHtml(row.allocation)}">${escapeHtml(row.allocation || "—")}</span></td>
      <td><span title="${escapeHtml(row.controlledSourceFile || row.evidence)}">${escapeHtml(row.controlledSourceKind || (row.controlledSourceStatus === "wrong_year_only" ? "Somente outro ano" : row.controlledSourceStatus === "not_found" ? "Não localizado" : "—"))}</span></td>
      <td><span title="${escapeHtml(row.title)}">${escapeHtml(row.title || "—")}</span></td>
      <td><span title="${escapeHtml(row.current)}">${escapeHtml(row.current || "—")}</span></td><td><span title="${escapeHtml(row.proposed)}">${escapeHtml(row.proposed || "—")}</span></td>
      <td>${conclusionHtml(row)}</td><td>${confidenceHtml(row.confidence)}</td><td><span class="ld-conflict-cell ${row.ldConflict ? "yes" : "no"}">${escapeHtml(row.conflictLd || "NÃO")}</span></td><td>${messageHtml(row)}</td><td>${decisionHtml(row)}</td></tr>`).join("");
    els.dbEmpty.hidden = preview.length > 0;
    els.dbMeta.textContent = `${visible.length.toLocaleString("pt-BR")} linha(s) · relatório completo`;
    els.dbSelectedCount.textContent = `${state.databookSelected.size.toLocaleString("pt-BR")} selecionado(s)`;
    els.dbSelectVisible.checked = Boolean(preview.length && preview.filter((row) => row.proposed && row.issue !== "ok").every((row) => state.databookSelected.has(row.id)));
    els.dbApproveSelected.disabled = !state.databookSelected.size;
    els.dbKeepSelected.disabled = !state.databookSelected.size;
  
    notifyReconUi();
  }

  function titleDiffHtml(current, proposed) {
    const before = Q.text(current);
    const after = Q.text(proposed);
    if (!after) return "—";
    if (!before || Q.norm(before) === Q.norm(after)) return escapeHtml(after);
    let prefix = 0;
    const maxPrefix = Math.min(before.length, after.length);
    while (prefix < maxPrefix && before[prefix].toLocaleUpperCase("pt-BR") === after[prefix].toLocaleUpperCase("pt-BR")) prefix += 1;
    while (prefix > 0 && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9]/i.test(after[prefix - 1]) && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9]/i.test(after[prefix] || "")) prefix -= 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
      && before[before.length - 1 - suffix].toLocaleUpperCase("pt-BR") === after[after.length - 1 - suffix].toLocaleUpperCase("pt-BR")) suffix += 1;
    while (suffix > 0 && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9]/i.test(after[after.length - suffix] || "") && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ0-9]/i.test(after[after.length - suffix - 1] || "")) suffix -= 1;
    const start = after.slice(0, prefix);
    const changed = after.slice(prefix, after.length - suffix || after.length);
    const end = suffix ? after.slice(after.length - suffix) : "";
    return `${escapeHtml(start)}<mark>${escapeHtml(changed || after)}</mark>${escapeHtml(end)}`;
  }

  // O título recomendado é editável sempre que existe uma decisão a tomar:
  // o texto aprovado (editado ou não) é o mesmo que vai para o Excel e para a
  // cópia da LD, então o que a Qualidade vê aqui é exatamente o que sai depois.
  function titleEditable(row) {
    return Boolean(row) && !(row.ldConflict && row.ldConflict.hasConflict) && row.issue !== "ok";
  }

  function titleProposedHtml(row) {
    if (row.ldConflict && row.ldConflict.hasConflict) {
      return `<p>${row.proposed ? titleDiffHtml(row.current, row.proposed) : "Resolva o conflito na LD antes de revisar o título"}</p>`;
    }
    if (row.issue === "ok") return "<p>Nenhuma mudança necessária</p>";
    const edited = Boolean(row.autoProposed) && Q.norm(row.autoProposed) !== Q.norm(row.proposed || "");
    const auto = edited
      ? `<div class="title-proposed-auto"><small>Sugestão automática</small><span>${titleDiffHtml(row.current, row.autoProposed)}</span><button type="button" data-restore-proposed="${escapeHtml(row.id)}">Usar sugestão automática</button></div>`
      : "";
    return `<label class="title-review-edit"><textarea class="title-proposed-input" data-proposed-edit="${escapeHtml(row.id)}" rows="2" spellcheck="false" aria-label="Título recomendado para ${escapeHtml(row.document)}" placeholder="Digite o título que deseja aprovar…">${escapeHtml(row.proposed || "")}</textarea></label>${auto}`;
  }

  function cleanTitleReportValue(value) {
    if (Q && typeof Q.stripSpreadsheetErrors === "function") return Q.stripSpreadsheetErrors(value);
    return String(value == null ? "" : value).replace(/#(?:N\/A|N\/D|VALUE!|VALOR!|REF!|NAME\?|NOME\?|DIV\/0!)/giu, " ").replace(/\s+/g, " ").trim();
  }

  function titleEvidenceHtml(row) {
    const category = titleSourceCategory(row);
    const sourceLabel = {
      learned_memory: "Memória de correções (sua edição anterior)",
      all_tag_bases: "SCON TAG SGP + SCON ESCOPO + Apêndice 3 Rev.B",
      scon_appendix: "SCON TAG SGP + Apêndice 3 Rev.B",
      scon_combined: "SCON TAG SGP + SCON ESCOPO",
      tag_eap_dual: "SCON ESCOPO + Apêndice 3 Rev.B",
      appendix: "Apêndice 3 Rev.B · TAG do equipamento",
      scon_exact: "SCON TAG SGP · Código SGP exato",
      scon_normalized: "SCON TAG SGP · correspondência normalizada única",
      scon_component: "SCON TAG SGP · TAG principal localizada no Grupo 7",
      scon_sgp_tag: "SCON TAG SGP · TAG localizada no CÓDIGO SGP",
      scon_ambiguous: "SCON TAG SGP · correspondência ambígua",
      scon_escopo_exact: "SCON ESCOPO · TAG + EAP",
      scon_escopo_fallback: "SCON ESCOPO · mesma TAG em outro EAP",
      scon_escopo_component: "SCON ESCOPO · TAG principal localizada no Grupo 7",
      scon_escopo_ambiguous: "SCON ESCOPO · referência não conclusiva",
      controlled: row.descriptionSource || "Base controlada",
      without_evidence: "Sem correspondência segura",
      already_correct: "Título já adequado",
    }[category] || row.descriptionSource || "Evidência";
    const sourceRows = [...new Set([...(row.sconSourceRows || []), ...(row.sconEscopoSourceRows || []), ...(row.appendixSourceRows || [])])].join(", ");
    const sconOnlyAmbiguous = row.sconMatch === "AMBÍGUO" && (!row.sconTitleComplement && !row.sconEscopoTitle);
    const sconEscopoOnlyAmbiguous = row.sconEscopoMatch === "AMBÍGUO" && (!row.descriptionSource || row.descriptionSource === "Título atual");
    const sconCandidates = (row.sconCandidateTitles || [])
      .map(cleanTitleReportValue)
      .filter(Boolean)
      .slice(0, 3);
    const sconCandidateText = sconCandidates.length
      ? ` Opções encontradas: ${sconCandidates.join(" | ")}${row.sconCandidateCount > sconCandidates.length ? " | …" : ""}`
      : "";
    const sconEscopoCandidates = (row.sconEscopoCandidateTitles || [])
      .map(cleanTitleReportValue)
      .filter(Boolean)
      .slice(0, 3);
    const sconEscopoCandidateText = sconEscopoCandidates.length
      ? ` Opções encontradas: ${sconEscopoCandidates.join(" | ")}${row.sconEscopoCandidateCount > sconEscopoCandidates.length ? " | …" : ""}`
      : "";
    const sconEscopoConflictText = /TAGs possíveis/i.test(row.sconEscopoMatchMode || "")
      ? `A busca progressiva por partes encontrou mais de uma TAG possível no SCON ESCOPO: ${(row.sconEscopoMatchedTags || []).join(", ") || "não identificadas"}. Nenhuma foi escolhida automaticamente.${sconEscopoCandidateText}`
      : !row.sconEscopoEapMatched && row.sconEscopoDocumentEap
        ? `A TAG foi localizada no SCON ESCOPO, mas não existe para o EAP ${row.sconEscopoDocumentEap || "do 4º grupo"}. EAPs disponíveis: ${(row.sconEscopoCandidateEaps || []).join(", ") || "não informados"}.${sconEscopoCandidateText}`
        : /DISCIPLINA/i.test(row.sconEscopoMatchMode || "")
        ? `A referência foi encontrada no SCON ESCOPO, mas a disciplina não coincide com a LD. Confira a disciplina antes de escolher o título.${sconEscopoCandidateText}`
        : `${row.sconEscopoCandidateCount || 0} referências foram localizadas, mas não puderam ser combinadas com segurança.${sconEscopoCandidateText}`;
    const sconConflictText = /DISCIPLINA/i.test(row.sconMatchMode || "")
      ? `A TAG foi localizada no SCON TAG SGP, mas a disciplina não coincide com a LD.${sconCandidateText}`
      : `A TAG foi localizada no SCON TAG SGP, porém existem descrições diferentes e nenhuma foi escolhida automaticamente.${sconCandidateText}`;
    const sconMatchDetail = row.sconMatchMode && row.sconMatch !== "NÃO" ? ` (${row.sconMatchMode})` : "";
    const sconEscopoMatchDetail = row.sconEscopoMatchMode && row.sconEscopoMatch !== "NÃO" ? ` (${row.sconEscopoMatchMode})` : "";
    const controlledDescriptions = [
      row.sconTitleComplement ? `SCON TAG SGP${sconMatchDetail}: ${cleanTitleReportValue(row.sconTitleComplement)}` : "",
      row.sconEscopoTitle ? `SCON ESCOPO${sconEscopoMatchDetail}: ${cleanTitleReportValue(row.sconEscopoTitle)}` : "",
      row.appendixTitle ? `Apêndice 3 Rev.B (${(row.appendixMatchedTags || []).join(", ") || row.tag || "TAG"}): ${cleanTitleReportValue(row.appendixTitle)}` : "",
    ].filter(Boolean);
    const rawDescription = row.nonTaggedRule
      ? `O QUÊ: ${row.nonTaggedWhat || "não identificado"} · ONDE/QUANDO: ${row.nonTaggedWhereWhen || "não identificado"}`
      : sconOnlyAmbiguous
        ? sconConflictText
      : sconEscopoOnlyAmbiguous
        ? sconEscopoConflictText
        : controlledDescriptions.join(" | ") || row.description || row.evidence || row.reason || "Nenhuma descrição segura foi localizada.";
    const description = cleanTitleReportValue(rawDescription) || "Nenhuma descrição segura foi localizada.";
    const identifier = cleanTitleReportValue(row.nonTaggedRule ? `nt-${row.nonTaggedIdentifier || ""}` : row.tag || row.possibleIdentifier);
    return `<div class="title-evidence-source ${category}"><span>${escapeHtml(sourceLabel)}</span>${sourceRows ? `<small>Linha(s) ${escapeHtml(sourceRows)}</small>` : ""}</div><p>${escapeHtml(description)}</p>${identifier ? `<code>${escapeHtml(identifier)}</code>` : ""}`;
  }

  function renderTitles() {
    renderSummary("title");
    const visible = visibleRows("title");
    const preview = titlePager ? titlePager.slice(visible) : visible.slice(0, DEFAULT_PAGE_SIZE);
    els.titleBody.innerHTML = preview.map((row) => `<article class="title-review-card ${auditRowClass(row)} source-${titleSourceCategory(row)}" role="listitem" data-title-id="${escapeHtml(row.id)}">
      <header class="title-review-card-head">
        <label class="title-review-select">${row.issue !== "ok" && row.proposed ? `<input class="audit-check" type="checkbox" data-select-id="${escapeHtml(row.id)}" ${state.titleSelected.has(row.id) ? "checked" : ""}>` : ""}<span><strong>${escapeHtml(row.document)}</strong><small>${escapeHtml(row.sheet || "Aba não informada")} · ${escapeHtml(row.issue === "ok" ? "Título já está adequado" : row.reason || "Revisão de título")}</small></span></label>
        <div class="title-review-status">${conclusionHtml(row)}${confidenceHtml(row.confidence)}<span class="ld-conflict-cell ${row.ldConflict && row.ldConflict.hasConflict ? "yes" : "no"}">${escapeHtml(row.conflictLd || "SEM CONFLITO")}</span></div>
      </header>
      <div class="title-review-comparison">
        <section class="title-review-block current"><span>Título atual na LD</span><p>${escapeHtml(row.current || "Título vazio")}</p></section>
        <section class="title-review-block evidence"><span>O que as bases informam</span>${titleEvidenceHtml(row)}</section>
        <section class="title-review-block proposed"><span>Título recomendado</span>${titleProposedHtml(row)}</section>
      </div>
      <footer class="title-review-card-footer"><div class="title-review-guidance">${messageHtml(row)}</div><div class="title-review-decision">${decisionHtml(row)}</div></footer>
    </article>`).join("");
    els.titleEmpty.hidden = preview.length > 0;
    els.titleMeta.textContent = `${visible.length.toLocaleString("pt-BR")} resultado(s) · filtros e relatório consideram toda a análise`;
    els.titleSelectedCount.textContent = `${state.titleSelected.size.toLocaleString("pt-BR")} selecionado(s)`;
    els.titleSelectVisible.checked = Boolean(preview.length && preview.filter((row) => row.proposed && row.issue !== "ok").every((row) => state.titleSelected.has(row.id)));
    els.titleApproveSelected.disabled = !state.titleSelected.size;
    els.titleKeepSelected.disabled = !state.titleSelected.size;
    notifyReconUi();
  }

  async function analyzeDatabook() {
    if (state.busyKinds.has("databook") || !state.index) return;
    const taskId = Tasks ? Tasks.start("Auditoria de Caminho Databook", state.file && state.file.name) : "";
    state.busyKinds.add("databook"); updateReady(); setProgress("databook", 12, "Preparando evidências da LD…"); await yieldFrame();
    try {
      const catalog = [...state.catalog];
      setProgress("databook", 42, "Comparando caminhos por família, disciplina e assunto…"); if (Tasks) Tasks.update(taskId, 42, "Comparando referências e histórico da LD"); await yieldFrame();
      state.databookRows = window.RECONCompute ? await window.RECONCompute.run("databook", "audit-databook", { index: state.index, catalog, sourceIndex: state.databookSourceIndex }) : Q.auditDatabook(state.index, catalog, state.databookSourceIndex);
      if (dbPager) dbPager.reset();
      state.databookSelected.clear();
      populateSheetSelect(els.dbSheet, state.databookRows);
      els.dbResults.hidden = false;
      setProgress("databook", 100, "Análise concluída");
      renderDatabook();
      window.setTimeout(() => hideProgress("databook"), 450);
      showToast(`${state.databookRows.length.toLocaleString("pt-BR")} documento(s) analisado(s).`, "success");
      if (Tasks) Tasks.finish(taskId, `${state.databookRows.length.toLocaleString("pt-BR")} documentos analisados`);
    } catch (error) {
      hideProgress("databook"); showToast(error.message || "Não foi possível analisar os caminhos.", "error");
      if (Tasks) Tasks.fail(taskId, error);
    } finally { state.busyKinds.delete("databook"); updateReady(); }
  }

  async function ensureSconForTitles(requestedKeys) {
    if (state.sconReferenceFile && state.sconTitleReferences) return state.sconTitleReferences;
    if (!window.RECONSconCatalog) return state.sconTitleReferences;
    if (els.titleSconReferenceMeta) els.titleSconReferenceMeta.textContent = "Carregando somente as disciplinas necessárias…";
    // A base embutida é buscada pela rede, em pedaços por disciplina. Uma falha
    // de rede aqui não pode derrubar a análise inteira (antes derrubava): o
    // usuário fica sem nenhum resultado só porque um arquivo não baixou,
    // quando o restante das disciplinas já carregadas continua utilizável.
    try {
      const catalog = await window.RECONSconCatalog.ensureForIndex(state.index, requestedKeys || null);
      state.sconTitleReferences = Q.parseSconTitleCatalog(catalog);
      const count = state.sconTitleReferences.entries.length.toLocaleString("pt-BR");
      if (catalog.failedDisciplines && catalog.failedDisciplines.length) {
        if (els.titleSconReferenceMeta) els.titleSconReferenceMeta.textContent = `${count} códigos SCON carregados · ${catalog.failedDisciplines.length} disciplina(s) indisponível(is)`;
        showToast(`Não foi possível baixar a base SCON TAG SGP de ${catalog.failedDisciplines.length} disciplina(s) (${catalog.failedDisciplines.join(", ")}). A análise continua com as demais disciplinas já carregadas; se a rede estabilizar, analise novamente para completar a base.`, "warn");
      } else if (els.titleSconReferenceMeta) {
        els.titleSconReferenceMeta.textContent = `${count} códigos SCON carregados por disciplina`;
      }
    } catch (error) {
      console.error("RECON: falha ao carregar a base SCON TAG SGP embutida", error);
      if (els.titleSconReferenceMeta) els.titleSconReferenceMeta.textContent = "Base incorporada indisponível nesta tentativa";
      showToast("Não foi possível baixar a base SCON TAG SGP embutida. A análise vai continuar sem ela; carregue o arquivo manualmente ou tente novamente.", "warn");
    }
    updateTitleReferenceStatus();
    return state.sconTitleReferences;
  }

  async function analyzeTitles() {
    if (state.busyKinds.has("title") || !state.index) return;
    let requestedKeys = null;
    if (titleScopeSpecific()) {
      const scope = resolveTitleScope();
      if (!scope.requested.length) { showToast("Carregue ou cole ao menos um código para analisar.", "warn"); return; }
      if (!scope.matched.length) { showToast("Nenhum dos códigos informados foi localizado na LD.", "error"); return; }
      requestedKeys = new Set(scope.matched.map((item) => item.documentKey));
    } else {
      state.titleRequestedCodes = [];
      state.titleMatchedCodes = [];
      state.titleUnmatchedCodes = [];
    }
    const taskDetail = titleScopeSpecific() ? `${state.titleMatchedCodes.length} código(s) específico(s)` : state.file && state.file.name;
    const taskId = Tasks ? Tasks.start("Auditoria de títulos", taskDetail) : "";
    state.busyKinds.add("title"); updateReady(); setProgress("title", 15, "Preparando títulos, descrições e tags…"); await yieldFrame();
    try {
      setProgress("title", 32, "Carregando evidências SCON TAG SGP, SCON ESCOPO e Apêndice 3 Rev.B…");
      await ensureSconForTitles(requestedKeys);
      setProgress("title", 48, "Verificando especificidade e padronização…"); if (Tasks) Tasks.update(taskId, 48, "Conferindo documento exato, tag e disciplina"); await yieldFrame();
      const titleOptions = { titleSourceMode: state.titleSourceMode };
      if (requestedKeys) titleOptions.documentKeys = requestedKeys;
      state.titleRows = window.RECONCompute ? await window.RECONCompute.run("title", "audit-titles", { index: state.index, references: mergedTitleReferences(), options: titleOptions }) : Q.auditTitles(state.index, mergedTitleReferences(), titleOptions);
      setProgress("title", 90, "Conferindo suas correções anteriores…");
      applyTitleMemory(state.titleRows, await loadTitleMemory());
      if (titlePager) titlePager.reset();
      state.titleSelected.clear();
      populateSheetSelect(els.titleSheet, state.titleRows);
      els.titleResults.hidden = false;
      setProgress("title", 100, "Análise concluída");
      renderTitles();
      window.setTimeout(() => hideProgress("title"), 450);
      const suffix = titleScopeSpecific() && state.titleUnmatchedCodes.length ? ` · ${state.titleUnmatchedCodes.length} código(s) não localizado(s)` : "";
      showToast(`${state.titleRows.length.toLocaleString("pt-BR")} título(s) analisado(s)${suffix}.`, state.titleUnmatchedCodes.length ? "warn" : "success");
      if (Tasks) Tasks.finish(taskId, `${state.titleRows.length.toLocaleString("pt-BR")} títulos analisados${suffix}`);
    } catch (error) {
      console.error("RECON: falha na análise de títulos", error);
      hideProgress("title"); showToast("Não foi possível concluir a análise dos títulos. Confira a LD e tente novamente.", "error");
      if (Tasks) Tasks.fail(taskId, error);
    } finally { state.busyKinds.delete("title"); updateReady(); }
  }

  function rowById(kind, id) {
    return (kind === "databook" ? state.databookRows : state.titleRows).find((row) => row.id === id);
  }

  function handleBodyClick(kind, event) {
    if (kind === "title") {
      const restore = event.target.closest("button[data-restore-proposed]");
      if (restore) {
        const row = rowById(kind, restore.dataset.restoreProposed);
        if (row) {
          row.proposed = row.autoProposed || "";
          row.decision = undefined;
          renderTitles();
        }
        return;
      }
    }
    const button = event.target.closest("button[data-action][data-id]");
    if (!button) return;
    const row = rowById(kind, button.dataset.id);
    if (!row || !row.proposed) return;
    storeDecision(row, button.dataset.action === "approve" ? "approved" : "kept");
    (kind === "databook" ? renderDatabook : renderTitles)();
  }

  function handleTitleProposedEdit(event) {
    const textarea = event.target.closest("textarea[data-proposed-edit]");
    if (!textarea) return;
    const row = rowById("title", textarea.dataset.proposedEdit);
    if (!row || !titleEditable(row)) return;
    const value = textarea.value.trim();
    if (value === (row.proposed || "").trim()) return;
    row.proposed = value;
    // Uma aprovação anterior valia para o texto antigo; editar o título exige
    // uma nova confirmação explícita antes de valer para o Excel e para a LD.
    row.decision = undefined;
    renderTitles();
  }

  function handleSelection(kind, event) {
    const input = event.target.closest("input[data-select-id]");
    if (!input) return;
    const selected = kind === "databook" ? state.databookSelected : state.titleSelected;
    if (input.checked) selected.add(input.dataset.selectId); else selected.delete(input.dataset.selectId);
    (kind === "databook" ? renderDatabook : renderTitles)();
  }

  function selectVisible(kind, checked) {
    const selected = kind === "databook" ? state.databookSelected : state.titleSelected;
    const pager = kind === "databook" ? dbPager : titlePager;
    const pageRows = pager ? pager.slice(visibleRows(kind)) : visibleRows(kind).slice(0, DEFAULT_PAGE_SIZE);
    pageRows.filter((row) => row.issue !== "ok" && row.proposed).forEach((row) => checked ? selected.add(row.id) : selected.delete(row.id));
    (kind === "databook" ? renderDatabook : renderTitles)();
  }

  function decideSelected(kind, decision) {
    const selected = kind === "databook" ? state.databookSelected : state.titleSelected;
    const rows = [...selected].map((id) => rowById(kind, id)).filter((row) => row && row.proposed);
    if (decision === "approved" && rows.length > 1) {
      const items = PendingCore ? rows.map((row) => PendingCore.fromAuditRow(kind, row)) : [];
      const signature = items[0] && items[0].signature;
      if (!PendingCore || !PendingCore.verifyIdentical(items, signature)) {
        showToast("Para aprovar em grupo, selecione somente sugestões com evidências idênticas.", "warn");
        return;
      }
    }
    rows.forEach((row) => storeDecision(row, decision));
    selected.clear();
    (kind === "databook" ? renderDatabook : renderTitles)();
    showToast(decision === "approved" ? "Sugestões aprovadas." : "Valores atuais mantidos.", "success");
  }

  function approveEvidenceGroup(kind, ids, signature) {
    if (!PendingCore || !Array.isArray(ids) || ids.length < 2 || !signature) return false;
    const rows = ids.map((id) => rowById(kind, id)).filter(Boolean);
    if (rows.length !== ids.length || rows.some((row) => row.decision !== "pending" || !row.proposed || row.ldConflict && row.ldConflict.hasConflict)) return false;
    const items = rows.map((row) => PendingCore.fromAuditRow(kind, row));
    if (!PendingCore.verifyIdentical(items, signature)) return false;
    rows.forEach((row) => storeDecision(row, "approved"));
    (kind === "databook" ? renderDatabook : renderTitles)();
    showToast(`${rows.length} sugestões com evidência idêntica foram aprovadas.`, "success");
    return true;
  }

  function rebuildDatabookSourceIndex() {
    if (!AllocationSources) return;
    const rows = [...state.databookSourceRows.confirmation, ...state.databookSourceRows.allocation];
    state.databookSourceIndex = AllocationSources.buildIndex(rows);
    const confirmations = state.databookSourceRows.confirmation.length;
    const allocations = state.databookSourceRows.allocation.length;
    const rejected = state.databookSourceRejected.confirmation.length + state.databookSourceRejected.allocation.length;
    if (els.dbControlledStatus) {
      els.dbControlledStatus.textContent = rows.length
        ? `${confirmations.toLocaleString("pt-BR")} registro(s) de confirmação · ${allocations.toLocaleString("pt-BR")} registro(s) de alocação${rejected ? ` · ${rejected.toLocaleString("pt-BR")} ignorado(s) por inconsistência` : ""}`
        : "Selecione as pastas da rede para usar as fontes controladas";
    }
  }

  async function loadDatabookSourceFolder(kind, fileList) {
    if (!AllocationSources) { showToast("O leitor de alocações não está disponível.", "error"); return; }
    const files = Array.from(fileList || []).filter((file) => /\.(xlsx|xlsm|xls)$/i.test(file.name || "") && !/^~\$/.test(file.name || ""));
    const label = kind === "confirmation" ? "confirmações" : "alocações";
    const meta = kind === "confirmation" ? els.dbConfirmationMeta : els.dbAllocationMeta;
    if (!files.length) {
      state.databookSourceRows[kind] = []; state.databookSourceRejected[kind] = []; state.databookSourceFiles[kind] = [];
      if (meta) meta.textContent = "Nenhuma planilha válida selecionada";
      rebuildDatabookSourceIndex();
      return;
    }
    if (meta) meta.textContent = `Lendo ${files.length.toLocaleString("pt-BR")} arquivo(s)…`;
    const parsedRows = []; const rejected = []; let failed = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const workbook = await readWorkbook(file);
        const parsed = AllocationSources.parseWorkbook(workbook, XLSX, {
          kind, name: file.name, relativePath: file.webkitRelativePath || file.name, lastModified: file.lastModified,
        });
        parsedRows.push(...parsed.rows); rejected.push(...parsed.rejected);
      } catch (error) {
        failed += 1;
        rejected.push({ source: file.webkitRelativePath || file.name, reason: error.message || "Arquivo não pôde ser lido." });
      }
      if ((index + 1) % 8 === 0) await yieldFrame();
    }
    state.databookSourceRows[kind] = parsedRows;
    state.databookSourceRejected[kind] = rejected;
    state.databookSourceFiles[kind] = files;
    if (meta) meta.textContent = `${files.length.toLocaleString("pt-BR")} arquivo(s) · ${parsedRows.length.toLocaleString("pt-BR")} registro(s) válido(s)${failed ? ` · ${failed} falha(s)` : ""}`;
    rebuildDatabookSourceIndex();
    state.databookRows = []; state.databookSelected.clear(); els.dbResults.hidden = true;
    showToast(`Pasta de ${label} indexada. Analise novamente os caminhos.`, "success");
  }

  async function loadDatabookReference(file) {
    if (!file) return;
    try {
      const parsed = A.parseDatabookWorkbook(await readWorkbook(file), XLSX);
      if (!parsed.entries.length) throw new Error("A base não contém referências de Caminho Databook.");
      state.databookReferenceFile = file; state.catalog = parsed.entries;
      els.dbReferenceMeta.textContent = file.name; els.dbBaseStatus.textContent = `${parsed.entries.length} referências carregadas`;
      showToast("Base Databook atualizada.", "success");
    } catch (error) { els.dbReference.value = ""; showToast(error.message, "error"); }
  }

  async function loadTitleReference(file) {
    if (!file) return;
    try {
      const parsed = Q.parseTitleReferenceWorkbook(await readWorkbook(file), XLSX);
      if (!parsed.entries.length) throw new Error("Nenhuma relação adicional de documento, tag ou descrição foi localizada.");
      state.titleReferenceFile = file;
      state.titleSupplementalReferences = parsed;
      els.titleReferenceMeta.textContent = file.name;
      updateTitleReferenceStatus();
      showToast("Base adicional de títulos carregada sem substituir as fontes controladas.", "success");
    } catch (error) { els.titleReference.value = ""; showToast(error.message, "error"); }
  }

  async function loadSconReference(file) {
    if (!file) return;
    try {
      const parsed = Q.parseTitleReferenceWorkbook(await readWorkbook(file), XLSX);
      const scon = parsed && parsed.scon;
      if (!scon || !scon.entries.length) throw new Error("A planilha não contém as colunas CÓDIGO SGP e DESCRIÇÃO da base SCON.");
      state.sconReferenceFile = file;
      state.sconTitleReferences = scon;
      if (els.titleSconReferenceMeta) els.titleSconReferenceMeta.textContent = `${file.name} · ${scon.entries.length.toLocaleString("pt-BR")} códigos`;
      updateTitleReferenceStatus();
      showToast("Base SCON atualizada. O RECON usará o terceiro campo da coluna DESCRIÇÃO.", "success");
    } catch (error) {
      if (els.titleSconReference) els.titleSconReference.value = "";
      showToast(error.message || "Não foi possível carregar a base SCON.", "error");
    }
  }

  function decisionLabel(row) {
    if (row.issue === "ok") return "Sem alteração";
    if (row.decision === "approved") return "Sugestão aprovada";
    if (row.decision === "kept") return "Manter valor atual";
    return row.proposed ? "Pendente" : "Análise manual";
  }

  function issueLabel(kind, issue) {
    const labels = kind === "databook" ? { ok: "Adequado", missing: "Caminho vazio ou incompleto", divergent: "Caminho completo com referência divergente", unconfirmed: "Não confirmado", conflict: "Conflito na LD" }
      : { ok: "Adequado", empty: "Título vazio", generic: "Pouco específico", description_mismatch: "Descrição divergente", missing_tag: "TAG comprovada ausente", possible_identifier: "Possível identificador", format: "Padronização", conflict: "Conflito na LD" };
    return labels[issue] || issue;
  }

  function titleReferenceSummary(row) {
    if (row.nonTaggedRule) {
      return cleanTitleReportValue(`Item não tagueado — O QUÊ: ${row.nonTaggedWhat || "não identificado"} · ONDE/QUANDO: ${row.nonTaggedWhereWhen || "não identificado"}`);
    }
    const references = [
      row.sconTitleComplement ? `SCON TAG SGP: ${row.sconTitleComplement}` : "",
      row.sconEscopoTitle ? `SCON ESCOPO (${row.sconEscopoLookupTag || row.tag || "TAG"} · EAP ${row.sconEscopoDocumentEap || "não informado"}): ${row.sconEscopoTitle}` : "",
      row.appendixTitle ? `Apêndice 3 Rev.B (${(row.appendixMatchedTags || []).join(", ") || row.tag || "TAG"}): ${row.appendixTitle}` : "",
    ].filter(Boolean);
    if (!row.sconTitleComplement && row.sconCandidateTitles && row.sconCandidateTitles.length) {
      references.push(`SCON TAG SGP para conferência: ${row.sconCandidateTitles.join(" · ")}`);
    }
    if (!row.sconEscopoTitle && row.sconEscopoCandidateTitles && row.sconEscopoCandidateTitles.length) {
      references.push(`SCON ESCOPO para conferência: ${row.sconEscopoCandidateTitles.join(" · ")}`);
    }
    return cleanTitleReportValue(references.join(" | ") || row.description || row.evidence || "");
  }

  function simpleAuditMessage(row) {
    const message = row.userMessage && [row.userMessage.title, row.userMessage.explanation].filter(Boolean).join(" — ");
    return cleanTitleReportValue(message || row.reason || "");
  }

  function titleSourceSummary(row) {
    const details = [
      row.descriptionSource || "",
      row.sconMatchMode && row.sconMatch !== "NÃO" ? `SCON TAG SGP: ${row.sconMatchMode}` : "",
      row.sconEscopoMatchMode && row.sconEscopoMatch !== "NÃO" ? `SCON ESCOPO: ${row.sconEscopoMatchMode}` : "",
      row.appendixMatchMode && row.appendixMatch !== "NÃO" ? `Apêndice 3 Rev.B: ${row.appendixMatchMode}` : "",
    ].filter(Boolean);
    return cleanTitleReportValue([...new Set(details)].join(" · "));
  }

  function excelColumns(kind) {
    if (kind === "databook") return [
      ["Documento", "document"], ["Aba LD", "sheet"], ["Linha LD", "row"], ["Coluna LD", (row) => `${PendingCore && PendingCore.columnLetter(row.column) || "—"}${row.columnHeader ? ` · ${row.columnHeader}` : ""}`], ["Alocação", "allocation"], ["Fonte controlada", "controlledSourceKind"], ["Arquivo da fonte", "controlledSourceFile"], ["Aba da fonte", "controlledSourceSheet"], ["Linha da fonte", "controlledSourceRow"], ["Data da fonte", "controlledSourceDate"], ["Título na LD", "title"], ["Disciplina", "discipline"], ["Caminho atual", "current"], ["Caminho sugerido", "proposed"], ["Origem simples da sugestão", (row) => PendingCore ? PendingCore.originFor("databook", row) : row.evidence], ["Tipo da conclusão", conclusionLabel], ["Confiança", "confidence"], ["Conflito na LD", "conflictLd"], ["Situação", (row) => issueLabel(kind, row.issue)], ["Código interno", "reasonCode"], ["Mensagem simples", (row) => (row.userMessage && `${row.userMessage.title} ${row.userMessage.explanation}`) || row.reason], ["Próxima ação", (row) => row.userMessage && row.userMessage.nextAction || ""], ["Motivo técnico", "reason"], ["Evidência", "evidence"], ["Documentos relacionados", (row) => (row.relatedDocuments || []).join(" · ")], ["Decisão", decisionLabel], ["Valor após decisão", (row) => row.decision === "approved" ? row.proposed : row.current],
    ];
    return [
      ["Documento da LD", "document"],
      ["Local na LD", (row) => `${row.sheet || "Aba não informada"} · linha ${row.row || "não informada"}`],
      ["Disciplina", "discipline"],
      ["Título atual na LD", "current"],
      ["Chave consultada", (row) => `TAG ${row.sconEscopoLookupTag || row.tag || "não confirmada"} · EAP ${row.sconEscopoDocumentEap || "não informado"}`],
      ["O que as bases informam", titleReferenceSummary],
      ["Fonte principal", titleSourceSummary],
      ["Título recomendado", "proposed"],
      ["Situação", (row) => issueLabel(kind, row.issue)],
      ["Confiança da sugestão", "confidence"],
      ["Por que revisar", simpleAuditMessage],
      ["Próxima ação", (row) => row.userMessage && row.userMessage.nextAction || (row.proposed ? "Conferir e aprovar ou manter o título atual" : "Conferir manualmente")],
      ["Conflito na LD", "conflictLd"],
      ["Decisão", decisionLabel],
      ["Título final", (row) => row.decision === "approved" ? row.proposed : row.current],
    ];
  }

  function fillRange(sheet, range, argb) {
    const decoded = XLSX.utils.decode_range(range);
    for (let row = decoded.s.r + 1; row <= decoded.e.r + 1; row += 1) for (let column = decoded.s.c + 1; column <= decoded.e.c + 1; column += 1) sheet.getCell(row, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  function columnLetter(number) {
    let value = Number(number), result = "";
    while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
    return result;
  }

  async function ensureExportLibraries() {
    if (window.RECONModuleLoader) await window.RECONModuleLoader.ensure("export");
    if (!window.ExcelJS || !window.JSZip) throw new Error("Bibliotecas de exportação indisponíveis.");
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

  async function buildAuditWorkbook(kind) {
    await ensureExportLibraries();
    const rows = visibleRows(kind);
    if (!rows.length) throw new Error("Selecione uma aba com resultados antes de baixar o relatório.");
    const name = kind === "databook" ? "Caminho Databook" : "Revisão de Títulos";
    const workbook = new ExcelJS.Workbook(); workbook.creator = "RECON"; workbook.lastModifiedBy = "RECON"; workbook.company = "CONSAG Engenharia"; workbook.title = `RECON · ${name}`; workbook.created = new Date(); workbook.modified = new Date();
    const logoId = await logoDefinition(workbook);
    const summary = workbook.addWorksheet("Resumo", { properties: { defaultRowHeight: 18 } }); summary.views = [{ showGridLines: false }];
    fillRange(summary, "A1:H3", "FF153A5C"); summary.mergeCells("C1:H2"); summary.getCell("C1").value = `RECON · ${name}`; summary.getCell("C1").font = { name: "Aptos Display", size: 18, bold: true, color: { argb: "FFFFFFFF" } }; summary.getCell("C1").alignment = { vertical: "middle" };
    if (logoId !== null) summary.addImage(logoId, { tl: { col: .12, row: .18 }, ext: { width: 158, height: 58 } });
    const selectedSheet = (kind === "databook" ? els.dbSheet : els.titleSheet).value;
    const selectedSheetLabel = selectedSheet || "Todas as abas";
    summary.mergeCells("A4:H4"); summary.getCell("A4").value = `LD: ${state.file.name}  ·  Aba: ${selectedSheetLabel}  ·  Gerado em ${new Date().toLocaleString("pt-BR")}`; summary.getCell("A4").font = { name: "Aptos", size: 9, color: { argb: "FF52687B" } }; summary.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0F4" } };
    const totals = Q.summarize(rows); const cards = [["ANALISADOS", totals.all, "FF246FA3"], ["ADEQUADOS", totals.ok, "FF0C7657"], ["PARA REVISAR", totals.review, "FFA56812"], ["SEM SUGESTÃO SEGURA", totals.unsafe, "FF8A5C38"]];
    cards.forEach(([label, value, color], index) => { const start = index * 2 + 1; summary.mergeCells(6, start, 8, start + 1); const cell = summary.getCell(6, start); cell.value = { richText: [{ font: { name: "Aptos", size: 9, bold: true, color: { argb: "FF6F7E8C" } }, text: `${label}\n` }, { font: { name: "Aptos Display", size: 19, bold: true, color: { argb: color } }, text: Number(value).toLocaleString("pt-BR") }] }; cell.alignment = { vertical: "middle", wrapText: true }; fillRange(summary, `${columnLetter(start)}6:${columnLetter(start + 1)}8`, "FFF5F8FA"); cell.border = { left: { style: "medium", color: { argb: color } } }; });
    summary.mergeCells("A10:H10"); summary.getCell("A10").value = "CRITÉRIOS DA ANÁLISE"; summary.getCell("A10").font = { name: "Aptos", size: 9, bold: true, color: { argb: "FFFFFFFF" } }; summary.getCell("A10").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24689A" } };
    const controlledSourceSummary = kind === "databook"
      ? `${state.databookSourceRows.confirmation.length.toLocaleString("pt-BR")} registro(s) de confirmação · ${state.databookSourceRows.allocation.length.toLocaleString("pt-BR")} registro(s) de arquivo de alocação`
      : `${state.sconTitleReferences && state.sconTitleReferences.entries ? state.sconTitleReferences.entries.length.toLocaleString("pt-BR") : "0"} códigos SCON TAG SGP · ${state.sconEscopoTitleReferences && state.sconEscopoTitleReferences.uniqueTagCount ? state.sconEscopoTitleReferences.uniqueTagCount.toLocaleString("pt-BR") : "0"} TAGs / ${state.sconEscopoTitleReferences && state.sconEscopoTitleReferences.uniqueEapCount ? state.sconEscopoTitleReferences.uniqueEapCount.toLocaleString("pt-BR") : "0"} EAPs SCON ESCOPO · ${state.tagReferenceTitleReferences && state.tagReferenceTitleReferences.uniqueTagCount ? state.tagReferenceTitleReferences.uniqueTagCount.toLocaleString("pt-BR") : "0"} TAGs Apêndice 3 Rev.B · ${state.titleReferences && state.titleReferences.entries ? state.titleReferences.entries.length.toLocaleString("pt-BR") : "0"} conclusões controladas`;
    const criteriaRows = [["Princípio", kind === "databook" ? "A LD só é alterada em uma nova cópia após confirmação do download; caminhos controlados são copiados sem reescrever o texto" : "A LD só é alterada em uma nova cópia após confirmação do download"], ["Decisões aprovadas", totals.approved], [kind === "databook" ? "Fontes controladas" : "Bases da análise", controlledSourceSummary]];
    if (kind === "title") {
      criteriaRows.push(["Como ler", "“Título atual na LD” é o valor encontrado; “O que as bases informam” mostra as referências limpas; “Título recomendado” é a proposta para conferência antes da aprovação"]);
      criteriaRows.push(["Ordem da busca", "1. Separar o código EAP do 4º grupo e a TAG/combinação de TAGs do 7º grupo; 2. pesquisar TAG exata, normalizada e progressivamente em partes; 3. no SCON ESCOPO, priorizar TAG + EAP e depois usar a mesma TAG em outro EAP; 4. no Apêndice 3 Rev.B, localizar cada TAG de equipamento independentemente do EAP; 5. combinar descrições sem duplicação e preservar o tipo de relatório da LD"]);
      criteriaRows.push(["Regra TAG + EAP", "O EAP define o critério de medição, mas não muda a identidade da TAG. Quando o EAP exato não existe, o RECON pode usar a descrição da mesma TAG em outro EAP. Do SCON ESCOPO, usa o item/área; do Apêndice 3 Rev.B, usa a descrição do equipamento"]);
      criteriaRows.push(["Escopo da revisão", titleScopeSpecific() ? `${state.titleRequestedCodes.length} código(s) solicitado(s) · ${state.titleMatchedCodes.length} localizado(s) · ${state.titleUnmatchedCodes.length} não localizado(s)` : "Toda a LD"]);
    }
    criteriaRows.forEach(([label, value], index) => { const row = 11 + index; summary.mergeCells(`A${row}:B${row}`); summary.mergeCells(`C${row}:H${row}`); summary.getCell(`A${row}`).value = label; summary.getCell(`C${row}`).value = value; summary.getCell(`A${row}`).font = { name: "Aptos", size: 9, bold: true, color: { argb: "FF53697B" } }; summary.getCell(`C${row}`).font = { name: "Aptos", size: 9, color: { argb: "FF263E52" } }; summary.getCell(`C${row}`).alignment = { vertical: "middle", horizontal: "left", wrapText: true }; });
    [15, 15, 22, 22, 15, 15, 22, 22].forEach((width, index) => { summary.getColumn(index + 1).width = width; }); summary.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 }; summary.headerFooter.oddFooter = "&LRECON&C&P de &N&R&D";

    const audit = workbook.addWorksheet(kind === "title" ? "Títulos para revisar" : "Auditoria", { properties: { defaultRowHeight: 18 } }); const columns = excelColumns(kind); const last = columnLetter(columns.length); audit.views = [{ state: "frozen", ySplit: 6, showGridLines: false, zoomScale: 85 }]; fillRange(audit, `A1:${last}3`, "FF153A5C"); audit.mergeCells(`C1:${last}2`); audit.getCell("C1").value = `RECON · ${name}`; audit.getCell("C1").font = { name: "Aptos Display", size: 17, bold: true, color: { argb: "FFFFFFFF" } }; audit.getCell("C1").alignment = { vertical: "middle" }; if (logoId !== null) audit.addImage(logoId, { tl: { col: .12, row: .18 }, ext: { width: 158, height: 58 } });
    audit.mergeCells(`A4:${last}4`); audit.getCell("A4").value = `${rows.length.toLocaleString("pt-BR")} documento(s) · LD: ${state.file.name} · Aba: ${selectedSheetLabel}`; audit.getCell("A4").font = { name: "Aptos", size: 8, color: { argb: "FF536679" } }; audit.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0F4" } };
    const headerRow = audit.getRow(6); columns.forEach(([label], index) => { const cell = headerRow.getCell(index + 1); cell.value = label; cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF225D87" } }; cell.alignment = { vertical: "middle", wrapText: true }; }); headerRow.height = 32;
    rows.forEach((row, rowIndex) => { const excelRow = audit.getRow(rowIndex + 7); columns.forEach(([, field], columnIndex) => { const raw = typeof field === "function" ? field(row) : row[field]; const cell = excelRow.getCell(columnIndex + 1); cell.value = raw === "" || raw === undefined ? null : raw; cell.font = { name: "Aptos", size: 9.5, color: { argb: "FF30465A" } }; cell.alignment = { vertical: "middle", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex % 2 ? "FFF8FAFB" : "FFFFFFFF" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFDCE4EA" } } }; }); excelRow.height = kind === "title" ? 56 : 40; });
    audit.autoFilter = { from: "A6", to: `${last}${rows.length + 6}` }; columns.forEach(([label], index) => { const n = Q.norm(label); audit.getColumn(index + 1).width = /TITULO|CAMINHO|EVIDENCIA|MOTIVO|RELACIONADO|VALOR APOS|BASES INFORMAM|POR QUE/.test(n) ? 38 : /DOCUMENTO/.test(n) ? 30 : /DISCIPLINA/.test(n) ? 22 : /FONTE PRINCIPAL|PROXIMA ACAO/.test(n) ? 24 : 16; }); audit.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .25, right: .25, top: .45, bottom: .45, header: .2, footer: .2 }, horizontalCentered: true }; audit.pageSetup.printTitlesRow = "6:6"; audit.headerFooter.oddFooter = `&LRECON · ${kind === "title" ? "Títulos para revisar" : "Auditoria"}&C&P de &N&R&D`;

    if (kind === "title" && titleScopeSpecific()) {
      const requestSheet = workbook.addWorksheet("Códigos solicitados", { properties: { defaultRowHeight: 18 } });
      requestSheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
      const rowByKey = new Map(state.titleRows.map((row) => [row.documentKey, row]));
      const requestRows = state.titleMatchedCodes.map((item) => {
        const row = rowByKey.get(item.documentKey) || {};
        return [item.requestedCode, "Localizado", row.document || item.document, row.sheet || item.sheet || "", row.row || "", row.current || "", row.proposed || row.current || "", row.confidence || "", row.reason || "Título localizado na LD"];
      }).concat(state.titleUnmatchedCodes.map((item) => [item.requestedCode, "Não localizado", "", "", "", "", "", "", item.reason]));
      const requestHeaders = ["Código solicitado", "Resultado", "Documento localizado", "Aba LD", "Linha LD", "Título atual", "Título recomendado", "Confiança", "Observação"];
      requestSheet.addRow(requestHeaders);
      requestRows.forEach((values) => requestSheet.addRow(values));
      requestSheet.getRow(1).eachCell((cell) => { cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF225D87" } }; cell.alignment = { vertical: "middle", wrapText: true }; });
      requestSheet.getRow(1).height = 30;
      requestSheet.columns = [28, 16, 36, 12, 10, 46, 46, 14, 42].map((width) => ({ width }));
      for (let index = 2; index <= requestRows.length + 1; index += 1) requestSheet.getRow(index).eachCell((cell) => { cell.font = { name: "Aptos", size: 9.5, color: { argb: "FF30465A" } }; cell.alignment = { vertical: "middle", wrapText: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 ? "FFF8FAFB" : "FFFFFFFF" } }; cell.border = { bottom: { style: "hair", color: { argb: "FFDCE4EA" } } }; });
      requestSheet.autoFilter = { from: "A1", to: `I${requestRows.length + 1}` };
      requestSheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    }
    return workbook;
  }

  async function exportAudit(kind) {
    const taskId = Tasks ? Tasks.start(kind === "databook" ? "Exportar auditoria Databook" : "Exportar auditoria de títulos", state.file && state.file.name) : "";
    try {
      const workbook = await buildAuditWorkbook(kind); const buffer = await workbook.xlsx.writeBuffer(); const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `RECON_${kind === "databook" ? "Auditoria_Databook" : titleScopeSpecific() ? "Revisao_de_Titulos_Codigos_Especificos" : "Revisao_de_Titulos"}_${safeStem((kind === "databook" ? els.dbSheet : els.titleSheet).value || "Todas_as_abas")}_${safeStem(state.file && state.file.name)}_${compactStamp()}.xlsx`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); showToast("Relatório Excel gerado.", "success");
      if (Tasks) Tasks.finish(taskId, "Relatório Excel validado e baixado");
    } catch (error) { if (Tasks) Tasks.fail(taskId, error); showToast(error.message || "Não foi possível gerar o relatório.", "error"); }
  }

  function downloadBuffer(buffer, fileName, mimeType) {
    const blob = new Blob([buffer], { type: mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // Escreve o buffer final no mesmo arquivo (File System Access API) ou baixa
  // uma cópia, conforme o modo escolhido. As duas funções que chamam isto já
  // geram o buffer a partir do arquivo ORIGINAL inalterado mais o conjunto
  // completo de decisões aprovadas — então repetir "salvar no arquivo
  // original" mais de uma vez na mesma sessão sempre regrava o estado final
  // correto, nunca acumula em cima de uma gravação anterior.
  async function deliverWorkbook(result, inPlace) {
    if (inPlace) {
      if (!state.fileHandle || !window.RECONFileHandles) {
        throw new Error("A permissão de edição direta não está mais disponível para este arquivo. Baixe uma cópia.");
      }
      await window.RECONFileHandles.writeBuffer(state.fileHandle, result.buffer);
      return;
    }
    const macro = /\.xlsm$/i.test(result.fileName);
    downloadBuffer(result.buffer, result.fileName, macro ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  async function applyDatabookToLd(options) {
    const inPlace = Boolean(options && options.inPlace);
    await ensureExportLibraries();
    const approved = state.databookRows.filter((row) => row.decision === "approved" && row.proposed && row.controlledSource);
    if (!approved.length) { showToast("Nenhum Caminho Databook confirmado por alocação está pronto para aplicação.", "error"); return; }
    if (!DatabookWriter) { showToast("O gravador de Caminho Databook não está disponível.", "error"); return; }
    const button = inPlace ? els.dbApplyLdInplace : els.dbApplyLd;
    const taskId = Tasks ? Tasks.start(inPlace ? "Salvar Databook no arquivo original" : "Gerar cópia da LD com Databook", `${approved.length} caminho(s) confirmado(s)`) : "";
    const originalLabel = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = inPlace ? "Salvando…" : "Gerando cópia…"; }
    try {
      const result = await DatabookWriter.apply(state.file, approved, XLSX, JSZip);
      await deliverWorkbook(result, inPlace);
      if (Tasks) Tasks.finish(taskId, inPlace ? "Arquivo original atualizado" : `${result.count} caminho(s) copiados exatamente da alocação`);
      showToast(inPlace ? `${result.count} caminho(s) salvos direto em "${state.file.name}".` : `${result.summary.title} ${result.summary.explanation}`, "success");
    } catch (error) {
      if (Tasks) Tasks.fail(taskId, error);
      showToast(error.message || "Não foi possível gravar os caminhos do Databook.", "error");
    } finally { if (button) button.textContent = originalLabel; renderSummary("databook"); }
  }

  async function applyTitlesToLd(options) {
    const inPlace = Boolean(options && options.inPlace);
    await ensureExportLibraries();
    const approved = state.titleRows.filter((row) => row.decision === "approved" && row.proposed);
    if (!approved.length) { showToast("Aprove ao menos um título antes de gerar a LD revisada.", "error"); return; }
    const button = inPlace ? els.titleApplyLdInplace : els.titleApplyLd;
    const taskId = Tasks ? Tasks.start(inPlace ? "Salvar títulos no arquivo original" : "Gerar cópia da LD revisada", `${approved.length} título(s)`) : "";
    const originalLabel = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = inPlace ? "Salvando…" : "Gerando cópia…"; }
    try {
      const plan = await TitleWriter.planChanges(state.file, approved, XLSX, JSZip);
      const guard = ExportGuard ? ExportGuard.validatePlan(plan) : (Contracts ? Contracts.validateChangeSet(plan.changes) : { valid: true, errors: [] });
      if (!guard.valid) throw new Error(guard.errors.join(" "));
      const result = await TitleWriter.apply(state.file, approved, XLSX, JSZip);
      await deliverWorkbook(result, inPlace);
      if (Tasks) Tasks.finish(taskId, inPlace ? "Arquivo original atualizado" : `${result.count} título(s) aplicados e reabertos para validação`);
      showToast(inPlace
        ? `${result.count} título(s) salvos direto em "${state.file.name}".`
        : (result.summary ? `${result.summary.title} ${result.summary.explanation}` : `${result.count} título(s) alterados. A LD original permaneceu intacta.`), "success");
    } catch (error) {
      if (Tasks) Tasks.fail(taskId, error);
      showToast(error.message || "Não foi possível gravar a revisão dos títulos.", "error");
    } finally {
      if (button) button.textContent = originalLabel;
      renderSummary("title");
    }
  }

  async function bundledArrayBuffer(fileName) {
    const offline = window.RECONOfflineResources;
    if (offline && (offline.has(fileName) || await offline.ensure(fileName))) return offline.arrayBuffer(fileName);
    throw new Error(`Base incorporada indisponível: ${fileName}`);
  }

  async function loadBundledReferences() {
    const jobs = [
      bundledArrayBuffer("Analise_descricoes_Planilha1.xlsx").then(async (buffer) => {
        const workbook = window.RECONWorkbookWorker ? await window.RECONWorkbookWorker.readBuffer(buffer, "titles-control-base", { cellDates: true, cellFormula: true }) : XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
        const parsed = Q.parseTitleReferenceWorkbook(workbook, XLSX);
        if (parsed.entries.length !== 782) throw new Error(`A base de títulos contém ${parsed.entries.length} de 782 registros esperados.`);
        state.titleReferences = parsed;
        updateTitleReferenceStatus();
      }),
      bundledArrayBuffer("Caminho data book_Rev.A VINI.xlsx").then(async (buffer) => {
        const workbook = window.RECONWorkbookWorker ? await window.RECONWorkbookWorker.readBuffer(buffer, "databook-rev-a", { cellDates: true, cellFormula: true }) : XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
        const parsed = A.parseDatabookWorkbook(workbook, XLSX);
        if (parsed.entries.length !== 158) throw new Error(`A base Databook contém ${parsed.entries.length} de 158 referências esperadas.`);
        const merged = new Map([...state.catalog, ...parsed.entries].map((item) => [`${Q.norm(item.description)}|${A.pathKey(item.databook)}`, item]));
        state.catalog = [...merged.values()]; els.dbBaseStatus.textContent = `${parsed.entries.length} referências validadas · base Rev.A`;
      }),
      Promise.resolve().then(() => {
        if (!window.RECONSconEscopoTitleCatalog) throw new Error("O SCON ESCOPO incorporado não foi carregado.");
        const parsed = Q.parseSconEscopoTitleCatalog(window.RECONSconEscopoTitleCatalog);
        if (parsed.entries.length !== 7798 || parsed.uniqueTagCount !== 3027 || parsed.uniqueEapCount !== 71) {
          throw new Error(`O SCON ESCOPO contém ${parsed.entries.length} linhas, ${parsed.uniqueTagCount} TAGs e ${parsed.uniqueEapCount} EAPs; eram esperadas 7.798 linhas, 3.027 TAGs e 71 EAPs.`);
        }
        state.sconEscopoTitleReferences = parsed;
        updateTitleReferenceStatus();
      }),
      Promise.resolve().then(() => {
        if (!window.RECONTagReferenceCatalog) throw new Error("O Apêndice 3 Rev.B incorporado não foi carregado.");
        const parsed = Q.parseTagReferenceCatalog(window.RECONTagReferenceCatalog);
        if (parsed.entries.length < 5600 || parsed.uniqueTagCount < 5500) {
          throw new Error(`O Apêndice 3 Rev.B contém somente ${parsed.entries.length} registros e ${parsed.uniqueTagCount} TAGs válidas.`);
        }
        state.tagReferenceTitleReferences = parsed;
        updateTitleReferenceStatus();
      }),
    ];
    const results = await Promise.allSettled(jobs);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      console.warn("RECON: falha ao carregar base incorporada", failures.map((result) => result.reason));
      showToast("Uma base incorporada não pôde ser carregada. O RECON continuará conservador e sem aplicar sugestões incertas.", "warn");
    }
    state.titleBaseLoading = false;
    updateReady();
  }

  window.addEventListener("recon:ld-ready", (event) => {
    state.file = event.detail.file; state.fileHandle = event.detail.fileHandle || null; state.parsed = event.detail.parsed; state.index = event.detail.index; state.databookRows = []; state.titleRows = []; state.databookSelected.clear(); state.titleSelected.clear(); els.dbResults.hidden = true; els.titleResults.hidden = true;
    if (dbPager) dbPager.reset(); if (titlePager) titlePager.reset();
    if (titleScopeSpecific()) resolveTitleScope();
    updateReady();
  });
  window.addEventListener("recon:ld-cleared", () => { state.file = null; state.fileHandle = null; state.parsed = null; state.index = null; state.databookRows = []; state.titleRows = []; state.titleMatchedCodes = []; state.titleUnmatchedCodes = []; els.dbResults.hidden = true; els.titleResults.hidden = true; updateReady(); });
  els.dbReference.addEventListener("change", () => loadDatabookReference(els.dbReference.files && els.dbReference.files[0]));
  if (els.dbConfirmationFolder) els.dbConfirmationFolder.addEventListener("change", () => loadDatabookSourceFolder("confirmation", els.dbConfirmationFolder.files));
  if (els.dbAllocationFolder) els.dbAllocationFolder.addEventListener("change", () => loadDatabookSourceFolder("allocation", els.dbAllocationFolder.files));
  if (els.titleReference) els.titleReference.addEventListener("change", () => loadTitleReference(els.titleReference.files && els.titleReference.files[0]));
  if (els.titleSconReference) els.titleSconReference.addEventListener("change", () => loadSconReference(els.titleSconReference.files && els.titleSconReference.files[0]));
  if (els.titleMemoryClear) els.titleMemoryClear.addEventListener("click", () => {
    if (!window.RECONDB) return;
    if (!window.confirm("Apagar todas as correções de título aprendidas neste navegador? Isso não pode ser desfeito.")) return;
    window.RECONDB.clear(TITLE_MEMORY_STORE).then(() => {
      updateTitleMemoryStatus();
      showToast("Memória de correções apagada.", "success");
    }).catch((error) => showToast(error.message || "Não foi possível apagar a memória.", "error"));
  });
  els.titleScopeRadios.forEach((radio) => radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.titleScopeMode = radio.value === "specific" ? "specific" : "all";
    if (els.titleCodeLoader) els.titleCodeLoader.hidden = !titleScopeSpecific();
    state.titleRows = [];
    state.titleSelected.clear();
    if (els.titleResults) els.titleResults.hidden = true;
    if (titleScopeSpecific() && state.index) resolveTitleScope();
    updateReady();
  }));
  els.titleSourceRadios.forEach((radio) => radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.titleSourceMode = ["scon_only", "appendix_only"].includes(radio.value) ? radio.value : "auto";
    // A fonte muda o texto do título recomendado; uma análise já feita com a
    // fonte anterior não pode continuar visível como se já refletisse a nova escolha.
    state.titleRows = [];
    state.titleSelected.clear();
    if (els.titleResults) els.titleResults.hidden = true;
    updateReady();
  }));
  if (els.titleCodeText) els.titleCodeText.addEventListener("input", () => { state.titleRows = []; if (els.titleResults) els.titleResults.hidden = true; updateReady(); });
  if (els.titleCodeFile) els.titleCodeFile.addEventListener("change", () => loadTitleCodeFile(els.titleCodeFile.files && els.titleCodeFile.files[0]));
  if (els.titleCodePrepare) els.titleCodePrepare.addEventListener("click", () => {
    if (!state.index) { showToast("Carregue a LD antes de preparar os códigos.", "warn"); return; }
    const scope = resolveTitleScope();
    showToast(scope.matched.length ? `${scope.matched.length} código(s) localizado(s) na LD.` : "Nenhum código localizado na LD.", scope.matched.length ? (scope.unmatched.length ? "warn" : "success") : "error");
  });
  if (els.titleCodeClear) els.titleCodeClear.addEventListener("click", clearTitleCodes);
  els.dbAnalyze.addEventListener("click", analyzeDatabook); els.titleAnalyze.addEventListener("click", analyzeTitles);
  els.dbSheet.addEventListener("change", () => { state.databookSelected.clear(); if (dbPager) dbPager.reset(); renderDatabook(); });
  els.titleSheet.addEventListener("change", () => { state.titleSelected.clear(); if (titlePager) titlePager.reset(); renderTitles(); });
  [els.dbSearch, els.dbIssue, els.dbConfidence].forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { if (dbPager) dbPager.reset(); renderDatabook(); }));
  [els.titleSearch, els.titleIssue, els.titleSource, els.titleConfidence].filter(Boolean).forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { saveTitleFilters(); if (titlePager) titlePager.reset(); renderTitles(); }));
  els.dbBody.addEventListener("click", (event) => handleBodyClick("databook", event)); els.dbBody.addEventListener("change", (event) => handleSelection("databook", event));
  els.titleBody.addEventListener("click", (event) => handleBodyClick("title", event)); els.titleBody.addEventListener("change", (event) => { handleSelection("title", event); handleTitleProposedEdit(event); });
  els.dbSelectVisible.addEventListener("change", () => selectVisible("databook", els.dbSelectVisible.checked)); els.titleSelectVisible.addEventListener("change", () => selectVisible("title", els.titleSelectVisible.checked));
  els.dbApproveSelected.addEventListener("click", () => decideSelected("databook", "approved")); els.dbKeepSelected.addEventListener("click", () => decideSelected("databook", "kept"));
  els.titleApproveSelected.addEventListener("click", () => decideSelected("title", "approved")); els.titleKeepSelected.addEventListener("click", () => decideSelected("title", "kept"));
  els.dbExport.addEventListener("click", () => exportAudit("databook")); els.titleExport.addEventListener("click", () => exportAudit("title"));
  if (els.dbApplyLd) els.dbApplyLd.addEventListener("click", () => applyDatabookToLd({ inPlace: false }));
  if (els.dbApplyLdInplace) els.dbApplyLdInplace.addEventListener("click", () => applyDatabookToLd({ inPlace: true }));
  if (els.titleApplyLd) els.titleApplyLd.addEventListener("click", () => applyTitlesToLd({ inPlace: false }));
  if (els.titleApplyLdInplace) els.titleApplyLdInplace.addEventListener("click", () => applyTitlesToLd({ inPlace: true }));
  const savedTitleFilters = readTitleFilters();
  if (els.titleIssue && [...els.titleIssue.options].some((option) => option.value === savedTitleFilters.issue)) els.titleIssue.value = savedTitleFilters.issue || "";
  if (els.titleConfidence && [...els.titleConfidence.options].some((option) => option.value === savedTitleFilters.confidence)) els.titleConfidence.value = savedTitleFilters.confidence || "";
  if (els.titleSource && [...els.titleSource.options].some((option) => option.value === savedTitleFilters.source)) els.titleSource.value = savedTitleFilters.source || "";
  if (els.titleSearch) els.titleSearch.value = Q.text(savedTitleFilters.search);
  rebuildDatabookSourceIndex(); loadBundledReferences(); updateTitleMemoryStatus(); updateReady(); renderDatabook(); renderTitles();
  window.RECONOutputPreviewProviders = window.RECONOutputPreviewProviders || {};
  window.RECONOutputPreviewProviders.databook = () => ({
    title: "Decisões do relatório de Databook",
    summary: `${state.databookRows.length} documento(s) analisado(s)`,
    expectedInputs: state.databookRows.length,
    accountedInputs: state.databookRows.length,
    requireUniqueTargets: false,
    items: state.databookRows.map((row) => ({
      primary: row.document,
      secondary: row.decision === "approved" && row.proposed ? row.proposed : row.current || "Mantido sem preenchimento",
      meta: row.decision === "approved" ? "Sugestão aprovada" : row.decision === "kept" ? "Valor mantido" : "Sem decisão de alteração",
    })),
  });
  window.RECONOutputPreviewProviders.databookApply = () => {
    const approved = state.databookRows.filter((row) => row.decision === "approved" && row.proposed && row.controlledSource);
    return {
      title: "Caminhos que serão aplicados na cópia da LD",
      summary: `${approved.length} caminho(s) confirmado(s) por alocação`,
      expectedInputs: approved.length,
      accountedInputs: approved.length,
      requireUniqueTargets: false,
      items: approved.map((row) => ({
        primary: row.document,
        secondary: row.proposed,
        meta: `${row.allocation || "Alocação não informada"} · ${row.controlledSourceKind || "Fonte controlada"}${row.controlledSourceFile ? ` · ${row.controlledSourceFile}` : ""}`,
      })),
    };
  };
  window.RECONOutputPreviewProviders.titles = () => ({
    title: "Decisões do relatório de títulos",
    summary: `${state.titleRows.length} título(s) analisado(s)`,
    expectedInputs: state.titleRows.length,
    accountedInputs: state.titleRows.length,
    requireUniqueTargets: false,
    items: state.titleRows.map((row) => ({
      primary: row.current || row.document,
      secondary: row.decision === "approved" && row.proposed ? row.proposed : row.current || row.document,
      meta: row.document,
    })),
  });
  window.RECONOutputPreviewProviders.titlesApply = () => {
    const approved = state.titleRows.filter((row) => row.decision === "approved" && row.proposed);
    return {
      title: "Títulos que serão alterados na cópia da LD",
      summary: `${approved.length} alteração(ões) aprovada(s)`,
      expectedInputs: approved.length,
      accountedInputs: approved.length,
      requireUniqueTargets: false,
      items: approved.map((row) => ({ primary: row.current || row.document, secondary: row.proposed, meta: `${row.document} · ${row.sheet}` })),
    };
  };

  let sconReleaseTimer = 0;
  window.addEventListener("recon:module", (event) => {
    window.clearTimeout(sconReleaseTimer);
    const module = event.detail && event.detail.module;
    if (module === "titles") return;
    if (state.sconReferenceFile) return;
    sconReleaseTimer = window.setTimeout(() => {
      state.sconTitleReferences = null;
      if (window.RECONSconCatalog) window.RECONSconCatalog.clear();
      updateTitleReferenceStatus();
    }, 120000);
  });
  window.RECONAudits = { state, analyzeDatabook, analyzeTitles, buildAuditWorkbook, visibleRows, mergedTitleReferences, loadSconReference, approveEvidenceGroup, resolveTitleScope, matchRequestedCode };
})();
