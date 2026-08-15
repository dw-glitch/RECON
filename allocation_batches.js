(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationBatches = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return String(value === null || value === undefined ? "" : value).trim(); }
  function norm(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase(); }

  function parseCode(value) {
    const match = text(value).match(/^C1O-ALOC-CM-(\d{4})-(\d{4})$/i);
    if (!match) return null;
    return { sequence: Number(match[1]), year: Number(match[2]), code: `C1O-ALOC-CM-${match[1]}-${match[2]}` };
  }

  function codeAt(base, offset) {
    const parsed = typeof base === "string" ? parseCode(base) : base;
    if (!parsed) throw new Error("Número inicial da alocação inválido.");
    const sequence = parsed.sequence + (Number(offset) || 0);
    if (sequence > 9999) throw new Error("A sequência de alocação ultrapassou 9999.");
    return `C1O-ALOC-CM-${String(sequence).padStart(4, "0")}-${parsed.year}`;
  }

  function sheetOf(result) { return text(result && (result.sheet || result.record && result.record.sheet)); }
  function workflowOf(result) {
    return text(result && result.output && result.output.discipline)
      || text(result && result.output && result.output.workflow)
      || text(result && result.record && result.record.discipline)
      || text(result && result.workflow);
  }

  function build(results, baseCode, options) {
    const parsed = parseCode(baseCode);
    if (!parsed) return { valid: false, groups: [], errors: ["Número inicial da alocação inválido."], baseCode: text(baseCode) };
    const mode = typeof options === "string" ? options : text(options && options.mode) || "discipline";
    const list = (results || []).filter(Boolean);
    if (mode === "single") {
      const sheets = [...new Set(list.map(sheetOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const workflows = [...new Set(list.map(workflowOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      const groups = list.length ? [{
        key: "SINGLE",
        isEt: false,
        workflow: workflows.join(" · "),
        workflows,
        label: "Todos na mesma alocação",
        results: list,
        sheets,
        blocking: false,
        allocationCode: parsed.code,
        index: 0,
      }] : [];
      return {
        valid: groups.length > 0,
        mode: "single",
        baseCode: parsed.code,
        firstCode: parsed.code,
        lastCode: parsed.code,
        groups,
        errors: [],
        etGroups: 0,
        totalDocuments: list.length,
      };
    }
    const grouped = new Map();
    list.forEach((result) => {
      const sheet = sheetOf(result);
      const workflow = workflowOf(result);
      const key = `DISCIPLINA|${norm(workflow) || "SEM DISCIPLINA"}`;
      if (!grouped.has(key)) grouped.set(key, {
        key,
        isEt: norm(sheet) === "ET",
        workflow,
        label: workflow || "Disciplina não informada",
        results: [],
        sheets: new Set(),
        blocking: !workflow,
      });
      const group = grouped.get(key);
      group.results.push(result);
      if (norm(sheet) === "ET") group.isEt = true;
      if (sheet) group.sheets.add(sheet);
    });
    const groups = [...grouped.values()].sort((left, right) => {
      return left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" });
    }).map((group, index) => ({
      ...group,
      sheets: [...group.sheets].sort((a, b) => a.localeCompare(b, "pt-BR")),
      allocationCode: codeAt(parsed, index),
      index,
    }));
    const errors = groups.filter((group) => group.blocking).map(() => "Há documento sem disciplina/workflow. Informe a disciplina ou escolha ‘Tudo na mesma alocação’.");
    return {
      valid: groups.length > 0 && errors.length === 0,
      mode: "discipline",
      baseCode: parsed.code,
      firstCode: groups[0] && groups[0].allocationCode || parsed.code,
      lastCode: groups.at(-1) && groups.at(-1).allocationCode || parsed.code,
      groups,
      errors: [...new Set(errors)],
      etGroups: groups.filter((group) => group.isEt).length,
      totalDocuments: groups.reduce((total, group) => total + group.results.length, 0),
    };
  }

  return { text, norm, parseCode, codeAt, sheetOf, workflowOf, build };
});
