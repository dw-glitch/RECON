(function (root) {
  "use strict";
  const active = new Map();
  let sequence = 0;

  function abortError(message) {
    try { return new DOMException(message, "AbortError"); }
    catch (_) { const error = new Error(message); error.name = "AbortError"; return error; }
  }

  function emitFallback(scope, error) {
    document.documentElement.dataset.reconWorkerFallback = "true";
    root.dispatchEvent(new CustomEvent("recon:worker-fallback", {
      detail: { scope, source: "compute", message: String(error && error.message || error || "Worker indisponível") },
    }));
  }

  function directCompute(type, payload) {
    if (type === "audit-titles") return root.RECONAuditCore.auditTitles(payload.index, payload.references, payload.options || null);
    if (type === "audit-databook") return root.RECONAuditCore.auditDatabook(payload.index, payload.catalog || [], payload.sourceIndex || null);
    if (type === "allocation-analyze") return root.AllocationCore.analyze(payload.entries || [], payload.records || [], payload.control || null, payload.options || {});
    if (type === "relations-catalog") return root.CorporateRelationsCore.rowsFromIndex(payload.index || null, payload.options || {});
    if (type === "relations-filter") return root.CorporateRelationsCore.filterRows(payload.rows || [], payload.filters || {});
    if (type === "relations-resolve") return root.CorporateRelationsCore.resolveEntries(payload.entries || [], payload.index || null, payload.options || {});
    if (type === "tag-analyze") return root.RECONTagConferenceCore.analyze(payload.values || [], payload.index || null);
    throw new Error(`Operação desconhecida: ${type}`);
  }

  function runDirect(task, type, payload, cause) {
    emitFallback(task.scope, cause);
    return new Promise((resolve, reject) => {
      task.directTimer = window.setTimeout(() => {
        task.directTimer = 0;
        if (task.cancelled) { reject(abortError("Operação cancelada pelo usuário.")); return; }
        try { resolve(directCompute(type, payload)); }
        catch (error) { reject(error); }
      }, 0);
    });
  }

  // Operações cujo término representa uma análise concluída pelo usuário.
  // "relations-filter" e "relations-resolve" ficam de fora porque disparam a
  // cada digitação no filtro e inflariam o histórico.
  const ANALYSIS_MODULES = {
    "audit-titles": "titles",
    "audit-databook": "databook",
    "allocation-analyze": "allocation",
    "relations-catalog": "relations",
    "tag-analyze": "tags",
  };

  function announceAnalysis(type, startedAt) {
    const module = ANALYSIS_MODULES[type];
    if (!module) return;
    root.dispatchEvent(new CustomEvent("recon:analysis-complete", {
      detail: { module, data: { operation: type, durationMs: Math.round(performance.now() - startedAt) } },
    }));
  }

  function run(scope, type, payload) {
    cancel(scope);
    const startedAt = performance.now();
    const id = `${scope}-${++sequence}`;
    const task = { id, scope, worker: null, reject: null, cancelled: false, directTimer: 0, settled: false };
    const promise = new Promise((resolve, reject) => {
      task.reject = reject;
      active.set(scope, task);

      const finish = (callback, value) => {
        if (task.settled) return;
        task.settled = true;
        active.delete(scope);
        if (task.worker) task.worker.terminate();
        callback(value);
      };

      const succeed = (result) => {
        finish(resolve, result);
        announceAnalysis(type, startedAt);
      };

      // Falha de infraestrutura: o Worker não existe, não carregou ou morreu.
      // Só aqui faz sentido repetir o cálculo na thread principal.
      const fallback = (cause) => {
        if (task.settled || task.cancelled) return;
        if (task.worker) { task.worker.terminate(); task.worker = null; }
        runDirect(task, type, payload, cause).then(
          (result) => { finish(resolve, result); announceAnalysis(type, startedAt); },
          (error) => finish(reject, error)
        );
      };

      // Erro de regra de negócio: o Worker rodou e a própria análise lançou.
      // Repetir na thread principal apenas congelaria a interface para chegar
      // exatamente ao mesmo erro, além de marcar o app como "modo compatível".
      const failLogic = (message) => {
        if (task.settled || task.cancelled) return;
        if (task.worker) { task.worker.terminate(); task.worker = null; }
        finish(reject, new Error(message || "Falha no processamento"));
      };

      if (root.location && root.location.protocol === "file:") { fallback(new Error("Modo local: processamento direto habilitado.")); return; }
      if (typeof root.Worker !== "function") { fallback(new Error("Web Worker não suportado neste navegador.")); return; }
      try {
        task.worker = new root.Worker("recon_compute_worker.js");
      } catch (error) {
        fallback(error);
        return;
      }
      task.worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.id !== id || task.settled) return;
        // `infrastructure` marca as falhas em que o Worker não conseguiu montar
        // suas dependências; nesse caso vale repetir na thread principal.
        if (data.error) {
          if (data.infrastructure) fallback(new Error(data.error));
          else failLogic(data.error);
          return;
        }
        succeed(data.result);
      };
      task.worker.onerror = (event) => fallback(new Error(event.message || "Falha de infraestrutura no Worker de análise."));
      try { task.worker.postMessage({ id, type, payload }); }
      catch (error) { fallback(error); }
    });
    return promise;
  }

  function cancel(scope) {
    const task = active.get(scope);
    if (!task) return false;
    active.delete(scope);
    task.cancelled = true;
    task.settled = true;
    if (task.worker) task.worker.terminate();
    if (task.directTimer) window.clearTimeout(task.directTimer);
    const error = abortError("Operação cancelada pelo usuário.");
    try { task.reject(error); } catch (_) {}
    return true;
  }

  function cancelAll() {
    [...active.keys()].forEach(cancel);
    if (root.RECONWorkbookWorker) root.RECONWorkbookWorker.cancelAll();
  }

  function installButtons() {
    const items = [
      ["relations", "relations-progress"], ["allocation", "allocation-progress"],
      ["databook", "databook-progress"], ["title", "title-progress"],
    ];
    items.forEach(([scope, id]) => {
      const host = document.getElementById(id);
      if (!host || host.querySelector("[data-recon-cancel]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button recon-cancel-task";
      button.dataset.reconCancel = scope;
      button.textContent = "Cancelar";
      button.addEventListener("click", () => { cancel(scope); if (root.RECONWorkbookWorker) root.RECONWorkbookWorker.cancelAll(); });
      host.appendChild(button);
    });
  }

  root.addEventListener("recon:module-ready", () => setTimeout(installButtons, 0));
  root.addEventListener("beforeunload", cancelAll);
  root.RECONCompute = Object.freeze({ run, cancel, cancelAll, active: (scope) => active.has(scope), directCompute });
})(window);
