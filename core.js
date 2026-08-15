(function (root, factory) {
  const contracts = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const api = factory(contracts);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TriagemCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contracts) {
  "use strict";

  const READY = "pronto";
  const DISCARD = "descartar";
  const REVIEW = "revisar";

  const REVISION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const N1710_CATEGORIES = new Set([
    "CE", "CR", "DB", "DE", "EC", "ET", "FD", "IM", "IS", "LA",
    "LD", "LI", "LO", "MA", "MC", "MD", "MO", "PR", "PT", "RL",
    "RM", "CT", "SIT",
  ]);
  const REPORT_DISCIPLINES = new Set([
    "ADC", "ARR", "DBU", "CVL", "CTO", "CRS", "CDR", "DOC", "ELE",
    "REQ", "ETF", "FSC", "FOR", "GER", "HVAC", "INSP", "INS", "PDMS",
    "MEC", "DIN", "EST", "PLA", "PRS", "PRJ", "QUA", "SMS", "SEG",
    "SIS", "SUP", "TEL", "TUB",
  ]);
  const EGRDT_OPTIONS = Object.freeze({
    formats: ["A0", "A1", "A2", "A3", "A4"],
    disciplines: [
      "DINÂMICOS", "ESTÁTICOS", "MONTAGEM", "COMISSIONAMENTO", "SUPRIMENTOS",
      "ELÉTRICA", "ENGENHARIA DE PROJETO", "ESTRUTURA METÁLICA",
      "FERRAMENTAS COMPUTACIONAIS", "INSTRUMENTAÇÃO", "MECÂNICA", "MEIO AMBIENTE",
      "SEGURANÇA", "PLANEJAMENTO", "COMUNICAÇÃO E RS", "ADM CONTRATUAL", "GERAL",
      "QUALIDADE", "CIVIL", "SAÚDE", "TUBULAÇÃO", "COORDENAÇÃO",
    ],
    documentTypes: [
      "AD", "AF", "AL", "ART", "AS", "AT", "CE", "CO", "CR", "CT", "CV",
      "DB", "DTRI", "DE", "DTRA", "ET", "FD", "GES", "HIS", "IM", "IS",
      "LA", "LD", "LI", "LO", "MA", "MC", "MD", "MO", "ORG", "PR", "PT",
      "RL", "RM", "SG", "SUB",
    ],
    purposes: [
      "Para Compra", "Para Construção", "Conforme Construído", "Certificado",
      "Pendente Certificação", "Cancelado", "Emitido para Comentários",
      "Para Cancelamento", "Para Informação", "Para Liberação",
    ],
  });
  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function norm(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalId(value) {
    return norm(value)
      .replace(/\s*([_.-])\s*/g, "$1")
      .replace(/\s+/g, " ");
  }

  function key(value) {
    return canonicalId(value);
  }

  function looseKey(value) {
    return norm(value).replace(/[^A-Z0-9]/g, "");
  }

  function statusKind(value) {
    const s = norm(value);
    const exact = {
      "NAO POSTADO": "not_posted",
      "EM ANALISE": "analysis",
      "COM COMENTARIOS": "advance",
      "SEM COMENTARIOS": "advance",
      "ACEITO SEM COMENTARIOS": "advance",
      "RECUSADO": "advance",
      "PARA CONSTRUCAO": "issued",
      "CONFORME CONSTRUIDO": "issued",
      "PARA COMPRA": "issued",
      "EM WORKFLOW": "pending",
      "PENDENTE CERTIFICACAO": "pending",
      "CANCELADO": "closed",
    };
    return exact[s] || "unknown";
  }

  function normalizeRevision(value) {
    return norm(value).replace(/^REV(?:ISAO)?\.?\s*/, "").replace(/\s+/g, "");
  }

  function revisionInfo(value) {
    const revision = normalizeRevision(value);
    if (revision === "0") return { revision, valid: true, kind: "standard", rank: 0 };
    if (/^[A-Z]+$/.test(revision)) {
      if ([...revision].some((letter) => !REVISION_ALPHABET.includes(letter))) {
        return { revision, valid: false, kind: "invalid", rank: -1 };
      }
      let rank = 0;
      for (const letter of revision) rank = rank * REVISION_ALPHABET.length + REVISION_ALPHABET.indexOf(letter) + 1;
      return { revision, valid: true, kind: "standard", rank: rank * 1000 };
    }
    const field = revision.match(/^([A-Z]+)([1-9]\d*)$/);
    if (field && [...field[1]].every((letter) => REVISION_ALPHABET.includes(letter))) {
      const base = revisionInfo(field[1]);
      return { revision, valid: true, kind: "field", rank: base.rank + Number(field[2]) };
    }
    return { revision, valid: false, kind: "invalid", rank: -1 };
  }

  function revisionRank(value) {
    return revisionInfo(value).rank;
  }

  function nextRevision(value) {
    const info = revisionInfo(value);
    if (!info.valid || info.kind !== "standard") return "";
    if (info.revision === "0") return "A";
    const digits = [...info.revision].map((letter) => REVISION_ALPHABET.indexOf(letter));
    let position = digits.length - 1;
    while (position >= 0 && digits[position] === REVISION_ALPHABET.length - 1) {
      digits[position] = 0;
      position -= 1;
    }
    if (position < 0) digits.unshift(0);
    else digits[position] += 1;
    return digits.map((digit) => REVISION_ALPHABET[digit]).join("");
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number" && value > 20000) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const raw = text(value);
    const br = raw.match(/^(\d{1,2})[\/]([01]?\d)[\/](\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) {
      let year = Number(br[3]);
      if (year < 100) year += 2000;
      const month = Number(br[2]);
      const day = Number(br[1]);
      const hour = Number(br[4] || 0);
      const minute = Number(br[5] || 0);
      const second = Number(br[6] || 0);
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1
        || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
      return date;
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      const hour = Number(iso[4] || 0);
      const minute = Number(iso[5] || 0);
      const second = Number(iso[6] || 0);
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1
        || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
      return date;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateTimestamp(value) {
    const date = parseDate(value);
    return date ? date.getTime() : 0;
  }

  function isRecentDate(value, recentDays, nowValue) {
    const date = parseDate(value);
    const now = parseDate(nowValue) || new Date();
    if (!date) return false;
    const elapsedDays = (now.getTime() - date.getTime()) / 86400000;
    return elapsedDays >= -1 && elapsedDays <= Math.max(1, Number(recentDays) || 30);
  }

  function recordCompare(a, b) {
    const revision = revisionRank(b.revision) - revisionRank(a.revision);
    if (revision) return revision;
    const source = (Number(b.sourceTimestamp) || 0) - (Number(a.sourceTimestamp) || 0);
    if (source) return source;
    const effective = dateTimestamp(b.effectiveDate) - dateTimestamp(a.effectiveDate);
    if (effective) return effective;
    const grdt = Number(Boolean(text(b.grdt))) - Number(Boolean(text(a.grdt)));
    if (grdt) return grdt;
    return (Number(b.row) || 0) - (Number(a.row) || 0);
  }

  function historyCompare(a, b) {
    const modified = dateTimestamp(b.modified) - dateTimestamp(a.modified);
    if (modified) return modified;
    const included = dateTimestamp(b.included) - dateTimestamp(a.included);
    if (included) return included;
    return (Number(b.row) || 0) - (Number(a.row) || 0);
  }

  function compactTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 19).replace(/\D/g, "");
  }

  function findHeader(rows) {
    const limit = Math.min(rows.length, 25);
    for (let i = 0; i < limit; i += 1) {
      const cells = (rows[i] || []).map(norm);
      const hasDocument = cells.some((c) => c === "DOCUMENTO" || c.startsWith("DOCUMENTO ") || c.includes("CODIGO DO DOCUMENTO") || c === "CODIGO DOCUMENTO");
      const hasRevision = cells.some((c) => c === "REVISAO" || c === "REV." || c === "REV");
      if (hasDocument && (hasRevision || cells.some((c) => c.includes("STATUS")))) return i;
    }
    return -1;
  }

  function columnMap(header) {
    const result = {};
    header.forEach((cell, index) => {
      const h = norm(cell);
      if (!h) return;
      if (h === "DOCUMENTO" || h.startsWith("DOCUMENTO ") || h === "CODIGO DOCUMENTO" || h === "CODIGO DO DOCUMENTO") result.document = index;
      else if (h === "REVISAO" || h === "REV." || h === "REV") result.revision = index;
      else if (h.includes("STATUS SIGEM")) result.sigemStatus = index;
      else if (h === "STATUS") result.status = index;
      else if (h === "TITULO" || h.includes("TITULO DO DOCUMENTO")) result.title = index;
      else if (h === "GRDT" || h.includes("NUMERO GRDT")) result.grdt = index;
      else if (h.includes("DATA EFETIVA DE EMISSAO")) result.effectiveDate = index;
      else if (h === "FORMATO") result.format = index;
      else if (h === "DISCIPLINA") result.discipline = index;
      else if (h.includes("TIPO DE DOCUMENTO") || h === "TIPO DOCUMENTO") result.documentType = index;
      else if (h.includes("PROPOSITO") || h.includes("FINALIDADE")) result.purpose = index;
      else if (h.includes("CAMINHO DATABOOK") || h.includes("CAMINHO DATA BOOK")) result.databook = index;
      else if (h.includes("COMENTARIO DA FISCAL")) result.fiscalComment = index;
      else if (h.includes("CONFIRMACAO") && h.includes("DOCUMENTOS PREVISTOS")) result.allocationStatus = index;
      else if (h.includes("ETAPA") && h.includes("ALOCACAO")) result.allocationStage = index;
      else if (h.includes("MODIFICADO EM")) result.modified = index;
      else if (h.includes("INCLUIDO EM")) result.included = index;
      else if (h.includes("ALOCACAO")) result.allocation = index;
    });
    return result;
  }

  // Algumas LDs, inclusive a LD_004, usam a coluna ALOCAÇÃO como estado
  // operacional (ALOCADO / NÃO ALOCADO), enquanto outras colocam nela o
  // código C1O-ALOC-CM-.... Separa os dois significados pelo conteúdo para
  // que o status não seja confundido com número de alocação.
  function allocationStatusFromAllocationCell(value) {
    const normalized = norm(value);
    if (/^NAO ALOCAD[OA]\b/.test(normalized)) return "NÃO ALOCADO";
    if (/^ALOCAD[OA]\b/.test(normalized)) return "ALOCADO";
    return "";
  }

  function cell(row, index) {
    return index === undefined ? "" : text(row[index]);
  }

  function sheetCell(sheet, row, column) {
    if (column === undefined) return "";
    const item = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (!item) return "";
    return text(item.w !== undefined ? item.w : item.v);
  }

  function sheetDateCell(sheet, row, column) {
    if (column === undefined) return "";
    const item = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    if (!item) return "";
    const value = item.v;
    const date = value instanceof Date ? value : (typeof value === "number" ? parseDate(value) : null);
    if (date) {
      // O SheetJS pode deslocar datas de planilhas antigas por alguns segundos
      // ao aplicar fusos horários históricos. O texto formatado da célula mantém
      // o dia exibido no Excel; usamos a interpretação mais próxima do valor
      // interno para resolver automaticamente formatos DD/MM e MM/DD.
      const formatted = text(item.w);
      const parts = formatted.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})(?:\D|$)/);
      if (parts) {
        let formattedYear = Number(parts[3]);
        if (formattedYear < 100) formattedYear += 2000;
        const first = Number(parts[1]);
        const second = Number(parts[2]);
        const candidates = [[first, second], [second, first]].map(([day, month]) => {
          const candidate = new Date(formattedYear, month - 1, day);
          return candidate.getFullYear() === formattedYear && candidate.getMonth() === month - 1 && candidate.getDate() === day
            ? { candidate, year: formattedYear, month, day }
            : null;
        }).filter(Boolean).sort((left, right) => Math.abs(left.candidate.getTime() - date.getTime()) - Math.abs(right.candidate.getTime() - date.getTime()));
        if (candidates.length) {
          const chosen = candidates[0];
          return `${chosen.year}-${String(chosen.month).padStart(2, "0")}-${String(chosen.day).padStart(2, "0")}`;
        }
      }
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    return text(value !== undefined ? value : item.w);
  }

  function inferLdVersion(workbook) {
    const coverName = (workbook.SheetNames || []).find((sheetName) => norm(sheetName) === "CAPA");
    const sheet = coverName ? workbook.Sheets[coverName] : null;
    if (!sheet || !sheet["!ref"]) return "";
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    let revisionHeader = -1;
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 40); row += 1) {
      const first = norm(sheetCell(sheet, row, range.s.c));
      if (first === "REV" || first === "REV." || first === "REVISAO") {
        revisionHeader = row;
        break;
      }
    }
    if (revisionHeader < 0) return "";
    let version = "";
    for (let row = revisionHeader + 1; row <= Math.min(range.e.r, revisionHeader + 160); row += 1) {
      const candidate = text(sheetCell(sheet, row, range.s.c)).toUpperCase().replace(/\s+/g, "");
      if (/^(?:0|[A-Z](?:\d{1,3})?)$/.test(candidate)) version = candidate;
    }
    return version;
  }

  // Quantas linhas do topo são varridas atrás do cabeçalho. LDs reais trazem
  // capa, filtros e legendas antes da tabela; 25 linhas cortava abas inteiras.
  const HEADER_SCAN_ROWS = 60;
  // O limite de 80 colunas descartava a coluna DOCUMENTO quando ela estava mais
  // à direita, e com ela a aba inteira.
  const MAX_COLUMNS = 400;

  function parseWorkbook(workbook, sourceName, sourceTimestamp, compatibilityProfile) {
    const records = [];
    const history = [];
    // Cobertura: tudo o que ficou de fora precisa ser contado e nomeado. Antes
    // uma aba sem cabeçalho reconhecido, ou uma linha com código curto, sumia
    // em silêncio e a análise parecia ter "pulado" parte da LD.
    const coverage = { sheets: [], skippedSheets: [], rowsRead: 0, rowsSkipped: { noDocument: 0, shortKey: 0, endMarker: 0 } };
    const ldVersion = inferLdVersion(workbook);
    const mappedFields = { technical: new Set(), history: new Set() };
    const configuredSheets = compatibilityProfile && compatibilityProfile.sheets || null;
    const ignoredSheets = new Set(["CAPA", "T", "G", "PLANILHA1", "ALOCACAO"]);
    (workbook.SheetNames || []).forEach((sheetName, sheetOrder) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet["!ref"]) return;
      const configured = configuredSheets && configuredSheets[sheetName];
      if (configuredSheets && (!configured || configured.role === "ignore")) return;
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      const lastColumn = Math.min(range.e.c, MAX_COLUMNS);
      let headerIndex = configured && Number.isInteger(configured.headerRow) ? configured.headerRow : -1;
      let header = [];
      if (headerIndex >= 0) {
        for (let c = range.s.c; c <= lastColumn; c += 1) header[c] = sheetCell(sheet, headerIndex, c);
      } else {
        for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + HEADER_SCAN_ROWS - 1); r += 1) {
          const candidate = [];
          for (let c = range.s.c; c <= lastColumn; c += 1) candidate[c] = sheetCell(sheet, r, c);
          const cells = candidate.map(norm);
          // A coluna DOCUMENTO sozinha já identifica a tabela. Exigir também
          // REVISÃO ou STATUS descartava abas técnicas legítimas que não têm
          // essas colunas — e com elas todos os seus documentos.
          const hasDocument = cells.some((value) => value === "DOCUMENTO" || value.startsWith("DOCUMENTO ")
            || value.includes("CODIGO DO DOCUMENTO") || value === "CODIGO DOCUMENTO" || value === "CODIGO DOCUMENTAL");
          if (hasDocument) {
            headerIndex = r;
            header = candidate;
            break;
          }
        }
      }
      if (headerIndex < 0) { coverage.skippedSheets.push({ sheet: sheetName, reason: "cabeçalho com coluna DOCUMENTO não encontrado" }); return; }
      const columns = configured && configured.columns ? { ...configured.columns } : columnMap(header);
      if (columns.document === undefined) { coverage.skippedSheets.push({ sheet: sheetName, reason: "coluna DOCUMENTO não mapeada" }); return; }
      const historySheet = configured ? configured.role === "history" : norm(sheetName) === "COLAR SIGEM";
      if (!historySheet && ignoredSheets.has(norm(sheetName))) { coverage.skippedSheets.push({ sheet: sheetName, reason: "aba de apoio, fora da análise" }); return; }
      let sheetRows = 0;
      Object.keys(columns).forEach((field) => mappedFields[historySheet ? "history" : "technical"].add(field));
      for (let i = headerIndex + 1; i <= range.e.r; i += 1) {
        const document = sheetCell(sheet, i, columns.document);
        if (!document) { coverage.rowsSkipped.noDocument += 1; continue; }
        if (norm(document) === "FIM") { coverage.rowsSkipped.endMarker += 1; continue; }
        const documentKey = key(document);
        if (documentKey.length < 7) { coverage.rowsSkipped.shortKey += 1; continue; }
        sheetRows += 1;
        coverage.rowsRead += 1;
        const rawAllocation = sheetCell(sheet, i, columns.allocation);
        const explicitAllocationStatus = sheetCell(sheet, i, columns.allocationStatus);
        const inferredAllocationStatus = allocationStatusFromAllocationCell(rawAllocation);
        const item = {
          document,
          documentKey,
          queryKey: sheetCell(sheet, i, 0),
          revision: sheetCell(sheet, i, columns.revision),
          status: sheetCell(sheet, i, columns.status),
          sigemStatus: sheetCell(sheet, i, columns.sigemStatus),
          title: sheetCell(sheet, i, columns.title),
          grdt: sheetCell(sheet, i, columns.grdt),
          effectiveDate: sheetDateCell(sheet, i, columns.effectiveDate),
          format: sheetCell(sheet, i, columns.format),
          discipline: sheetCell(sheet, i, columns.discipline),
          documentType: sheetCell(sheet, i, columns.documentType),
          purpose: sheetCell(sheet, i, columns.purpose),
          databook: sheetCell(sheet, i, columns.databook),
          fiscalComment: sheetCell(sheet, i, columns.fiscalComment),
          allocationStatus: explicitAllocationStatus || inferredAllocationStatus,
          allocationStage: sheetCell(sheet, i, columns.allocationStage),
          modified: sheetCell(sheet, i, columns.modified),
          included: sheetCell(sheet, i, columns.included),
          allocation: inferredAllocationStatus ? "" : rawAllocation,
          sheet: sheetName.trim(),
          row: i + 1,
          source: sourceName,
          sourceTimestamp: Number(sourceTimestamp) || 0,
          sourceOrder: sheetOrder,
          ldVersion,
          ldColumns: header.map((label, column) => ({
            header: text(label).replace(/\s+/g, " "),
            value: sheetCell(sheet, i, column),
            column: column + 1,
          })).filter((entry) => entry.header),
        };
        const normalizedItem = Contracts ? Contracts.normalizeRecord(item) : item;
        if (historySheet) history.push(normalizedItem);
        else records.push(normalizedItem);
      }
      coverage.sheets.push({ sheet: sheetName, role: historySheet ? "histórico" : "técnica", headerRow: headerIndex + 1, rows: sheetRows });
    });
    return {
      records,
      history,
      coverage,
      ldVersion,
      mappedFields: {
        technical: [...mappedFields.technical],
        history: [...mappedFields.history],
      },
      compatibilityProfile: compatibilityProfile || null,
    };
  }

  function buildIndex(records, history) {
    const byDocument = new Map();
    const byDocumentRevision = new Map();
    records.forEach((item) => {
      if (!byDocument.has(item.documentKey)) byDocument.set(item.documentKey, { records: [], history: [] });
      byDocument.get(item.documentKey).records.push(item);
    });
    history.forEach((item) => {
      if (!byDocument.has(item.documentKey)) byDocument.set(item.documentKey, { records: [], history: [] });
      byDocument.get(item.documentKey).history.push(item);
      const revision = normalizeRevision(item.revision);
      if (revision) {
        const historyKey = `${item.documentKey}::${revision}`;
        if (!byDocumentRevision.has(historyKey)) byDocumentRevision.set(historyKey, []);
        byDocumentRevision.get(historyKey).push(item);
      }
    });
    const documents = [...byDocument.entries()]
      .map(([documentKey, group]) => {
        const all = [...group.records, ...group.history];
        const representative = all.sort((a, b) => b.document.length - a.document.length)[0];
        return { documentKey, looseDocumentKey: looseKey(representative.document), document: representative.document, group };
      })
      .sort((a, b) => b.documentKey.length - a.documentKey.length);
    const byLooseDocument = new Map();
    documents.forEach((item) => {
      if (!item.looseDocumentKey) return;
      if (!byLooseDocument.has(item.looseDocumentKey)) byLooseDocument.set(item.looseDocumentKey, []);
      byLooseDocument.get(item.looseDocumentKey).push(item);
    });
    byDocumentRevision.forEach((items) => items.sort(historyCompare));
    // Índice para o caminho rápido de matchDocuments: quando o texto de
    // entrada É exatamente a chave de um documento (o caso comum — a relação
    // normalmente traz o próprio código), evita varrer todos os "documents"
    // fazendo indexOf em cada um só para achar isso de novo.
    const byDocumentKey = new Map(documents.map((item) => [item.documentKey, item]));
    return { byDocument, byDocumentRevision, byLooseDocument, byDocumentKey, documents };
  }

  const DOCUMENT_EXTENSION_PATTERN = /\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i;

  function matchDocuments(nameOrText, index, hintedSheet) {
    // A relação costuma trazer o nome do arquivo, não só o código (colunas
    // "ARQUIVO"/"PDF" no upload). Sem tirar a extensão, nem o match exato
    // (byDocumentKey) nem o loose (byLooseDocument) batiam nunca — a busca
    // sempre caía na varredura lenta, mesmo pros casos mais comuns.
    const inputKey = canonicalId(nameOrText).replace(DOCUMENT_EXTENSION_PATTERN, "");
    const inputLoose = looseKey(inputKey);
    const hint = norm(hintedSheet);

    // Uma correspondência exata de comprimento total nunca pode ser dominada
    // por outro candidato (nada pode ser "maior" dentro da mesma string), e
    // qualquer outra chave que também apareça como substring de inputKey é,
    // por definição, mais curta — logo sempre eliminada pelo filtro de
    // maximalCandidates abaixo. O resultado é idêntico ao da varredura
    // completa, só que em O(1) em vez de O(quantidade de documentos).
    const exactMatch = index.byDocumentKey && index.byDocumentKey.get(inputKey);
    let candidates = exactMatch ? [exactMatch] : index.documents.filter((item) => {
      let position = inputKey.indexOf(item.documentKey);
      while (position >= 0) {
        const before = position > 0 ? inputKey[position - 1] : "";
        const afterPosition = position + item.documentKey.length;
        const after = afterPosition < inputKey.length ? inputKey[afterPosition] : "";
        if ((!before || !/[A-Z0-9]/.test(before)) && (!after || !/[A-Z0-9]/.test(after))) return true;
        position = inputKey.indexOf(item.documentKey, position + 1);
      }
      return false;
    });

    if (!candidates.length && inputLoose) {
      const exactLoose = index.byLooseDocument && index.byLooseDocument.get(inputLoose) || [];
      candidates = exactLoose.length ? exactLoose : index.documents.filter((item) => item.looseDocumentKey && inputLoose.includes(item.looseDocumentKey));
    }
    if (!candidates.length) return [];
    const maximalCandidates = candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate
      && (other.documentKey.length > candidate.documentKey.length || other.looseDocumentKey.length > candidate.looseDocumentKey.length)
      && (other.documentKey.includes(candidate.documentKey) || other.looseDocumentKey.includes(candidate.looseDocumentKey))
    )));
    if (hint) {
      const inSheet = maximalCandidates.filter((candidate) => candidate.group.records.some((r) => norm(r.sheet) === hint));
      if (inSheet.length) return inSheet;
    }
    return maximalCandidates;
  }

  function matchDocument(nameOrText, index, hintedSheet) {
    return matchDocuments(nameOrText, index, hintedSheet)[0] || null;
  }

  function inferSheetFromName(fileName) {
    const baseName = text(fileName).split(/[\\/]/).pop();
    const name = canonicalId(baseName.replace(/\.[A-Z0-9]{1,5}$/i, ""));
    if (/^5900(?:\.\d+){3}-[A-Z0-9]{3}-CV-[A-Z0-9]+-\d{4}(?:$|[_ -])/.test(name)) return "CV";
    if (/^[A-Z0-9]{3}_RNEST_[A-Z0-9]+_\d+(?:\.\d+){3}_[A-Z0-9]+_[A-Z0-9]+_/.test(name)) return "ET";
    const first = name.split("-")[0];
    const category = /^[IAFLED]$/.test(first) ? name.split("-")[1] : first;
    if (N1710_CATEGORIES.has(category) && name.includes("-5290.00-")) return "N-1710";
    return "";
  }

  function controlArtifactKind(fileName) {
    const name = norm(fileName);
    if (!name) return "arquivo sem nome";
    if (/^~\$/.test(name)) return "arquivo temporário do Office";
    if (/(?:^|[ _-])E?GRDT(?:[ _.(-]|$)/.test(name)) return "arquivo de controle GRDT";
    if (/^(RELATORIO[ _-](?:TRIAGEM|GRCON)|DADOS[ _-]EGRDT|PACOTE[ _-](?:DOCUMENTOS[ _-]PRONTOS|GRCON))/.test(name)) return "saída gerada pelo aplicativo";
    return "";
  }

  function claimedRevisionFromName(fileName, document) {
    const stem = text(fileName).replace(/\.[^.]+$/, "");
    const escaped = text(document).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let tail = stem;
    if (document && new RegExp(escaped, "i").test(stem)) tail = stem.replace(new RegExp(`^.*?${escaped}`, "i"), "");
    const patterns = [
      /_0001[_ -](?:REV[_ -]?)?([A-Z]{1,3}\d*|0)$/i,
      /[_ -]REV(?:ISAO)?[_ -]?([A-Z]{1,3}\d*|0)$/i,
      /[_ -]([A-Z]{1,3}\d*|0)$/i,
    ];
    for (const pattern of patterns) {
      const m = tail.match(pattern);
      if (m) return normalizeRevision(m[1]);
    }
    return "";
  }

  function revisionFromName(fileName, document) {
    const claim = claimedRevisionFromName(fileName, document);
    return revisionInfo(claim).valid ? claim : "";
  }

  function revisionFromText(pdfText, document) {
    const value = canonicalId(pdfText);
    const documentKey = canonicalId(document);
    let scope = value;
    if (documentKey) {
      const position = value.indexOf(documentKey);
      if (position < 0) return "";
      scope = value.slice(Math.max(0, position - 180), position + documentKey.length + 260);
    }
    const patterns = [
      /REVISAO\s*[:\-]?\s*([A-HJ-NP-Z]{1,3}|0)\b/g,
      /\bREV\.?\s*[:\-]?\s*([A-HJ-NP-Z]{1,3}|0)\b/g,
      /\bREVISION\s*[:\-]?\s*([A-HJ-NP-Z]{1,3}|0)\b/g,
      /_0001[_ -]([A-HJ-NP-Z]{1,3}|0)\b/g,
    ];
    const revisions = [];
    for (const pattern of patterns) {
      for (const match of scope.matchAll(pattern)) {
        const revision = normalizeRevision(match[1]);
        if (revisionInfo(revision).valid) revisions.push(revision);
      }
    }
    const unique = [...new Set(revisions)];
    if (documentKey) return unique.length === 1 ? unique[0] : "";
    return unique[0] || "";
  }

  function validateDocumentCode(document, sheetName) {
    const raw = text(document);
    const sheet = norm(sheetName);
    const errors = [];
    if (!raw) return { valid: false, family: sheet, errors: ["Código documental vazio."] };

    if (sheet === "ET" || raw.includes("_RNEST_")) {
      const groups = raw.split("_");
      if (groups.length !== 7) errors.push("Relatório deve possuir 7 grupos separados por underline.");
      if (groups[1] && norm(groups[1]) !== "RNEST") errors.push("Grupo 2 do relatório deve ser RNEST.");
      if (groups[3] && !/^\d+(?:\.\d+){3}$/.test(groups[3])) errors.push("EAP do relatório deve possuir quatro níveis numéricos.");
      if (groups[4] && !REPORT_DISCIPLINES.has(norm(groups[4]))) errors.push("Disciplina do relatório não consta na lista contratual.");
      if (groups[6] && /^NT-/i.test(groups[6]) && !groups[6].startsWith("nt-")) errors.push("Identificador não tagueado deve começar exatamente por nt- minúsculo.");
      if (groups[6] && /[_ç?|!@#$%¨&*(),\s]/i.test(groups[6])) errors.push("TAG/identificador contém caractere proibido pela ET.");
      return { valid: errors.length === 0, family: "ET", errors };
    }

    if (sheet === "CV" || raw.includes("-C1O-CV-")) {
      if (!/^5900(?:\.\d+){3}-[A-Z0-9]{3}-CV-[A-Z0-9]+-\d{4}$/i.test(raw)) {
        errors.push("Currículo não atende aos cinco grupos e ao sequencial de quatro dígitos da ET.");
      }
      return { valid: errors.length === 0, family: "CV", errors };
    }

    const groups = raw.split("-");
    const hasLanguage = groups.length > 0 && /^[IAFLED]$/i.test(groups[0]);
    const category = norm(groups[hasLanguage ? 1 : 0]);
    const expectedGroups = hasLanguage ? 7 : 6;
    if (groups.length !== expectedGroups) errors.push(`Documento deve possuir ${expectedGroups} grupos neste caso.`);
    if (!N1710_CATEGORIES.has(category)) errors.push("Categoria documental não consta na lista contratual.");
    const installation = groups[hasLanguage ? 2 : 1] || "";
    if (installation !== "5290.00") errors.push("Instalação deve ser 5290.00 para a Refinaria do Nordeste neste contrato.");
    const area = groups[hasLanguage ? 3 : 2] || "";
    if (!/^\d{4,5}$/.test(area)) errors.push("Grupo de área/sistema deve possuir quatro dígitos ou diferenciador mais quatro dígitos.");
    const documentClass = groups[hasLanguage ? 4 : 3] || "";
    if (!/^[A-Z0-9]{3}$/i.test(documentClass)) errors.push("Código do grupo 4 deve possuir três caracteres alfanuméricos.");
    const origin = groups[hasLanguage ? 5 : 4] || "";
    if (norm(origin) !== "C1O") errors.push("Origem documental deve ser C1O para a CONSAG neste contrato.");
    const sequence = groups[hasLanguage ? 6 : 5] || "";
    if (!/^\d{3,4}$/.test(sequence)) errors.push("Sequencial deve possuir três ou quatro dígitos.");
    return { valid: errors.length === 0, family: "N-1710", errors };
  }

  function optionValue(value, options) {
    const wanted = norm(value);
    return options.find((item) => norm(item) === wanted) || "";
  }

  function inferDiscipline(document, record) {
    const direct = optionValue(record && record.discipline, EGRDT_OPTIONS.disciplines);
    if (direct) return direct;
    const source = norm(record && record.discipline);
    const sourceParts = source.split("/").map((part) => part.trim()).filter(Boolean);
    const sourceTail = sourceParts[sourceParts.length - 1] || source;
    const sourcePrefix = sourceParts.length > 1 ? sourceParts[sourceParts.length - 2] : "";
    const officialByPrefix = [...EGRDT_OPTIONS.disciplines]
      .sort((a, b) => norm(b).length - norm(a).length)
      .find((option) => sourcePrefix.includes(norm(option)));
    if (officialByPrefix) return officialByPrefix;
    const officialByTail = [...EGRDT_OPTIONS.disciplines]
      .sort((a, b) => norm(b).length - norm(a).length)
      .find((option) => sourceTail === norm(option) || sourceTail.includes(norm(option)));
    if (officialByTail) return officialByTail;
    const officialInSource = [...EGRDT_OPTIONS.disciplines]
      .sort((a, b) => norm(b).length - norm(a).length)
      .find((option) => norm(option).length >= 5 && source.includes(norm(option)));
    if (officialInSource) return officialInSource;
    const textMap = [
      ["TUBUL", "TUBULAÇÃO"], ["CIVIL", "CIVIL"], ["ELETR", "ELÉTRICA"],
      ["INSTRUMENT", "INSTRUMENTAÇÃO"], ["DINAM", "DINÂMICOS"], ["ESTATIC", "ESTÁTICOS"],
      ["MECAN", "MECÂNICA"], ["QUALIDADE", "QUALIDADE"], ["PLANEJ", "PLANEJAMENTO"],
      ["COMISSION", "COMISSIONAMENTO"], ["SUPRIMENT", "SUPRIMENTOS"],
      ["COORDEN", "COORDENAÇÃO"], ["SEGURAN", "SEGURANÇA"], ["SAUDE", "SAÚDE"],
      ["MEIO AMBIENTE", "MEIO AMBIENTE"], ["ADM CONTRATUAL", "ADM CONTRATUAL"],
      ["COMUNICACAO", "COMUNICAÇÃO E RS"], ["RESPONSABILIDADE SOCIAL", "COMUNICAÇÃO E RS"],
      ["FERRAMENTAS COMPUTACIONAIS", "FERRAMENTAS COMPUTACIONAIS"], ["MONTAGEM", "MONTAGEM"],
      ["TELECOM", "COMUNICAÇÃO E RS"], ["PROJETO", "ENGENHARIA DE PROJETO"], ["GERAL", "GERAL"],
    ];
    const byText = textMap.find(([token]) => source.includes(token));
    if (byText) return byText[1];
    const groups = text(document).split("_");
    const cvCode = text(document).match(/-CV-([A-Z0-9]+)-/i);
    const code = norm(cvCode ? cvCode[1] : groups[4]);
    const codeMap = {
      CVL: "CIVIL", ELE: "ELÉTRICA", INS: "INSTRUMENTAÇÃO", DIN: "DINÂMICOS",
      EST: "ESTÁTICOS", MEC: "MECÂNICA", PLA: "PLANEJAMENTO", QUA: "QUALIDADE",
      SEG: "SEGURANÇA", SUP: "SUPRIMENTOS", TUB: "TUBULAÇÃO", CDR: "COORDENAÇÃO",
      CRS: "COMUNICAÇÃO E RS", ADC: "ADM CONTRATUAL", PRJ: "ENGENHARIA DE PROJETO",
      SMS: "SEGURANÇA", TEL: "COMUNICAÇÃO E RS", GER: "GERAL", MON: "MONTAGEM",
    };
    return codeMap[code] || "";
  }

  function inferDocumentType(document, record, sheetName) {
    const direct = optionValue(record && record.documentType, EGRDT_OPTIONS.documentTypes);
    if (direct) return direct;
    const sheet = norm(sheetName);
    if (sheet === "ET" || text(document).includes("_RNEST_")) return "RL";
    if (sheet === "CV" || text(document).includes("-C1O-CV-")) return "CV";
    const groups = text(document).split("-");
    const category = /^[IAFLED]$/i.test(groups[0]) ? groups[1] : groups[0];
    return optionValue(category, EGRDT_OPTIONS.documentTypes);
  }

  function buildEgrdtData(document, revision, finalName, record, sheetName, pdfFormat) {
    return {
      document: text(document),
      revision: normalizeRevision(revision),
      title: text(record && record.title),
      fileName: text(finalName),
      format: optionValue((record && record.format) || pdfFormat, EGRDT_OPTIONS.formats),
      discipline: inferDiscipline(document, record || {}),
      documentType: inferDocumentType(document, record || {}, sheetName),
      purpose: optionValue(record && record.purpose, EGRDT_OPTIONS.purposes),
      databook: text(record && record.databook),
    };
  }

  function validateEgrdtData(data) {
    const errors = [];
    if (!text(data.document)) errors.push("DOCUMENTO vazio");
    if (!revisionInfo(data.revision).valid) errors.push("REVISÃO inválida");
    if (!text(data.title)) errors.push("TÍTULO vazio");
    if (!text(data.fileName) || !/\.[A-Z0-9]{2,8}$/i.test(text(data.fileName))) errors.push("ARQUIVO sem extensão");
    if (!EGRDT_OPTIONS.formats.includes(text(data.format))) errors.push("FORMATO fora da lista oficial");
    if (!EGRDT_OPTIONS.disciplines.includes(text(data.discipline))) errors.push("DISCIPLINA fora da lista oficial");
    if (!EGRDT_OPTIONS.documentTypes.includes(text(data.documentType))) errors.push("TIPO DE DOCUMENTO fora da lista oficial");
    if (!EGRDT_OPTIONS.purposes.includes(text(data.purpose))) errors.push("PROPÓSITO fora da lista oficial");
    return errors;
  }

  function chooseBestRecord(group, hintedSheet) {
    const hint = norm(hintedSheet);
    let records = group.records || [];
    if (hint) {
      const filtered = records.filter((r) => norm(r.sheet) === hint);
      if (!filtered.length && records.length) {
        return { record: null, ambiguous: false, sheetMismatch: true, candidates: records };
      }
      records = filtered;
    }
    if (!records.length) return { record: null, ambiguous: false, sheetMismatch: false, candidates: [] };
    records = [...records].sort(recordCompare);
    const sheets = [...new Set(records.map((item) => norm(item.sheet)))];
    if (!hint && sheets.length > 1) return { record: null, ambiguous: true, candidates: records };
    if (records.length > 1) {
      const signatures = new Set(records.map((item) => [
        normalizeRevision(item.revision), norm(item.sigemStatus || item.status), text(item.grdt),
        text(item.effectiveDate), text(item.databook), norm(item.title), norm(item.format),
        norm(item.discipline), norm(item.documentType), norm(item.purpose),
        norm(item.allocationStatus), norm(item.fiscalComment),
        norm(item.allocationStage),
      ].join("|")));
      if (signatures.size > 1) return { record: null, ambiguous: true, candidates: records };
    }
    return { record: records[0], ambiguous: false, sheetMismatch: false, candidates: records };
  }

  function statusEvidence(group, revision, hintedSheet) {
    const rev = norm(revision);
    const hint = norm(hintedSheet);
    const all = [...(group.history || []), ...(group.records || [])];
    return all.filter((item) => {
      if (normalizeRevision(item.revision) !== rev) return false;
      if (hint && item.sheet && !norm(item.sheet).includes("SIGEM") && norm(item.sheet) !== hint) return false;
      return true;
    }).map((item) => ({
      status: item.sigemStatus || item.status,
      source: item.source,
      sheet: item.sheet,
      revision: item.revision,
      item,
    })).filter((item) => text(item.status));
  }

  function recordForRevision(group, revision, hintedSheet) {
    const hint = norm(hintedSheet);
    let records = (group.records || []).filter((item) => normalizeRevision(item.revision) === normalizeRevision(revision));
    if (hint) {
      const sameSheet = records.filter((item) => norm(item.sheet) === hint);
      if (sameSheet.length) records = sameSheet;
    }
    return records.length === 1 ? records[0] : null;
  }

  function statusForRevision(group, revision) {
    const rev = normalizeRevision(revision);
    const history = (group.history || [])
      .filter((item) => normalizeRevision(item.revision) === rev)
      .sort((a, b) => (Number(a.row) || 0) - (Number(b.row) || 0));
    if (history.length) {
      const rawStatuses = history.map((item) => text(item.sigemStatus || item.status));
      const statuses = [...new Set(rawStatuses.filter(Boolean).map(norm))];
      if (rawStatuses.some((status) => !status)) {
        return { status: "Status vazio na Colar SIGEM", item: null, source: "SIGEM", conflict: false, incomplete: true, candidates: history };
      }
      if (statuses.length > 1) {
        return { status: "Conflito na Colar SIGEM", item: null, source: "SIGEM", conflict: true, incomplete: false, candidates: history };
      }
      if (!statuses.length) {
        return { status: "Status vazio na Colar SIGEM", item: null, source: "SIGEM", conflict: false, incomplete: true, candidates: history };
      }
      return { status: text(history[0].sigemStatus || history[0].status), item: history[0], source: "SIGEM", conflict: false, incomplete: false };
    }
    return { status: "Não Postado", item: null, source: "ausência de DOCUMENTO-REVISÃO na Colar SIGEM", conflict: false, incomplete: false };
  }

  function proposedFileName(inputName, document, revision) {
    const ext = /\.[^.]+$/.exec(text(inputName));
    const extension = ext ? ext[0].toLowerCase() : ".pdf";
    const originalStem = text(inputName).replace(/\.[^.]+$/, "");
    const revisionPattern = "(?:0|[A-HJ-NP-Z]+)";
    const sequenceExpression = new RegExp(`_0001(?:[_ -](?:REV[_ -]?)?${revisionPattern})?$`, "i");
    const trailingExpression = new RegExp(`[_ -](?:REV(?:ISAO)?[_ -]?)?${revisionPattern}$`, "i");
    const hasSequence = sequenceExpression.test(originalStem);
    const withoutRevision = originalStem.replace(trailingExpression, "");
    let base = hasSequence ? originalStem.replace(sequenceExpression, "_0001") : document;
    if (!hasSequence && key(withoutRevision) === key(document)) base = withoutRevision;
    if (!base) base = originalStem.replace(trailingExpression, "");
    if (inferSheetFromName(`${document}.pdf`) === "N-1710" && !/_0001$/i.test(base)) base = `${document}_0001`;
    const r = normalizeRevision(revision);
    return `${base}${r && r !== "0" ? `_${r}` : ""}${extension}`;
  }

  function validateFinalFileName(fileName, originalName, document, revision) {
    const expected = proposedFileName(originalName || fileName, document, revision);
    const validName = canonicalId(fileName) === canonicalId(expected);
    const normalizedRevision = normalizeRevision(revision);
    const detectedRevision = claimedRevisionFromName(fileName, document);
    const revisionValid = normalizedRevision === "0"
      ? detectedRevision === ""
      : detectedRevision === normalizedRevision;
    return {
      valid: validName && revisionValid,
      expected,
      detectedRevision,
      revision: normalizedRevision,
      errors: [
        ...(validName ? [] : [`Nome final divergente; esperado ${expected}.`]),
        ...(revisionValid ? [] : [`O sufixo do arquivo não representa a revisão ${normalizedRevision}.`]),
      ],
    };
  }

  function reviewResult(input, values) {
    const item = values || {};
    return {
      ...input,
      id: input.id,
      document: item.document || input.document || "Não localizado",
      documentKey: item.documentKey || "",
      sheet: item.sheet || "",
      sheetSource: item.sheetSource || "não identificada",
      revision: normalizeRevision(item.revision),
      revisionSource: item.revisionSource || "não confirmada",
      status: item.status || "Sem correspondência na LD",
      decision: REVIEW,
      reason: item.reason || "A informação precisa de conferência manual.",
      finalName: item.finalName || input.name || "arquivo.pdf",
      grdt: item.grdt || "",
      effectiveDate: item.effectiveDate || "",
      recentEmission: false,
      databook: item.databook || "",
      evidence: item.evidence || [],
      record: item.record || {},
      codeValidation: item.codeValidation || { valid: false, errors: [] },
      egrdt: item.egrdt || {},
      allocationStatus: item.allocationStatus || "",
      fiscalComment: item.fiscalComment || "",
      documentSource: item.documentSource || input.documentSource || "nome do arquivo",
      hardBlock: Boolean(item.hardBlock),
      blockCode: item.blockCode || "",
    };
  }

  function triageOne(input, index, options) {
    const settings = options || {};
    const recentDays = Math.max(1, Number(settings.recentDays) || 30);
    const nowValue = settings.now || new Date();
    const inferredSheet = input.hintedSheet || inferSheetFromName(input.name || input.document || "");
    const identitySource = input.document ? "documento informado" : "nome do arquivo";
    const identityValue = input.document || input.name || "";
    const matches = matchDocuments(identityValue, index);
    if (matches.length > 1) {
      const codes = matches.slice(0, 5).map((candidate) => candidate.document).join("; ");
      return reviewResult(input, {
        document: input.document || "Não localizado",
        sheet: inferredSheet,
        sheetSource: inferredSheet ? "prefixo do arquivo" : "não identificada",
        revision: revisionFromName(input.name || "", input.document || "") || "",
        status: "Código ambíguo no nome",
        reason: `O nome do arquivo contém mais de um código controlado (${codes}). Nenhuma associação automática foi feita.`,
        finalName: input.name || "arquivo.pdf",
        documentSource: identitySource,
      });
    }
    const match = matches[0] || null;
    if (!match) {
      return reviewResult(input, {
        document: input.document || "Não localizado",
        sheet: inferredSheet,
        sheetSource: inferredSheet ? "prefixo do arquivo" : "não identificada",
        revision: revisionFromName(input.name || "", input.document || "") || "",
        status: "Sem correspondência na LD",
        reason: "O nome do arquivo não contém um código controlado encontrado na LD. O texto interno do PDF não é usado para substituir a identidade informada pelo nome.",
        finalName: input.name || "arquivo.pdf",
        documentSource: identitySource,
      });
    }

    const group = match.group;
    const selection = chooseBestRecord(group, inferredSheet);
    if (selection.sheetMismatch) {
      const sheets = [...new Set(selection.candidates.map((item) => item.sheet))].join(", ");
      const blocked = selection.candidates.filter((item) => norm(item.allocationStatus) === "NAO ALOCADO");
      const blockedComments = [...new Set(blocked.map((item) => text(item.fiscalComment)).filter(Boolean))].join(" | ");
      return reviewResult(input, {
        document: match.document,
        documentKey: match.documentKey,
        sheet: inferredSheet,
        sheetSource: "prefixo do arquivo",
        revision: revisionFromName(input.name || "", match.document),
        status: "Aba incompatível",
        reason: blocked.length
          ? `O prefixo indica ${inferredSheet}, mas o código foi localizado somente em ${sheets} e existe registro Não Alocado. A postagem permanece bloqueada até a divergência e a alocação serem resolvidas.${blockedComments ? ` Comentário da Fiscal: ${blockedComments}` : ""}`
          : `O prefixo do arquivo indica a aba ${inferredSheet}, mas o código foi localizado somente em ${sheets}. Nenhuma aba foi escolhida por aproximação.`,
        finalName: input.name || `${match.document}.pdf`,
        documentSource: identitySource,
        allocationStatus: blocked.length ? "NÃO ALOCADO" : "",
        fiscalComment: blockedComments,
        hardBlock: blocked.length > 0,
        blockCode: blocked.length ? "not_allocated_conflict" : "",
      });
    }
    if (selection.ambiguous) {
      const locations = selection.candidates
        .slice(0, 5)
        .map((item) => `${item.source} / ${item.sheet} / linha ${item.row}`)
        .join("; ");
      const blocked = selection.candidates.filter((item) => norm(item.allocationStatus) === "NAO ALOCADO");
      const blockedComments = [...new Set(blocked.map((item) => text(item.fiscalComment)).filter(Boolean))].join(" | ");
      return reviewResult(input, {
        document: match.document,
        documentKey: match.documentKey,
        sheet: inferredSheet,
        sheetSource: inferredSheet ? "prefixo do arquivo" : "LD",
        revision: revisionFromName(input.name || "", match.document),
        status: "Registros conflitantes",
        reason: blocked.length
          ? `Há registros técnicos conflitantes e pelo menos um deles está Não Alocado. A postagem permanece bloqueada até a divergência e a alocação serem resolvidas.${blockedComments ? ` Comentário da Fiscal: ${blockedComments}` : ""} Registros: ${locations}.`
          : `Há mais de um registro técnico incompatível para o documento. Não foi feita escolha automática: ${locations}.`,
        finalName: input.name || `${match.document}.pdf`,
        documentSource: identitySource,
        allocationStatus: blocked.length ? "NÃO ALOCADO" : "",
        fiscalComment: blockedComments,
        hardBlock: blocked.length > 0,
        blockCode: blocked.length ? "not_allocated_conflict" : "",
      });
    }

    const technicalRecord = selection.record;
    const latestHistory = [...(group.history || [])].sort(recordCompare)[0] || null;
    if (!technicalRecord) {
      return reviewResult(input, {
        document: match.document,
        documentKey: match.documentKey,
        sheet: inferredSheet,
        sheetSource: inferredSheet ? "prefixo do arquivo" : "LD",
        revision: revisionFromName(input.name || "", match.document),
        status: "Sem linha técnica na LD",
        reason: "O código foi encontrado apenas no histórico SIGEM e não possui uma linha técnica controlada nas abas ET, N-1710 ou CV. A postagem permanece bloqueada.",
        finalName: input.name || `${match.document}.pdf`,
        documentSource: identitySource,
      });
    }

    const best = technicalRecord;
    const controlledSheet = technicalRecord.sheet;
    const document = technicalRecord.document || match.document;
    const fromFileClaim = claimedRevisionFromName(input.name || "", document);
    const fromPdf = revisionFromText(input.pdfText || "", document);
    const ldRevision = technicalRecord ? normalizeRevision(technicalRecord.revision) : "";
    const latestHistoryRev = latestHistory ? normalizeRevision(latestHistory.revision) : "";
    const controlledRevisions = [
      { value: ldRevision, source: "LD" },
      { value: latestHistoryRev, source: "histórico SIGEM" },
    ].filter((candidate) => revisionInfo(candidate.value).valid)
      .sort((a, b) => revisionRank(b.value) - revisionRank(a.value));
    let revision = controlledRevisions.length ? controlledRevisions[0].value : "";
    let revisionSource = controlledRevisions.length ? controlledRevisions[0].source : "LD";
    const claimedRevision = normalizeRevision(input.revision || fromFileClaim || fromPdf);
    let grdt = text(technicalRecord && technicalRecord.grdt);
    let effectiveDate = text(technicalRecord && technicalRecord.effectiveDate);
    const databook = text(technicalRecord && technicalRecord.databook);
    const allocationStatus = text(technicalRecord && technicalRecord.allocationStatus);
    const fiscalComment = text(technicalRecord && technicalRecord.fiscalComment);
    let evidence = [];
    let decision = REVIEW;
    let reason = "A revisão precisa de conferência manual.";
    let displayStatus = "Sem status";

    if (norm(allocationStatus) === "NAO ALOCADO") {
      const codeValidation = validateDocumentCode(document, controlledSheet);
      const blockedSigem = revision
        ? statusForRevision(group, revision).status
        : text(technicalRecord && (technicalRecord.sigemStatus || technicalRecord.status)) || "Não confirmado";
      const allocationReason = fiscalComment
        ? `A linha está marcada como Não Alocado. A postagem permanece bloqueada até a alocação ser aceita. Comentário da Fiscal: ${fiscalComment}`
        : "A linha está marcada como Não Alocado e ainda não possui comentário da Fiscal. Pode ser um item novo não submetido à alocação; confirme e conclua a alocação antes de postar.";
      return reviewResult(input, {
        document,
        documentKey: match.documentKey,
        sheet: controlledSheet,
        sheetSource: input.hintedSheet ? "lista informada" : inferredSheet ? "prefixo do arquivo" : "LD",
        revision,
        revisionSource,
        status: blockedSigem,
        reason: allocationReason,
        finalName: proposedFileName(input.name || `${document}.pdf`, document, revision),
        grdt,
        effectiveDate,
        databook,
        record: best,
        codeValidation,
        allocationStatus,
        fiscalComment,
        documentSource: identitySource,
        hardBlock: true,
        blockCode: "not_allocated",
      });
    }

    if (fromFileClaim && !revisionInfo(fromFileClaim).valid) {
      return reviewResult(input, {
        document,
        documentKey: match.documentKey,
        sheet: controlledSheet,
        sheetSource: inferredSheet ? "prefixo do arquivo" : "LD",
        revision: fromFileClaim,
        revisionSource: "nome",
        status: "Revisão inválida no nome",
        reason: `O nome do arquivo indica a revisão ${fromFileClaim}, que não atende à sequência válida.`,
        finalName: input.name || `${document}.pdf`,
        grdt,
        effectiveDate,
        databook,
        record: best,
        documentSource: identitySource,
      });
    }

    if (!revision) {
      const codeValidation = validateDocumentCode(document, controlledSheet);
      return reviewResult(input, {
        document,
        documentKey: match.documentKey,
        sheet: controlledSheet,
        sheetSource: input.hintedSheet ? "lista informada" : inferredSheet ? "prefixo do arquivo" : "LD",
        revision: "",
        revisionSource,
        status: "Revisão vazia na LD",
        reason: "A revisão está vazia. Ela não foi convertida automaticamente em 0; confirme a revisão controlada antes da postagem.",
        finalName: input.name || `${document}.pdf`,
        grdt,
        effectiveDate,
        databook,
        record: best,
        codeValidation,
        documentSource: identitySource,
      });
    }

    const revisionValidation = revisionInfo(revision);
    if (!revisionValidation.valid) {
      return reviewResult(input, {
        document,
        documentKey: match.documentKey,
        sheet: controlledSheet,
        sheetSource: input.hintedSheet ? "lista informada" : inferredSheet ? "prefixo do arquivo" : "LD",
        revision,
        revisionSource,
        status: "Revisão inválida",
        reason: "A revisão não atende à sequência válida (0, A…Z sem I/O, AA…).",
        finalName: input.name || `${document}.pdf`,
        grdt,
        effectiveDate,
        databook,
        record: best,
        documentSource: identitySource,
      });
    }

    const traversed = [];
    let completed = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const statusInfo = statusForRevision(group, revision);
      const currentStatus = text(statusInfo.status) || "Não Postado";
      const kind = statusKind(currentStatus);
      const currentRecord = recordForRevision(group, revision, inferredSheet);
      displayStatus = currentStatus;
      evidence = statusEvidence(group, revision, inferredSheet);

      if (statusInfo.conflict) {
        decision = REVIEW;
        reason = `A combinação ${document}-${revision} aparece mais de uma vez na Colar SIGEM com status diferentes. Corrija a fonte controlada antes de decidir.`;
        completed = true;
        break;
      }

      if (statusInfo.incomplete) {
        decision = REVIEW;
        reason = `A combinação ${document}-${revision} existe na Colar SIGEM, mas o Status SIGEM está vazio. A ausência de status não pode ser tratada como Não Postado.`;
        completed = true;
        break;
      }

      if (kind === "not_posted") {
        decision = READY;
        if (traversed.length) {
          const sequence = traversed.map((item) => `${item.revision} (${item.status})`).join(", ");
          reason = `As revisões ${sequence} já têm retorno. A primeira combinação DOCUMENTO-REVISÃO ausente da Colar SIGEM é ${revision}, portanto está Não Postado.`;
          revisionSource = "histórico SIGEM";
        } else {
          reason = `A combinação ${document}-${revision} não existe na Colar SIGEM; o status calculado é Não Postado e pode seguir para postagem.`;
        }
        completed = true;
        break;
      }

      if (kind === "analysis") {
        const analysisRecord = currentRecord;
        const analysisGrdt = text(analysisRecord && analysisRecord.grdt);
        const analysisDate = text(analysisRecord && analysisRecord.effectiveDate);
        grdt = analysisGrdt;
        effectiveDate = analysisDate;
        const parsedAnalysisDate = parseDate(analysisDate);
        if (analysisGrdt && parsedAnalysisDate && isRecentDate(analysisDate, recentDays, nowValue)) {
          decision = DISCARD;
          reason = `A revisão ${revision} está Em Análise e a mesma linha controlada possui ${analysisGrdt}, com emissão recente em ${analysisDate}; desconsiderar.`;
        } else if (!analysisRecord) {
          decision = REVIEW;
          reason = `A revisão ${revision} está Em Análise no SIGEM, mas não existe uma única linha técnica da mesma revisão para comprovar GRDT e data.`;
        } else if (!analysisGrdt) {
          decision = REVIEW;
          reason = `A revisão ${revision} está Em Análise, porém a GRDT da mesma linha está vazia; não é seguro desconsiderar.`;
        } else if (!analysisDate) {
          decision = REVIEW;
          reason = `A revisão ${revision} está Em Análise e possui ${analysisGrdt}, mas a Data Efetiva de Emissão da mesma linha está vazia.`;
        } else if (!parsedAnalysisDate) {
          decision = REVIEW;
          reason = `A revisão ${revision} está Em Análise e possui ${analysisGrdt}, mas a Data Efetiva de Emissão “${analysisDate}” é inválida.`;
        } else {
          decision = REVIEW;
          reason = `A revisão ${revision} está Em Análise, mas a emissão de ${analysisDate} está fora da janela configurada de ${recentDays} dias.`;
        }
        completed = true;
        break;
      }

      if (kind === "advance") {
        traversed.push({ revision, status: currentStatus });
        const following = nextRevision(revision);
        if (!following) {
          decision = REVIEW;
          reason = `A revisão ${revision} é de campo ou inválida para avanço automático; aplique o procedimento específico antes de gerar a próxima revisão.`;
          completed = true;
          break;
        }
        revision = following;
        revisionSource = "histórico SIGEM";
        continue;
      }

      decision = REVIEW;
      reason = `O status oficial “${currentStatus}” da revisão ${revision} não autoriza avanço automático neste fluxo. Somente Com Comentários, Sem Comentários, Aceito Sem Comentários e Recusado avançam automaticamente.`;
      completed = true;
      break;
    }

    if (!completed) {
      decision = REVIEW;
      reason = "Não foi possível localizar uma revisão Não Postado após 100 incrementos; verifique o histórico do documento.";
    }

    const recentEmission = Boolean(grdt) && isRecentDate(effectiveDate, recentDays, nowValue);
    const codeValidation = validateDocumentCode(document, controlledSheet);
    if (!codeValidation.valid && decision === READY) {
      decision = REVIEW;
      reason = `O status permitiria postagem, mas o código documental não passou na validação: ${codeValidation.errors.join(" ")}`;
    }
    const finalName = proposedFileName(input.name || `${document}.pdf`, document, revision);
    const egrdt = buildEgrdtData(document, revision, finalName, best, controlledSheet, input.pdfFormat);

    return {
      ...input,
      id: input.id,
      document,
      documentKey: match.documentKey,
      sheet: controlledSheet,
      sheetSource: input.hintedSheet ? "lista informada" : inferredSheet ? "prefixo do arquivo" : "LD",
      revision,
      revisionSource,
      status: displayStatus || "Sem status",
      decision,
      reason,
      finalName,
      grdt,
      effectiveDate,
      recentEmission,
      recentDays,
      databook,
      allocationStatus,
      fiscalComment,
      evidence,
      record: best,
      codeValidation,
      egrdt,
      claimedRevision,
      documentSource: identitySource,
    };
  }

  function simpleReason(row) {
    const item = row || {};
    const status = norm(item.status);
    const original = text(item.reason);
    const reason = norm(original);
    const revision = text(item.revision) || "informada";
    const fiscalComment = text(item.fiscalComment);
    const fiscalSuffix = fiscalComment ? ` Comentário da Fiscal: ${fiscalComment}` : "";

    if (item.hardBlock || norm(item.allocationStatus) === "NAO ALOCADO") {
      if (item.blockCode === "not_allocated_conflict") {
        return `Não Alocado e com informações conflitantes na LD. Corrija a alocação e confirme a linha correta antes de postar.${fiscalSuffix}`;
      }
      return fiscalComment
        ? `Não Alocado. Resolva o comentário da Fiscal antes de postar.${fiscalSuffix}`
        : "Não Alocado. Conclua a alocação antes de postar.";
    }

    if (item.decision === READY) {
      if (status === "NAO POSTADO") {
        return reason.includes("AS REVISOES")
          ? `Revisão ${revision} liberada. É a primeira Não Postado.`
          : `Revisão ${revision} está Não Postado e pode seguir para envio.`;
      }
      return `Revisão ${revision} liberada para envio.`;
    }

    if (item.decision === DISCARD) {
      return `Revisão ${revision} já está Em Análise com GRDT recente. Desconsiderar.`;
    }

    const exactStatuses = {
      "CODIGO AMBIGUO NO NOME": "O nome informado contém mais de um código da LD. Confirme qual é o documento correto.",
      "SEM CORRESPONDENCIA NA LD": "Documento não encontrado na LD.",
      "ABA INCOMPATIVEL": "O documento foi encontrado em uma aba diferente da indicada pelo nome. Confirme a aba correta.",
      "REGISTROS CONFLITANTES": "A LD possui mais de uma linha diferente para este documento. Confirme qual linha está correta.",
      "SEM LINHA TECNICA NA LD": "Documento encontrado no histórico SIGEM, mas não encontrado nas abas técnicas da LD.",
      "REVISAO INVALIDA NO NOME": "A revisão informada no nome do arquivo é inválida. Corrija ou confirme a revisão.",
      "REVISAO VAZIA NA LD": "A revisão está vazia na LD. Preencha ou confirme antes de postar.",
      "REVISAO INVALIDA": "A revisão da LD é inválida. Confirme a sequência correta antes de postar.",
      "STATUS VAZIO NA COLAR SIGEM": `A revisão ${revision} está no SIGEM, mas o status está vazio. Preencha ou confirme o status.`,
      "CONFLITO NA COLAR SIGEM": `A revisão ${revision} possui status diferentes no SIGEM. Corrija o conflito antes de postar.`,
      "REVISOES DIVERGENTES NO PACOTE": "Os arquivos do mesmo documento indicam revisões diferentes. Confirme qual revisão está correta.",
      "PACOTE INCONSISTENTE": "Os arquivos do mesmo documento geraram resultados diferentes. Confira os arquivos selecionados.",
      "PDF NAO LOCALIZADO": "O PDF físico não foi encontrado. Inclua o arquivo antes de gerar o pacote físico.",
      "PDF NAO VALIDADO": "O PDF não pôde ser aberto e validado. Substitua ou confira o arquivo.",
      "ARQUIVO VAZIO": "O arquivo está vazio. Substitua pelo documento correto.",
      "PDF INVALIDO": "O arquivo não é um PDF válido ou não pôde ser aberto.",
    };
    if (exactStatuses[status]) return exactStatuses[status];

    if (status === "EM ANALISE") {
      if (reason.includes("NAO EXISTE UMA UNICA LINHA TECNICA")) {
        return `Revisão ${revision} está Em Análise, mas não foi encontrada uma linha correspondente na LD.`;
      }
      if (reason.includes("GRDT") && reason.includes("VAZIA")) {
        return `Revisão ${revision} está Em Análise, mas a GRDT está vazia.`;
      }
      if (reason.includes("DATA EFETIVA") && reason.includes("VAZIA")) {
        return `Revisão ${revision} está Em Análise, mas a Data Efetiva de Emissão está vazia.`;
      }
      if (reason.includes("DATA EFETIVA") && reason.includes("INVALIDA")) {
        return `Revisão ${revision} está Em Análise, mas a Data Efetiva de Emissão é inválida.`;
      }
      if (reason.includes("FORA DA JANELA")) {
        return `Revisão ${revision} está Em Análise, mas a emissão não é recente. Confirme antes de desconsiderar.`;
      }
      return `Revisão ${revision} está Em Análise. Confira a GRDT e a data de emissão.`;
    }

    if (reason.includes("STATUS OFICIAL")) {
      return `O status “${text(item.status) || "não informado"}” não possui decisão automática. Confirme antes de postar.`;
    }
    if (reason.includes("DE CAMPO") || reason.includes("INVALIDA PARA AVANCO")) {
      return `A revisão ${revision} exige conferência manual antes de avançar.`;
    }
    if (reason.includes("APOS 100 INCREMENTOS")) {
      return "O histórico possui revisões demais para uma decisão automática. Confira o documento no SIGEM.";
    }
    if (reason.includes("CODIGO DOCUMENTAL NAO PASSOU")) {
      return `O código do documento não é válido para a aba ${text(item.sheet) || "informada"}. Confirme a codificação.`;
    }
    return "Não foi possível decidir automaticamente. Confira os dados do documento na LD e no SIGEM.";
  }

  function resultCounts(results) {
    return results.reduce((acc, row) => {
      acc.total += 1;
      if (row.hardBlock) acc.bloqueado += 1;
      else acc[row.decision] += 1;
      return acc;
    }, { total: 0, pronto: 0, bloqueado: 0, descartar: 0, revisar: 0 });
  }

  return {
    READY,
    DISCARD,
    REVIEW,
    normalizeRecordContract: Contracts ? Contracts.normalizeRecord : (value) => value,
    norm,
    canonicalId,
    key,
    looseKey,
    statusKind,
    normalizeRevision,
    revisionInfo,
    revisionRank,
    nextRevision,
    compactTimestamp,
    parseDate,
    isRecentDate,
    parseWorkbook,
    buildIndex,
    matchDocument,
    matchDocuments,
    inferSheetFromName,
    controlArtifactKind,
    revisionFromName,
    claimedRevisionFromName,
    revisionFromText,
    validateDocumentCode,
    proposedFileName,
    validateFinalFileName,
    EGRDT_OPTIONS,
    buildEgrdtData,
    validateEgrdtData,
    triageOne,
    simpleReason,
    resultCounts,
  };
});
