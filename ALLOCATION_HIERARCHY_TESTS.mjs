import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const A = require("./allocation_core.js");

function levels(n4, n2 = "10.SUPRIMENTO", n3 = "10.02.BENS TAG PRAT OU NÃO TAG") {
  return ["UHDTD U-32", n2, n3, n4, "", "", "", "", "", ""];
}

const projectLevelBase = [
  { code: "10.2.1", levels: levels("10.02.01.A.DINÂMICOS"), rowNumber: 193 },
  { code: "10.2.1", levels: levels("10.02.01.B.ELÉTRICA"), rowNumber: 194 },
  { code: "10.2.1", levels: levels("10.02.01.C.ESTÁTICOS"), rowNumber: 195 },
  { code: "10.2.1", levels: levels("10.02.01.E.INSTRUMENTAÇÃO"), rowNumber: 197 },
  { code: "10.2.1", levels: levels("10.02.01.F.SEGURANÇA"), rowNumber: 198 },
  { code: "10.2.1", levels: levels("10.02.01.G.TELECOM"), rowNumber: 199 },
  { code: "10.2.1", levels: levels("10.02.01.H.TUBULAÇÃO"), rowNumber: 200 },
  { code: "10.2.1", levels: levels("10.02.01.I.ESTRUTURA METÁLICA"), rowNumber: 201 },
  { code: "10.2.1", levels: levels("10.02.01.J.HVAC"), rowNumber: 202 },
  { code: "3.4", levels: ["UHDTD U-32", "03.REPARO", "03.04.CIVIL", "", "", "", "", "", "", ""], rowNumber: 50 },
];

const electricalPath = projectLevelBase.find((entry) => A.projectPathDisciplineKey(entry.levels) === "ELETRICA").levels;
const pollutedHistory = new Map([["10.2.1.2", electricalPath.slice()]]);

function control(overrides = {}) {
  return {
    projectLevelBase,
    levelsByEap: pollutedHistory,
    levelsByDatabook: new Map(),
    ...overrides,
  };
}

function tubRecord(document) {
  return {
    document,
    discipline: "TUB",
    workflow: "RNEST UHDTD U-32 C&M/TUBULACAO",
    title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO",
    "CAMINHO DATA BOOK": "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO|TUB E STH",
  };
}

function expectedLeaf(discipline) {
  const found = projectLevelBase.find((entry) => A.projectPathDisciplineKey(entry.levels) === discipline);
  assert.ok(found, `fixture sem caminho para ${discipline}`);
  return found.levels.filter(Boolean).at(-1);
}

const criticalDocuments = [
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-228452-Tubos",
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-4682-Conexoes",
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-1593-Tubos",
];

for (const document of criticalDocuments) {
  const record = tubRecord(document);
  const resolution = A.levelResolutionForEap(control(), record);
  assert.equal(resolution.sourceType, "project-base", `${document}: a Base mestre deve vencer o histórico contaminado`);
  assert.equal(resolution.levels[3], expectedLeaf("TUBULACAO"), `${document}: deve cair em TUBULAÇÃO`);
  assert.notEqual(resolution.levels[3], expectedLeaf("ELETRICA"), `${document}: nunca pode cair em ELÉTRICA`);

  const output = A.outputFromRecord(record, null, null, control(), "2026-09-15", null);
  assert.equal(output.levels[3], expectedLeaf("TUBULACAO"), `${document}: output final deve manter o mesmo ramo mestre`);
}

const disciplineCases = [
  ["C1O_RNEST_U32_10.2.1.2_ELE_RIR_nt-LBN-NF-6204", "ELE", "RNEST UHDTD U-32 C&M/ELETRICA", "ELETRICA"],
  ["C1O_RNEST_U32_10.2.1.2_INS_RIR_nt-FIT-320302A", "INS", "RNEST UHDTD U-32 C&M/INSTRUMENTACAO", "INSTRUMENTACAO"],
  ["C1O_RNEST_U32_10.2.1.2_TEL_RIR_nt-NF-1", "TEL", "RNEST UHDTD U-32 C&M/TELECOM", "TELECOM"],
  ["C1O_RNEST_U32_10.2.1.2_MEC_RIR_nt-NF-2", "MEC", "RNEST UHDTD U-32 C&M/EQP ESTATICOS", "EQP_ESTATICOS"],
  ["C1O_RNEST_U32_10.2.1.2_EQD_RIR_nt-NF-3", "EQD", "RNEST UHDTD U-32 C&M/EQP DINAMICOS", "EQP_DINAMICOS"],
  ["C1O_RNEST_U32_10.2.1.2_HVAC_RIR_nt-NF-4", "HVAC", "RNEST UHDTD U-32 C&M/HVAC", "HVAC"],
];

for (const [document, discipline, workflow, expectedDiscipline] of disciplineCases) {
  const record = { document, discipline, workflow };
  const resolution = A.levelResolutionForEap(control(), record);
  assert.equal(resolution.sourceType, "project-base", `${document}: deve resolver pela Base mestre`);
  assert.equal(resolution.levels[3], expectedLeaf(expectedDiscipline), `${document}: disciplina incorreta`);
}

const civil = {
  document: "C1O_RNEST_U32_3.4.21.1_CVL_LAC_nt-R-32001",
  discipline: "CIVIL",
  workflow: "RNEST UHDTD U-32 C&M/CIVIL",
};
const civilResolution = A.levelResolutionForEap(control({ levelsByEap: new Map() }), civil);
assert.equal(civilResolution.sourceType, "project-base");
assert.equal(civilResolution.levels[2], "03.04.CIVIL");

// Sem evidência de disciplina, vários ramos da mesma EAP são ambíguos. O
// sistema deve pedir revisão em vez de escolher a primeira linha da Base.
const ambiguous = {
  document: "C1O_RNEST_U32_10.2.1.2_XXX_RIR_nt-NF-9999",
  discipline: "",
  workflow: "",
};
const ambiguousResolution = A.levelResolutionForEap(control(), ambiguous);
assert.equal(ambiguousResolution.blockFallback, true);
assert.equal(ambiguousResolution.levels.length, 0);
assert.match(ambiguousResolution.reason, /REVISAR CAMINHO DE ALOCAÇÃO/);

// Mesmo sem a Base, um histórico contraditório não pode ser reutilizado.
const historyOnlyConflict = A.levelResolutionForEap(
  control({ projectLevelBase: [] }),
  tubRecord(criticalDocuments[0]),
);
assert.equal(historyOnlyConflict.blockFallback, true);
assert.equal(historyOnlyConflict.sourceType, "history-eap-conflict");
assert.equal(historyOnlyConflict.levels.length, 0);

// A montagem exportável precisa ser um caminho único: nenhuma combinação
// N1/N2/N3 de um ramo com N4 de outro pode sobreviver à validação estrutural.
const mixed = electricalPath.slice();
mixed[0] = projectLevelBase.find((entry) => A.projectPathDisciplineKey(entry.levels) === "TUBULACAO").levels[0];
assert.equal(A.levelsCompatibleWithRecord(mixed, tubRecord(criticalDocuments[0])), false);

console.log("ALLOCATION_HIERARCHY_TESTS: OK");
