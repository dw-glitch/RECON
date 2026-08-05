"use strict";
self.window = self;

// Falha de carregamento é infraestrutura: o cliente deve repetir fora do Worker.
// Um erro lançado depois, ao ler a planilha, é do arquivo — repetir não resolve.
let bootError = null;
try {
  importScripts("xlsx.full.min.js", "recon_contracts.js", "core.js");
} catch (error) {
  bootError = String(error && error.message || error || "Falha ao carregar a biblioteca de planilhas");
}

function serializeWorkbook(workbook) {
  const sheets = {};
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name];
    sheets[name] = self.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  }
  return { sheetNames: [...(workbook.SheetNames || [])], sheets, props: workbook.Props || {}, custprops: workbook.Custprops || {} };
}

function readWorkbook(buffer, options) {
  return self.XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true, dense: false, ...(options || {}) });
}

function fail(id, error, infrastructure) {
  self.postMessage({
    id,
    error: String(error && error.message || error || "Falha ao ler planilha"),
    infrastructure: Boolean(infrastructure),
  });
}

self.onmessage = (event) => {
  const { id, buffer, options, mode, meta } = event.data || {};

  if (bootError) { fail(id, bootError, true); return; }

  const missing = ["XLSX", "TriagemCore"].filter((name) => self[name] == null);
  if (mode === "ld" && missing.length) {
    fail(id, `Componente(s) ausente(s) no Worker: ${missing.join(", ")}.`, true);
    return;
  }
  if (self.XLSX == null) { fail(id, "Componente ausente no Worker: XLSX.", true); return; }

  try {
    self.postMessage({ id, progress: 15, message: "Abrindo planilha" });
    const workbook = readWorkbook(buffer, options);
    if (mode === "ld") {
      self.postMessage({ id, progress: 48, message: "Lendo documentos e histórico" });
      const parsed = self.TriagemCore.parseWorkbook(
        workbook,
        meta && meta.sourceName || "LD",
        meta && meta.sourceTimestamp || 0,
        meta && meta.compatibilityProfile || null
      );
      self.postMessage({ id, progress: 76, message: "Criando índice da LD" });
      const index = meta && meta.buildIndex === false ? null : self.TriagemCore.buildIndex(parsed.records, parsed.history);
      self.postMessage({ id, progress: 100, result: { parsed, index } });
      return;
    }
    self.postMessage({ id, progress: 70, message: "Preparando abas" });
    const serialized = serializeWorkbook(workbook);
    self.postMessage({ id, progress: 100, result: serialized });
  } catch (error) {
    fail(id, error, false);
  }
};
