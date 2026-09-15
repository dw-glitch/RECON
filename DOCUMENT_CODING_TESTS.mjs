import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(new URL(import.meta.url).pathname);
const N = require("./document_coding_normative.js");
const C = require("./document_coding_core.js");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error.stack || error);
  }
}

check("ET Rev. Q é a revisão vigente e Rev. P permanece histórica", () => {
  assert.equal(N.latestNorm("ET-5290.00-22000-912-1LV-001").revision, "Q");
  assert.ok(N.NORMS.some((item) => item.id === "ET-5290.00-22000-912-1LV-001" && item.revision === "P" && item.status === "historical"));
});

check("N-1710 é montada por grupos e não por regex solta", () => {
  const result = C.buildN1710Code({
    category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "98F", origin: "C1O",
  }, C.buildLdIndex([]));
  assert.equal(result.code, "RL-5290.00-22313-98F-C1O-001");
  assert.equal(result.groups.length, 7);
  assert.match(result.groups.find((g) => g.field === "serviceClass").source, /Anexo D|Anexo F/);
});

check("N-1710 não inventa grupo ausente", () => {
  const result = C.buildN1710Code({ category: "RL", installation: "5290.00", activityArea: "22313", origin: "C1O" }, C.buildLdIndex([]));
  assert.equal(result.complete, false);
  assert.equal(result.confidence, C.CONFIDENCE.REVIEW);
  assert.ok(result.missing.includes("serviceClass"));
  assert.equal(result.code, "");
});

check("sequencial N-1710 usa somente a mesma família", () => {
  const index = C.buildLdIndex([
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-023", TITULO: "Relatório A" },
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-026", TITULO: "Relatório B" },
    { DOCUMENTO: "RL-5290.00-22313-98G-C1O-900", TITULO: "Outra classe" },
    { DOCUMENTO: "ET-5290.00-22313-98F-C1O-777", TITULO: "Outra categoria" },
  ]);
  const result = C.buildN1710Code({ category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "98F", origin: "C1O" }, index);
  assert.equal(result.sequence, "027");
  assert.equal(result.code, "RL-5290.00-22313-98F-C1O-027");
});

check("buracos antigos não são reutilizados", () => {
  const index = C.buildLdIndex([
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-001" },
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-004" },
  ]);
  const seq = C.nextN1710Sequence({ category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "98F", origin: "C1O" }, index, []);
  assert.equal(seq.value, "005");
});

check("lote da mesma família reserva 024, 025, 026 em memória", () => {
  const index = C.buildLdIndex([{ DOCUMENTO: "RL-5290.00-22313-98F-C1O-023" }]);
  const base = { category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "98F", origin: "C1O" };
  const reserved = [];
  const values = [];
  for (let i = 0; i < 3; i += 1) {
    const result = C.buildN1710Code(base, index, { reserved });
    values.push(result.sequence);
    reserved.push({ familyKey: result.familyKey, sequence: Number(result.sequence), code: result.code });
  }
  assert.deepEqual(values, ["024", "025", "026"]);
});

check("N-1710 muda para quatro dígitos após 999", () => {
  const index = C.buildLdIndex([{ DOCUMENTO: "RL-5290.00-22313-98F-C1O-999" }]);
  const result = C.buildN1710Code({ category: "RL", installation: "5290.00", activityArea: "22313", serviceClass: "98F", origin: "C1O" }, index);
  assert.equal(result.sequence, "1000");
});

check("código existente na LD é preservado, inclusive em nova revisão", () => {
  const code = "RL-5290.00-22313-98F-C1O-026";
  const index = C.buildLdIndex([{ DOCUMENTO: code, TITULO: "RELATÓRIO DE TESTE", REV: "0" }]);
  const result = C.analyzeDocument({ filename: `${code} REV A.pdf`, text: `TÍTULO: RELATÓRIO DE TESTE\nREV. A\n${code}` }, index);
  assert.equal(result.existing, true);
  assert.equal(result.code, code);
  assert.equal(result.confidence, C.CONFIDENCE.CONFIRMED);
});

check("correspondência ambígua forte na LD não vira igualdade automática", () => {
  const index = C.buildLdIndex([
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-010", TITULO: "RELATÓRIO DE INSPEÇÃO DA BOMBA A", TAG: "32-P-1001" },
    { DOCUMENTO: "RL-5290.00-22313-98F-C1O-011", TITULO: "RELATÓRIO DE INSPEÇÃO DA BOMBA B", TAG: "32-P-1001" },
  ]);
  const info = C.matchLdDocument({ title: "RELATÓRIO DE INSPEÇÃO DA BOMBA", tag: "32-P-1001", category: "RL" }, index);
  assert.equal(info.match, null);
  assert.equal(info.level, "ambiguous");
  assert.ok(info.candidates.length >= 2);
});

