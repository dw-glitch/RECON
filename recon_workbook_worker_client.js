(function (root) {
  "use strict";
  const workbookCache = new Map();
  const ldCache = new Map();
  const active = new Map();
  let sequence = 0;

  function signature(file) { return `${file && file.name}|${file && file.size}|${file && file.lastModified}`; }
  function profileKey(profile) {
    try { return JSON.stringify(profile || null); } catch (_) { return "profile"; }
  }
  function rebuild(serialized) {
    const workbook = { SheetNames: serialized.sheetNames || [], Sheets: {}, Props: serialized.props || {}, Custprops: serialized.custprops || {} };
    workbook.SheetNames.forEach((name) => { workbook.Sheets[name] = root.XLSX.utils.aoa_to_sheet((serialized.sheets && serialized.sheets[name]) || []); });
    return workbook;
  }
  function serializeWorkbook(workbook) {
    const sheets = {};
    for (const name of workbook.SheetNames || []) {
      sheets[name] = root.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "", blankrows: true });
    }
    return { sheetNames: [...(workbook.SheetNames || [])], sheets, props: workbook.Props || {}, custprops: workbook.Custprops || {} };
  }
  function trimCache(cache, limit) { while (cache.size > limit) cache.delete(cache.keys().next().value); }
  function abortError(message) {
    try { return new DOMException(message, "AbortError"); }
    catch (_) { const error = new Error(message); error.name = "AbortError"; return error; }
  }
  function dispatchProgress(id, mode, progress, message) {
    root.dispatchEvent(new CustomEvent("recon:workbook-progress", { detail: { id, mode, progress, message: message || "" } }));
  }
  function emitFallback(mode, error) {
    document.documentElement.dataset.reconWorkerFallback = "true";
    root.dispatchEvent(new CustomEvent("recon:worker-fallback", {
      detail: { scope: mode, source: "workbook", message: String(error && error.message || error || "Worker indisponível") },
    }));
  }

  function processDirect(task, buffer, options, mode, meta, cause) {
    emitFallback(mode, cause);
    return new Promise((resolve, reject) => {
      task.directTimer = window.setTimeout(() => {
        task.directTimer = 0;
        if (task.cancelled) { reject(abortError("Leitura cancelada pelo usuário.")); return; }
        try {
          dispatchProgress(task.id, mode, 15, "Abrindo planilha em modo compatível");
          const workbook = root.XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true, dense: false, ...(options || {}) });
          if (mode === "ld") {
            dispatchProgress(task.id, mode, 48, "Lendo documentos e histórico");
            const parsed = root.TriagemCore.parseWorkbook(
              workbook,
              meta && meta.sourceName || "LD",
              meta && meta.sourceTimestamp || 0,
              meta && meta.compatibilityProfile || null
            );
            dispatchProgress(task.id, mode, 76, "Criando índice da LD");
            const index = meta && meta.buildIndex === false ? null : root.TriagemCore.buildIndex(parsed.records, parsed.history);
            dispatchProgress(task.id, mode, 100, "Concluído em modo compatível");
            resolve({ parsed, index });
            return;
          }
          dispatchProgress(task.id, mode, 70, "Preparando abas");
          const serialized = serializeWorkbook(workbook);
          dispatchProgress(task.id, mode, 100, "Concluído em modo compatível");
          resolve(serialized);
        } catch (error) { reject(error); }
      }, 0);
    });
  }

  async function processBuffer(buffer, key, options, mode, meta) {
    const cache = mode === "ld" ? ldCache : workbookCache;
    if (cache.has(key)) return mode === "ld" ? cache.get(key) : rebuild(cache.get(key));
    const id = `wb-${++sequence}`;
    const task = { id, worker: null, reject: null, cancelled: false, directTimer: 0, settled: false };
    const result = await new Promise((resolve, reject) => {
      task.reject = reject;
      active.set(id, task);

      const finish = (callback, value) => {
        if (task.settled) return;
        task.settled = true;
        active.delete(id);
        if (task.worker) task.worker.terminate();
        callback(value);
      };
      const fallback = (cause) => {
        if (task.settled || task.cancelled) return;
        if (task.worker) { task.worker.terminate(); task.worker = null; }
        processDirect(task, buffer, options, mode, meta, cause).then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error)
        );
      };

      if (typeof root.Worker !== "function") { fallback(new Error("Web Worker não suportado neste navegador.")); return; }
      try {
        task.worker = new root.Worker("recon_workbook_worker.js");
      } catch (error) {
        fallback(error);
        return;
      }
      task.worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.id !== id || task.settled) return;
        if (data.progress !== undefined) dispatchProgress(id, mode, data.progress, data.message || "");
        if (data.error) { finish(reject, new Error(data.error)); return; }
        if (data.result) finish(resolve, data.result);
      };
      task.worker.onerror = (event) => fallback(new Error(event.message || "Falha de infraestrutura no Worker da planilha."));
      try {
        const workerBuffer = buffer.slice(0);
        task.worker.postMessage({ id, buffer: workerBuffer, options: options || {}, mode: mode || "workbook", meta: meta || {} }, [workerBuffer]);
      } catch (error) { fallback(error); }
    });

    cache.set(key, result);
    trimCache(cache, mode === "ld" ? 1 : 4);
    return mode === "ld" ? result : rebuild(result);
  }

  async function read(file, options) {
    if (!file) throw new Error("Planilha não informada.");
    return processBuffer(await file.arrayBuffer(), signature(file), options, "workbook", null);
  }
  async function readLd(file, meta) {
    if (!file) throw new Error("LD não informada.");
    const key = `ld:${signature(file)}|${profileKey(meta && meta.compatibilityProfile)}|${meta && meta.buildIndex === false ? "records" : "index"}`;
    return processBuffer(await file.arrayBuffer(), key, { cellDates: true, cellFormula: true }, "ld", {
      sourceName: meta && meta.sourceName || file.name,
      sourceTimestamp: meta && meta.sourceTimestamp || file.lastModified || 0,
      compatibilityProfile: meta && meta.compatibilityProfile || null,
      buildIndex: !(meta && meta.buildIndex === false),
    });
  }
  async function readBuffer(buffer, cacheKey, options) {
    const transferable = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return processBuffer(transferable, `buffer:${cacheKey || transferable.byteLength}`, options, "workbook", null);
  }

  function clear(file) {
    if (!file) { workbookCache.clear(); ldCache.clear(); return; }
    const prefix = signature(file);
    workbookCache.delete(prefix);
    [...ldCache.keys()].filter((key) => key.includes(prefix)).forEach((key) => ldCache.delete(key));
  }
  function cancelAll() {
    active.forEach((task) => {
      task.cancelled = true;
      task.settled = true;
      if (task.worker) task.worker.terminate();
      if (task.directTimer) window.clearTimeout(task.directTimer);
      try { task.reject(abortError("Leitura cancelada pelo usuário.")); } catch (_) {}
    });
    active.clear();
  }
  root.addEventListener("beforeunload", cancelAll);
  root.addEventListener("recon:ld-cleared", () => clear());
  root.RECONWorkbookWorker = Object.freeze({
    read, readLd, readBuffer, clear, cancelAll,
    cacheSize: () => workbookCache.size + ldCache.size,
    workbookCacheSize: () => workbookCache.size,
    ldCacheSize: () => ldCache.size,
  });
})(window);
