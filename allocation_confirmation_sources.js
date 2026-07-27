(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const api = factory(C);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationConfirmations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  const DOCUMENT_HEADERS = [
    "NOMEDOCUMENTO", "NOME DOCUMENTO", "NOME DO DOCUMENTO", "DOCUMENTO",
    "CODIGO DO DOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO DOCUMENTO", "CÓDIGO DOCUMENTO",
  ];
  const ALLOCATION_HEADERS = [
    "ALOCAÇÃO", "ALOCACAO", "NÚMERO DA ALOCAÇÃO", "NUMERO DA ALOCACAO",
    "CÓDIGO DA ALOCAÇÃO", "CODIGO DA ALOCACAO",
  ];
  const STATUS_HEADERS = [
    "STATUS DA ALOCAÇÃO", "STATUS DA ALOCACAO", "SITUAÇÃO DA ALOCAÇÃO", "SITUACAO DA ALOCACAO",
    "CONFIRMAÇÃO DE DOCUMENTOS PREVISTOS", "CONFIRMACAO DE DOCUMENTOS PREVISTOS",
    "RESULTADO DA ALOCAÇÃO", "RESULTADO DA ALOCACAO", "STATUS", "SITUAÇÃO", "SITUACAO",
  ];
  const COMMENT_HEADERS = [
    "RESPOSTA DA FISCAL 01", "RESPOSTA DA FISCAL", "COMENTÁRIO DA FISCAL", "COMENTARIO DA FISCAL",
    "COMENTÁRIOS DA FISCAL", "COMENTARIOS DA FISCAL", "MOTIVO DA RECUSA", "MOTIVO",
    "OBSERVAÇÃO", "OBSERVACAO", "COMENTÁRIO", "COMENTARIO", "RESPOSTA", "PARECER",
  ];
  const DATE_HEADERS = [
    "RETORNO DA FISCAL 01", "DATA DE RETORNO", "DATA DO RETORNO", "DATA DA CONFIRMAÇÃO",
    "DATA DA CONFIRMACAO", "DATA", "DATA DO ENVIO DA ALOCAÇÃO", "DATA DO ENVIO DA ALOCACAO",
  ];

  function text(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    return String(value).trim();
  }

  function norm(value) {
    return C && C.norm ? C.norm(value) : text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function key(value) {
    return C && C.key ? C.key(value) : norm(value);
  }

  function looseKey(value) {
    return C && C.looseKey ? C.looseKey(value) : norm(value).replace(/[^A-Z0-9]+/g, "");
  }

  function parseAllocationCode(value) {
    const match = text(value).match(/C1O-ALOC-CM-(\d{4})-(\d{4})/i);
    if (!match) return null;
    return { code: `C1O-ALOC-CM-${match[1]}-${match[2]}`, sequence: Number(match[1]), year: Number(match[2]) };
  }

  function headerMap(row) {
    const map = new Map();
    (row || []).forEach((value, index) => {
      const name = norm(value);
      if (name && !map.has(name)) map.set(name, index);
    });
    return map;
  }

  function findColumn(map, aliases) {
    for (const alias of aliases) {
      const exact = map.get(norm(alias));
      if (exact !== undefined) return exact;
    }
    const wanted = aliases.map(norm);
    for (const [header, index] of map.entries()) {
      if (wanted.some((alias) => alias.length >= 7 && (header.includes(alias) || alias.includes(header)))) return index;
    }
    return -1;
  }

  function findColumns(map, aliases) {
    const result = [];
    const wanted = aliases.map(norm);
    for (const [header, index] of map.entries()) {
      if (wanted.some((alias) => header === alias || (alias.length >= 7 && (header.includes(alias) || alias.includes(header))))) result.push(index);
    }
    return [...new Set(result)];
  }

  function findHeader(rows) {
    const limit = Math.min((rows || []).length, 65);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const map = headerMap(rows[rowIndex]);
      const documentColumn = findColumn(map, DOCUMENT_HEADERS);
      if (documentColumn < 0) continue;
      const statusColumn = findColumn(map, STATUS_HEADERS);
      const commentColumns = findColumns(map, COMMENT_HEADERS);
      const allocationColumn = findColumn(map, ALLOCATION_HEADERS);
      if (statusColumn < 0 && !commentColumns.length && allocationColumn < 0) continue;
      return {
        rowIndex,
        map,
        documentColumn,
        allocationColumn,
        statusColumn,
        commentColumns,
        dateColumn: findColumn(map, DATE_HEADERS),
      };
    }
    return null;
  }

  function parseDate(value, XLSX) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number" && XLSX && XLSX.SSF && XLSX.SSF.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y) return new Date(parsed.y, (parsed.m || 1) - 1, parsed.d || 1);
    }
    const raw = text(value);
    if (!raw) return null;
    let match = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return null;
  }

  function formatDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }

  function sourceName(meta) {
    return text(meta && (meta.relativePath || meta.webkitRelativePath || meta.name || meta.sourceName));
  }

  function isDateLike(value, XLSX) {
    return Boolean(parseDate(value, XLSX));
  }

  function meaningfulComment(values, XLSX) {
    const unique = [];
    (values || []).forEach((value) => {
      const candidate = text(value);
      if (!candidate || isDateLike(value, XLSX)) return;
      const normalized = norm(candidate);
      if (!normalized || /^(N\/A|NA|-)$/.test(normalized)) return;
      if (!unique.some((item) => norm(item) === normalized)) unique.push(candidate);
    });
    return unique.join(" | ");
  }

  function classifyEvidence(item) {
    const status = norm(item && item.status);
    const comment = norm(item && item.comment);
    const combined = `${status} ${comment}`.trim();
    if (!combined) return { kind: "unknown", label: "SEM RESULTADO", confidence: "baixa" };

    const rejected = /\b(RECUSAD[OA]?|REJEITAD[OA]?|NAO ALOCAD[OA]?|DEVOLVID[OA]?|NAO ACEIT[OA]?|PENDENTE DE CORRECAO|CORRIGIR|AJUSTAR|REENVIAR|REFAZER|FAVOR VERIFICAR|DIVERGENCIA)\b/.test(combined);
    if (rejected) return { kind: "rejected", label: "RECUSADO — NOVA ALOCAÇÃO NECESSÁRIA", confidence: "alta" };

    const accepted = /\b(ALOCAD[OA]?|ACEIT[OA]?|APROVAD[OA]?|CONCLUID[OA]?|CONFIRMAD[OA]?|OK)\b/.test(combined)
      && !/\bNAO\s+(?:ALOCAD|ACEIT|APROVAD|CONCLUID|CONFIRMAD)/.test(combined);
    if (accepted) return { kind: "accepted", label: "ALOCADO / ACEITO", confidence: "alta" };

    const pending = /\b(PENDENTE|EM ANALISE|AGUARDANDO|EM TRATAMENTO|EM ANDAMENTO)\b/.test(combined);
    if (pending) return { kind: "pending", label: "PENDENTE DE CONFIRMAÇÃO", confidence: "média" };

    return { kind: "unknown", label: text(item && item.status) || "RESULTADO NÃO RECONHECIDO", confidence: "baixa" };
  }

  function parseWorkbook(workbook, XLSX, meta) {
    const rows = [];
    const rejected = [];
    const name = sourceName(meta);
    const allocationFromFile = parseAllocationCode(name);
    const modified = Number(meta && meta.lastModified) || 0;

    (workbook && workbook.SheetNames || []).forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
      const header = findHeader(values);
      if (!header) return;
      for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
        const row = values[rowIndex] || [];
        const document = text(row[header.documentColumn]);
        if (!document || norm(document) === "FIM") continue;
        const allocationFromRow = header.allocationColumn >= 0 ? parseAllocationCode(row[header.allocationColumn]) : null;
        const allocation = allocationFromRow || allocationFromFile;
        const status = header.statusColumn >= 0 ? text(row[header.statusColumn]) : "";
        const comment = meaningfulComment(header.commentColumns.map((column) => row[column]), XLSX);
        const returnDate = header.dateColumn >= 0 ? parseDate(row[header.dateColumn], XLSX) : null;
        const evidence = {
          document,
          documentKey: key(document),
          documentLooseKey: looseKey(document),
          allocation: allocation ? allocation.code : "",
          allocationSequence: allocation ? allocation.sequence : 0,
          allocationYear: allocation ? allocation.year : 0,
          status,
          comment,
          returnDate: formatDate(returnDate),
          returnTimestamp: returnDate ? returnDate.getTime() : 0,
          source: name,
          sourceSheet: text(sheetName),
          sourceRow: rowIndex + 1,
          sourceModified: modified,
          kind: "confirmation",
        };
        evidence.outcome = classifyEvidence(evidence);
        if (!evidence.status && !evidence.comment && !evidence.allocation) {
          rejected.push({ source: name, sheet: sheetName, row: rowIndex + 1, document, reason: "Linha sem resultado, comentário ou número de alocação." });
          continue;
        }
        rows.push(evidence);
      }
    });
    return { rows, rejected, source: name };
  }

  function evidenceRank(item) {
    const yearSequence = (Number(item && item.allocationYear) || 0) * 100000 + (Number(item && item.allocationSequence) || 0);
    return [yearSequence, Number(item && item.returnTimestamp) || 0, Number(item && item.sourceModified) || 0, Number(item && item.sourceRow) || 0];
  }

  function compareEvidence(left, right) {
    const a = evidenceRank(left);
    const b = evidenceRank(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return 0;
  }

  function buildIndex(items) {
    const byDocument = new Map();
    const byLooseDocument = new Map();
    (items || []).forEach((item) => {
      if (!item || !item.documentKey) return;
      if (!byDocument.has(item.documentKey)) byDocument.set(item.documentKey, []);
      byDocument.get(item.documentKey).push(item);
      const loose = item.documentLooseKey || looseKey(item.document);
      if (loose) {
        if (!byLooseDocument.has(loose)) byLooseDocument.set(loose, []);
        byLooseDocument.get(loose).push(item);
      }
    });
    byDocument.forEach((rows) => rows.sort(compareEvidence));
    byLooseDocument.forEach((rows) => rows.sort(compareEvidence));
    return { rows: items || [], byDocument, byLooseDocument };
  }

  function resolve(index, documentKey) {
    let rows = index && index.byDocument && index.byDocument.get(documentKey) || [];
    if (!rows.length) rows = index && index.byLooseDocument && index.byLooseDocument.get(looseKey(documentKey)) || [];
    if (!rows.length) return { evidence: null, conflict: false, candidates: [] };
    const first = rows[0];
    const firstRank = evidenceRank(first).join("|");
    const sameRank = rows.filter((item) => evidenceRank(item).join("|") === firstRank);
    const outcomes = new Set(sameRank.map((item) => item.outcome && item.outcome.kind || "unknown"));
    const conflict = outcomes.size > 1;
    return { evidence: conflict ? null : first, conflict, candidates: sameRank };
  }

  function sourceLabel(item) {
    if (!item) return "";
    return [item.source || "Confirmação de alocação", item.sourceSheet ? `aba ${item.sourceSheet}` : "", item.sourceRow ? `linha ${item.sourceRow}` : "", item.returnDate || ""].filter(Boolean).join(" · ");
  }

  return Object.freeze({
    text,
    norm,
    key,
    parseAllocationCode,
    classifyEvidence,
    parseWorkbook,
    buildIndex,
    resolve,
    sourceLabel,
  });
});
