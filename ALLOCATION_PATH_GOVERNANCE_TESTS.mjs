import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const A = require("./allocation_core.js");
const G = require("./allocation_path_governance.js");

function path(code, rowNumber, levels) {
  return { code, rowNumber, levels };
}

const paths = [
  path("10.2.1", 195, ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.A.DINÂMICOS"]),
  path("10.2.1", 196, ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.B.ELÉTRICA"]),
  path("10.2.1", 199, ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.E.INSTRUMENTAÇÃO"]),
  path("10.2.1", 202, ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.H.TUBULAÇÃO"]),
  path("3.6", 31, ["UHDTD U-32", "03.REPARO", "03.06.ESTÁTICOS"]),
  path("3.9", 34, ["UHDTD U-32", "03.REPARO", "03.09.ESTRUTURA METÁLICA"]),
];

const control = {
  projectLevelBase: paths,
  // Reproduz a causa raiz antiga: a maioria histórica do EAP apontava para
  // ELÉTRICA. A governança nova não pode usar isso como fonte de verdade.
  levelsByEap: new Map([
    ["10.2.1.2", ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.B.ELÉTRICA"]],
  ]),
};

const tubPath = paths.find((entry) => G.candidateDiscipline(entry) === "TUBULACAO" && entry.code === "10.2.1");
const electricPath = paths.find((entry) => G.candidateDiscipline(entry) === "ELETRICA" && entry.code === "10.2.1");
const instrumentPath = paths.find((entry) => G.candidateDiscipline(entry) === "INSTRUMENTACAO" && entry.code === "10.2.1");
const staticPath = paths.find((entry) => G.candidateDiscipline(entry) === "EQP_ESTATICOS");
const structurePath = paths.find((entry) => G.candidateDiscipline(entry) === "ESTRUTURA_METALICA");

assert.ok(tubPath && electricPath && instrumentPath && staticPath && structurePath, "fixture precisa representar os ramos da Base");

function record(document, discipline, workflow, databook) {
  return { document, discipline, workflow, databook };
}

function output(workflow, databook, levels) {
  return { workflow, databook, levels: levels.slice() };
}

const tubDocuments = [
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-228452-Tubos",
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-4682-Conexoes",
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-1593-Tubos",
  "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-225081-Conexoes",
];

for (const document of tubDocuments) {
  const item = record(document, "TUB", "RNEST UHDTD U-32 C&M/TUBULACAO", "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO");
  const current = output(item.workflow, item.databook, electricPath.levels);
  const resolution = G.resolveProjectPath(control, item, current);
  assert.equal(resolution.status, "resolved", `${document} precisa resolver um ramo único`);
  assert.equal(resolution.confidence, "alta", `${document} precisa ter confiança alta`);
  assert.deepEqual(resolution.levels, G.buildIndex(paths).bySignature.get(G.levelSignature(tubPath.levels)).levels);
  assert.notEqual(G.levelSignature(resolution.levels), G.levelSignature(electricPath.levels), `${document} não pode receber ELÉTRICA`);
}

{
  const item = record("C1O_RNEST_U32_10.2.1.2_ELE_RIR_nt-NF-95169-Conexoes", "ELE", "RNEST UHDTD U-32 C&M/ELETRICA", "UHDT-D|DATA BOOK C&M|ELÉTRICA|RIR ELÉTRICA");
  const resolution = G.resolveProjectPath(control, item, output(item.workflow, item.databook, tubPath.levels));
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.levels, electricPath.levels, "ELÉTRICA deve permanecer no ramo ELÉTRICA da própria Base");
}

{
  const item = record("C1O_RNEST_U32_10.2.1.2_INS_RIR_nt-NF-115326", "INS", "RNEST UHDTD U-32 C&M/INSTRUMENTACAO", "UHDT-D|DATA BOOK C&M|INSTRUMENTAÇÃO|RIR_INSTRUMENTAÇÃO");
  const resolution = G.resolveProjectPath(control, item, output(item.workflow, item.databook, electricPath.levels));
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.levels, instrumentPath.levels, "Instrumentação deve permanecer no ramo da própria Base");
}

{
  const item = record("C1O_RNEST_U32_3.6.9.1_EST_RIR_nt-NF-0007-Parafusos", "ESTATICOS", "RNEST UHDTD U-32 C&M/ESTATICOS", "UHDT-D|DATA BOOK C&M|EQP ESTÁTICO|RIR|EQP ESTÁTICOS DIVERSOS");
  const resolution = G.resolveProjectPath(control, item, output(item.workflow, item.databook, staticPath.levels));
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.levels, staticPath.levels, "Estáticos não pode ser afetado pela correção de TUB");
}

{
  const item = record("C1O_RNEST_U32_3.9.2.1_CVL_RIR_nt-EMT-NF-0378-Acessorios", "CIVIL", "RNEST UHDTD U-32 C&M/CIVIL", "UHDT-D|DATA BOOK C&M|CIVIL|RIR ESTRUTURA METÁLICA");
  const resolution = G.resolveProjectPath(control, item, output(item.workflow, item.databook, structurePath.levels));
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.levels, structurePath.levels, "CVL/EMT deve continuar no ramo específico de estrutura metálica");
}

{
  const mixed = {
    output: { levels: tubPath.levels.slice(), allocationPathResolution: null },
    allocationPathResolution: null,
  };
  const resolution = G.resolveProjectPath(control,
    record(tubDocuments[0], "TUB", "RNEST UHDTD U-32 C&M/TUBULACAO", "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO"),
    output("RNEST UHDTD U-32 C&M/TUBULACAO", "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO", electricPath.levels));
  mixed.allocationPathResolution = resolution;
  mixed.output.allocationPathResolution = resolution;
  mixed.output.levels = resolution.levels.slice();
  assert.doesNotThrow(() => G.validateExportableResult(mixed));
  mixed.output.levels[3] = electricPath.levels[3];
  assert.throws(() => G.validateExportableResult(mixed), /REVISAR CAMINHO DE ALOCAÇÃO/, "misturar N4 de outro ramo deve bloquear exportação");
}

{
  const ambiguousControl = {
    projectLevelBase: [
      tubPath,
      path("10.2.1", 999, ["UHDTD U-32", "10.SUPRIMENTO", "10.02.BENS TAG PRAT OU NÃO TAG", "10.02.01.K.TUBULAÇÃO ALTERNATIVA"]),
    ],
  };
  const item = record(tubDocuments[0], "TUB", "RNEST UHDTD U-32 C&M/TUBULACAO", "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO");
  const resolution = G.resolveProjectPath(ambiguousControl, item, output(item.workflow, item.databook, electricPath.levels));
  assert.equal(resolution.status, "review", "empate estrutural deve pedir revisão em vez de escolher a primeira linha");
  assert.equal(resolution.blocking, true);
}

console.log("Allocation path governance regression: OK");
