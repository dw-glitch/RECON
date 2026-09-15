import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Normative = require("./document_coding_cv_standard.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
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

test("correção normativa de CV é carregada antes do motor de codificação", () => {
  const loader = fs.readFileSync("recon_module_loader.js", "utf8");
  const standard = loader.indexOf('"document_coding_cv_standard.js"');
  const core = loader.indexOf('"document_coding_core.js"');
  assert.ok(standard >= 0, "shim do padrão CV não registrado no loader");
  assert.ok(core > standard, "motor de codificação precisa carregar depois do padrão CV");
});

test("padrão CV fica disponível offline", () => {
  const sw = fs.readFileSync("sw.js", "utf8");
  assert.match(sw, /document_coding_cv_standard\.js/);
});

console.log(`\nPadrão CV: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