check("relatório ET usa sete grupos e underline", () => {
  const result = C.buildEtReportCode({
    emitter: "C1O", enterprise: "RNEST", unit: "U32", eap: "3.8.9.1", discipline: "TUB", reportCode: "RIR", tag: "32-P-1234A",
  }, C.buildLdIndex([]));
  assert.equal(result.complete, true);
  assert.equal(result.code, "C1O_RNEST_U32_3.8.9.1_TUB_RIR_32-P-1234A");
});

check("não tagueado mantém prefixo nt- minúsculo", () => {
  const result = C.buildEtReportCode({
    emitter: "C1O", enterprise: "RNEST", unit: "U32", eap: "3.8.9.1", discipline: "TUB", reportCode: "RIR", tag: "NT-LINHA-GERAL",
  }, C.buildLdIndex([]));
  assert.equal(result.code.endsWith("_nt-LINHA-GERAL"), true);
});

check("TAG com caractere proibido exige confirmação em vez de ser corrigida", () => {
  const result = C.buildEtReportCode({
    emitter: "C1O", enterprise: "RNEST", unit: "U32", eap: "3.8.9.1", discipline: "TUB", reportCode: "RIR", tag: "TAG COM ESPAÇO",
  }, C.buildLdIndex([]));
  assert.equal(result.complete, false);
  assert.equal(result.confidence, C.CONFIDENCE.REVIEW);
});

check("CT e SIT são roteadas para N-1710", () => {
  const ct = C.classifyDocument({ filename: "consulta.pdf", text: "CONSULTA TÉCNICA para o projeto" });
  const sit = C.classifyDocument({ filename: "sit.pdf", text: "SOLICITAÇÃO DE INFORMAÇÕES TÉCNICAS" });
  assert.equal(ct.kind, "n1710");
  assert.equal(ct.category, "CT");
  assert.equal(sit.kind, "n1710");
  assert.equal(sit.category, "SIT");
});

check("currículo usa motor ET separado da N-1710", () => {
  const classification = { kind: "et-cv", label: "Currículo" };
  const result = C.buildEtSequentialCode({ classification, contract: "5900.0130870.25.2", emitter: "C1O", discipline: "TUB" }, C.buildLdIndex([]));
  assert.equal(result.complete, true);
  assert.equal(result.code, "5900.0130870.25.2-C1O-CV-TUB-0001");
});

check("nome final sanitiza somente caracteres incompatíveis do filesystem", () => {
  const name = C.finalFilename("RL-5290.00-22313-98F-C1O-027", "RELATÓRIO: TESTE / BOMBA");
  assert.equal(name, "RL-5290.00-22313-98F-C1O-027 - RELATÓRIO TESTE BOMBA.pdf");
});

check("template oficial da capa está preso ao SHA-256 do arquivo fornecido", () => {
  const source = fs.readFileSync(path.join(root, "document_coding_pdf.js"), "utf8");
  assert.match(source, /ead0a55d21c7d14e99d2aca5fa0d4f73aaf0e28e6f561a3b9a601612cce2adfc/);
  assert.match(source, /coverUsesOriginalTemplate:\s*true/);
});

check("módulo está registrado no shell, loader e service worker", () => {
  const app = fs.readFileSync(path.join(root, "recon_app.js"), "utf8");
  const loader = fs.readFileSync(path.join(root, "recon_module_loader.js"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(app, /data\.module\s*=\s*"coding"|dataset\.module\s*=\s*"coding"/);
  assert.match(app, /dataModuleView|dataset\.moduleView\s*=\s*"coding"/);
  assert.match(loader, /coding:\s*\["coding"\]/);
  assert.match(loader, /document_coding_app\.js/);
  assert.match(sw, /document_coding_core\.js/);
});

check("geração DOCX não finge conversão nem rasteriza sem adaptador", () => {
  const source = fs.readFileSync(path.join(root, "document_coding_pdf.js"), "utf8");
  assert.match(source, /RECONDocumentCodingDocxPdfAdapter/);
  assert.match(source, /não rasteriza nem simula Word/);
});

check("reserva compartilhada tem hook explícito e fallback local auditável", () => {
  const source = fs.readFileSync(path.join(root, "document_coding_storage.js"), "utf8");
  assert.match(source, /RECONDocumentCodingSharedSequenceAdapter/);
  assert.match(source, /navigator\.locks/);
  assert.match(source, /crossDeviceAtomic/);
});

console.log(`\nCodificação: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
