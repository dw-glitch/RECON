(function (root, factory) {
  const norms = root.RECONAllocationNorms ||
    (typeof module === "object" && module.exports ? require("./allocation_normative_rules.js") : null);
  const api = factory(norms);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationGovernance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Norms) {
  "use strict";

  const READY = "pronto";
  const REVIEW = "revisar";
  const SKIP = "desconsiderar";

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function summarizeIssues(items) {
    return (items || []).map((item) => text(item && (item.message || item.code || item))).filter(Boolean);
  }

  function baseGovernance(state, kind, label, evaluation, extra) {
    const data = evaluation || {};
    return Object.freeze({
      state,
      kind,
      label,
      confidence: text(data.confidence) || (state === "ready" ? "alta" : state === "review" ? "media" : "baixa"),
      blocked: state === "skip" && kind === "normative-block",
      exportAllowed: state === "ready",
      automaticAllowed: Boolean(data.automaticAllowed && state === "ready"),
      fallbackUsed: Boolean(data.fallbackUsed),
      conflicts: Boolean(data.conflicts),
      manual: Boolean(data.manual),
      sourceType: text(data.sourceType),
      source: text(data.source),
      databook: text(data.databook),
      validationKind: text(data.validationKind),
      errors: Array.isArray(data.errors) ? data.errors : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      ruleRefs: Array.isArray(data.ruleRefs) ? data.ruleRefs : [],
      ...(extra || {}),
    });
  }

  function applyToResult(input) {
    const result = { ...(input || {}) };
    const originalDecision = result.decision;

    if (originalDecision === SKIP && result.record && result.output) {
      result.normativeGovernance = baseGovernance(
        "skip",
        "already-allocated",
        "Já alocado — fora da nova emissão",
        null,
        { exportAllowed: false, automaticAllowed: false }
      );
      result.selected = false;
      return result;
    }

    if (!result.document || !result.record || !result.output) {
      result.decision = REVIEW;
      result.selected = false;
      result.normativeGovernance = baseGovernance(
        "review",
        "insufficient-input",
        "Revisar — evidência insuficiente",
        null,
        { exportAllowed: false, automaticAllowed: false }
      );
      return result;
    }

    if (!Norms || typeof Norms.evaluateAllocation !== "function") {
      result.decision = REVIEW;
      result.selected = false;
      result.normativeGovernance = baseGovernance(
        "review",
        "governance-unavailable",
        "Revisar — governança normativa indisponível",
        null,
        { exportAllowed: false, automaticAllowed: false }
      );
      return result;
    }

    const evaluation = Norms.evaluateAllocation(result);
    const errors = Array.isArray(evaluation.errors) ? evaluation.errors : [];
    const warnings = Array.isArray(evaluation.warnings) ? evaluation.warnings : [];

    if (errors.length) {
      const messages = summarizeIssues(errors);
      result.decision = SKIP;
      result.selected = false;
      result.normativeGovernance = baseGovernance(
        "skip",
        "normative-block",
        "Bloqueado — regra normativa não atendida",
        evaluation,
        {
          exportAllowed: false,
          automaticAllowed: false,
          summary: messages.join(" · ") || "A saída automática foi bloqueada por regra normativa objetiva.",
        }
      );
      return result;
    }

    if (originalDecision !== READY) {
      result.decision = REVIEW;
      result.selected = false;
      result.normativeGovernance = baseGovernance(
        "review",
        "operational-review",
        "Revisar — decisão operacional pendente",
        evaluation,
        {
          exportAllowed: false,
          automaticAllowed: false,
          summary: summarizeIssues(warnings).join(" · "),
        }
      );
      return result;
    }

    if (!evaluation.automaticAllowed) {
      result.decision = REVIEW;
      result.selected = false;
      result.normativeGovernance = baseGovernance(
        "review",
        "normative-review",
        evaluation.label || "Alocação provável — revisar.",
        evaluation,
        {
          exportAllowed: false,
          automaticAllowed: false,
          summary: summarizeIssues(warnings).join(" · "),
        }
      );
      return result;
    }

    result.decision = READY;
    result.selected = true;
    result.normativeGovernance = baseGovernance(
      "ready",
      "normative-ready",
      evaluation.label || "Alta confiança",
      evaluation,
      {
        exportAllowed: true,
        automaticAllowed: true,
        summary: summarizeIssues(warnings).join(" · "),
      }
    );
    return result;
  }

  function applyResults(results) {
    return (results || []).map(applyToResult);
  }

  function canSelect(result) {
    const governance = result && result.normativeGovernance;
    return Boolean(
      result &&
      result.document &&
      result.record &&
      result.output &&
      governance &&
      !governance.blocked &&
      governance.kind !== "already-allocated" &&
      (governance.state === "ready" || governance.state === "review")
    );
  }

  function isExportApproved(result) {
    const governance = result && result.normativeGovernance;
    if (!canSelect(result) || !governance) return false;
    if (governance.state === "ready" && governance.exportAllowed === true) return true;
    return governance.state === "review" && result.manualOverride === true;
  }

  function assertExportable(results) {
    const list = results || [];
    if (!list.length) throw new Error("Nenhum documento está pronto para exportação.");
    const blocked = list.filter((result) => !isExportApproved(result));
    if (blocked.length) {
      const sample = blocked.slice(0, 3).map((result) => text(result.document) || "(sem documento)").join(", ");
      throw new Error(`A pré-conferência normativa ainda exige revisão humana em ${blocked.length} item(ns): ${sample}. Confirme manualmente somente os itens revisados; itens Bloqueados não podem ser exportados.`);
    }
    return true;
  }

  return Object.freeze({
    READY,
    REVIEW,
    SKIP,
    applyToResult,
    applyResults,
    canSelect,
    isExportApproved,
    assertExportable,
  });
});
