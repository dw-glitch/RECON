(function (root, factory) {
  const contracts = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const api = factory(contracts);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONExportGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contracts) {
  "use strict";

  function validatePlan(plan) {
    const changes = plan && Array.isArray(plan.changes) ? plan.changes : [];
    if (!changes.length) return { valid: false, errors: ["Nenhuma alteração foi aprovada."], changes: [] };
    return Contracts ? Contracts.validateChangeSet(changes) : { valid: true, errors: [], changes };
  }

  function validateRenames(rows) {
    const items = (rows || []).filter(Boolean);
    const errors = items.filter((row) => !row.valid).map((row) => `${row.originalName || row.name || "Arquivo"}: ${row.message || "precisa de correção."}`);
    const reviews = items.filter((row) => row.valid && row.needsReview && !row.confirmed).map((row) => `${row.originalName || row.name || "Arquivo"}: confira o número identificado.`);
    if (!items.length) errors.push("Nenhum PDF foi preparado para renomeação.");
    return { valid: errors.length === 0, errors, warnings: reviews, count: items.length };
  }

  return { validatePlan, validateRenames };
});
