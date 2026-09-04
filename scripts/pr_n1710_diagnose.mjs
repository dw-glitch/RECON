import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../core.js");
const A = require("../allocation_core.js");

const doc = "PR-5290.00-22313-700-C1O-006";
const previous = "PR-5290.00-22313-700-C1O-005";
const record = {
  document: doc,
  documentKey: C.key(doc),
  looseDocumentKey: C.looseKey(doc),
  revision: "0",
  title: "PROCEDIMENTO DE TESTE",
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
    { header: "DOCUMENTO", value: doc },
    { header: "DISCIPLINA", value: "QUALIDADE" },
    { header: "TIPO DE DOCUMENTO", value: "PR" },
    { header: "CONFIRMAÇÃO DOCUMENTOS PREVISTOS", value: "NÃO ALOCADO" },
  ],
};
const history = {
  document: previous,
  documentKey: C.key(previous),
  allocation: "C1O-ALOC-CM-0200-2026",
  databook: "UHDT-D|DATA BOOK C&M|GERAL - PROCEDIMENTOS DE EXECUÇÃO|QUALIDADE",
  levels: ["UHDT-D", "DATA BOOK C&M", "GERAL - PROCEDIMENTOS DE EXECUÇÃO", "QUALIDADE", "", "", "", "", "", ""],
  workflow: "QUALIDADE",
  rowNumber: 2,
  source: "historico.xlsx",
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
const index = C.buildIndex([record], []);
console.log("inferSheet", C.inferSheetFromName(doc));
console.log("validation", JSON.stringify(C.validateDocumentCode(doc, "N-1710")));
console.log("matches", C.matchDocuments(doc, index).length);
console.log("family", JSON.stringify(A.documentFamily(doc)));
const analyzed = A.analyze([{ raw: doc, hintedSheet: "N-1710" }], [record], control, {
  historyRows: [history],
  allocationDate: "2026-09-04",
  ldSourceNames: ["LD_001.xlsx"],
});
const result = analyzed.results[0];
console.log("decision", result && result.decision);
console.log("reason", result && result.reason);
console.log("databook", result && result.output && result.output.databook);
console.log("evidence", result && result.output && result.output.databookEvidence && JSON.stringify(result.output.databookEvidence));
console.log("warnings", result && result.warnings && result.warnings.join(" | "));
if (!result) process.exitCode = 2;
