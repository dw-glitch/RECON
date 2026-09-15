import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const Core = require("./document_coding_core.js");
const LD = require("./document_coding_ld_core.js");
const Profile = require("./document_coding_n1710_profile.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
}

function makeFile(filename, sheet, headers, rows) {
  return {
    filename,
    hash: filename,
    sheetNames: [sheet],
    count: rows.length,
    rows: rows.map((values, index) => ({ row: Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])), meta: { name: filename, sheet, rowNumber: index + 2 } })),
  };
}

const headers = ["Código", "Título", "Revisão", "Disciplina", "TAG", "Prazo", "Taxonomia LD"];
const ld001 = makeFile("N-1710_LD_001.xlsx", "TUB", headers, [
  ["RL-5290.00-22313-200-C1O-025", "Relatório 25", "0", "TUB", "", "A01", "N1710"],
  ["RL-5290.00-22313-200-C1O-026", "Relatório 26", "0", "TUB", "", "A01", "N1710"],
  ["RL-5290.00-22313-200-C1O-028", "Relatório 28", "0", "TUB", "", "A01", "N1710"],
]);
const ld003 = makeFile("ET_LD_003_RIR.xlsx", "RIR", headers, [
  ["C1O_RNEST_U32_3.8.9.1_TUB_RIR_32-P-1001", "RIR bomba", "0", "TUB", "32-P-1001", "E30", "RIR"],
  ["C1O_RNEST_U32_3.8.9.1_TUB_RIR_32-P-1002", "RIR bomba 2", "0", "TUB", "32-P-1002", "E30", "RIR"],
]);
const allRows = [...ld001.rows, ...ld003.rows];
const normalized = Core.buildLdIndex(allRows).rows;
const schemaIndex = LD.buildSchemaIndex([ld001, ld003], normalized);

function n1710Analysis(code = "RL-5290.00-22313-200-C1O-027") {
  return {
    ruleId: "n1710", code, sequence: code.split("-").at(-1), complete: true,
    data: { title: "Relatório 27", revision: "A", discipline: "TUB", category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "200", origin: "C1O", classification: { label: "Relatório" } },
  };
}

test("perfil N-1710 respeita revisões independentes dos anexos fornecidos", () => {
  assert.equal(Profile.PARTS.text.revision, "N");
  assert.equal(Profile.PARTS.A.revision, "W");
  assert.equal(Profile.PARTS.B.revision, "CJ");
  assert.equal(Profile.PARTS.C.revision, "BF");
  assert.equal(Profile.PARTS.D.revision, "BG");
  assert.equal(Profile.PARTS.E.revision, "D");
  assert.equal(Profile.PARTS.F.revision, "G");
  assert.equal(Profile.PARTS.G.revision, "CN");
});

test("fontes grupo a grupo apontam para o anexo vigente", () => {
  assert.match(Profile.sourceForGroup("category"), /Anexo A.*Rev\. W/);
  assert.match(Profile.sourceForGroup("installation"), /Anexo B.*Rev\. CJ/);
  assert.match(Profile.sourceForGroup("activityArea"), /Anexo C.*Rev\. BF/);
  assert.match(Profile.sourceForGroup("serviceClass"), /Anexo D.*Rev\. BG/);
  assert.match(Profile.sourceForGroup("activityArea", { transpetroFleet: true }), /Anexo E.*Rev\. D/);
  assert.match(Profile.sourceForGroup("serviceClass", { transpetroFleet: true }), /Anexo F.*Rev\. G/);
});

test("escolhe LD N-1710 pela família e estrutura em vez de modelo genérico", () => {
  const dest = LD.chooseDestination(n1710Analysis(), schemaIndex);
  assert.ok(dest.schema);
  assert.equal(dest.schema.file, "N-1710_LD_001.xlsx");
  assert.equal(dest.schema.sheet, "TUB");
});

