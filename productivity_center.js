(function (root) {
  "use strict";

  const doc = root.document;
  if (!doc) return;
  const html = doc.documentElement;
  const APP = String(html.dataset.app || "").toUpperCase();
  if (!/^(GRCON|RECON)$/.test(APP)) return;

  const PREFIX = APP === "GRCON" ? "grcon." : "recon.";
  const THEME_KEY = APP === "GRCON" ? "quality-theme-grcon" : "quality-theme-recon";
  const APP_VERSION = html.dataset.version || doc.querySelector('meta[name="application-version"]')?.content || "";
  const PREF_SCHEMA = "quality.apps.preferences.backup.v1";
  const FULL_SCHEMA = "quality.apps.complete-backup.v1";
  const $ = (selector, scope) => (scope || doc).querySelector(selector);
  const $$ = (selector, scope) => [...(scope || doc).querySelectorAll(selector)];

  function safeStorage(name) {
    try {
      const storage = root[name];
      const probe = `${PREFIX}storage.probe`;
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (_) {
      return null;
    }
  }

  const local = safeStorage("localStorage");
  const session = safeStorage("sessionStorage");

  function isOwnedKey(key) {
    return Boolean(key) && (String(key).startsWith(PREFIX) || String(key) === THEME_KEY);
  }

  function appEntries(storage) {
    const result = {};
    if (!storage) return result;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!isOwnedKey(key)) continue;
      try { result[key] = storage.getItem(key); } catch (_) {}
    }
    return result;
  }

  function preferenceEntries() {
    const all = appEntries(local);
    if (APP === "RECON") return all;
    const allowed = [
      "grcon.preferences.",
      "grcon.triage.preferences.",
      "grcon.analysis.saved-filters.",
      "grcon.sigem.preferences.",
      "grcon.egrdt.batch-limit.",
    ];
    return Object.fromEntries(Object.entries(all).filter(([key]) => key === THEME_KEY || allowed.some((prefix) => key.startsWith(prefix))));
  }

  function byteSize(value) {
    try { return new Blob([String(value || "")]).size; } catch (_) { return String(value || "").length * 2; }
  }

  function entriesSize(entries) {
    return Object.entries(entries || {}).reduce((sum, [key, value]) => sum + byteSize(key) + byteSize(value), 0);
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  }

  function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function download(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function notify(message, tone) {
    const toast = $("#toast");
    if (toast) {
      toast.textContent = message;
      toast.className = `toast show ${tone || "success"}`;
      root.setTimeout(() => toast.classList.remove("show"), 4500);
      return;
    }
    const status = APP === "GRCON" ? $("#macro6-status") : $("#recon-preferences-status");
    if (status) status.textContent = message;
  }

  function setBusy(busy, message) {
    const panel = APP === "GRCON" ? $("#macro6-productivity") : $("#recon-preferences-dialog");
    if (panel) panel.setAttribute("aria-busy", String(Boolean(busy)));
    const status = APP === "GRCON" ? $("#macro6-status") : $("#recon-preferences-status");
    if (status && message) status.textContent = message;
    $$("[data-macro6-action]", panel || doc).forEach((button) => { button.disabled = Boolean(busy); });
  }

  async function refreshStorageSummary() {
    const localEntries = appEntries(local);
    const sessionEntries = appEntries(session);
    let estimate = null;
    try { estimate = await root.navigator?.storage?.estimate?.(); } catch (_) {}
    const localBytes = entriesSize(localEntries);
    const sessionBytes = entriesSize(sessionEntries);
    const summary = {
      localCount: Object.keys(localEntries).length,
      sessionCount: Object.keys(sessionEntries).length,
      localBytes,
      sessionBytes,
      originUsage: Number(estimate?.usage) || 0,
      originQuota: Number(estimate?.quota) || 0,
    };
    const target = APP === "GRCON" ? $("#macro6-storage-summary") : $("#recon-preferences-storage");
    if (target) {
      const quota = summary.originQuota ? ` · origem ${formatBytes(summary.originUsage)} de ${formatBytes(summary.originQuota)}` : "";
      target.textContent = `${summary.localCount} configuração(ões) persistentes · ${formatBytes(summary.localBytes)} · ${summary.sessionCount} rascunho(s) da sessão${quota}`;
    }
    return summary;
  }

  function writeEntries(storage, entries, replace) {
    const prepared = entries || {};
    if (!storage) {
      if (Object.keys(prepared).length) throw new Error("Armazenamento local indisponível neste navegador.");
      return;
    }
    if (replace) {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (isOwnedKey(key)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    }
    Object.entries(prepared).forEach(([key, value]) => {
      if (!isOwnedKey(key)) return;
      storage.setItem(key, String(value == null ? "" : value));
    });
  }

  function validateEntries(entries, label) {
    if (entries == null) return {};
    if (typeof entries !== "object" || Array.isArray(entries)) throw new Error(`${label} inválido no backup.`);
    const result = {};
    Object.entries(entries).forEach(([key, value]) => {
      if (!isOwnedKey(key)) throw new Error(`O backup contém uma chave não pertencente ao ${APP}: ${key}.`);
      if (value != null && !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Valor inválido para ${key}.`);
      result[key] = String(value == null ? "" : value);
    });
    return result;
  }

  function validateAnalysisHistory(payload) {
    if (APP !== "GRCON" || payload == null) return null;
    if (root.GrconAnalysisHistory?.validateBackup) return root.GrconAnalysisHistory.validateBackup(payload);
    if (payload?.schema !== "grcon.analysis.history.backup.v1" || !Array.isArray(payload.sessions) || !Array.isArray(payload.documents)) {
      throw new Error("Backup do Histórico de análises inválido.");
    }
    return payload;
  }

  function exportPreferences() {
    const payload = {
      schema: PREF_SCHEMA,
      app: APP,
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      preferences: preferenceEntries(),
    };
    download(JSON.stringify(payload, null, 2), `${APP}_preferencias_${timestamp()}.json`);
    notify("Preferências exportadas.", "success");
  }

  async function exportCompleteBackup() {
    setBusy(true, "Preparando backup completo…");
    try {
      const payload = {
        schema: FULL_SCHEMA,
        app: APP,
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        localStorage: appEntries(local),
        sessionStorage: appEntries(session),
      };
      if (APP === "GRCON" && root.GrconAnalysisHistory?.exportBackup) {
        payload.analysisHistory = await root.GrconAnalysisHistory.exportBackup();
      }
      download(JSON.stringify(payload), `${APP}_backup_completo_${timestamp()}.json`);
      notify("Backup completo criado.", "success");
    } catch (error) {
      notify(error.message || "Não foi possível criar o backup.", "error");
    } finally {
      setBusy(false, "Backup concluído.");
      refreshStorageSummary();
    }
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result || ""))); }
        catch (_) { reject(new Error("O arquivo selecionado não contém um JSON válido.")); }
      };
      reader.onerror = () => reject(reader.error || new Error("Não foi possível ler o arquivo."));
      reader.readAsText(file, "utf-8");
    });
  }

  async function importPayload(file, complete) {
    if (!file) return;
    setBusy(true, "Validando arquivo…");
    let localSnapshot = null;
    let sessionSnapshot = null;
    let historySnapshot = null;
    try {
      const payload = await readJsonFile(file);
      const expected = complete ? FULL_SCHEMA : PREF_SCHEMA;
      if (payload?.schema !== expected || payload?.app !== APP) {
        throw new Error(`Este arquivo não é um ${complete ? "backup completo" : "backup de preferências"} do ${APP}.`);
      }

      const prepared = complete
        ? {
            localStorage: validateEntries(payload.localStorage, "localStorage"),
            sessionStorage: validateEntries(payload.sessionStorage, "sessionStorage"),
            analysisHistory: validateAnalysisHistory(payload.analysisHistory),
          }
        : { preferences: validateEntries(payload.preferences, "Preferências") };

      const question = complete
        ? "Restaurar este backup substituirá preferências, filas e históricos locais deste aplicativo. Continuar?"
        : "Importar estas preferências substituirá somente as configurações equivalentes. Continuar?";
      if (!root.confirm(question)) return;

      localSnapshot = appEntries(local);
      sessionSnapshot = appEntries(session);
      if (complete && APP === "GRCON" && prepared.analysisHistory && root.GrconAnalysisHistory?.exportBackup) {
        historySnapshot = await root.GrconAnalysisHistory.exportBackup();
      }

      try {
        if (complete) {
          if (APP === "GRCON" && prepared.analysisHistory) {
            if (!root.GrconAnalysisHistory?.importBackup) throw new Error("O Histórico de análises não está disponível para restauração.");
            await root.GrconAnalysisHistory.importBackup(prepared.analysisHistory, { replace: true });
          }
          writeEntries(local, prepared.localStorage, true);
          writeEntries(session, prepared.sessionStorage, true);
        } else {
          writeEntries(local, prepared.preferences, false);
        }
      } catch (error) {
        const rollbackErrors = [];
        try { writeEntries(local, localSnapshot || {}, true); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        try { writeEntries(session, sessionSnapshot || {}, true); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        if (historySnapshot && root.GrconAnalysisHistory?.importBackup) {
          try { await root.GrconAnalysisHistory.importBackup(historySnapshot, { replace: true }); }
          catch (rollbackError) { rollbackErrors.push(rollbackError); }
        }
        const suffix = rollbackErrors.length
          ? " Também não foi possível restaurar integralmente o estado anterior; não feche a página e exporte os dados disponíveis."
          : " Nenhuma alteração parcial foi mantida.";
        throw new Error(`${error.message || "Falha ao restaurar o backup."}${suffix}`);
      }

      notify("Dados restaurados. O aplicativo será recarregado.", "success");
      root.setTimeout(() => root.location.reload(), 700);
    } catch (error) {
      notify(error.message || "Não foi possível restaurar o arquivo.", "error");
    } finally {
      setBusy(false, "Aguardando ação.");
      const input = complete
        ? (APP === "GRCON" ? $("#macro6-full-import") : $("#recon-full-import"))
        : (APP === "GRCON" ? $("#macro6-preferences-import") : $("#recon-preferences-import"));
      if (input) input.value = "";
      refreshStorageSummary();
    }
  }

  function removePreferenceEntries() {
    if (!local) return;
    Object.keys(preferenceEntries()).forEach((key) => local.removeItem(key));
  }

  async function resetPreferences() {
    if (!root.confirm("Restaurar as preferências padrão? Históricos e números de eGRDT não serão apagados.")) return;
    removePreferenceEntries();
    notify("Preferências restauradas. O aplicativo será recarregado.", "success");
    root.setTimeout(() => root.location.reload(), 600);
  }

  async function clearOperationalData() {
    const message = APP === "GRCON"
      ? "Apagar Histórico de análises, Histórico de eGRDTs, fila SIGEM e tarefas concluídas? Preferências e sequência numérica serão preservadas."
      : "Limpar rascunhos e estado temporário desta sessão? Preferências salvas serão preservadas.";
    if (!root.confirm(message)) return;
    setBusy(true, "Limpando dados selecionados…");
    try {
      if (APP === "GRCON") {
        ["grcon.egrdt.history.v1", "grcon.sigem.postings.v1", "grcon.task.center.v1"].forEach((key) => local?.removeItem(key));
        await root.GrconAnalysisHistory?.clearAll?.();
        root.dispatchEvent(new CustomEvent("grcon:history-updated"));
        root.dispatchEvent(new CustomEvent("grcon:analysis-history-updated"));
      } else if (session) {
        const keys = [];
        for (let index = 0; index < session.length; index += 1) {
          const key = session.key(index);
          if (key?.startsWith(PREFIX)) keys.push(key);
        }
        keys.forEach((key) => session.removeItem(key));
      }
      notify("Limpeza concluída.", "success");
    } catch (error) {
      notify(error.message || "Não foi possível concluir a limpeza.", "error");
    } finally {
      setBusy(false, "Limpeza concluída.");
      refreshStorageSummary();
    }
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value).replace(/\r?\n/g, " ");
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function defaultDateRange() {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { start: localDateKey(start), end: localDateKey(end) };
  }

  async function exportGrconComparison() {
    const start = $("#macro6-report-start")?.value || "";
    const end = $("#macro6-report-end")?.value || "";
    if (start && end && start > end) {
      notify("A data inicial não pode ser posterior à data final.", "warning");
      return;
    }
    setBusy(true, "Preparando relatório comparativo…");
    try {
      const documents = await root.GrconAnalysisHistory?.allDocuments?.() || [];
      const egrdts = root.GrconHistory?.read?.() || [];
      const postings = root.GrconSigemPosting?.read?.() || [];
      const dates = new Map();
      const rowFor = (dateKey) => {
        if (!dates.has(dateKey)) dates.set(dateKey, { dateKey, total: 0, ready: 0, review: 0, blocked: 0, discard: 0, egrdts: 0, documents: 0, posted: 0, pending: 0, failed: 0, cancelled: 0 });
        return dates.get(dateKey);
      };
      const inside = (key) => key && (!start || key >= start) && (!end || key <= end);
      documents.forEach((record) => {
        const key = record.dateKey || localDateKey(record.analyzedAt);
        if (!inside(key)) return;
        const row = rowFor(key);
        row.total += 1;
        const status = String(record.statusKey || root.GrconAnalysisHistory?.statusKey?.(record.statusDelivered || record.decision || "") || "").toUpperCase();
        if (status === "READY") row.ready += 1;
        else if (status === "REVIEW") row.review += 1;
        else if (status === "BLOCKED") row.blocked += 1;
        else if (status === "DISCARD") row.discard += 1;
      });
      egrdts.forEach((record) => {
        const key = localDateKey(record.generatedAt);
        if (!inside(key)) return;
        const row = rowFor(key);
        row.egrdts += 1;
        row.documents += Number(record.documentCount || 0);
      });
      postings.forEach((record) => {
        const key = localDateKey(record.updatedAt || record.generatedAt);
        if (!inside(key)) return;
        const row = rowFor(key);
        const status = String(record.status || "").toUpperCase();
        if (status === "POSTADO") row.posted += 1;
        else if (status === "PENDENCIA") row.pending += 1;
        else if (status === "FALHA") row.failed += 1;
        else if (status === "CANCELADO") row.cancelled += 1;
      });
      const rows = [...dates.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      const header = ["Data", "Análises", "Prontos", "Revisar", "Bloqueados", "Desconsiderados", "eGRDTs geradas", "Documentos nas eGRDTs", "Postadas", "Pendências", "Falhas", "Canceladas"];
      const lines = [header, ...rows.map((row) => [row.dateKey, row.total, row.ready, row.review, row.blocked, row.discard, row.egrdts, row.documents, row.posted, row.pending, row.failed, row.cancelled])];
      const csv = `\uFEFF${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
      download(csv, `GRCON_comparativo_${start || "inicio"}_${end || "fim"}.csv`, "text/csv;charset=utf-8");
      notify(`${rows.length} dia(s) incluído(s) no relatório comparativo.`, "success");
    } catch (error) {
      notify(error.message || "Não foi possível gerar o relatório comparativo.", "error");
    } finally {
      setBusy(false, "Aguardando ação.");
    }
  }

  function exportReconSessionReport() {
    const moduleNames = {
      relations: "Gerador de Relações",
      allocation: "Gerador de Alocação",
      tags: "Conferência de TAGs",
      databook: "Databook",
      titles: "Correção de títulos",
      renamer: "Renomeador",
    };
    const lines = [["Módulo", "Indicador", "Valor"]];
    Object.entries(moduleNames).forEach(([key, label]) => {
      const section = $(`[data-module-view="${key}"]`);
      if (!section) return;
      const seen = new Set();
      $$(`nav.summary div, nav.audit-summary div, nav.allocation-summary div, .allocation-summary div`, section).forEach((item) => {
        const name = $("span", item)?.textContent?.trim();
        const value = $("strong", item)?.textContent?.trim();
        if (!name || value == null) return;
        const signature = `${name}|${value}`;
        if (seen.has(signature)) return;
        seen.add(signature);
        lines.push([label, name, value]);
      });
      const rows = $$(`tbody tr`, section).filter((row) => !row.hidden).length;
      if (rows) lines.push([label, "Linhas visíveis", rows]);
    });
    const pending = $("#recon-pending-badge")?.textContent?.trim();
    if (pending) lines.push(["Pendências", "Total", pending]);
    lines.push(["Aplicativo", "Versão", APP_VERSION]);
    lines.push(["Relatório", "Gerado em", new Date().toLocaleString("pt-BR")]);
    const csv = `\uFEFF${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
    download(csv, `RECON_resumo_sessao_${timestamp()}.csv`, "text/csv;charset=utf-8");
    notify("Resumo da sessão exportado.", "success");
  }

  function closeReconDialog() {
    const dialog = $("#recon-preferences-dialog");
    const overlay = $("#recon-preferences-overlay");
    if (dialog) { dialog.hidden = true; dialog.setAttribute("aria-hidden", "true"); }
    if (overlay) overlay.hidden = true;
    $("#recon-preferences-open")?.focus();
  }

  function openReconDialog() {
    const dialog = $("#recon-preferences-dialog");
    const overlay = $("#recon-preferences-overlay");
    if (dialog) { dialog.hidden = false; dialog.setAttribute("aria-hidden", "false"); }
    if (overlay) overlay.hidden = false;
    refreshStorageSummary();
    root.setTimeout(() => $("#recon-preferences-close")?.focus(), 0);
  }

  function bindCommon(options) {
    const ids = options.ids;
    $(ids.exportPreferences)?.addEventListener("click", exportPreferences);
    $(ids.importPreferences)?.addEventListener("click", () => $(ids.importPreferencesInput)?.click());
    $(ids.importPreferencesInput)?.addEventListener("change", (event) => importPayload(event.target.files?.[0], false));
    $(ids.exportFull)?.addEventListener("click", exportCompleteBackup);
    $(ids.importFull)?.addEventListener("click", () => $(ids.importFullInput)?.click());
    $(ids.importFullInput)?.addEventListener("change", (event) => importPayload(event.target.files?.[0], true));
    $(ids.resetPreferences)?.addEventListener("click", resetPreferences);
    $(ids.clearOperational)?.addEventListener("click", clearOperationalData);
  }

  function initGrcon() {
    const range = defaultDateRange();
    const start = $("#macro6-report-start");
    const end = $("#macro6-report-end");
    if (start && !start.value) start.value = range.start;
    if (end && !end.value) end.value = range.end;
    bindCommon({ ids: {
      exportPreferences: "#macro6-preferences-export",
      importPreferences: "#macro6-preferences-import-button",
      importPreferencesInput: "#macro6-preferences-import",
      exportFull: "#macro6-full-export",
      importFull: "#macro6-full-import-button",
      importFullInput: "#macro6-full-import",
      resetPreferences: "#macro6-reset-preferences",
      clearOperational: "#macro6-clear-operational",
    }});
    $("#macro6-comparison-report")?.addEventListener("click", exportGrconComparison);
    refreshStorageSummary();
  }

  function initRecon() {
    $("#recon-preferences-open")?.addEventListener("click", openReconDialog);
    $("#recon-preferences-close")?.addEventListener("click", closeReconDialog);
    $("#recon-preferences-overlay")?.addEventListener("click", closeReconDialog);
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#recon-preferences-dialog")?.hidden) closeReconDialog();
    });
    bindCommon({ ids: {
      exportPreferences: "#recon-preferences-export",
      importPreferences: "#recon-preferences-import-button",
      importPreferencesInput: "#recon-preferences-import",
      exportFull: "#recon-full-export",
      importFull: "#recon-full-import-button",
      importFullInput: "#recon-full-import",
      resetPreferences: "#recon-reset-preferences",
      clearOperational: "#recon-clear-operational",
    }});
    $("#recon-session-report")?.addEventListener("click", exportReconSessionReport);
    refreshStorageSummary();
  }

  function init() {
    if (APP === "GRCON") initGrcon(); else initRecon();
    root.QualityProductivityCenter = Object.freeze({
      app: APP,
      version: APP_VERSION,
      exportPreferences,
      exportCompleteBackup,
      refreshStorageSummary,
    });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
