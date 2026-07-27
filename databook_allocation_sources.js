(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const A = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const api = factory(C, A);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDatabookAllocationSources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, A) {
  "use strict";

  const DOCUMENT_HEADERS = [
    "NOMEDOCUMENTO", "NOME DOCUMENTO", "NOME DO DOCUMENTO", "DOCUMENTO",
    "CODIGO DO DOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO DOCUMENTO", "CÓDIGO DOCUMENTO",
  ];
  const DATABOOK_HEADERS = [
    "CAMINHO DATA BOOK", "CAMINHO DATABOOK", "CAMINHO DO DATA BOOK", "CAMINHO DO DATABOOK",
  ];
  const ALLOCATION_HEADERS = [
    "ALOCACAO", "ALOCAÇÃO", "NUMERO DA ALOCACAO", "NÚMERO DA ALOCAÇÃO", "CODIGO DA ALOCACAO", "CÓDIGO DA ALOCAÇÃO",
  ];
  const DATE_HEADERS = [
    "DATA DO ENVIO DA ALOC", "DATA DO ENVIO DA ALOCACAO", "DATA DO ENVIO DA ALOCAÇÃO",
    "DATA DA ALOCACAO", "DATA DA ALOCAÇÃO", "DATA EFETIVA", "DATA PREVISTA",
    "RETORNO DA FISCAL 01", "DATA DE RETORNO", "DATA",
  ];

  function raw(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    return String(value);
  }

  function text(value) {
    const valueRaw = raw(value);
    return valueRaw instanceof Date ? valueRaw.toISOString() : valueRaw.trim();
  }

  function norm(value) {
    if (A && A.norm) return A.norm(value);
    if (C && C.norm) return C.norm(value);
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function key(value) {
    if (A && A.key) return A.key(value);
    if (C && C.key) return C.key(value);
    return norm(value).replace(/[^A-Z0-9]+/g, "");
  }

  function pathKey(value) {
    return A && A.pathKey ? A.pathKey(value) : norm(value).replace(/\s*\|\s*/g, "|");
  }

  function completeDatabook(value) {
    if (A && A.completeDatabook) return A.completeDatabook(value);
    return text(value).split("|").filter((part) => part.trim()).length >= 3;
  }

  function parseAllocationCode(value) {
    const match = text(value).match(/C1O-ALOC-CM-(\d{4})-(\d{4})/i);
    if (!match) return null;
    return {
      code: `C1O-ALOC-CM-${match[1]}-${match[2]}`,
      sequence: Number(match[1]),
      year: Number(match[2]),
    };
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
      if (wanted.some((alias) => alias.length >= 8 && (header.includes(alias) || alias.includes(header)))) return index;
    }
    return -1;
  }

  function findHeader(rows) {
    const limit = Math.min((rows || []).length, 60);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const map = headerMap(rows[rowIndex]);
      const documentColumn = findColumn(map, DOCUMENT_HEADERS);
      const databookColumn = findColumn(map, DATABOOK_HEADERS);
      if (documentColumn < 0 || databookColumn < 0) continue;
      return {
        rowIndex,
        map,
        documentColumn,
        databookColumn,
        allocationColumn: findColumn(map, ALLOCATION_HEADERS),
        dateColumn: findColumn(map, DATE_HEADERS),
      };
    }
    return null;
  }

  function excelDate(value, XLSX) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number" && XLSX && XLSX.SSF && XLSX.SSF.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed && parsed.y) return new Date(parsed.y, (parsed.m || 1) - 1, parsed.d || 1);
    }
    const stringValue = text(value);
    if (!stringValue) return null;
    let match = stringValue.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = stringValue.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
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

  function parseWorkbook(workbook, XLSX, meta) {
    const rows = [];
    const rejected = [];
    const kind = text(meta && meta.kind).toLowerCase() === "confirmation" ? "confirmation" : "allocation";
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
        const databookRaw = raw(row[header.databookColumn]);
        const databook = databookRaw instanceof Date ? "" : String(databookRaw);
        if (!document || norm(document) === "FIM" || !completeDatabook(databook)) continue;

        const allocationCell = header.allocationColumn >= 0 ? row[header.allocationColumn] : "";
        const allocationFromRow = parseAllocationCode(allocationCell);
        if (allocationFromRow && allocationFromFile && allocationFromRow.code !== allocationFromFile.code) {
          rejected.push({ source: name, sheet: sheetName, row: rowIndex + 1, document, reason: `A linha informa ${allocationFromRow.code}, mas o arquivo indica ${allocationFromFile.code}.` });
          continue;
        }
        const allocation = allocationFromRow || allocationFromFile;
        if (!allocation) {
          rejected.push({ source: name, sheet: sheetName, row: rowIndex + 1, document, reason: "Número completo da alocação não localizado." });
          continue;
        }

        const rowDate = header.dateColumn >= 0 ? excelDate(row[header.dateColumn], XLSX) : null;
        if (rowDate && rowDate.getFullYear() !== allocation.year) {
          rejected.push({ source: name, sheet: sheetName, row: rowIndex + 1, document, reason: `A data ${formatDate(rowDate)} não pertence ao ano ${allocation.year} da alocação.` });
          continue;
        }

        rows.push({
          document,
          documentKey: key(document),
          allocation: allocation.code,
          allocationSequence: allocation.sequence,
          allocationYear: allocation.year,
          databook,
          databookKey: pathKey(databook),
          kind,
          source: name,
          sourceSheet: text(sheetName),
          sourceRow: rowIndex + 1,
          sourceDate: formatDate(rowDate),
          sourceDateTimestamp: rowDate ? rowDate.getTime() : 0,
          sourceModified: modified,
        });
      }
    });
    return { rows, rejected, source: name, kind };
  }

  function buildIndex(items) {
    const rows = (items || []).filter((item) => item && item.documentKey && item.allocation && item.databookKey);
    const byDocumentAllocation = new Map();
    const byDocument = new Map();
    rows.forEach((item) => {
      const exactKey = `${item.documentKey}::${item.allocation}`;
      if (!byDocumentAllocation.has(exactKey)) byDocumentAllocation.set(exactKey, []);
      byDocumentAllocation.get(exactKey).push(item);
      if (!byDocument.has(item.documentKey)) byDocument.set(item.documentKey, []);
      byDocument.get(item.documentKey).push(item);
    });
    return { rows, byDocumentAllocation, byDocument };
  }

  function recordValue(record, aliases) {
    const wanted = (aliases || []).map(norm);
    for (const column of record && record.ldColumns || []) {
      const header = norm(column.header);
      if (wanted.includes(header) && text(column.value)) return text(column.value);
    }
    for (const column of record && record.ldColumns || []) {
      const header = norm(column.header);
      if (wanted.some((alias) => alias.length >= 7 && header.includes(alias)) && text(column.value)) return text(column.value);
    }
    return "";
  }

  function allocationForRecord(record) {
    return parseAllocationCode(record && record.allocation)
      || parseAllocationCode(recordValue(record, ALLOCATION_HEADERS));
  }

  function selectPriority(candidates, kind) {
    const selected = (candidates || []).filter((item) => item.kind === kind);
    if (!selected.length) return null;
    const paths = new Map();
    selected.forEach((item) => {
      if (!paths.has(item.databookKey)) paths.set(item.databookKey, []);
      paths.get(item.databookKey).push(item);
    });
    if (paths.size > 1) {
      return {
        status: "conflict",
        kind,
        candidates: selected,
        paths: [...paths.values()].map((group) => group[0].databook),
        reason: `${kind === "confirmation" ? "As confirmações" : "Os arquivos de alocação"} do mesmo documento e da mesma alocação possuem Caminhos Databook diferentes.`,
      };
    }
    const group = [...paths.values()][0];
    const chosen = [...group].sort((left, right) => (
      Number(right.sourceDateTimestamp || 0) - Number(left.sourceDateTimestamp || 0)
      || Number(right.sourceModified || 0) - Number(left.sourceModified || 0)
      || Number(right.sourceRow || 0) - Number(left.sourceRow || 0)
    ))[0];
    return { status: "found", kind, chosen, candidates: selected };
  }

  function resolve(record, index) {
    const allocation = allocationForRecord(record);
    if (!allocation) {
      return { status: "allocation_missing", reason: "A LD não informa um número completo de alocação para este documento." };
    }
    const documentKey = text(record && record.documentKey) || key(record && record.document);
    const exact = index && index.byDocumentAllocation && index.byDocumentAllocation.get(`${documentKey}::${allocation.code}`) || [];
    const confirmed = selectPriority(exact, "confirmation");
    if (confirmed) return { ...confirmed, allocation };
    const original = selectPriority(exact, "allocation");
    if (original) return { ...original, allocation };

    const sameDocument = index && index.byDocument && index.byDocument.get(documentKey) || [];
    const otherYears = [...new Set(sameDocument
      .filter((item) => item.allocationSequence === allocation.sequence && item.allocationYear !== allocation.year)
      .map((item) => item.allocationYear))].sort();
    if (otherYears.length) {
      return {
        status: "wrong_year_only",
        allocation,
        otherYears,
        reason: `Foram encontrados arquivos da sequência ${String(allocation.sequence).padStart(4, "0")}, mas somente de outro(s) ano(s): ${otherYears.join(", ")}.`,
      };
    }
    return { status: "not_found", allocation, reason: `O documento não foi encontrado nos arquivos da alocação ${allocation.code}.` };
  }

  function sourceLabel(item) {
    if (!item) return "";
    const kind = item.kind === "confirmation" ? "Confirmação de alocação" : "Arquivo de alocação";
    return `${kind} · ${item.source}${item.sourceSheet ? ` · ${item.sourceSheet}` : ""}${item.sourceRow ? ` · linha ${item.sourceRow}` : ""}${item.sourceDate ? ` · ${item.sourceDate}` : ""}`;
  }

  return Object.freeze({
    raw,
    text,
    norm,
    key,
    pathKey,
    completeDatabook,
    parseAllocationCode,
    parseWorkbook,
    buildIndex,
    allocationForRecord,
    resolve,
    sourceLabel,
  });
});
