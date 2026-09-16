import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Bundle = require("./document_coding_bundle_core.js");
const PdfBundle = require("./document_coding_pdf_bundle.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
}

const parts = [
  { name: "03_CREA.pdf", text: "CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA CREA registro profissional", pageCount: 2 },
  { name: "02_Curriculo.pdf", text: "CURRICULUM VITAE\nFormação Acadêmica\nExperiência Profissional\nGerente do Contrato", pageCount: 4 },
  { name: "04_Clicksign.pdf", text: "Clicksign\nAssinaturas\nLog gerado em 04 de setembro\nDocumento assinado", pageCount: 1 },
  { name: "01_Avaliacao.pdf", text: "AVALIAÇÃO DE CURRÍCULO\nREQUISITO/FUNÇÃO CONTRATUAL: Anexo X – Apêndice C\nCONTADOR DE EXPERIÊNCIA\nAVALIAÇÃO CONSAG", pageCount: 3 },
];

test("currículo é reconhecido como um único dossiê", () => {
  assert.equal(Bundle.likelyCv(parts), true);
});

test("ordem do currículo segue avaliação, CV, comprovações e log", () => {
  const ordered = Bundle.orderParts(parts, true);
  assert.deepEqual(ordered.map((p) => p.bundleRole.id), [
    Bundle.PART_ROLE.CV_EVALUATION,
    Bundle.PART_ROLE.CV_RESUME,
    Bundle.PART_ROLE.CV_EVIDENCE,
    Bundle.PART_ROLE.SIGNATURE_LOG,
  ]);
});

test("texto consolidado mantém fronteira e conteúdo de cada PDF", () => {
  const ordered = Bundle.orderParts(parts, true);
  const combined = Bundle.buildCombinedText(ordered);
  assert.match(combined, /INICIO ARQUIVO 1\/4: 01_Avaliacao\.pdf/);
  assert.match(combined, /PAPEL NO DOSSIÊ: Avaliação de currículo/);
  assert.match(combined, /Gerente do Contrato/);
  assert.match(combined, /FIM ARQUIVO 4\/4: 04_Clicksign\.pdf/);
  assert.equal(Bundle.pageCount(ordered), 10);
});

test("modelo de avaliação de CV nunca aprova automaticamente", () => {
  const analysis = {
    code: "5900.0130870.25.2-C1O-CV-GER-0004",
    data: { contract: "5900.0130870.25.2", title: "Curriculo - Gerência - Gerente do Contrato", revision: "0" },
    cvCompliance: {
      role: { item: "3.2.1", title: "Gerente do Contrato" },
      claimedExperienceYears: 8,
      status: { label: "PRONTO PARA REVISÃO DOCUMENTAL" },
      criteria: [{ label: "Formação", detail: "Graduação em Engenharia", sourceItem: "3.2.1", evidence: "Engenharia" }],
    },
  };
  const model = PdfBundle.modelCvEvaluation(analysis, "NOME DO PROFISSIONAL: JOSE TESTE\nEMPREENDIMENTO: UHDT-D");
  assert.equal(model.contract, "5900.0130870.25.2");
  assert.equal(model.professional, "JOSE TESTE");
  assert.match(model.contractFunction, /Apêndice C/);
  assert.match(model.opinion, /PENDENTE/);
  assert.doesNotMatch(model.opinion, /^APROVADO$/);
});

test("runtime PDF não aponta mais por padrão para /pdf.worker.min.js inexistente", () => {
  const runtime = fs.readFileSync("document_coding_pdf_runtime.js", "utf8");
  assert.match(runtime, /3\.11\.174/);
  assert.match(runtime, /cdn\.jsdelivr\.net/);
  assert.match(runtime, /unpkg\.com/);
  assert.match(runtime, /cdnjs\.cloudflare\.com/);
  assert.doesNotMatch(runtime, /workerSrc\s*=\s*["']pdf\.worker\.min\.js["']/);
});

test("análise operacional é serial e não cria códigos por arquivo", () => {
  const app = fs.readFileSync("document_coding_bundle_runtime_app.js", "utf8");
  assert.match(app, /for \(let i = 0; i < state\.documents\.length; i \+= 1\)/);
  assert.match(app, /pageConcurrency:\s*1/);
  assert.doesNotMatch(app, /Parsers\.mapPool\(/);
  assert.match(app, /Core\.analyzeDocument\(\{ filename:cvHint/);
  assert.match(app, /1 documento · 1 código/);
});

test("gerador final aceita várias partes mas produz um único PDF", () => {
  const pdf = fs.readFileSync("document_coding_pdf_bundle.js", "utf8");
  assert.match(pdf, /async function generateFinalBundle/);
  assert.match(pdf, /for \(let i = 0; i < parts\.length; i \+= 1\)/);
  assert.match(pdf, /await appendBytes\(coverBytes, 0\)/);
  assert.match(pdf, /output\.save/);
  assert.match(pdf, /includeCvEvaluation/);
});

test("loader aplica runtime, consolidação e modelo CV antes do bootstrap", () => {
  const loader = fs.readFileSync("recon_module_loader.js", "utf8");
  const pdfjs = loader.indexOf('"pdf.min.js"');
  const runtime = loader.indexOf('"document_coding_pdf_runtime.js"');
  const bundleCore = loader.indexOf('"document_coding_bundle_core.js"');
  const pdfBase = loader.indexOf('"document_coding_pdf.js"');
  const pdfBundle = loader.indexOf('"document_coding_pdf_bundle.js"');
  const app = loader.indexOf('"document_coding_app.js"');
  const runtimeApp = loader.indexOf('"document_coding_bundle_runtime_app.js"');
  const bootstrap = loader.indexOf('"document_coding_bootstrap.js"');
  assert.ok(pdfjs >= 0 && runtime > pdfjs);
  assert.ok(bundleCore > runtime);
  assert.ok(pdfBundle > pdfBase && app > pdfBundle);
  assert.ok(runtimeApp > app && bootstrap > runtimeApp);
});

console.log(`\nDocumento consolidado: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
