(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CorporateOutputAudit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    return String(value === null || value === undefined ? "" : value).trim();
  }

  function analyze(input) {
    const source = input || {};
    const items = Array.isArray(source.items) ? source.items.map((item) => ({
      primary: text(item && item.primary),
      secondary: text(item && item.secondary),
      meta: text(item && item.meta),
    })) : [];
    const issues = [];
    const expected = Number(source.expectedInputs);
    const accounted = Number(source.accountedInputs);
    if (Number.isFinite(expected) && Number.isFinite(accounted) && expected !== accounted) {
      issues.push(`${Math.abs(expected - accounted)} entrada(s) não foram conciliadas.`);
    }
    const missingTargets = items.filter((item) => !item.secondary).length;
    if (missingTargets) issues.push(`${missingTargets} saída(s) estão sem nome final.`);
    if (source.requireUniqueTargets !== false) {
      const seen = new Set();
      const duplicates = new Set();
      items.forEach((item) => {
        const key = item.secondary.toLocaleUpperCase("pt-BR");
        if (!key) return;
        if (seen.has(key)) duplicates.add(item.secondary);
        seen.add(key);
      });
      if (duplicates.size) issues.push(`${duplicates.size} nome(s) final(is) estão duplicados.`);
    }
    (Array.isArray(source.warnings) ? source.warnings : []).map(text).filter(Boolean).forEach((warning) => issues.push(warning));
    return {
      title: text(source.title) || "Conferência final",
      summary: text(source.summary) || `${items.length} item(ns) na saída`,
      counts: Array.isArray(source.counts) ? source.counts : [],
      items,
      issues: [...new Set(issues)],
      valid: issues.length === 0,
    };
  }

  return { analyze };
});
