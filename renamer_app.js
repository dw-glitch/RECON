(function () {
  "use strict";

  function notifyReconUi() {
    window.dispatchEvent(new CustomEvent("recon:ui-update"));
  }

  const Core = window.RECONRenamerCore;
  const Tasks = window.QualityTaskCenter;
  const ExportGuard = window.RECONExportGuard;
  const PRESET_KEY = "recon.renamer.presets.v1";
  const MAX_SAVED_PRESETS = 20;
  const FILTER_KEY = "recon.renamer.filters.v2";
  const CONCURRENCY = 3;
  const $ = (selector) => document.querySelector(selector);

  const OfflineResources = window.RECONOfflineResources;
  let pdfWorkerObjectUrl = "";
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    if (OfflineResources && OfflineResources.has("pdf.worker.min.js")) {
      pdfWorkerObjectUrl = OfflineResources.objectUrl("pdf.worker.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerObjectUrl;
    } else {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
    }
  }
  window.addEventListener("beforeunload", () => { if (pdfWorkerObjectUrl && OfflineResources) OfflineResources.revokeObjectUrls(); });

  const els = {
    sourceCard: $(".recon-source"), files: $("#renamer-files"), folder: $("#renamer-folder"), clear: $("#renamer-clear"), dropzone: $("#renamer-dropzone"), fileMeta: $("#renamer-file-meta"),
    preset: $("#renamer-preset"), template: $("#renamer-template"), sort: $("#renamer-sort"), start: $("#renamer-start"), padding: $("#renamer-padding"), pages: $("#renamer-pages"), label: $("#renamer-label"),
    choiceHelp: $("#renamer-choice-help"), exampleName: $("#renamer-example-name"), advanced: $("#renamer-advanced"),
    pattern: $("#renamer-pattern"), patternText: $("#renamer-pattern-text"), usePattern: $("#renamer-use-pattern"), presetName: $("#renamer-preset-name"), savePreset: $("#renamer-save-preset"), deletePreset: $("#renamer-delete-preset"),
    ready: $("#renamer-ready"), analyze: $("#renamer-analyze"), progress: $("#renamer-progress"), progressBar: $("#renamer-progress-bar"), progressText: $("#renamer-progress-text"),
    results: $("#renamer-results"), resultMeta: $("#renamer-result-meta"), download: $("#renamer-download"), selectAll: $("#renamer-select-all"), queue: $("#renamer-queue-list"), queueSearch: $("#ops-renamer-search"), queueStatus: $("#ops-renamer-status"), filterCount: $("#ops-renamer-filter-count"), clearFilters: $("#renamer-clear-filters"), confirmReady: $("#renamer-confirm-ready"), packageSummary: $("#renamer-package-summary"), packageSummaryText: $("#renamer-package-summary-text"),
    canvas: $("#renamer-canvas"), canvasWrap: $("#renamer-canvas-wrap"), previewEmpty: $("#renamer-preview-empty"), pageMeta: $("#renamer-page-meta"), prevPage: $("#renamer-prev-page"), nextPage: $("#renamer-next-page"),
    currentName: $("#renamer-current-name"), certificate: $("#renamer-certificate"), candidates: $("#renamer-candidates"), sequence: $("#renamer-sequence"), finalName: $("#renamer-final-name"), itemState: $("#renamer-item-state"), itemSelected: $("#renamer-item-selected"), confirm: $("#renamer-confirm"), prev: $("#renamer-prev"), next: $("#renamer-next"), toast: $("#toast"),
  };

  const state = {
    files: [], items: [], currentIndex: -1, currentPage: 1, previewToken: 0, busy: false, pattern: null, customPresets: readPresets(), queueSearch: "", queueStatus: "all",
  };
  const queuePager = window.RECONPager && window.RECONPager.create("renamer", els.resultMeta, () => renderQueue(), 50);

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function uid() { return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  function showToast(message, kind) { if (!els.toast) return; els.toast.textContent = message; els.toast.className = `toast show ${kind || ""}`.trim(); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { els.toast.className = "toast"; }, 4200); }
  function yieldFrame() { return new Promise((resolve) => setTimeout(resolve, 0)); }
  function readPresets() { try { const value = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]"); return Array.isArray(value) ? value.slice(0, MAX_SAVED_PRESETS) : []; } catch (_) { return []; } }
  function writePresets() { try { localStorage.setItem(PRESET_KEY, JSON.stringify(state.customPresets.slice(0, MAX_SAVED_PRESETS))); } catch (_) { /* conveniência local */ } }
  function readFilters() { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {}; } catch (_) { return {}; } }
  function writeFilters() { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ search: state.queueSearch, status: state.queueStatus })); } catch (_) {} }
  function setProgress(value, message) { els.progress.hidden = false; els.progressBar.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`; els.progressText.textContent = message; }
  function hideProgress() { els.progress.hidden = true; }

  function validPdfFiles(fileList) {
    const seen = new Set(state.files.map((file) => `${file.name}|${file.size}|${file.lastModified}`));
    return [...(fileList || [])].filter((file) => {
      if (!file || !/\.pdf$/i.test(file.name) || Number(file.size) <= 0 || /^~\$|^\./.test(file.name)) return false;
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function addFiles(fileList) {
    const added = validPdfFiles(fileList);
    if (!added.length) { if (fileList && fileList.length) showToast("Nenhum PDF novo foi adicionado.", "warn"); return; }
    state.files.push(...added);
    state.items = [];
    state.currentIndex = -1;
    state.pattern = Core.inferFilenamePattern(state.files.map((file) => file.name));
    renderSource();
    renderPattern();
    els.results.hidden = true;
    showToast(`${added.length} PDF(s) adicionado(s).`, "success");
  }

  function clearAll() {
    state.files = [];
    state.items = [];
    state.currentIndex = -1;
    state.pattern = null;
    els.files.value = "";
    els.folder.value = "";
    els.results.hidden = true;
    if (els.packageSummary) els.packageSummary.hidden = true;
    if (els.packageSummaryText) els.packageSummaryText.textContent = "";
    renderSource();
    renderPattern();
    clearPreview();
  }

  function renderSource() {
    const count = state.files.length;
    els.fileMeta.textContent = count ? `${count} PDF(s) · ${(state.files.reduce((sum, file) => sum + Number(file.size || 0), 0) / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : "Nenhum PDF selecionado";
    els.ready.textContent = count ? `${count} PDF(s) pronto(s) para leitura` : "Selecione os PDFs";
    els.analyze.disabled = !count || state.busy;
    els.clear.disabled = !count || state.busy;
  }

  function renderPattern() {
    if (!state.pattern || state.files.length < 2) { els.pattern.hidden = true; return; }
    const prefix = state.pattern.prefix || "—";
    const suffix = state.pattern.suffix || "—";
    const sample = state.pattern.variables.slice(0, 3).filter(Boolean).join(" · ") || "sem trecho variável";
    els.patternText.textContent = `Fixo antes: ${prefix} | variável: ${sample} | fixo depois: ${suffix}`;
    els.pattern.hidden = false;
  }

  function loadPresetOptions(selectedValue) {
    [...els.preset.querySelectorAll('option[data-saved="true"]')].forEach((option) => option.remove());
    state.customPresets.forEach((preset) => {
      const option = document.createElement("option");
      option.value = `saved:${preset.id}`;
      option.dataset.saved = "true";
      option.textContent = preset.name;
      els.preset.append(option);
    });
    if (selectedValue && [...els.preset.options].some((option) => option.value === selectedValue)) els.preset.value = selectedValue;
  }

  function configuration() {
    return {
      template: els.template.value.trim() || "{original}", sort: els.sort.value, start: Math.max(0, Number(els.start.value) || 0), padding: Math.max(1, Math.min(8, Number(els.padding.value) || 3)), pages: Math.max(0, Number(els.pages.value) || 0), label: els.label.value.trim(),
    };
  }

  function updateFriendlyExample() {
    const preset = els.preset.value;
    const template = els.template.value.trim() || "{original}";
    const sample = Core.formatTemplate(template, {
      originalName: "RELATORIO_INSPECAO.pdf",
      certificate: "123456",
      sequence: Math.max(0, Number(els.start.value) || 1),
      page: 1,
    }, { padding: Math.max(1, Math.min(8, Number(els.padding.value) || 3)) });
    const help = {
      certificate: "Exemplo: o número 123456 encontrado no PDF vira 123456.pdf.",
      "original-certificate": "Exemplo: RELATORIO_INSPECAO_123456.pdf.",
      sequence: "Exemplo: CERTIFICADO_001.pdf, CERTIFICADO_002.pdf...",
      custom: "Você escolhe quais partes formam o novo nome nos ajustes avançados.",
    };
    if (els.choiceHelp) els.choiceHelp.textContent = help[preset] || help.custom;
    if (els.exampleName) els.exampleName.textContent = sample || "Exemplo.pdf";
    if (els.advanced && preset === "custom") els.advanced.open = true;
  }

  function applyPreset(value) {
    const builtIn = { certificate: "{certificado}", "original-certificate": "{original}_{certificado}", sequence: "CERTIFICADO_{sequencia}" };
    if (builtIn[value]) els.template.value = builtIn[value];
    if (value.startsWith("saved:")) {
      const preset = state.customPresets.find((item) => item.id === value.slice(6));
      if (preset) {
        els.template.value = preset.template || "{original}";
        els.sort.value = preset.sort || "original";
        els.start.value = Number(preset.start) || 0;
        els.padding.value = Number(preset.padding) || 3;
        els.pages.value = String(preset.pages == null ? 3 : preset.pages);
        els.label.value = preset.label || "";
        els.presetName.value = preset.name;
      }
    } else els.presetName.value = "";
    els.deletePreset.hidden = !value.startsWith("saved:");
    updateFriendlyExample();
    recompute(false);
  }

  function savePreset() {
    const name = els.presetName.value.trim();
    if (!name) { showToast("Informe um nome para salvar o padrão.", "warn"); els.presetName.focus(); return; }
    const current = configuration();
    const existing = state.customPresets.find((preset) => preset.name.toLocaleUpperCase("pt-BR") === name.toLocaleUpperCase("pt-BR"));
    const record = { id: existing ? existing.id : uid(), name, ...current, savedAt: Date.now() };
    state.customPresets = [record, ...state.customPresets.filter((preset) => preset.id !== record.id)].slice(0, MAX_SAVED_PRESETS);
    writePresets();
    loadPresetOptions(`saved:${record.id}`);
    els.deletePreset.hidden = false;
    showToast("Padrão salvo neste navegador.", "success");
  }

  function deletePreset() {
    if (!els.preset.value.startsWith("saved:")) return;
    const id = els.preset.value.slice(6);
    state.customPresets = state.customPresets.filter((preset) => preset.id !== id);
    writePresets();
    loadPresetOptions("certificate");
    applyPreset("certificate");
    showToast("Padrão excluído.", "success");
  }

  function contentText(content) {
    const output = [];
    let previousY = null;
    (content.items || []).forEach((item) => {
      const y = item.transform && Number(item.transform[5]);
      if (previousY != null && Number.isFinite(y) && Math.abs(y - previousY) > 3) output.push("\n");
      output.push(String(item.str || ""));
      output.push(item.hasEOL ? "\n" : " ");
      if (Number.isFinite(y)) previousY = y;
    });
    return output.join("").replace(/[ \t]+\n/g, "\n");
  }

  async function analyzePdf(file, index, settings) {
    const item = {
      id: uid(), file, originalName: file.name, originalIndex: index, index, sequence: settings.start + index, certificate: "", candidates: [], confidence: "none", confirmed: false, page: 0, pageCount: 0, pagesText: [], finalName: "", template: settings.template, selected: true, manualName: false, manualSequence: false, error: "",
    };
    try {
      if (!window.pdfjsLib) throw new Error("Leitor de PDF não carregado");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      item.pageCount = pdf.numPages;
      const limit = settings.pages === 0 ? pdf.numPages : Math.min(pdf.numPages, settings.pages);
      for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ normalizeWhitespace: true });
        item.pagesText.push({ page: pageNumber, text: contentText(content) });
        page.cleanup();
      }
      const detection = Core.extractCertificateCandidates(item.pagesText, settings.label);
      item.candidates = detection.candidates;
      item.certificate = detection.selected;
      item.confidence = detection.confidence;
      item.page = detection.page || 1;
      item.confirmed = detection.confidence === "high";
      if (pdf.destroy) await pdf.destroy();
    } catch (error) {
      item.error = String(error && error.message || error || "Falha ao ler PDF");
      item.confidence = "none";
    }
    return item;
  }

  async function analyzeAll() {
    if (!state.files.length || state.busy) return;
    state.busy = true;
    renderSource();
    const settings = configuration();
    setProgress(2, "Preparando leitura dos PDFs…");
    const work = async (task) => {
      const result = new Array(state.files.length);
      let cursor = 0;
      let completed = 0;
      async function worker() {
        while (cursor < state.files.length) {
          const index = cursor; cursor += 1;
          result[index] = await analyzePdf(state.files[index], index, settings);
          completed += 1;
          const percent = Math.round((completed / state.files.length) * 88);
          setProgress(percent, `Lendo ${completed} de ${state.files.length}`);
          if (task) task.update(percent, `${completed} de ${state.files.length} PDFs analisados`);
          if (completed % 4 === 0) await yieldFrame();
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, state.files.length) }, worker));
      state.items = result;
      recompute(true);
      setProgress(96, "Montando a conferência…");
      state.currentIndex = state.items.length ? 0 : -1;
      renderResults();
      if (state.currentIndex >= 0) await selectItem(0, true);
      setProgress(100, "Concluído");
      if (task) task.update(100, `${state.items.length} PDFs preparados`);
    };
    try {
      if (Tasks && Tasks.run) await Tasks.run("RECON · Renomear PDFs", work, `${state.files.length} arquivos`);
      else await work(null);
      showToast("Análise concluída. Confira os itens sinalizados.", "success");
    } catch (error) { showToast(`Não foi possível analisar: ${error.message || error}`, "error"); }
    finally { state.busy = false; renderSource(); setTimeout(hideProgress, 600); }
  }

  function sortedItems(items, mode) {
    const copy = [...items];
    if (mode === "original") copy.sort((a, b) => Core.naturalCompare(a.originalName, b.originalName));
    else if (mode === "certificate") copy.sort((a, b) => Core.naturalCompare(a.certificate || a.originalName, b.certificate || b.originalName));
    else copy.sort((a, b) => Number(a.originalIndex) - Number(b.originalIndex));
    return copy;
  }

  function recompute(reorder) {
    if (!state.items.length) return;
    const settings = configuration();
    const currentId = state.items[state.currentIndex] && state.items[state.currentIndex].id;
    if (reorder) state.items = sortedItems(state.items, settings.sort);
    state.items.forEach((item, index) => {
      item.index = index;
      item.template = settings.template;
      if (!item.manualSequence) item.sequence = settings.start + index;
      if (!item.manualName) item.finalName = Core.formatTemplate(settings.template, item, settings);
    });
    state.items = Core.validateBatch(state.items);
    if (currentId) state.currentIndex = Math.max(0, state.items.findIndex((item) => item.id === currentId));
    renderResults();
    renderInspector();
  }

  function eligible(item) { return Boolean(item && item.selected && item.valid && (!item.needsReview || item.confirmed)); }
  function counts() {
    return state.items.reduce((out, item) => {
      out.all += 1;
      if (item.status === "blocked") out.blocked += 1;
      else if (item.needsReview && !item.confirmed) out.review += 1;
      else out.ready += 1;
      if (eligible(item)) out.selected += 1;
      return out;
    }, { all: 0, ready: 0, review: 0, blocked: 0, selected: 0 });
  }

  function filteredQueue() {
    const query = String(state.queueSearch || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return state.items.map((item, index) => ({ item, index })).filter(({ item }) => {
      const status = itemStatus(item).kind;
      if (state.queueStatus === "selected" && !item.selected) return false;
      if (!["all", "selected"].includes(state.queueStatus) && status !== state.queueStatus) return false;
      if (!query) return true;
      const haystack = `${item.originalName} ${item.finalName} ${item.certificate} ${item.error || ""} ${item.message || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      return haystack.includes(query);
    });
  }

  function renderResults() {
    if (!state.items.length) { els.results.hidden = true; return; }
    els.results.hidden = false;
    const summary = counts();
    Object.entries(summary).forEach(([key, value]) => { const target = document.querySelector(`[data-renamer-count="${key}"]`); if (target) target.textContent = String(value); });
    els.resultMeta.textContent = `${summary.all} arquivo(s) · ${summary.review + summary.blocked} pendência(s)`;
    els.download.disabled = !summary.selected || state.busy;
    els.selectAll.checked = state.items.every((item) => item.selected);
    els.selectAll.indeterminate = !els.selectAll.checked && state.items.some((item) => item.selected);
    const confirmable = state.items.filter((item) => item.needsReview && !item.confirmed && item.certificate && item.status !== "blocked");
    if (els.confirmReady) { els.confirmReady.disabled = !confirmable.length || state.busy; els.confirmReady.textContent = confirmable.length ? `Confirmar números localizados (${confirmable.length})` : "Confirmar números localizados"; }
    renderQueue();
    notifyReconUi();
  }

  function itemStatus(item) {
    if (item.status === "blocked") return { kind: "blocked", label: "Com erro" };
    if (item.needsReview && !item.confirmed) return { kind: "review", label: "Conferir" };
    return { kind: "ready", label: "Pronto" };
  }

  function renderQueue() {
    const indexed = filteredQueue();
    const page = queuePager ? queuePager.slice(indexed) : indexed.slice(0, 50);
    if (els.filterCount) els.filterCount.textContent = `${indexed.length.toLocaleString("pt-BR")} de ${state.items.length.toLocaleString("pt-BR")} arquivo(s)`;
    els.queue.innerHTML = page.length ? page.map(({ item, index }) => {
      const status = itemStatus(item);
      return `<article class="renamer-queue-item ${status.kind} ${index === state.currentIndex ? "active" : ""}" data-renamer-index="${index}"><input class="renamer-row-check" type="checkbox" ${item.selected ? "checked" : ""} aria-label="Incluir ${escapeHtml(item.originalName)}"><button class="renamer-row-main" type="button"><strong>${escapeHtml(item.originalName)}</strong><span>${escapeHtml(item.finalName || "—")}</span></button><i>${status.label}</i><div class="renamer-order"><button type="button" data-move="up" aria-label="Mover para cima">↑</button><button type="button" data-move="down" aria-label="Mover para baixo">↓</button></div></article>`;
    }).join("") : '<empty-state class="renamer-queue-empty"><strong>Nenhum arquivo neste filtro</strong><span>Limpe a busca ou escolha outra situação.</span></empty-state>';
  }

  async function selectItem(index, renderPdf) {
    if (!state.items.length) return;
    state.currentIndex = Math.max(0, Math.min(state.items.length - 1, Number(index) || 0));
    const item = state.items[state.currentIndex];
    state.currentPage = Math.max(1, Math.min(item.pageCount || 1, item.page || 1));
    renderResults();
    renderInspector();
    if (renderPdf !== false) await renderPreview();
  }

  function renderInspector() {
    const item = state.items[state.currentIndex];
    const disabled = !item;
    [els.certificate, els.sequence, els.finalName, els.itemSelected, els.confirm, els.prev, els.next, els.prevPage, els.nextPage].forEach((element) => { element.disabled = disabled; });
    if (!item) { els.currentName.textContent = "—"; els.candidates.innerHTML = ""; els.itemState.className = "renamer-item-state neutral"; els.itemState.innerHTML = "<strong>Aguardando</strong><span>—</span>"; return; }
    els.currentName.textContent = item.originalName;
    els.certificate.value = item.certificate || "";
    els.sequence.value = item.sequence;
    els.finalName.value = item.finalName || "";
    els.itemSelected.checked = item.selected;
    els.candidates.innerHTML = item.candidates.length ? `<span>Sugestões encontradas</span>${item.candidates.slice(0, 6).map((candidate) => `<button type="button" data-candidate="${escapeHtml(candidate.value)}" title="Página ${candidate.page}">${escapeHtml(candidate.value)}<small>p. ${candidate.page}</small></button>`).join("")}` : `<span>${item.error ? "Falha na leitura" : "Nenhum número localizado no texto"}</span>`;
    const status = itemStatus(item);
    els.itemState.className = `renamer-item-state ${status.kind}`;
    els.itemState.innerHTML = `<strong>${status.label}</strong><span>${escapeHtml(item.error || item.message || "—")}</span>`;
    els.confirm.hidden = !(item.needsReview && !item.confirmed && item.certificate);
    els.prev.disabled = state.currentIndex <= 0;
    els.next.disabled = state.currentIndex >= state.items.length - 1;
    els.prevPage.disabled = state.currentPage <= 1;
    els.nextPage.disabled = state.currentPage >= (item.pageCount || 1);
  }

  function clearPreview() {
    state.previewToken += 1;
    els.canvas.width = 1; els.canvas.height = 1;
    els.previewEmpty.hidden = false;
    els.pageMeta.textContent = "Página —";
  }

  async function renderPreview() {
    const item = state.items[state.currentIndex];
    if (!item || !window.pdfjsLib) { clearPreview(); return; }
    const token = ++state.previewToken;
    els.previewEmpty.hidden = false;
    els.previewEmpty.textContent = "Carregando prévia…";
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      if (token !== state.previewToken) { if (pdf.destroy) await pdf.destroy(); return; }
      state.currentPage = Math.max(1, Math.min(pdf.numPages, state.currentPage));
      const page = await pdf.getPage(state.currentPage);
      const base = page.getViewport({ scale: 1 });
      const available = Math.max(420, Number(els.canvasWrap.clientWidth || 640) - 32);
      const scale = Math.min(1.8, available / base.width);
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const context = els.canvas.getContext("2d", { alpha: false });
      els.canvas.width = Math.floor(viewport.width * ratio);
      els.canvas.height = Math.floor(viewport.height * ratio);
      els.canvas.style.width = `${Math.floor(viewport.width)}px`;
      els.canvas.style.height = `${Math.floor(viewport.height)}px`;
      await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], background: "#ffffff" }).promise;
      if (token === state.previewToken) { els.previewEmpty.hidden = true; els.pageMeta.textContent = `Página ${state.currentPage} de ${pdf.numPages}`; }
      page.cleanup(); if (pdf.destroy) await pdf.destroy();
    } catch (error) {
      if (token === state.previewToken) { els.previewEmpty.hidden = false; els.previewEmpty.textContent = "Prévia indisponível"; els.pageMeta.textContent = "Página —"; }
    }
    renderInspector();
  }

  function updateCurrent(patch) {
    const item = state.items[state.currentIndex];
    if (!item) return;
    Object.assign(item, patch);
    const settings = configuration();
    item.template = settings.template;
    if (!item.manualName) item.finalName = Core.formatTemplate(settings.template, item, settings);
    state.items = Core.validateBatch(state.items);
    renderResults();
    renderInspector();
  }

  function moveCurrent(index, direction) {
    const next = direction === "up" ? index - 1 : index + 1;
    if (next < 0 || next >= state.items.length) return;
    const item = state.items[index];
    state.items.splice(index, 1); state.items.splice(next, 0, item);
    state.items.forEach((row, rowIndex) => { row.index = rowIndex; if (!row.manualSequence) row.sequence = Number(els.start.value || 0) + rowIndex; if (!row.manualName) row.finalName = Core.formatTemplate(els.template.value, row, configuration()); });
    state.currentIndex = next;
    state.items = Core.validateBatch(state.items);
    renderResults(); renderInspector();
  }

  async function ensureExportLibraries() {
    if (window.RECONModuleLoader) await window.RECONModuleLoader.ensure("export");
    if (!window.ExcelJS || !window.JSZip) throw new Error("Bibliotecas de exportação indisponíveis.");
  }

  async function workbookLogo(workbook) {
    if (window.RECONBrand?.addReportLogo) return window.RECONBrand.addReportLogo(workbook);
    try {
      const response = await window.fetch("recon-logo-report.png", { cache: "no-store" });
      if (response.ok) return workbook.addImage({ buffer: await response.arrayBuffer(), extension: "png" });
    } catch (_) {
      // O relatório continua íntegro mesmo sem imagem.
    }
    return null;
  }

  function fillRange(sheet, range, argb) { sheet.getCell(range.split(":")[0]); sheet.eachRow((row, rowNumber) => { if (rowNumber > 3) return; row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; }); }); }

  async function buildWorkbook() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RECON"; workbook.lastModifiedBy = "RECON"; workbook.company = "CONSAG Engenharia"; workbook.created = new Date(); workbook.modified = new Date();
    const logo = await workbookLogo(workbook);
    const summary = workbook.addWorksheet("Resumo", { views: [{ showGridLines: false }] });
    summary.columns = [{ width: 4 }, { width: 25 }, { width: 25 }, { width: 25 }, { width: 25 }];
    summary.mergeCells("B2:E3"); summary.getCell("B2").value = "RECON · RENOMEAÇÃO EM LOTE"; summary.getCell("B2").font = { name: "Aptos Display", size: 18, bold: true, color: { argb: "FFFFFFFF" } }; summary.getCell("B2").alignment = { vertical: "middle" };
    [2, 3].forEach((row) => { for (let col = 1; col <= 5; col += 1) summary.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF153A5C" } }; });
    if (logo !== null) summary.addImage(logo, { tl: { col: .2, row: .35 }, ext: { width: 158, height: 58 } });
    const c = counts(); const data = [["Arquivos", c.all], ["Prontos", c.ready], ["Para conferir", c.review], ["Com erro", c.blocked], ["Incluídos no pacote", c.selected], ["Modelo usado", configuration().template], ["Gerado em", new Date().toLocaleString("pt-BR")]];
    data.forEach((row, index) => { summary.getCell(6 + index, 2).value = row[0]; summary.getCell(6 + index, 2).font = { name: "Aptos", size: 10, bold: true, color: { argb: "FF52697C" } }; summary.getCell(6 + index, 3).value = row[1]; summary.getCell(6 + index, 3).font = { name: "Aptos", size: 10, color: { argb: "FF263E52" } }; summary.getRow(6 + index).height = 24; });

    const sheet = workbook.addWorksheet("Renomeação", { views: [{ state: "frozen", ySplit: 5, showGridLines: false, zoomScale: 85 }] });
    const headers = ["INCLUIR", "ARQUIVO ORIGINAL", "ARQUIVO FINAL", "CERTIFICADO", "SEQUÊNCIA", "PÁGINA", "CONFIANÇA", "SITUAÇÃO", "MOTIVO", "PADRÃO"];
    sheet.columns = [{ width: 12 }, { width: 48 }, { width: 48 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 38 }, { width: 28 }];
    sheet.mergeCells("C1:J2"); sheet.getCell("C1").value = "RECON · RELATÓRIO DE RENOMEAÇÃO"; sheet.getCell("C1").font = { name: "Aptos Display", size: 17, bold: true, color: { argb: "FFFFFFFF" } }; sheet.getCell("C1").alignment = { vertical: "middle" };
    for (let row = 1; row <= 3; row += 1) for (let col = 1; col <= headers.length; col += 1) sheet.getCell(row, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF153A5C" } };
    if (logo !== null) sheet.addImage(logo, { tl: { col: .15, row: .25 }, ext: { width: 158, height: 58 } });
    const headerRow = sheet.getRow(5); headers.forEach((header, index) => { const cell = headerRow.getCell(index + 1); cell.value = header; cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF246FA3" } }; cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }; }); headerRow.height = 32;
    state.items.forEach((item) => {
      const status = itemStatus(item); const row = sheet.addRow([eligible(item) ? "SIM" : "NÃO", item.originalName, item.finalName, item.certificate, item.sequence, item.page || "", item.confidence === "high" ? "Alta" : item.confidence === "manual" ? "Confirmada" : "Conferir", status.label, item.error || item.message, item.template]);
      row.height = 30; row.alignment = { vertical: "middle", wrapText: true }; row.font = { name: "Aptos", size: 9.5, color: { argb: "FF30485C" } };
      const color = status.kind === "ready" ? "FFEAF7F1" : status.kind === "review" ? "FFFFF5DF" : "FFFFF0ED"; row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; row.getCell(8).font = { bold: true, color: { argb: status.kind === "ready" ? "FF0C7657" : status.kind === "review" ? "FFA56812" : "FFA64035" } };
    });
    sheet.autoFilter = { from: "A5", to: `J${Math.max(5, sheet.rowCount)}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .25, right: .25, top: .45, bottom: .45, header: .2, footer: .2 }, horizontalCentered: true };
    sheet.pageSetup.printTitlesRow = "5:5";
    sheet.headerFooter.oddFooter = "&LRECON · Renomeação&C&P de &N&R&D";
    summary.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: .3, right: .3, top: .45, bottom: .45, header: .2, footer: .2 } };
    summary.headerFooter.oddFooter = "&LRECON · Resumo&C&P de &N&R&D";
    return workbook;
  }

  function timestamp() { const date = new Date(); const part = (value, size) => String(value).padStart(size || 2, "0"); return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}_${part(date.getMilliseconds(), 3)}`; }
  function triggerDownload(blob, filename) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000); }

  async function downloadPackage() {
    await ensureExportLibraries();
    const selected = state.items.filter((item) => item.selected);
    const guard = ExportGuard ? ExportGuard.validateRenames(selected) : { valid: true, errors: [], warnings: [] };
    if (!guard.valid) { showToast(`O pacote não foi gerado. ${guard.errors[0] || "Existem arquivos que precisam de correção."}`, "error"); return; }
    if (guard.warnings.length) { showToast(`Confira antes de continuar. ${guard.warnings[0]}`, "warn"); return; }
    const included = state.items.filter(eligible);
    if (!included.length || state.busy) { showToast("Nenhum arquivo conferido está pronto para o pacote.", "warn"); return; }
    const excluded = state.items.length - included.length;
    const confirmation = `Gerar o pacote com ${included.length} PDF(s)?${excluded ? ` ${excluded} arquivo(s) ficarão de fora por seleção, revisão ou erro.` : ""}`;
    if (!window.confirm(confirmation)) return;
    state.busy = true; renderSource(); renderResults(); setProgress(2, "Preparando pacote…");
    const work = async (task) => {
      const zip = new JSZip();
      included.forEach((item) => zip.file(item.finalName, item.file));
      if (task) task.update(28, `${included.length} PDFs adicionados ao pacote`);
      setProgress(30, "Gerando relatório Excel…");
      const workbook = await buildWorkbook();
      const report = await workbook.xlsx.writeBuffer();
      zip.file(`Relatorio_RECON_Renomeacao_${timestamp()}.xlsx`, report);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } }, (metadata) => {
        const progress = 35 + Math.round(metadata.percent * .63); setProgress(progress, `Compactando ${Math.round(metadata.percent)}%`); if (task) task.update(progress, "Gerando ZIP com arquivos renomeados");
      });
      triggerDownload(blob, `RECON_Arquivos_Renomeados_${timestamp()}.zip`);
      if (task) task.update(100, `${included.length} PDFs e relatório entregues`);
    };
    try { if (Tasks && Tasks.run) await Tasks.run("RECON · Gerar pacote renomeado", work, `${included.length} PDFs`); else await work(null); showToast(`Pacote gerado com ${included.length} PDF(s).`, "success"); if (els.packageSummary && els.packageSummaryText) { els.packageSummary.hidden = false; els.packageSummaryText.textContent = `${included.length} PDF(s) renomeado(s) · ${excluded} fora do pacote · ${new Date().toLocaleString("pt-BR")}`; } }
    catch (error) { showToast(`Falha ao gerar pacote: ${error.message || error}`, "error"); }
    finally { state.busy = false; renderSource(); renderResults(); setTimeout(hideProgress, 650); }
  }

  function confirmLocatedNumbers() {
    const candidates = state.items.filter((item) => item.needsReview && !item.confirmed && item.certificate && item.status !== "blocked");
    if (!candidates.length) return;
    if (!window.confirm(`Confirmar o número localizado em ${candidates.length} arquivo(s)? Revise a fila antes de continuar.`)) return;
    candidates.forEach((item) => { item.confirmed = true; item.confidence = "manual"; });
    state.items = Core.validateBatch(state.items);
    renderResults(); renderInspector();
    showToast(`${candidates.length} arquivo(s) confirmado(s).`, "success");
  }

  els.files.addEventListener("change", () => addFiles(els.files.files));
  els.folder.addEventListener("change", () => addFiles(els.folder.files));
  els.clear.addEventListener("click", clearAll);
  ["dragenter", "dragover"].forEach((type) => els.dropzone.addEventListener(type, (event) => { event.preventDefault(); els.dropzone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((type) => els.dropzone.addEventListener(type, (event) => { event.preventDefault(); els.dropzone.classList.remove("dragging"); }));
  els.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  els.dropzone.addEventListener("click", () => els.files.click());
  els.dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); els.files.click(); } });
  els.preset.addEventListener("change", () => applyPreset(els.preset.value));
  els.template.addEventListener("input", () => { els.preset.value = "custom"; updateFriendlyExample(); recompute(false); });
  els.sort.addEventListener("change", () => recompute(true));
  [els.start, els.padding].forEach((element) => element.addEventListener("input", () => { updateFriendlyExample(); recompute(false); }));
  els.analyze.addEventListener("click", analyzeAll);
  els.usePattern.addEventListener("click", () => { if (!state.pattern) return; els.template.value = state.pattern.suggestion; els.preset.value = "custom"; updateFriendlyExample(); recompute(false); showToast("O padrão encontrado foi aplicado. Confira o exemplo antes de continuar.", "success"); });
  els.savePreset.addEventListener("click", savePreset); els.deletePreset.addEventListener("click", deletePreset);
  els.queue.addEventListener("click", (event) => { const row = event.target.closest("[data-renamer-index]"); if (!row) return; const index = Number(row.dataset.renamerIndex); const move = event.target.closest("[data-move]"); if (move) { moveCurrent(index, move.dataset.move); return; } if (!event.target.classList.contains("renamer-row-check")) selectItem(index, true); });
  els.queue.addEventListener("change", (event) => { const check = event.target.closest(".renamer-row-check"); if (!check) return; const row = check.closest("[data-renamer-index]"); state.items[Number(row.dataset.renamerIndex)].selected = check.checked; renderResults(); renderInspector(); });
  els.selectAll.addEventListener("change", () => { state.items.forEach((item) => { item.selected = els.selectAll.checked; }); renderResults(); renderInspector(); });
  els.candidates.addEventListener("click", (event) => { const button = event.target.closest("[data-candidate]"); if (!button) return; updateCurrent({ certificate: button.dataset.candidate, confidence: "manual", confirmed: true, page: Number(button.querySelector("small")?.textContent.replace(/\D/g, "")) || state.items[state.currentIndex].page, manualName: false }); });
  els.certificate.addEventListener("input", () => updateCurrent({ certificate: els.certificate.value.trim(), confidence: "manual", confirmed: Boolean(els.certificate.value.trim()), manualName: false }));
  els.sequence.addEventListener("input", () => updateCurrent({ sequence: Number(els.sequence.value) || 0, manualSequence: true, manualName: false }));
  els.finalName.addEventListener("input", () => updateCurrent({ finalName: els.finalName.value.trim(), manualName: true }));
  els.finalName.addEventListener("change", () => { const value = els.finalName.value.trim(); if (value && !/\.pdf$/i.test(value)) updateCurrent({ finalName: `${value.replace(/\.[^.]+$/, "")}.pdf`, manualName: true }); });
  els.itemSelected.addEventListener("change", () => updateCurrent({ selected: els.itemSelected.checked }));
  els.confirm.addEventListener("click", () => updateCurrent({ confirmed: true, confidence: "manual" }));
  els.prev.addEventListener("click", () => selectItem(state.currentIndex - 1, true)); els.next.addEventListener("click", () => selectItem(state.currentIndex + 1, true));
  els.prevPage.addEventListener("click", () => { state.currentPage -= 1; renderPreview(); }); els.nextPage.addEventListener("click", () => { state.currentPage += 1; renderPreview(); });
  if (els.queueSearch) els.queueSearch.addEventListener("input", () => { state.queueSearch = els.queueSearch.value; writeFilters(); if (queuePager) queuePager.reset(); renderQueue(); });
  if (els.queueStatus) els.queueStatus.addEventListener("change", () => { state.queueStatus = els.queueStatus.value || "all"; writeFilters(); if (queuePager) queuePager.reset(); renderQueue(); });
  if (els.clearFilters) els.clearFilters.addEventListener("click", () => { state.queueSearch = ""; state.queueStatus = "all"; if (els.queueSearch) els.queueSearch.value = ""; if (els.queueStatus) els.queueStatus.value = "all"; try { localStorage.removeItem(FILTER_KEY); } catch (_) {} if (queuePager) queuePager.reset(); renderQueue(); });
  if (els.confirmReady) els.confirmReady.addEventListener("click", confirmLocatedNumbers);
  document.addEventListener("keydown", (event) => {
    if (!event.altKey || document.getElementById("module-renamer")?.hidden || !state.items.length) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); selectItem(state.currentIndex - 1, true); }
    if (event.key === "ArrowRight") { event.preventDefault(); selectItem(state.currentIndex + 1, true); }
    if (event.key === "Enter") { event.preventDefault(); const item = state.items[state.currentIndex]; if (item && item.certificate) updateCurrent({ confirmed: true, confidence: "manual" }); }
  });
  els.download.addEventListener("click", downloadPackage);
  window.addEventListener("recon:module", (event) => { if (event.detail.module === "renamer" && state.items.length && state.currentIndex >= 0) renderPreview(); else if (event.detail.module !== "renamer") clearPreview(); });

  const savedFilters = readFilters();
  state.queueSearch = String(savedFilters.search || "");
  state.queueStatus = ["all", "ready", "review", "blocked", "selected"].includes(savedFilters.status) ? savedFilters.status : "all";
  if (els.queueSearch) els.queueSearch.value = state.queueSearch;
  if (els.queueStatus) els.queueStatus.value = state.queueStatus;
  loadPresetOptions(); updateFriendlyExample(); renderSource(); renderPattern(); clearPreview();
  window.RECONOutputPreviewProviders = window.RECONOutputPreviewProviders || {};
  window.RECONOutputPreviewProviders.renamer = () => ({
    title: "Arquivos que entrarão no pacote renomeado",
    summary: `${state.items.filter(eligible).length} PDF(s) no ZIP`,
    expectedInputs: state.files.length,
    accountedInputs: state.items.length,
    requireUniqueTargets: true,
    items: state.items.filter(eligible).map((item) => ({ primary: item.originalName, secondary: item.finalName, meta: item.confirmed ? "Conferido" : "Regra automática" })),
  });
  window.RECONRenamer = { state, addFiles, analyzeAll, recompute, buildWorkbook, downloadPackage, selectItem, configuration };
})();
