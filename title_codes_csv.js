(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONTitleCodesCsv = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // CSV de relações de documentos: respeita aspas, delimitadores e cabeçalhos.
  // Não divide por ponto e vírgula/virgula as células que contêm títulos.
  function parse(content, helpers) {
    const cleanRequestedCode = helpers.clean;
    const Q = { norm: helpers.norm };
    let input = String(content || "").replace(/^\uFEFF/, "");
    const sepLine = input.match(/^sep=([;,\t])\r?\n/i);
    const forcedSeparator = sepLine ? sepLine[1] : "";
    if (sepLine) input = input.slice(sepLine[0].length);
    const firstLine = input.split(/\r?\n/).find((line) => line.trim()) || "";
    const countSeparator = (separator) => {
      let quoted = false, total = 0;
      for (let i = 0; i < firstLine.length; i += 1) {
        if (firstLine[i] === '"') {
          if (quoted && firstLine[i + 1] === '"') { i += 1; continue; }
          quoted = !quoted;
        } else if (!quoted && firstLine[i] === separator) total += 1;
      }
      return total;
    };
    const delimiters = [";", "\t", ","];
    const delimiter = forcedSeparator || [...delimiters].sort((a, b) => countSeparator(b) - countSeparator(a))[0];
    const rows = [];
    let current = [], cell = "", quoted = false;
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        current.push(cell); cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && input[i + 1] === "\n") i += 1;
        current.push(cell); cell = "";
        if (current.some((value) => value.trim())) rows.push(current);
        current = [];
      } else cell += char;
    }
    if (quoted) throw new Error("O CSV contém aspas não fechadas. Revise o arquivo.");
    current.push(cell);
    if (current.some((value) => value.trim())) rows.push(current);
    if (!rows.length) return [];

    const normalizeHeader = (value) => Q.norm(value).replace(/[\s_-]+/g, " ").trim();
    const columnNames = new Set(["DOCUMENTO", "CODIGO", "CODIGO DOCUMENTO", "CODIGO DO DOCUMENTO", "CODIGO DOCUMENTAL", "NUMERO DO DOCUMENTO"]);
    const header = rows[0].map(normalizeHeader);
    const headerIndex = header.findIndex((value) => columnNames.has(value));
    const looksLikeCode = (value) => {
      const code = cleanRequestedCode(value).toUpperCase();
      return code.length >= 8 && /^[A-Z0-9]+(?:[-_.][A-Z0-9]+){2,}$/.test(code);
    };
    const isLabeledHeader = header.some((value) => /^(TITULO|REVISAO|STATUS|DISCIPLINA|DATA|DESCRICAO|DOCUMENTO|CODIGO|CODIGO DOCUMENTO|CODIGO DO DOCUMENTO)$/.test(value));
    if (headerIndex < 0 && isLabeledHeader) {
      throw new Error("O CSV tem cabeçalho, mas não contém coluna DOCUMENTO ou CÓDIGO DO DOCUMENTO.");
    }
    let column = headerIndex;
    if (column < 0) {
      const maximumColumns = Math.max(...rows.slice(0, 30).map((row) => row.length));
      let bestCount = 0;
      for (let i = 0; i < maximumColumns; i += 1) {
        const count = rows.slice(0, 30).filter((row) => looksLikeCode(row[i] || "")).length;
        if (count > bestCount) { bestCount = count; column = i; }
      }
      if (column < 0) column = 0;
    }
    return rows.slice(headerIndex >= 0 ? 1 : 0)
      .map((row) => cleanRequestedCode(row[column] || ""))
      .filter((value) => value && (looksLikeCode(value) || headerIndex >= 0));
  }

  return Object.freeze({ parse });
});
