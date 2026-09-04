import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const C = require("./core.js");
const A = require("./allocation_core.js");

const DOC = "PR-5290.00-22313-700-C1O-006";
const PREVIOUS = "PR-5290.00-22313-700-C1O-005";
const PATH = "UHDT-D|DATA BOOK C&M|GERAL - PROCEDIMENTOS DE EXECUÇÃO|QUALIDADE";

assert.equal(C.inferSheetFromName(DOC), "N-1710");
assert.deepEqual(C.validateDocumentCode(DOC, "N-1710").errors, []);

const fakeXlsx = {
  utils: {
    sheet_to_json(sheet) { return sheet.rows || []; },
  },
};
const workbook = {
  SheetNames: ["GERAL"],
  Sheets: {
    GERAL: {
      rows: [
        ["CÓDIGO DO DOCUMENTO", "Caminho Data Book", "Workflow", "N1", "N2", "N3", "N4"],
        [PREVIOUS, PATH, "QUALIDADE", "UHDT-D", "DATA BOOK C&M", "GERAL - PROCEDIMENTOS DE EXECUÇÃO", "QUALIDADE"],
      ],
    },
  },
};
const parsedHistory = A.parseHistoricalAllocationWorkbook(
  workbook,
  fakeXlsx,
  "C1O_ALOC_CM_0200_2026 - histórico revisado.xlsx",
);
assert.equal(parsedHistory.rows.length, 1, "histórico com cabeçalho alternativo deve ser reconhecido");
assert.equal(parsedHistory.rows[0].document, PREVIOUS);
assert.equal(parsedHistory.rows[0].allocation, "C1O-ALOC-CM-0200-2026");
assert.equal(parsedHistory.rows[0].databook, PATH);

const record = {
  document: DOC,
  documentKey: C.key(DOC),
  looseDocumentKey: C.looseKey(DOC),
  revision: "0",
  title: "PROCEDIMENTO DE EXECUÇÃO E CONTROLE DA QUALIDADE",
  discipline: "QUALIDADE",
  documentType: "PR",
  purpose: "Para Informação",
  databook: "",
  allocationStatus: "NÃO ALOCADO",
  allocation: "",
  sheet: "N-1710",
  row: 2,
  source: "LD_001.xlsx",
  sourceOrder: 0,
  sourceTimestamp: 1,
  ldColumns: [
    { header: "DOCUMENTO", value: DOC },
    { header: "DISCIPLINA", value: "QUALIDADE" },
    { header: "TIPO DE DOCUMENTO", value: "PR" },
    { header: "CONFIRMAÇÃO DOCUMENTOS PREVISTOS", value: "NÃO ALOCADO" },
  ],
};
const control = {
  rows: [],
  latestByDocument: new Map(),
  levelsByDatabook: new Map(),
  levelsByEap: new Map(),
  projectLevelBase: [],
  baseDocuments: new Map(),
  latestLdVersion: "0",
};
const analyzed = A.analyze([{ raw: DOC, hintedSheet: "N-1710" }], [record], control, {
  historyRows: parsedHistory.rows,
  allocationDate: "2026-09-04",
  ldSourceNames: ["LD_001.xlsx"],
});
assert.equal(analyzed.results.length, 1);
const result = analyzed.results[0];
assert.equal(result.decision, A.READY, "PR N-1710 não alocado deve poder gerar alocação");
assert.equal(result.output.databook, PATH, "PR deve reutilizar histórico estrutural compatível da mesma família");
assert.equal(result.output.databookEvidence.sourceType, "history");

const fallback = A.generalDatabookFallback(record);
assert.equal(fallback.databook, PATH, "sem histórico, QUALIDADE deve cair no caminho geral correto da disciplina");

const app = fs.readFileSync(path.join(root, "allocation_app.js"), "utf8");
const historyFilter = app.match(/function allocationHistoryFiles\(fileList\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.match(historyFilter, /\.xlsx\|xlsm\|xls/i, "seletor de histórico precisa aceitar planilhas Excel");
assert.doesNotMatch(historyFilter, /C1O-ALOC-CM-\\d\{4\}/, "histórico não pode depender do nome exato do arquivo");

console.log("PR/N-1710 allocation regression: OK");
