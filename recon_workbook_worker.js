"use strict";
self.window = self;
importScripts("xlsx.full.min.js", "recon_contracts.js", "core.js");

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

self.onmessage = (event) => {
  const { id, buffer, options, mode, meta } = event.data || {};
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
    self.postMessage({ id, error: String(error && error.message || error || "Falha ao ler planilha") });
  }
};
