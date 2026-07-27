(function (root, factory) {
  const api = factory(root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReconAllocationTitleQuality = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (A) {
  "use strict";

  function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
  function norm(value) { return A && A.norm ? A.norm(value) : text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " "); }
  function key(value) { return A && A.key ? A.key(value) : norm(value).replace(/\s*([_.-])\s*/g, "$1"); }
  function titleKind(value) { return A && A.titleKind ? A.titleKind(value) : ""; }

  function normalizeTitle(value) {
    return text(value)
      .replace(/[\u2012-\u2015]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\s+([,;:.])/g, "$1")
      .replace(/([,;:])\1+/g, "$1")
      .trim()
      .toLocaleUpperCase("pt-BR");
  }

  function titleQuality(value, document) {
    const raw = text(value);
    const normalized = normalizeTitle(raw);
    const normalizedKey = norm(normalized);
    const issues = [];
    let score = 100;
    const add = (code, label, severity, weight) => { issues.push({ code, label, severity }); score -= weight; };
    if (!raw) add("empty", "Título vazio", "error", 100);
    if (raw && /\b(?:SEM TITULO|A DEFINIR|TBD|XXX|NAO INFORMADO|N\/A)\b/i.test(normalizedKey)) add("placeholder", "Título provisório", "error", 55);
    const reserved = /\bRESERVADO\b/.test(normalizedKey);
    if (reserved) add("reserved", "Título reservado", "neutral", 0);
    if (raw && normalized !== raw) add("format", "Padronizar espaços, sinais e caixa alta", "info", 6);
    if (/\.(?:PDF|DOCX?|XLSX?|DWG|DGN|PPTX?)\b/i.test(raw)) add("extension", "Remover extensão de arquivo", "warn", 18);
    if (document && key(raw) === key(document)) add("document", "Título repete somente o código documental", "error", 40);
    if (raw && normalized.length < 8 && !reserved) add("short", "Título muito curto", "warn", 24);
    if (raw && /\b([A-ZÀ-Ý0-9]{3,})\s+\1\b/i.test(normalized)) add("duplicate", "Palavra repetida", "warn", 12);
    if ((raw.match(/\(/g) || []).length !== (raw.match(/\)/g) || []).length) add("parentheses", "Parênteses incompletos", "warn", 12);
    const kind = titleKind(normalized);
    const significant = normalizedKey.split(/[^A-Z0-9]+/).filter((token) => token.length >= 3);
    if (kind && significant.length <= 2 && !reserved) add("generic", "Título genérico; informe o objeto ou serviço", "warn", 22);
    if (/[^A-ZÀ-Ý0-9 ()_\-/,.;:+ºª%&]/i.test(normalized)) add("characters", "Conferir caracteres incomuns", "info", 5);
    score = Math.max(0, Math.min(100, score));
    return { original: raw, suggested: normalized, changed: Boolean(raw && normalized !== raw), score, status: reserved ? "reserved" : score >= 88 ? "good" : score >= 68 ? "attention" : "review", kind, reserved, issues };
  }

  return { normalizeTitle, titleQuality };
});