test("linha segue exatamente a ordem de cabeçalhos da LD de destino", () => {
  const line = LD.generateLine(n1710Analysis(), schemaIndex);
  assert.deepEqual(line.headers, headers);
  assert.equal(line.values[0], "RL-5290.00-22313-200-C1O-027");
  assert.equal(line.values[1], "Relatório 27");
  assert.equal(line.values[2], "A");
  assert.equal(line.values[3], "TUB");
  assert.equal(line.values[5], "A01", "valor estável da família deve ser reaproveitado");
  assert.equal(line.values[6], "N1710", "taxonomia estável da família deve ser reaproveitada");
});

test("localização sugere inserir 027 entre 026 e 028", () => {
  const line = LD.generateLine(n1710Analysis(), schemaIndex);
  assert.match(line.position.label, /026/);
  assert.match(line.position.label, /028/);
});

test("TSV usa TAB, quebra de linha e não inclui cabeçalho por padrão", () => {
  const line = LD.generateLine(n1710Analysis(), schemaIndex);
  const tsv = LD.linesToTsv([line], false);
  assert.ok(tsv.includes("\t"));
  assert.ok(!tsv.startsWith("Código\t"));
  const withHeader = LD.linesToTsv([line, line], true);
  assert.ok(withHeader.startsWith("Código\tTítulo\t"));
  assert.ok(withHeader.includes("\r\n"));
});

test("zeros à esquerda são preservados no clipboard do Excel", () => {
  assert.equal(LD.excelCell("001"), "'001");
  assert.equal(LD.excelCell("0001"), "'0001");
  assert.equal(LD.excelCell("A01"), "A01");
});

test("estruturas incompatíveis não são misturadas num único conteúdo", () => {
  const line = LD.generateLine(n1710Analysis(), schemaIndex);
  const other = { ...line, headers: ["Código", "Título"], values: ["X", "Y"] };
  assert.throws(() => LD.linesToTsv([line, other], false), /incompatíveis/i);
});

test("documento existente retorna status existing e não gera nova linha", () => {
  const existingEntry = normalized.find((row) => row.code.endsWith("-026"));
  const analysis = { ...n1710Analysis(existingEntry.code), existing: true, ldMatch: existingEntry };
  const line = LD.generateLine(analysis, schemaIndex);
  assert.equal(line.status, "existing");
  assert.equal(line.valid, false);
  assert.equal(line.existing.code, existingEntry.code);
});

test("relatório RIR é direcionado para LD/aba RIR", () => {
  const analysis = {
    ruleId: "et-report", complete: true, code: "C1O_RNEST_U32_3.8.9.1_TUB_RIR_32-P-1003",
    data: { title: "RIR bomba 3", revision: "0", discipline: "TUB", tag: "32-P-1003", emitter: "C1O", enterprise: "RNEST", unit: "U32", eap: "3.8.9.1", reportCode: "RIR", classification: { label: "Relatório de Inspeção de Recebimento" } },
  };
  const dest = LD.chooseDestination(analysis, schemaIndex);
  assert.equal(dest.schema.file, "ET_LD_003_RIR.xlsx");
  assert.equal(dest.schema.sheet, "RIR");
});

test("índice de esquemas e geração de 100 linhas permanece eficiente em LD grande", () => {
  const bigRows = [];
  for (let i = 1; i <= 20000; i += 1) bigRows.push([`RL-5290.00-22313-200-C1O-${String(i).padStart(4, "0")}`, `Relatório ${i}`, "0", "TUB", "", "A01", "N1710"]);
  const big = makeFile("N-1710_LD_001_BIG.xlsx", "TUB", headers, bigRows);
  const start = performance.now();
  const idx = LD.buildSchemaIndex([big], Core.buildLdIndex(big.rows).rows);
  for (let i = 20001; i <= 20100; i += 1) LD.generateLine(n1710Analysis(`RL-5290.00-22313-200-C1O-${i}`), idx);
  const elapsed = performance.now() - start;
  console.log(`  benchmark sintético: 20.000 registros + 100 linhas = ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 10000, `benchmark patológico: ${elapsed.toFixed(1)} ms`);
});

console.log(`\nLinhas LD: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
