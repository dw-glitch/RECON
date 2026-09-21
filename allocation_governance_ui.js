(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationGovernanceUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function view(result) {
    const governance = result && result.normativeGovernance || {};
    const blocked = Boolean(governance.blocked);
    const state = blocked ? "blocked" : text(governance.state) || "review";
    const label = blocked ? "Bloqueado" :
      state === "ready" ? "Pronto" :
        governance.kind === "already-allocated" ? "Já alocado" : "Revisar";
    const tone = blocked ? "review blocked" : state === "ready" ? "ready" : state === "skip" ? "skip" : "review";
    const issueMessages = [
      ...(governance.errors || []).map((item) => text(item && (item.message || item.code || item))),
      ...(governance.warnings || []).map((item) => text(item && (item.message || item.code || item))),
    ].filter(Boolean);
    return {
      state,
      label,
      tone,
      confidence: text(governance.confidence),
      summary: text(governance.summary) || issueMessages.join(" · "),
      source: text(governance.source),
      sourceType: text(governance.sourceType),
      ruleRefs: Array.isArray(governance.ruleRefs) ? governance.ruleRefs.filter(Boolean) : [],
      exportAllowed: governance.exportAllowed === true,
      blocked,
    };
  }

  return Object.freeze({ view });
});
