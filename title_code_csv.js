(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONTitleCodeCsv = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normal(value) {
    return String(value == null ? "" : value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/\s+/g, " ");
  }
  function clean(value) {
    return String(value == null ? "" : value).trim().replace(/^\uFEFF/, "")
      .replace(/^[\s'"`]+|[\s'"`]+$/g, "")
      .replace(/^.*[\\/]/, "")
      .replace(/\.(?:pdf|docx?|xlsx?|xlsm|dwg|dgn|pptx?|csv|txt)$/i, "").trim();
  }
  function normalizedHeader(value) {
    return normal(value).replace(/[^A-Z0-9]+/g, " ").trim();
  }
  function documentHeader(value) {
    return /^(DOCUMENTO|CODIGO|CODIGO DO DOCUMENTO|CODIGO DOCUMENTAL|NUMERO DO DOCUMENTO|DOCUMENT CODE|DOCUMENT NUMBER)$/.test(normalizedHeader(value));
  }
  function isLikelyCode(value) {
    const candidate = clean(value);
    if (!candidate || documentHeader(candidate)) return false;
    if (/^(TITULO|REVISAO|DESCRICAO|DATA|STATUS|DISCIPLINA|EAP|NOME|ARQUIVO)$/i.test(normalizedHeader(candidate))) return false;
    return candidate.length >= 6 && /^[A-Z0-9][A-Z0-9._/\-]*$/i.test(candidate) && /\d/.test(candidate);
  }
  function parseDelimited(source, separator) {
    const rows = [];
    let row = [], value = "", quoted = false;
    const input = String(source || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (ch === '"') {
        if (quoted && input[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (!quoted && ch === separator) {
        row.push(value); value = "";
      } else if (!quoted && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && input[i + 1] === "\n") i += 1;
        row.push(value); value = "";
        if (row.some((cell) => String(cell).trim())) rows.push(row);
        row = [];
      } else value += ch;
    }
    row.push(value);
    if (row.some((cell) => String(cell).trim())) rows.push(row);
    return rows;
  }
  function delimiterScore(source, separator) {
    const sample = parseDelimited(source, separator).slice(0, 30);
    const withColumns = sample.filter((row) => row.length > 1).length;
    const consistent = sample.filter((row) => row.length === (sample[0] || []).length).length;
    return withColumns * 100 + consistent;
  }
  function parseMatrix(matrix) {
    const rows = (matrix || []).filter((row) => Array.isArray(row) && row.some((item) => String(item == null ? "" : item).trim()));
    if (!rows.length) return [];
    let headerRow = -1, column = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
      const index = rows[i].findIndex(documentHeader);
      if (index >= 0) { headerRow = i; column = index; break; }
    }
    if (column < 0) {
      // Without a recognized header, select the column containing the most valid
      // documentary codes rather than treating title/revision columns as codes.
      const width = Math.min(64, Math.max(...rows.slice(0, 100).map((row) => row.length)));
      const rank = Array.from({ length: width }, (_, col) => ({
        col,
        count: rows.slice(0, 100).filter((row) => isLikelyCode(row[col])).length,
      })).sort((a, b) => b.count - a.count || a.col - b.col);
      if (!rank.length || !rank[0].count) return [];
      column = rank[0].col;
    }
    const seen = new Set(), output = [];
    for (const row of rows.slice(headerRow + 1)) {
      const code = clean(row[column]);
      if (!isLikelyCode(code)) continue;
      const key = normal(code).replace(/[^A-Z0-9]+/g, "");
      if (seen.has(key)) continue;
      seen.add(key); output.push(code);
    }
    return output;
  }
  function parse(source) {
    const text = String(source || "");
    const candidates = [";", ",", "\t"];
    candidates.sort((a, b) => delimiterScore(text, b) - delimiterScore(text, a));
    return parseMatrix(parseDelimited(text, candidates[0]));
  }
  return Object.freeze({ parse, parseMatrix, parseDelimited, documentHeader, isLikelyCode });
});
