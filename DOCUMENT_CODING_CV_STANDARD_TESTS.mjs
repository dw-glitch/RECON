import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Normative = require("./document_coding_cv_standard.js");

// Reproduz a ordem real do navegador: primeiro o padrão CV substitui a base
// normativa global, depois o motor de codificação é carregado.
const normativePath = require.resolve("./document_coding_normative.js");
require.cache[normativePath].exports = Normative;
delete require.cache[require.resolve("./document_coding_core.js")];
delete require.cache[require.resolve("./document_coding_cv_core_standard.js")];
delete require.cache[require.resolve("./document_coding_ld_core.js")];
delete require.cache[require.resolve("./document_coding_cv_ld_standard.js")];
const Core = require("./document_coding_cv_core_standard.js");
const LD = require("./document_coding_cv_ld_standard.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
}

function normalizedCv(code, discipline, rowNumber) {
  return {
    code,
    title: `Curriculo - ${discipline}`,
    discipline,
    ld: "LD-5290.00-22313-91A-C1O-001_0001_E.xlsx",
    sheet: "CV",
    rowNumber,
    raw: {
      DOCUMENTO: code,
      TÍTULO: `Curriculo - ${discipline}`,
      DISCIPLINA: discipline,
      REVISÃO: "0",
    },
    parsedN1710: null,
    parsedEtReport: null,
  };
}

test("CV usa exatamente contrato-emissor-CV-disciplina-sequencial", () => {
  assert.deepEqual(Normative.RULES.ET_CV.groups, ["contract", "emitter", "documentType", "discipline", "sequence"]);
  assert.equal(Normative.RULES.ET_CV.sequenceDigits, 4);
  assert.deepEqual(Normative.RULES.ET_CV.sequenceFamily, ["contract", "emitter", "documentType", "discipline"]);
});

test("sequencial de currículo reinicia por disciplina conforme a LD real", () => {
  const std = Normative.CV_OPERATIONAL_STANDARD;
  assert.equal(std.contract, "5900.0130870.25.2");
  assert.equal(std.emitter, "C1O");
  assert.ok(std.examples.includes("5900.0130870.25.2-C1O-CV-CRS-0001"));
  assert.ok(std.examples.includes("5900.0130870.25.2-C1O-CV-CVL-0001"));
  assert.ok(std.examples.includes("5900.0130870.25.2-C1O-CV-ELE-0001"));
  assert.ok(std.examples.includes("5900.0130870.25.2-C1O-CV-GER-0001"));
});

test("motor infere contrato/emissor da aba CV e não mistura sequencial de CRS com GER", () => {
  const ldIndex = Core.buildLdIndex([
    normalizedCv("5900.0130870.25.2-C1O-CV-CRS-0009", "CRS", 7),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0001", "GER", 8),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0002", "GER", 9),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0003", "GER", 10),
  ]);
  const result = Core.analyzeDocument({
    filename: "Curriculo_Gerente_Contrato.docx",
    text: "CURRICULO\nGER\nGerente do Contrato\nFormação em Engenharia",
  }, ldIndex, {});
  assert.equal(result.ruleId, "et-cv");
  assert.equal(result.data.contract, "5900.0130870.25.2");
  assert.equal(result.data.emitter, "C1O");
  assert.equal(result.data.discipline, "GER");
  assert.equal(result.code, "5900.0130870.25.2-C1O-CV-GER-0004");
});

test("linha do currículo é direcionada para a aba CV e mantém só a família GER", () => {
  const rows = [
    normalizedCv("5900.0130870.25.2-C1O-CV-CRS-0009", "CRS", 7),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0001", "GER", 8),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0002", "GER", 9),
    normalizedCv("5900.0130870.25.2-C1O-CV-GER-0003", "GER", 10),
  ];
  const schema = {
    id: "cv-schema",
    file: "LD-5290.00-22313-91A-C1O-001_0001_E.xlsx",
    sheet: "CV",
    headers: ["DOCUMENTO", "REVISÃO", "TÍTULO", "DISCIPLINA"],
    signature: "DOCUMENTO|REVISAO|TITULO|DISCIPLINA",
    rows,
    rawRows: [],
    fillRatios: { DOCUMENTO: 1, REVISÃO: 1, TÍTULO: 1, DISCIPLINA: 1 },
    dimensions: { scheme: new Map([["OTHER", 4]]), category: new Map(), discipline: new Map([["CRS", 1], ["GER", 3]]), unit: new Map(), eap: new Map(), reportCode: new Map(), installation: new Map(), activityArea: new Map(), serviceClass: new Map(), origin: new Map() },
  };
  const analysis = {
    ruleId: "et-cv",
    code: "5900.0130870.25.2-C1O-CV-GER-0004",
    sequence: "0004",
    complete: true,
    data: { contract: "5900.0130870.25.2", emitter: "C1O", discipline: "GER", revision: "0", title: "Curriculo - Gerência - Gerente do Contrato", classification: { kind: "et-cv", label: "Currículo" } },
  };
  const destination = LD.chooseCvDestination(analysis, { schemas: [schema] });
  assert.equal(destination.schema.sheet, "CV");
  const family = LD.cvRows(schema, analysis);
  assert.equal(family.length, 3);
  assert.ok(family.every((row) => row.discipline === "GER"));
  const line = LD.generateLine(analysis, { schemas: [schema], byId: new Map([[schema.id, schema]]) }, {});
  assert.equal(line.schema.sheet, "CV");
  assert.match(line.position.label, /GER-0003/);
  assert.doesNotMatch(line.position.label, /CRS-0009/);
});

test("correções operacionais são carregadas na ordem correta", () => {
  const loader = fs.readFileSync("recon_module_loader.js", "utf8");
  const normativeStandard = loader.indexOf('"document_coding_cv_standard.js"');
  const core = loader.indexOf('"document_coding_core.js"');
  const coreStandard = loader.indexOf('"document_coding_cv_core_standard.js"');
  const ldCore = loader.indexOf('"document_coding_ld_core.js"');
  const ldStandard = loader.indexOf('"document_coding_cv_ld_standard.js"');
  const ldApp = loader.indexOf('"document_coding_ld_app.js"');
  assert.ok(normativeStandard >= 0 && core > normativeStandard);
  assert.ok(coreStandard > core, "padrão operacional do motor CV deve vir após o core");
  assert.ok(ldCore > coreStandard, "LD core deve capturar o Core já corrigido");
  assert.ok(ldStandard > ldCore && ldApp > ldStandard, "padrão CV da LD deve ser aplicado antes do app de Linhas da LD");
});

test("correções CV ficam disponíveis offline", () => {
  const sw = fs.readFileSync("sw.js", "utf8");
  assert.match(sw, /document_coding_cv_standard\.js/);
  assert.match(sw, /document_coding_cv_core_standard\.js/);
  assert.match(sw, /document_coding_cv_ld_standard\.js/);
});

console.log(`\nPadrão CV: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
