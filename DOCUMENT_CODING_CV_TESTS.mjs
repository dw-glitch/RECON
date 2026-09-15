import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Profile = require("./document_coding_cv_profile.js");
const CV = require("./document_coding_cv_core.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
}

test("perfil contratual usa exatamente o Apêndice C RNEST/T2 Rev.0", () => {
  assert.equal(Profile.SOURCE.id, "ET-5290.00-22000-910-1LV-002");
  assert.equal(Profile.SOURCE.revision, "0");
  assert.equal(Profile.SOURCE.date, "2024-10-18");
  assert.match(Profile.SOURCE.title, /QUALIFICAÇÃO DA EQUIPE CONTRATADA/i);
});

test("matriz cobre dezenas de funções contratuais e preserva item de origem", () => {
  assert.ok(Profile.ROLES.length >= 70, `cobertura insuficiente: ${Profile.ROLES.length} funções`);
  const ids = new Set(Profile.ROLES.map((role) => role.id));
  assert.equal(ids.size, Profile.ROLES.length, "IDs de função precisam ser únicos");
  assert.ok(Profile.ROLES.every((role) => role.item && role.title));
});

test("regra geral nunca aceita somente o currículo como comprovação completa", () => {
  const result = CV.evaluate("CURRICULUM VITAE\nEngenheiro Civil\n10 anos de experiência", { roleId: "civil-responsible" });
  const ctps = result.criteria.find((item) => item.id === "proof-ctps");
  const council = result.criteria.find((item) => item.id === "proof-council");
  assert.equal(ctps.status, "missing-evidence");
  assert.equal(council.status, "missing-evidence");
  assert.notEqual(result.status.label, "APROVADO");
});

test("responsável de eletricidade exige Engenharia Elétrica, conselho, cinco anos e NR-10", () => {
  const role = CV.findRole("electrical-responsible");
  assert.equal(role.item, "3.2.6.1");
  assert.deepEqual(role.degreeAny, ["engenharia elétrica", "engenharia eletrica"]);
  assert.equal(role.minYears, 5);
  assert.ok(role.courses.some((value) => /NR-10/.test(value)));
  assert.equal(role.council, true);
});

test("CV de elétrica com requisitos declarados ainda diferencia evidência de aprovação PETROBRAS", () => {
  const raw = `CURRICULUM VITAE\nEngenharia Elétrica\nCREA 123456 ativo\nNR-10\nExperiência profissional: 2017 - 2025\nMontagem e testes de sistemas elétricos em obra industrial de grande porte\nCTPS apresentada`;
  const result = CV.evaluate(raw, { roleId: "electrical-responsible" });
  assert.equal(result.role.id, "electrical-responsible");
  assert.equal(result.criteria.find((item) => item.id === "degree").status, "evidence");
  assert.equal(result.criteria.find((item) => item.id === "council").status, "evidence");
  assert.equal(result.criteria.find((item) => item.id === "course-0").status, "evidence");
  assert.ok(result.claimedExperienceYears >= 5);
  assert.ok(result.criteria.some((item) => item.status === "external"), "aprovação PETROBRAS deve permanecer externa ao RECON");
});

test("Técnico de Documentação recebe requisitos específicos do item 3.2.10.2", () => {
  const role = CV.findRole("documentation-technician");
  assert.equal(role.item, "3.2.10.2");
  assert.equal(role.minYears, 3);
  assert.equal(role.council, true);
  assert.ok(role.projectEvidence.some((value) => /data books/i.test(value)));
});

test("inspetor de END carrega certificações e regra adicional para acesso por corda", () => {
  const role = CV.findRole("ndt-inspector");
  assert.ok(role.credentials.some((value) => /ABENDI NA-001/.test(value)));
  assert.ok(role.credentials.some((value) => /ISO 9712/.test(value)));
  assert.ok(role.notes.some((value) => /acesso por corda/i.test(value)));
  const supplements = Profile.supplementalFor(role).map((source) => source.id);
  assert.ok(supplements.includes("ET-0000.00-0000-972-PEI-003"));
  assert.ok(supplements.includes("MD-5290.00-22313-950-1LV-007"));
});

test("arquivo de inspeção de válvulas está registrado como fonte complementar contratual", () => {
  const valve = Profile.SUPPLEMENTAL_SOURCES.find((source) => source.id === "ET-5290.00-2000-971-PEI-005");
  assert.ok(valve);
  assert.equal(valve.revision, "C");
  assert.match(valve.scope, /válvulas/i);
});

test("função pode ser inferida quando o cargo está explícito no CV", () => {
  const inferred = CV.inferRole("CURRICULUM VITAE\nCargo proposto: Gerente da Qualidade\nEngenharia Mecânica\nISO 9001");
  assert.ok(inferred.role);
  assert.equal(inferred.role.id, "quality-manager");
});

test("função ambígua não é inventada", () => {
  const result = CV.evaluate("CURRICULUM VITAE\nEngenheiro com experiência em obra industrial.");
  assert.equal(result.role, null);
  assert.equal(result.status.id, "role-review");
});

test("estrutura de CV inclui formação, registro, experiência e checklist de comprovação", () => {
  const evaluation = CV.evaluate("CURRICULUM VITAE", { roleId: "quality-manager" });
  const draft = CV.draft("CURRICULUM VITAE", evaluation);
  assert.match(draft, /FORMAÇÃO ACADÊMICA/);
  assert.match(draft, /REGISTRO PROFISSIONAL/);
  assert.match(draft, /EXPERIÊNCIA PROFISSIONAL/);
  assert.match(draft, /Carteira de trabalho \/ CTPS/);
  assert.match(draft, /30 dias corridos/);
  assert.match(draft, /aprovação da Fiscalização PETROBRAS/i);
});

test("perfil de CV está registrado no lazy-loader e no cache offline", () => {
  const loader = fs.readFileSync(new URL("./recon_module_loader.js", import.meta.url), "utf8");
  const sw = fs.readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  for (const file of ["document_coding_cv_profile.js", "document_coding_cv_core.js", "document_coding_cv_app.js"]) {
    assert.match(loader, new RegExp(file.replace(/\./g, "\\.")), `${file} fora do loader`);
    assert.match(sw, new RegExp(file.replace(/\./g, "\\.")), `${file} fora do precache`);
  }
});

console.log(`\nCV contratual: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
