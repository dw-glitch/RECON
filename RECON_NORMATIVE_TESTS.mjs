#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TitleR = require("./document_title_standard_r.js");
const Norms = require("./allocation_normative_rules.js");
const Governance = require("./allocation_governance.js");

let checks = 0;
function check(name, fn) {
  try {
    fn();
    checks += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function readyFixture(overrides) {
  return {
    decision: Governance.READY,
    selected: true,
    document: "C1O_RNEST_U32_3.1.1.1_TUB_MTAM_B-32110A",
    record: { document: "C1O_RNEST_U32_3.1.1.1_TUB_MTAM_B-32110A" },
    output: {
      databook: "N1 | N2 | N3",
      databookEvidence: { sourceType: "ld-exact", source: "LD", confidence: "confirmada" },
    },
    warnings: [],
    ...(overrides || {}),
  };
}

check("ET Rev. R expõe 332 linhas e 331 códigos únicos", () => {
  assert.equal(TitleR.STANDARD.revision, "R");
  assert.equal(TitleR.reportRowCount, 332);
  assert.equal(TitleR.reportCodeCount, 331);
});

check("ET Rev. R incorpora MTAM, MTEC, RCCM e RIRFE", () => {
  for (const code of ["MTAM", "MTEC", "RCCM", "RIRFE"]) assert.ok(TitleR.reportTitlesFor(code).length > 0, code);
});

check("Relatório RNEST válido passa pela validação objetiva", () => {
  const result = Norms.validateRnReport("C1O_RNEST_U32_3.1.1.1_TUB_MTAM_B-32110A");
  assert.equal(result.kind, "rn-report");
  assert.equal(result.errors.length, 0);
});

check("Item não tagueado com nt- minúsculo é aceito", () => {
  const result = Norms.validateRnReport("C1O_RNEST_U32_3.1.1.1_TUB_MTAM_nt-BOBINA50");
  assert.equal(result.errors.filter((item) => item.code === "ET_NT_PREFIX").length, 0);
});

check("Item não tagueado com nt_ é rejeitado", () => {
  const result = Norms.validateRnReport("C1O_RNEST_U32_3.1.1.1_TUB_MTAM_nt_BOBINA50");
  assert.ok(result.errors.some((item) => item.code === "ET_GROUP_COUNT" || item.code === "ET_NT_PREFIX"));
});

check("N-1710 válido usa os catálogos versionados", () => {
  const result = Norms.validateN1710("CE-5290.00-0000-000-C1O-001");
  assert.equal(result.kind, "n1710");
  assert.equal(result.errors.length, 0);
});

check("Código N-1710 fora do catálogo é bloqueado", () => {
  const result = Norms.validateN1710("CE-5290.00-ZZZZ-000-C1O-001");
  assert.ok(result.errors.length > 0);
});

check("Fonte exata da LD pode alcançar alta confiança", () => {
  const result = Norms.evaluateAllocation(readyFixture());
  assert.equal(result.confidence, "alta");
  assert.equal(result.automaticAllowed, true);
});

check("Fallback de disciplina exige revisão", () => {
  const fixture = readyFixture();
  fixture.output.databookEvidence = { sourceType: "discipline-fallback", source: "Pasta geral", confidence: "fallback" };
  const result = Governance.applyToResult(fixture);
  assert.equal(result.decision, Governance.REVIEW);
  assert.equal(result.normativeGovernance.exportAllowed, false);
});

check("Intervenção manual exige revisão", () => {
  const fixture = readyFixture();
  fixture.output.databookEvidence = { sourceType: "manual", source: "Ajuste nesta análise", confidence: "manual" };
  const result = Governance.applyToResult(fixture);
  assert.equal(result.decision, Governance.REVIEW);
  assert.equal(result.normativeGovernance.manual, true);
});

check("Conflito explícito exige revisão", () => {
  const fixture = readyFixture({ reason: "Conflito entre fontes" });
  const result = Governance.applyToResult(fixture);
  assert.equal(result.decision, Governance.REVIEW);
  assert.equal(result.normativeGovernance.conflicts, true);
});

check("Erro normativo objetivo gera estado SKIP bloqueado", () => {
  const fixture = readyFixture({ document: "C1O_RNEST_U32_3.1.1.1_TUB_CODIGO-INEXISTENTE_B-32110A" });
  fixture.record = { document: fixture.document };
  const result = Governance.applyToResult(fixture);
  assert.equal(result.decision, Governance.SKIP);
  assert.equal(result.normativeGovernance.state, "skip");
  assert.equal(result.normativeGovernance.blocked, true);
  assert.equal(result.normativeGovernance.exportAllowed, false);
});

check("Documento já alocado preserva o SKIP operacional", () => {
  const result = Governance.applyToResult({ ...readyFixture(), decision: Governance.SKIP });
  assert.equal(result.decision, Governance.SKIP);
  assert.equal(result.normativeGovernance.kind, "already-allocated");
  assert.equal(result.normativeGovernance.blocked, false);
});

check("READY exporta automaticamente; REVIEW exige confirmação humana explícita", () => {
  const ready = Governance.applyToResult(readyFixture());
  assert.equal(Governance.canSelect(ready), true);
  assert.doesNotThrow(() => Governance.assertExportable([ready]));
  const review = Governance.applyToResult({
    ...readyFixture(),
    output: { databook: "N1 | N2 | N3", databookEvidence: { sourceType: "discipline-fallback", source: "geral" } },
  });
  assert.equal(Governance.canSelect(review), true);
  assert.throws(() => Governance.assertExportable([review]));
  review.manualOverride = true;
  assert.doesNotThrow(() => Governance.assertExportable([review]));
});

check("Governança em lote mantém um resultado por entrada", () => {
  const results = Governance.applyResults([readyFixture(), { ...readyFixture(), decision: Governance.SKIP }]);
  assert.equal(results.length, 2);
  assert.equal(results[0].decision, Governance.READY);
  assert.equal(results[1].decision, Governance.SKIP);
});

console.log(`\nRECON_NORMATIVE_TESTS: ${checks} verificações concluídas.`);
