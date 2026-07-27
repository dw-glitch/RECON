(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const api = factory(C);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LDConflictCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const FIELD_DEFS = Object.freeze([
    { key: "revision", label: "Revisão", read: (record) => record && record.revision },
    { key: "status", label: "Status SIGEM", read: (record, kind) => kind === "history" ? record && (record.sigemStatus || record.status) : record && record.sigemStatus },
    { key: "grdt", label: "GRDT", read: (record) => record && record.grdt },
    { key: "effectiveDate", label: "Data efetiva", read: (record) => record && record.effectiveDate },
    { key: "title", label: "Título", read: (record) => record && record.title },
    { key: "allocationStatus", label: "Situação de alocação", read: (record) => record && record.allocationStatus },
    { key: "allocation", label: "Alocação", read: (record) => record && record.allocation },
    { key: "databook", label: "Caminho Databook", read: (record) => record && record.databook },
  ]);
  const CROSS_SOURCE_FIELDS = new Set(["status", "grdt", "effectiveDate", "allocationStatus", "allocation", "databook"]);

  function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
  function norm(value) { return C && C.norm ? C.norm(value) : text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }
  function revision(value) { return C && C.normalizeRevision ? C.normalizeRevision(value) : norm(value).replace(/^(?:REV(?:ISAO)?)[ .:_-]*/i, ""); }
  function sourceKind(record, fallback) { return record && record._ldSourceKind || fallback || "technical"; }
  function recordId(record, kind) { const item = record || {}; return [sourceKind(item, kind), text(item.source), text(item.sheet), Number(item.row) || 0, revision(item.revision)].join("::"); }
  function location(record, kind) { const item = record || {}; return { id: recordId(item, kind), kind: sourceKind(item, kind), source: text(item.source), sheet: text(item.sheet) || "LD", row: Number(item.row) || 0, revision: revision(item.revision), label: `${text(item.sheet) || "LD"}${item.row ? ` · linha ${item.row}` : ""}`, record: item }; }
  function decorated(records, kind) { return (records || []).map((record) => ({ record, kind, id: recordId(record, kind) })); }
  function fieldValue(entry, definition) { const raw = text(definition.read(entry.record, entry.kind)); const normalized = definition.key === "revision" ? revision(raw) : norm(raw); return { raw, normalized }; }
  function collectDifference(entries, definition, scope) { const values = new Map(); entries.forEach((entry) => { const value = fieldValue(entry, definition); if (!value.raw || !value.normalized) return; if (!values.has(value.normalized)) values.set(value.normalized, { value: value.raw, records: [] }); values.get(value.normalized).records.push(entry.id); }); if (values.size < 2) return null; return { field: definition.key, label: definition.label, scope, values: [...values.values()] }; }
  function addDifferences(target, seen, entries, definitions, scope) { definitions.forEach((definition) => { const difference = collectDifference(entries, definition, scope); if (!difference) return; const signature = `${scope}|${difference.field}|${difference.values.map((item) => norm(item.value)).sort().join("|")}`; if (seen.has(signature)) return; seen.add(signature); target.push(difference); }); }

  function analyzeGroup(group, options) {
    const settings = options || {}; const hint = norm(settings.hintedSheet);
    const technicalAll = decorated(group && group.records, "technical");
    const sameSheet = hint ? technicalAll.filter((entry) => norm(entry.record && entry.record.sheet) === hint) : [];
    const technical = sameSheet.length ? sameSheet : technicalAll;
    const history = decorated(group && group.history, "history");
    const differences = []; const seen = new Set();
    if (technical.length > 1) addDifferences(differences, seen, technical, FIELD_DEFS, "linhas técnicas");
    const historyByRevision = new Map();
    history.forEach((entry) => { const key = revision(entry.record && entry.record.revision) || "SEM REVISAO"; if (!historyByRevision.has(key)) historyByRevision.set(key, []); historyByRevision.get(key).push(entry); });
    historyByRevision.forEach((entries, rev) => { if (entries.length > 1) addDifferences(differences, seen, entries, FIELD_DEFS.filter((field) => field.key !== "revision"), `Colar SIGEM · revisão ${rev}`); });
    const technicalByRevision = new Map();
    technical.forEach((entry) => { const key = revision(entry.record && entry.record.revision); if (!key) return; if (!technicalByRevision.has(key)) technicalByRevision.set(key, []); technicalByRevision.get(key).push(entry); });
    technicalByRevision.forEach((technicalEntries, rev) => { const historyEntries = historyByRevision.get(rev) || []; if (!historyEntries.length) return; addDifferences(differences, seen, [...technicalEntries, ...historyEntries], FIELD_DEFS.filter((field) => CROSS_SOURCE_FIELDS.has(field.key)), `linha técnica × Colar SIGEM · revisão ${rev}`); });
    const conflictingIds = new Set(); differences.forEach((difference) => difference.values.forEach((value) => value.records.forEach((id) => conflictingIds.add(id))));
    const candidates = [...technical, ...history].filter((entry) => conflictingIds.has(entry.id)).map((entry) => location(entry.record, entry.kind));
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
    const resolutionId = text(settings.resolutionId); const selected = resolutionId ? uniqueCandidates.find((candidate) => candidate.id === resolutionId) || null : null;
    const fieldLabels = [...new Set(differences.map((difference) => difference.label))];
    return { hasConflict: differences.length > 0, blocked: differences.length > 0 && !selected, resolved: Boolean(selected), resolutionId: selected ? selected.id : "", selected, differences, candidates: uniqueCandidates, fields: fieldLabels, summary: differences.length ? `Valores diferentes em: ${fieldLabels.join(", ")}.` : "Nenhum conflito entre as linhas controladas." };
  }

  function applyResolution(group, analysis) { if (!analysis || !analysis.selected) return group || { records: [], history: [] }; const selected = analysis.selected; const records = [...(group && group.records || [])]; const history = [...(group && group.history || [])]; if (selected.kind === "technical") return { ...group, records: [selected.record], history, _ldConflictResolution: selected.id }; const selectedRevision = revision(selected.record && selected.record.revision); return { ...group, records, history: [...history.filter((record) => revision(record && record.revision) !== selectedRevision), selected.record], _ldConflictResolution: selected.id }; }
  function evidenceText(analysis) { if (!analysis || !analysis.hasConflict) return ""; const differences = analysis.differences.map((difference) => `${difference.label}: ${difference.values.map((item) => item.value).join(" × ")}`).join("; "); const sources = analysis.candidates.map((candidate) => candidate.label).join("; "); return `${differences}${sources ? `. Fontes: ${sources}.` : "."}`; }
  function consensusValue(group, field) { const definition = FIELD_DEFS.find((item) => item.key === field); if (!definition) return ""; const entries = [...decorated(group && group.records, "technical"), ...decorated(group && group.history, "history")]; const values = new Map(); entries.forEach((entry) => { const found = fieldValue(entry, definition); if (found.raw && found.normalized && !values.has(found.normalized)) values.set(found.normalized, found.raw); }); return values.size === 1 ? [...values.values()][0] : ""; }
  return Object.freeze({ FIELD_DEFS, text, norm, revision, recordId, location, analyzeGroup, applyResolution, evidenceText, consensusValue });
});
