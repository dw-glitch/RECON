(function (root, factory) {
  const core = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const conflicts = root.LDConflictCore || (typeof module === "object" && module.exports ? require("./ld_conflicts.js") : null);
  const confirmations = root.RECONAllocationConfirmations || (typeof module === "object" && module.exports ? require("./allocation_confirmation_sources.js") : null);
  const api = factory(core, conflicts, confirmations);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AllocationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, F, P) {
  "use strict";

  const READY = "pronto";
  const REVIEW = "revisar";
  const SKIP = "desconsiderar";

  const ALLOCATION_HEADERS = Object.freeze([
    "NomeDocumento",
    "Data Prevista",
    "Workflow",
    "Documento Ativo",
    "Ação",
    "Data da Linha Base",
    "Propósito de Emissão Original",
    "Documento Crítico",
    "Observação",
    "Caminho Data Book",
    "N1",
    "N2",
    "N3",
    "N4",
    "N5",
    "N6",
  ]);

  const CONTROL_HEADERS = Object.freeze([
    "ABA",
    "VERSÃO \nDA LD",
    "DATA DO ENVIO\n DA ALOC",
    "Retorno da Fiscal 01\n (Renata)",
    "Resposta da Fiscal 01\n (Renata)",
    "Retorno da Fiscal 02\n (Nani)",
    "STATUS DA ALOCAÇÃO",
    "ALOCAÇÃO",
    "FAROL",
    ...ALLOCATION_HEADERS,
    "N7",
    "N8",
    "N9",
    "N10",
  ]);

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
    return C && C.key ? C.key(value) : norm(value).replace(/\s*([_.-])\s*/g, "$1");
  }

  function looseKey(value) {
    return C && C.looseKey ? C.looseKey(value) : norm(value).replace(/[^A-Z0-9]/g, "");
  }

  const TITLE_STOP_WORDS = new Set([
    "A", "AS", "AO", "AOS", "COM", "DA", "DAS", "DE", "DO", "DOS", "E", "EM", "NA", "NAS", "NO", "NOS",
    "O", "OS", "PARA", "POR", "UM", "UMA", "MCM", "UHDT", "UHDTD", "U32", "C1O", "C",
  ]);

  function pathKey(value) {
    return norm(value)
      .replace(/EDECUCAO/g, "EXECUCAO")
      .replace(/INTRUMENT/g, "INSTRUMENT")
      .replace(/\s*\|\s*/g, "|");
  }

  function completeDatabook(value) {
    const raw = text(value);
    return raw && raw.split("|").filter((part) => part.trim()).length >= 3;
  }

  function documentFamily(value) {
    const document = text(value);
    let match = document.match(/^(?:[IAFLED]-)?([A-Z]{2,4})-5290\.00-[0-9]{5}-([A-Z0-9]{3})-[A-Z0-9]{3}-/i);
    if (match) return { key: `${norm(match[1])}|${norm(match[2])}`, label: norm(match[2]), type: norm(match[1]) };
    match = document.match(/-C1O-CV-([A-Z0-9]+)-/i);
    if (match) return { key: `CV|${norm(match[1])}`, label: norm(match[1]), type: "CV" };
    const groups = document.split("_");
    if (groups.length >= 7 && norm(groups[1]) === "RNEST") {
      return { key: `ET|${norm(groups[3])}|${norm(groups[4])}|${norm(groups[5])}`, label: `${groups[4]} ${groups[5]}`, type: "ET" };
    }
    return { key: "", label: "", type: "" };
  }

  function normalizeEap(value) {
    const match = text(value).match(/(\d+(?:\.\d+){3})/);
    if (!match) return "";
    return match[1].split(".").map((part) => String(Number(part))).join(".");
  }

  function documentEap(value) {
    const token = text(value).split("_").find((part) => /^\d+(?:\.\d+){3}$/.test(part.trim()));
    return normalizeEap(token);
  }

  function recordEap(record) {
    return normalizeEap(recordValue(record, ["EAP", "CÓDIGO EAP", "CODIGO EAP"])) || documentEap(record && record.document);
  }

  function levelKey(levels) {
    return Array.from({ length: 10 }, (_, index) => norm((levels || [])[index])).join("|");
  }

  function addLevelsVote(votes, keyValue, levels) {
    const voteKey = text(keyValue);
    const normalizedLevels = Array.from({ length: 10 }, (_, index) => text((levels || [])[index]));
    if (!voteKey || !normalizedLevels.some(Boolean)) return;
    if (!votes.has(voteKey)) votes.set(voteKey, new Map());
    const bucket = votes.get(voteKey);
    const signature = levelKey(normalizedLevels);
    if (!bucket.has(signature)) bucket.set(signature, { levels: normalizedLevels, count: 0 });
    bucket.get(signature).count += 1;
  }

  function mostVotedLevels(bucket) {
    if (!bucket || !bucket.size) return [];
    return [...bucket.values()].sort((left, right) => right.count - left.count)[0].levels.slice();
  }

  function leadingNumericCode(value) {
    const match = text(value).match(/^(\d+(?:\.\d+)*)/);
    if (!match) return "";
    return match[1].split(".").map((part) => String(Number(part))).join(".");
  }

  function parseProjectLevelBase(workbook, XLSX) {
    const sheet = findSheet(workbook, "Base - Caminho das Pastas");
    const rows = rowsFromSheet(sheet, XLSX);
    let headerIndex = -1;
    let map = null;
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
      const candidate = headerMap(rows[index]);
      if (candidate.has("NIVEL 1") || candidate.has("NÍVEL 1")) {
        headerIndex = index;
        map = candidate;
        break;
      }
    }
    if (headerIndex < 0 || !map) return [];
    const entries = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const levels = Array.from({ length: 10 }, (_, levelIndex) => text(rowValue(row, map, [`Nivel ${levelIndex + 1}`, `Nível ${levelIndex + 1}`])));
      if (!levels.some(Boolean)) continue;
      const numericCodes = levels.map(leadingNumericCode).filter(Boolean);
      if (!numericCodes.length) continue;
      const code = numericCodes.sort((left, right) => right.split(".").length - left.split(".").length)[0];
      entries.push({ code, levels, rowNumber: index + 1 });
    }
    return entries;
  }

  function commonLevels(rows) {
    if (!rows || !rows.length) return [];
    return Array.from({ length: 10 }, (_, index) => {
      const values = rows.map((row) => text((row.levels || [])[index]));
      const first = values[0];
      return first && values.every((value) => norm(value) === norm(first)) ? first : "";
    });
  }

  function levelsFromEapBase(entries, eapValue) {
    const eap = normalizeEap(eapValue);
    if (!eap) return [];
    const candidates = (entries || []).filter((entry) => eap === entry.code || eap.startsWith(`${entry.code}.`));
    if (!candidates.length) return [];
    const deepest = Math.max(...candidates.map((entry) => entry.code.split(".").length));
    const best = candidates.filter((entry) => entry.code.split(".").length === deepest);
    return best.length === 1 ? best[0].levels.slice() : commonLevels(best);
  }

  function levelsForEap(control, record) {
    const eap = recordEap(record);
    if (!eap || !control) return [];
    const exact = control.levelsByEap && control.levelsByEap.get(eap);
    if (exact && exact.some(Boolean)) return exact.slice();
    return levelsFromEapBase(control.projectLevelBase || [], eap);
  }

  function documentSequence(value) {
    const document = text(value).replace(/\.[A-Z0-9]+$/i, "");
    const match = document.match(/(?:-|_)(\d{1,6})$/);
    return match ? Number(match[1]) : null;
  }

  function titleKind(value) {
    const title = norm(value);
    const rules = [
      ["CURRICULO", /\bCURRICULO\b/],
      ["IEIS", /\bIEIS\b|INSTRUCAO DE EXECUCAO E INSPECAO DE SOLDAGEM/],
      ["EPS", /\bEPS\b|ESPECIFICACAO DE PROCEDIMENTO DE SOLDAGEM/],
      ["RQPS", /\bRQPS\b|QUALIFICACAO DE PROCEDIMENTO DE SOLDAGEM/],
      ["RQS", /\bRQS\b|QUALIFICACAO DE SOLDADOR/],
      ["RSQ", /\bRSQ\b|RELACAO DE SOLDADORES QUALIFICADOS/],
      ["RIR", /\bRIR\b|INSPECAO DE RECEBIMENTO/],
      ["RNC", /\bRNC\b|RELATORIO DE NAO CONFORMIDADE/],
      ["DATA BOOK", /\bDATA BOOK\b/],
      ["PLANO", /\bPLANO\b/],
      ["PROCEDIMENTO", /\bPROCEDIMENTO\b/],
      ["RELATORIO", /\bRELATORIO\b/],
      ["CERTIFICADO", /\bCERTIFICACAO\b|\bCERTIFICADO\b/],
    ];
    const found = rules.find(([, pattern]) => pattern.test(title));
    return found ? found[0] : "";
  }

  function titleTokens(value) {
    return new Set(norm(value).split(/[^A-Z0-9]+/).filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token)));
  }

  function titleSimilarity(left, right) {
    const a = titleTokens(left);
    const b = titleTokens(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    a.forEach((token) => { if (b.has(token)) intersection += 1; });
    return intersection / Math.max(a.size, b.size);
  }

  function subjectTags(document, title, databook) {
    const rawDocument = norm(document);
    const searchable = norm(`${title || ""} ${databook || ""}`).replace(/[^A-Z0-9]+/g, " ");
    const tags = new Set();
    const has = (pattern) => pattern.test(searchable);
    if (has(/\bMOTORES?\b/)) tags.add("MOTOR");
    if (has(/\bCABOS?\b|\bBOBINA\b/)) tags.add("CABO");
    if (has(/\bTRANSFORMADOR(?:ES)?\b/)) tags.add("TRANSFORMADOR");
    if (has(/\bCAIXA(?:S)?\b|\bBORNE\b/)) tags.add("CAIXA");
    if (has(/\bINFRAESTRUTURA\b|\bELETRODUTO\b|\bLEITO\b|\bBANDEJA\b/)) tags.add("INFRAESTRUTURA");
    if (has(/\bPAINEL(?:ES|S)?\b/)) tags.add("PAINEL");
    if (has(/\bVASOS?\b|\bTANQUES?\b/)) tags.add("VASO_TANQUE");
    if (has(/\bFORNOS?\b|\bQUEIMADORES?\b/)) tags.add("FORNO_QUEIMADOR");
    if (has(/\bTURBINAS?\b/)) tags.add("TURBINA");
    if (has(/\bESTRUTURA METALICA\b/)) tags.add("ESTRUTURA_METALICA");
    if (has(/\bACABAMENTO\b/)) tags.add("ACABAMENTO");
    if ((has(/\bINSTRUMENTACAO\b/) && !tags.has("INFRAESTRUTURA") && !tags.has("CABO"))
      && !tags.size) tags.add("INSTRUMENTO");
    if (tags.size) return tags;
    if (/_M-/.test(rawDocument)) tags.add("MOTOR");
    if (/_BOBINA|_NT-C-/.test(rawDocument)) tags.add("CABO");
    if (/_(?:TLE|TF)-/.test(rawDocument)) tags.add("TRANSFORMADOR");
    if (/_(?:CBT|CJA|CJV)-/.test(rawDocument)) tags.add("CAIXA");
    if (/_NT-(?:LBR|ETR)-/.test(rawDocument)) tags.add("INFRAESTRUTURA");
    if (/_PN-/.test(rawDocument)) tags.add("PAINEL");
    if (/_V-/.test(rawDocument)) tags.add("VASO_TANQUE");
    if (/_(?:F-|Q-F-)/.test(rawDocument)) tags.add("FORNO_QUEIMADOR");
    if (/_TB-/.test(rawDocument)) tags.add("TURBINA");
    if (/_NT-EMT-/.test(rawDocument)) tags.add("ESTRUTURA_METALICA");
    if (/_NT-LAC_/.test(rawDocument)) tags.add("ACABAMENTO");
    if (/_(?:PI|CJP|CJF|CJD)-/.test(rawDocument)) tags.add("INSTRUMENTO");
    return tags;
  }

  function setsIntersect(left, right) {
    for (const value of left) if (right.has(value)) return true;
    return false;
  }

  function recordValue(record, aliases) {
    const columns = record && record.ldColumns || [];
    for (const alias of aliases) {
      const entry = columns.find((column) => norm(column.header) === norm(alias));
      if (entry && text(entry.value)) return text(entry.value);
    }
    return "";
  }

  function hasAllocationStatusColumn(record) {
    return (record && record.ldColumns || []).some((column) => {
      const header = norm(column.header);
      return header.includes("CONFIRMACAO") && header.includes("DOCUMENTOS PREVISTOS");
    });
  }

  function versionParts(value) {
    const raw = text(value).toUpperCase().replace(/\s+/g, "");
    const match = raw.match(/^([A-Z]+)(\d*)$/);
    if (!match) return null;
    return { raw, prefix: match[1], sequence: match[2] ? Number(match[2]) : 0 };
  }

  function newestLdVersion() {
    return [...arguments].map(versionParts).filter(Boolean).sort((left, right) => {
      const prefix = left.prefix.localeCompare(right.prefix, "pt-BR");
      return prefix || left.sequence - right.sequence;
    }).at(-1)?.raw || "";
  }

  function recordVersion(record, fallbackVersion) {
    const direct = recordValue(record, ["VERSÃO DA LD ENVIADA"]);
    if (direct) return direct;
    return newestLdVersion(record && record.ldVersion, fallbackVersion);
  }

  function rowValue(row, headerMap, aliases) {
    for (const alias of aliases) {
      const index = headerMap.get(norm(alias));
      if (index !== undefined) return row[index];
    }
    return "";
  }

  function findSheet(workbook, wanted) {
    const name = (workbook.SheetNames || []).find((sheetName) => norm(sheetName) === norm(wanted));
    return name ? workbook.Sheets[name] : null;
  }

  function rowsFromSheet(sheet, XLSX) {
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  }

  function findHeaderIndex(rows, required) {
    const wanted = norm(required);
    const limit = Math.min(rows.length, 40);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      if ((rows[rowIndex] || []).some((value) => norm(value) === wanted)) return rowIndex;
    }
    return -1;
  }

  function headerMap(row) {
    const result = new Map();
    (row || []).forEach((value, index) => {
      const name = norm(value);
      if (name && !result.has(name)) result.set(name, index);
    });
    return result;
  }

  function splitBaseLevels(value) {
    const parts = text(value).split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length && norm(parts[0]).includes("IMPLANTACAO DO PROJETO")) parts.shift();
    return Array.from({ length: 10 }, (_, index) => parts[index] || "");
  }

  function controlRowObject(row, map, rowNumber) {
    const output = {};
    CONTROL_HEADERS.forEach((header) => {
      output[header] = rowValue(row, map, [header]);
    });
    output.rowNumber = rowNumber;
    output.document = text(rowValue(row, map, ["NomeDocumento"]));
    output.documentKey = key(output.document);
    output.documentLooseKey = looseKey(output.document);
    output.allocation = text(rowValue(row, map, ["ALOCAÇÃO"]));
    output.status = text(rowValue(row, map, ["STATUS DA ALOCAÇÃO"]));
    output.workflow = text(rowValue(row, map, ["Workflow"]));
    output.databook = text(rowValue(row, map, ["Caminho Data Book"]));
    output.ldVersion = text(rowValue(row, map, ["VERSÃO \nDA LD", "VERSÃO DA LD"]));
    output.fiscalComment = text(rowValue(row, map, ["Resposta da Fiscal 01\n (Renata)", "Resposta da Fiscal 01", "COMENTÁRIO DA FISCAL", "COMENTARIO DA FISCAL", "OBSERVAÇÃO", "OBSERVACAO"]));
    output.returnDate = text(rowValue(row, map, ["Retorno da Fiscal 01\n (Renata)", "Retorno da Fiscal 01", "DATA DE RETORNO"]));
    output.levels = Array.from({ length: 10 }, (_, index) => text(rowValue(row, map, [`N${index + 1}`])));
    return output;
  }

  function parseControlWorkbook(workbook, XLSX) {
    const centralSheet = findSheet(workbook, "Central de alocação");
    if (!centralSheet) throw new Error("A aba Central de alocação não foi encontrada no controle.");
    const rows = rowsFromSheet(centralSheet, XLSX);
    const headerIndex = findHeaderIndex(rows, "NomeDocumento");
    if (headerIndex < 0) throw new Error("A coluna NomeDocumento não foi encontrada na Central de alocação.");
    const map = headerMap(rows[headerIndex]);
    const required = ["ABA", "ALOCAÇÃO", "NomeDocumento", "Data Prevista", "Workflow", "Ação", "Propósito de Emissão Original", "Caminho Data Book", "N1"];
    const missing = required.filter((header) => !map.has(norm(header)));
    if (missing.length) throw new Error(`O controle está sem as colunas: ${missing.join(", ")}.`);

    const controlRows = [];
    const latestByDocument = new Map();
    const levelsByDatabookVotes = new Map();
    const eapLevelVotes = new Map();
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const item = controlRowObject(rows[index] || [], map, index + 1);
      if (!item.document) continue;
      controlRows.push(item);
      latestByDocument.set(item.documentKey, item);
      if (item.documentLooseKey) latestByDocument.set(item.documentLooseKey, item);
      if (item.databook && item.levels.some(Boolean)) addLevelsVote(levelsByDatabookVotes, norm(item.databook), item.levels);
      const eap = documentEap(item.document);
      if (eap && item.levels.some(Boolean)) addLevelsVote(eapLevelVotes, eap, item.levels);
    }

    const levelsByDatabook = new Map([...levelsByDatabookVotes.entries()].map(([path, votes]) => [path, mostVotedLevels(votes)]));
    const levelsByEap = new Map([...eapLevelVotes.entries()].map(([eap, votes]) => [eap, mostVotedLevels(votes)]));
    const projectLevelBase = parseProjectLevelBase(workbook, XLSX);

    const baseDocuments = new Map();
    const baseSheet = findSheet(workbook, "Base - Doc previsto no projeto");
    rowsFromSheet(baseSheet, XLSX).forEach((row) => {
      const document = text(row[0]);
      if (!document || norm(document) === "DOCUMENTO") return;
      const baseItem = {
        document,
        flag: text(row[2]),
        path: text(row[3]),
        levels: splitBaseLevels(row[3]),
      };
      baseDocuments.set(key(document), baseItem);
      baseDocuments.set(looseKey(document), baseItem);
    });

    return {
      headerIndex,
      headers: (rows[headerIndex] || []).map(text),
      rows: controlRows,
      latestByDocument,
      levelsByDatabook,
      levelsByEap,
      projectLevelBase,
      baseDocuments,
      latestLdVersion: newestLdVersion(...controlRows.map((row) => row.ldVersion)),
    };
  }

  function parseDatabookWorkbook(workbook, XLSX) {
    const sheet = findSheet(workbook, "CAMINHO DB_SIGEM");
    if (!sheet) return { entries: [], sourceSheet: "" };
    const rows = rowsFromSheet(sheet, XLSX);
    const entries = [];
    let current = null;
    rows.forEach((row, rowIndex) => {
      const pathColumn = (row || []).findIndex((cell) => completeDatabook(cell) && !norm(cell).startsWith("NOME UNIDADE|"));
      const databook = pathColumn >= 0 ? text(row[pathColumn]) : "";
      let description = "";
      if (pathColumn >= 0) {
        for (let column = pathColumn - 1; column >= 0; column -= 1) {
          const candidate = text(row[column]);
          if (!candidate || /^\d+(?:[.,]\d+)*$/.test(candidate) || norm(candidate) === "I" || /^REV\./i.test(candidate)) continue;
          description = candidate;
          break;
        }
      } else {
        description = (row || []).map(text).find((cell) => /DOCUMENTOS?:/i.test(cell) || /^\*/.test(cell)) || "";
      }
      if (completeDatabook(databook) && !norm(databook).startsWith("NOME UNIDADE|")) {
        current = { description, databook, notes: "", rowNumber: rowIndex + 1, sourceSheet: "CAMINHO DB_SIGEM" };
        entries.push(current);
      } else if (current && description && (/DOCUMENTOS?:/i.test(description) || /^\*/.test(description.trim()))) {
        current.notes = [current.notes, description].filter(Boolean).join("\n");
      }
    });
    return { entries, sourceSheet: "CAMINHO DB_SIGEM" };
  }

  function parseHistoricalAllocationWorkbook(workbook, XLSX, sourceName) {
    const rows = [];
    const allocationFromName = text(sourceName).match(/C1O-ALOC-CM-\d{4}-\d{4}/i);
    (workbook.SheetNames || []).forEach((sheetName) => {
      const values = rowsFromSheet(workbook.Sheets[sheetName], XLSX);
      let headerIndex = -1;
      let map = null;
      for (let index = 0; index < Math.min(values.length, 45); index += 1) {
        const candidate = headerMap(values[index]);
        if (candidate.has("NOMEDOCUMENTO") || candidate.has("DOCUMENTO")) {
          headerIndex = index;
          map = candidate;
          break;
        }
      }
      if (headerIndex < 0 || !map) return;
      for (let index = headerIndex + 1; index < values.length; index += 1) {
        const row = values[index] || [];
        const document = text(rowValue(row, map, ["NomeDocumento", "DOCUMENTO"]));
        if (!document || norm(document) === "FIM") continue;
        const item = {};
        ALLOCATION_HEADERS.forEach((header) => { item[header] = rowValue(row, map, [header]); });
        const levels = Array.from({ length: 10 }, (_, levelIndex) => text(rowValue(row, map, [`N${levelIndex + 1}`])));
        Object.assign(item, {
          document,
          documentKey: key(document),
          allocation: text(rowValue(row, map, ["ALOCAÇÃO"])) || (allocationFromName ? allocationFromName[0].toUpperCase() : ""),
          status: text(rowValue(row, map, ["STATUS DA ALOCAÇÃO"])),
          fiscalComment: text(rowValue(row, map, ["Resposta da Fiscal 01", "COMENTÁRIO DA FISCAL", "COMENTARIO DA FISCAL", "OBSERVAÇÃO", "OBSERVACAO"])),
          returnDate: text(rowValue(row, map, ["Retorno da Fiscal 01", "DATA DE RETORNO"])),
          workflow: text(rowValue(row, map, ["Workflow"])),
          databook: text(rowValue(row, map, ["Caminho Data Book", "CAMINHO DATABOOK"])),
          levels,
          rowNumber: index + 1,
          source: text(sourceName),
          sourceSheet: sheetName,
        });
        rows.push(item);
      }
    });
    return { rows };
  }

  function parseAllocationCode(value) {
    const match = text(value).match(/^C1O-ALOC-CM-(\d{4})-(\d{4})$/i);
    if (!match) return null;
    return { code: `C1O-ALOC-CM-${match[1]}-${match[2]}`, sequence: Number(match[1]), year: Number(match[2]) };
  }

  function suggestAllocationCode(control, yearValue) {
    const year = Number(yearValue) || new Date().getFullYear();
    let latest = 0;
    (control && control.rows || []).forEach((row) => {
      const parsed = parseAllocationCode(row.allocation);
      if (parsed && parsed.year === year) latest = Math.max(latest, parsed.sequence);
    });
    return `C1O-ALOC-CM-${String(latest + 1).padStart(4, "0")}-${year}`;
  }

  function parseRelationWorkbook(workbook, XLSX) {
    const entries = [];
    const ignored = [];
    (workbook.SheetNames || []).forEach((sheetName) => {
      const rows = rowsFromSheet(workbook.Sheets[sheetName], XLSX);
      let headerIndex = -1;
      let columns = [];
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 35); rowIndex += 1) {
        const matches = (rows[rowIndex] || []).map(norm).map((header, index) => ({ header, index })).filter(({ header }) => (
          header === "DOCUMENTO" || header === "NOMEDOCUMENTO" || header === "CODIGO" || header === "CODIGO DO DOCUMENTO"
          || header === "ARQUIVO" || header === "PDF" || header === "NOME DO ARQUIVO" || header === "NOME DO PDF"
        ));
        if (matches.length) {
          headerIndex = rowIndex;
          columns = matches.map((item) => item.index);
          break;
        }
      }
      if (headerIndex < 0) return;
      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        columns.forEach((columnIndex) => {
          const raw = text((rows[rowIndex] || [])[columnIndex]);
          if (!raw || norm(raw) === "FIM") return;
          entries.push({ raw, sheetName, rowNumber: rowIndex + 1, hintedSheet: "" });
        });
      }
    });
    if (!entries.length) ignored.push("Nenhuma coluna de documento foi localizada na relação Excel.");
    return { entries, ignored };
  }

  function parseTextRelation(value) {
    const entries = [];
    const ignored = [];
    text(value).split(/\r?\n/).forEach((line, index) => {
      const raw = line.trim().replace(/^[\s\t;|,]+|[\s\t;|,]+$/g, "");
      if (!raw) return;
      if (norm(raw) === "FIM") return;
      entries.push({ raw, sheetName: "Entrada por texto", rowNumber: index + 1, hintedSheet: "" });
    });
    if (!entries.length) ignored.push("A entrada por texto está vazia.");
    return { entries, ignored };
  }

  function ldSignature(record) {
    return [
      record.sheet,
      recordVersion(record),
      recordValue(record, ["DATA PREVISTA DE EMISSÃO"]),
      recordValue(record, ["DISCIPLINA", "WORKFLOW", "QUEM?"]),
      recordValue(record, ["ESCOPO"]),
      recordValue(record, ["PROPÓSITO DE EMISSÃO"]),
      recordValue(record, ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"]),
    ].map(norm).join("||");
  }

  function dateValue(value, fallback) {
    const raw = text(value);
    if (!raw) return text(fallback);
    const parsed = C && C.parseDate ? C.parseDate(raw) : new Date(raw);
    return parsed && !Number.isNaN(parsed.getTime()) ? text(parsed) : raw;
  }

  function disciplineKey(value) {
    return norm(value).split(/[|/]/).filter(Boolean).at(-1) || "";
  }

  function evidenceRecord(row, index) {
    const group = index && index.byDocument && index.byDocument.get(key(row && row.document));
    if (!group || !group.records || !group.records.length) return null;
    return [...group.records].sort((left, right) => (Number(right.row) || 0) - (Number(left.row) || 0))[0];
  }

  function latestAllocation(values) {
    return [...new Set((values || []).map(text).filter(Boolean))].sort((left, right) => {
      const a = parseAllocationCode(left);
      const b = parseAllocationCode(right);
      if (a && b) return a.year - b.year || a.sequence - b.sequence;
      if (a) return 1;
      if (b) return -1;
      return left.localeCompare(right, "pt-BR");
    }).at(-1) || "";
  }

  function conflictEvidence(sourceType, source, alternatives, relatedDocuments) {
    return {
      databook: "",
      levels: [],
      source,
      sourceType,
      confidence: "conflito",
      support: (alternatives || []).reduce((total, item) => total + (Number(item.support) || 0), 0),
      allocation: "",
      relatedDocuments: (relatedDocuments || []).slice(0, 8),
      alternatives: (alternatives || []).slice(0, 4),
      conflict: true,
    };
  }

  function chooseFamilyEvidence(record, rows, index, sourceType) {
    const targetFamily = documentFamily(record.document);
    if (!targetFamily.key) return null;
    const targetKind = titleKind(record.title);
    const targetSubjects = subjectTags(record.document, record.title, "");
    const targetDiscipline = disciplineKey(record.discipline);
    const targetSequence = documentSequence(record.document);
    const dedupe = new Set();
    const candidates = [];
    (rows || []).forEach((row) => {
      if (!row || !completeDatabook(row.databook)) return;
      const sameDocument = key(row.document) === record.documentKey;
      if (sameDocument) return;
      const candidateRecord = evidenceRecord(row, index);
      const candidateFamily = documentFamily(row.document);
      if (candidateFamily.key !== targetFamily.key) return;
      const candidateTitle = candidateRecord && candidateRecord.title || row.approvedTitle || row.title || row.originalTitle || "";
      const candidateKind = titleKind(candidateTitle);
      const candidateSubjects = subjectTags(row.document, candidateTitle, row.databook);
      const subjectMatch = setsIntersect(targetSubjects, candidateSubjects);
      const similarity = titleSimilarity(record.title, candidateTitle);
      const kindMatch = Boolean(targetKind && candidateKind && targetKind === candidateKind);
      if (targetKind && candidateKind && !kindMatch) return;
      if (targetSubjects.size && !subjectMatch) return;
      if (!kindMatch && similarity < 0.32) return;
      const dedupeKey = `${key(row.document)}|${pathKey(row.databook)}`;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);
      const candidateSequence = documentSequence(row.document);
      const distance = targetSequence !== null && candidateSequence !== null ? Math.abs(targetSequence - candidateSequence) : null;
      const disciplineMatch = Boolean(targetDiscipline && targetDiscipline === disciplineKey(candidateRecord && candidateRecord.discipline || row.discipline || row.workflow));
      const score = 50 + (kindMatch ? 35 : 0) + (subjectMatch ? 38 : 0) + Math.round(similarity * 30) + (disciplineMatch ? 10 : 0)
        + (sourceType === "history" ? 18 : 4)
        + (distance === null ? 0 : Math.max(0, 10 - Math.min(10, distance)));
      candidates.push({ row, record: candidateRecord, similarity, kindMatch, subjectMatch, disciplineMatch, sameDocument, score, path: row.databook });
    });
    if (!candidates.length) return null;

    const groups = new Map();
    candidates.forEach((candidate) => {
      const candidatePathKey = pathKey(candidate.path);
      if (!groups.has(candidatePathKey)) groups.set(candidatePathKey, { path: candidate.path, candidates: [], documents: new Set(), allocations: new Set(), totalScore: 0, maxScore: 0 });
      const group = groups.get(candidatePathKey);
      group.candidates.push(candidate);
      group.documents.add(key(candidate.row.document));
      if (candidate.row.allocation) group.allocations.add(candidate.row.allocation);
      group.totalScore += candidate.score;
      group.maxScore = Math.max(group.maxScore, candidate.score);
    });
    const ranked = [...groups.values()].sort((left, right) => right.documents.size - left.documents.size || right.totalScore - left.totalScore || right.maxScore - left.maxScore);
    const top = ranked[0];
    const totalSupport = ranked.reduce((sum, group) => sum + group.documents.size, 0);
    const share = totalSupport ? top.documents.size / totalSupport : 0;
    const sourceLabel = sourceType === "history" ? `Conflito no histórico da família ${targetFamily.label}`
      : `Conflito na LD da família ${targetFamily.label}`;
    const alternatives = ranked.map((group) => ({ databook: group.path, support: group.documents.size, score: group.maxScore }));
    const relatedDocuments = ranked.flatMap((group) => group.candidates.map((candidate) => candidate.row.document));
    if (!targetSubjects.size && ranked.length > 1 && share < (sourceType === "history" ? 0.90 : 0.93)) {
      return conflictEvidence(sourceType, sourceLabel, alternatives, relatedDocuments);
    }
    const kindSupport = top.candidates.filter((candidate) => candidate.kindMatch).length;
    const strong = sourceType === "history"
      ? (top.documents.size >= 2 && share >= 0.60 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.6)))
        || (top.documents.size === 1 && ranked.length === 1 && top.maxScore >= 118)
      : top.documents.size >= 2 && share >= 0.72 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.7));
    if (!strong) return ranked.length > 1 ? conflictEvidence(sourceType, sourceLabel, alternatives, relatedDocuments) : null;

    const levelGroups = new Map();
    top.candidates.forEach((candidate) => {
      const levels = (candidate.row.levels || []).map(text);
      if (!levels.some(Boolean)) return;
      const levelKey = levels.map(norm).join("|");
      if (!levelGroups.has(levelKey)) levelGroups.set(levelKey, { levels, count: 0 });
      levelGroups.get(levelKey).count += 1;
    });
    const chosenLevels = [...levelGroups.values()].sort((left, right) => right.count - left.count)[0];
    const allocation = latestAllocation([...top.allocations]);
    return {
      databook: top.path,
      levels: chosenLevels ? chosenLevels.levels : [],
      source: sourceType === "history" ? `Histórico da família ${targetFamily.label}` : `LD da família ${targetFamily.label}`,
      sourceType,
      confidence: "alta",
      support: top.documents.size,
      allocation,
      relatedDocuments: top.candidates.slice(0, 8).map((candidate) => candidate.row.document),
    };
  }

  function chooseCvEvidence(record, rows) {
    if (titleKind(record.title) !== "CURRICULO") return null;
    const candidates = (rows || []).filter((row) => {
      const family = documentFamily(row && row.document);
      return family.type === "CV" && text(row.databook) && (row.levels || []).slice(0, 4).some(Boolean);
    });
    if (!candidates.length) return null;
    const groups = new Map();
    candidates.forEach((row) => {
      const levels = (row.levels || []).map(text);
      const groupKey = `${pathKey(row.databook)}||${levels.slice(0, 4).map(norm).join("|")}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { databook: row.databook, levels, documents: new Set(), allocations: new Set(), rows: [] });
      const group = groups.get(groupKey);
      group.documents.add(key(row.document));
      if (row.allocation) group.allocations.add(row.allocation);
      group.rows.push(row);
    });
    const ranked = [...groups.values()].sort((left, right) => right.documents.size - left.documents.size);
    const top = ranked[0];
    const totalSupport = ranked.reduce((sum, group) => sum + group.documents.size, 0);
    const share = totalSupport ? top.documents.size / totalSupport : 0;
    if (top.documents.size < 3 || share < 0.80) {
      if (ranked.length > 1) return conflictEvidence("history", "Conflito no histórico de currículos CV", ranked.map((group) => ({
        databook: group.databook,
        support: group.documents.size,
      })), ranked.flatMap((group) => group.rows.map((row) => row.document)));
      return null;
    }
    return {
      databook: top.databook,
      levels: top.levels,
      source: "Histórico de currículos CV",
      sourceType: "history",
      confidence: "alta",
      support: top.documents.size,
      allocation: latestAllocation([...top.allocations]),
      relatedDocuments: top.rows.slice(0, 8).map((row) => row.document),
    };
  }

  function chooseCatalogEvidence(record, catalogEntries) {
    const targetKind = titleKind(record.title);
    const targetDiscipline = disciplineKey(record.discipline);
    const targetTokens = titleTokens(record.title);
    const targetSubjects = subjectTags(record.document, record.title, "");
    const ranked = (catalogEntries || []).map((entry) => {
      const searchable = `${entry.description || ""} ${entry.notes || ""}`;
      const searchableNorm = norm(searchable);
      let overlap = 0;
      targetTokens.forEach((token) => { if (searchableNorm.includes(token)) overlap += 1; });
      const kindMatch = Boolean(targetKind && searchableNorm.includes(targetKind));
      const disciplineMatch = Boolean(targetDiscipline && norm(`${entry.databook} ${entry.description}`).includes(targetDiscipline));
      const entrySubjects = subjectTags("", searchable, entry.databook);
      const subjectMatch = targetSubjects.size && setsIntersect(targetSubjects, entrySubjects);
      const subjectConflict = targetSubjects.size && entrySubjects.size && !subjectMatch;
      const depth = text(entry.databook).split("|").filter(Boolean).length;
      const score = (kindMatch ? 65 : 0) + (disciplineMatch ? 24 : 0) + Math.min(28, overlap * 4)
        + Math.round(titleSimilarity(record.title, searchable) * 28)
        + (subjectMatch ? 58 : 0) - (subjectConflict ? 32 : 0)
        + (subjectMatch && depth >= 5 ? 8 : 0);
      return { entry, score, kindMatch, disciplineMatch, subjectMatch };
    }).filter((candidate) => candidate.score >= 62).sort((left, right) => right.score - left.score);
    if (!ranked.length) return null;
    const top = ranked[0];
    const runner = ranked.find((candidate) => pathKey(candidate.entry.databook) !== pathKey(top.entry.databook));
    if (runner && top.score - runner.score < 10) return conflictEvidence("catalog", "Conflito no Mapa Databook", [top, runner].map((candidate) => ({
      databook: candidate.entry.databook,
      support: 1,
      score: candidate.score,
    })), []);
    if (top.score < 76) return null;
    return {
      databook: top.entry.databook,
      levels: [],
      source: "Mapa Databook",
      sourceType: "catalog",
      confidence: "alta",
      support: 1,
      allocation: "",
      relatedDocuments: [],
    };
  }

  function evidenceRowsByFamily(rows) {
    const grouped = new Map();
    (rows || []).forEach((row) => {
      const family = documentFamily(row && row.document);
      if (!family.key) return;
      if (!grouped.has(family.key)) grouped.set(family.key, []);
      grouped.get(family.key).push(row);
    });
    return grouped;
  }

  function evidenceRowsByType(rows) {
    const grouped = new Map();
    (rows || []).forEach((row) => {
      const family = documentFamily(row && row.document);
      if (!family.type) return;
      if (!grouped.has(family.type)) grouped.set(family.type, []);
      grouped.get(family.type).push(row);
    });
    return grouped;
  }

  function buildDatabookEvidenceContext(records, control, options) {
    const supplemental = options && options.historyRows || [];
    const historyRows = [...(control && control.rows || []), ...supplemental];
    const ldRows = (records || []).filter((candidate) => completeDatabook(candidate.databook)).map((candidate) => ({
      document: candidate.document,
      documentKey: candidate.documentKey,
      databook: candidate.databook,
      workflow: candidate.discipline,
      levels: [],
      allocation: "",
    }));
    return {
      historyByFamily: evidenceRowsByFamily(historyRows),
      historyByType: evidenceRowsByType(historyRows),
      ldByFamily: evidenceRowsByFamily(ldRows),
      catalogEntries: options && options.catalogEntries || [],
    };
  }

  function inferDatabookEvidence(record, context, index) {
    const family = documentFamily(record.document);
    let strongestConflict = null;
    const accept = (evidence) => {
      if (!evidence) return null;
      if (evidence.conflict) {
        if (!strongestConflict) strongestConflict = evidence;
        return null;
      }
      return evidence;
    };
    if (family.type === "CV") {
      const cvEvidence = chooseCvEvidence(record, context.historyByType.get("CV") || []);
      const acceptedCv = accept(cvEvidence);
      if (acceptedCv) return acceptedCv;
    }
    const historyEvidence = chooseFamilyEvidence(record, context.historyByFamily.get(family.key) || [], index, "history");
    const acceptedHistory = accept(historyEvidence);
    if (acceptedHistory) return acceptedHistory;
    const ldEvidence = chooseFamilyEvidence(record, context.ldByFamily.get(family.key) || [], index, "ld");
    const acceptedLd = accept(ldEvidence);
    if (acceptedLd) return acceptedLd;
    const catalogEvidence = chooseCatalogEvidence(record, context.catalogEntries);
    const acceptedCatalog = accept(catalogEvidence);
    if (acceptedCatalog) return acceptedCatalog;
    return strongestConflict;
  }

  function levelsForDatabook(levelsByDatabook, databook) {
    if (!databook || !levelsByDatabook) return [];
    const exact = levelsByDatabook.get(norm(databook));
    if (exact && exact.some(Boolean)) return exact.slice();
    const wanted = pathKey(databook);
    for (const [candidate, levels] of levelsByDatabook.entries()) {
      if (pathKey(candidate) === wanted && levels.some(Boolean)) return levels.slice();
    }
    return [];
  }

  function outputFromRecord(record, history, base, control, allocationDate, inference) {
    const rawLdDatabook = recordValue(record, ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"]);
    const rawHistoryDatabook = history && history.databook || "";
    const ldDatabook = completeDatabook(rawLdDatabook) ? rawLdDatabook : "";
    const historyDatabook = completeDatabook(rawHistoryDatabook) ? rawHistoryDatabook : "";
    const inferredDatabook = inference && completeDatabook(inference.databook) ? inference.databook : "";
    const databook = ldDatabook || historyDatabook || inferredDatabook;
    const evidence = ldDatabook
      ? { source: "LD", sourceType: "ld-exact", confidence: "confirmada", support: 1, allocation: "", relatedDocuments: [] }
      : historyDatabook
        ? { source: "Histórico do documento", sourceType: "history-exact", confidence: "confirmada", support: 1, allocation: history && history.allocation || "", relatedDocuments: [record.document] }
        : inference || { source: "", sourceType: "", confidence: "", support: 0, allocation: "", relatedDocuments: [] };

    const family = documentFamily(record.document);
    const eapLevels = family.type === "ET" ? levelsForEap(control, record) : [];
    let levels = [];
    let levelsSource = "";
    if (family.type === "ET" && eapLevels.some(Boolean)) {
      levels = eapLevels.slice();
      levelsSource = `Base EAP ${recordEap(record)}`;
    } else if (base && base.levels && base.levels.some(Boolean)) {
      levels = base.levels.slice();
      levelsSource = "Base do documento";
    } else if (history && history.levels && history.levels.some(Boolean)) {
      levels = history.levels.slice();
      levelsSource = "Histórico do documento";
    } else if (inference && inference.levels && inference.levels.some(Boolean)
      && (!databook || pathKey(inference.databook) === pathKey(databook))) {
      levels = inference.levels.slice();
      levelsSource = inference.source;
    }
    if (!levels.length) {
      levels = levelsForDatabook(control && control.levelsByDatabook, databook);
      if (levels.some(Boolean)) levelsSource = "Histórico do caminho";
    }
    while (levels.length < 10) levels.push("");
    const sourceAction = recordValue(record, ["ESCOPO", "AÇÃO", "ACAO"]) || text(history && history["Ação"]) || "INCLUSÃO";
    const action = norm(sourceAction) === "EMISSAO" ? "INCLUSÃO" : sourceAction;
    return {
      document: record.document,
      plannedDate: text(history && history["Data Prevista"]) || text(allocationDate),
      workflow: recordValue(record, ["DISCIPLINA", "WORKFLOW", "QUEM?"]) || (history && history.workflow) || "",
      active: recordValue(record, ["DOCUMENTO ATIVO"]) || text(history && history["Documento Ativo"]),
      action,
      baselineDate: recordValue(record, ["DATA DA LINHA BASE"]) || text(history && history["Data da Linha Base"]),
      purpose: recordValue(record, ["PROPÓSITO DE EMISSÃO", "PROPÓSITO DE EMISSÃO ORIGINAL"]) || text(history && history["Propósito de Emissão Original"]),
      critical: recordValue(record, ["DOCUMENTO CRÍTICO"]) || text(history && history["Documento Crítico"]),
      observation: recordValue(record, ["OBSERVAÇÃO"]) || text(history && history["Observação"]),
      databook,
      levels,
      databookEvidence: evidence,
      levelsSource,
    };
  }

  function historyRank(row) {
    const parsed = parseAllocationCode(row && row.allocation);
    return parsed ? parsed.year * 100000 + parsed.sequence : Number(row && row.rowNumber) || 0;
  }

  function exactHistoryMap(control, supplemental) {
    const result = new Map();
    [...(control && control.rows || []), ...(supplemental || [])].forEach((row) => {
      if (!row || !(row.document || row.documentKey)) return;
      const identity = looseKey(row.document || row.documentKey);
      if (!identity) return;
      const current = result.get(identity);
      if (!current || historyRank(row) >= historyRank(current)) result.set(identity, row);
    });
    return result;
  }

  function latestRecord(records) {
    return (records || []).slice().sort((a, b) => (Number(b.row) || 0) - (Number(a.row) || 0))[0] || null;
  }

  function formatDateBR(value) {
    const parsed = C && C.parseDate ? C.parseDate(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return text(value);
    return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
  }

  function postingEvidenceForRecord(record) {
    const item = record || {};
    const grdt = text(item.grdt || recordValue(item, ["GRDT", "EGRDT"]));
    const effectiveDate = text(item.effectiveDate || recordValue(item, ["DATA EFETIVA DE EMISSÃO", "DATA EFETIVA EMISSÃO"]));
    const parsedDate = C && C.parseDate ? C.parseDate(effectiveDate) : effectiveDate ? new Date(effectiveDate) : null;
    const validDate = parsedDate instanceof Date && !Number.isNaN(parsedDate.getTime());
    const complete = Boolean(grdt && validDate);
    const partial = Boolean((grdt || effectiveDate) && !complete);
    const source = [text(item.source), text(item.sheet) ? `aba ${item.sheet}` : "", item.row ? `linha ${item.row}` : ""].filter(Boolean).join(" · ");
    if (complete) return {
      grdt, effectiveDate, complete: true, partial: false, status: "POSTADO CONFORME LD",
      explanation: `A própria LD informa a GRDT ${grdt} e a Data Efetiva de Emissão ${formatDateBR(effectiveDate)} na mesma linha${source ? ` (${source})` : ""}.`,
      source, sheet: text(item.sheet), row: Number(item.row) || 0,
    };
    if (partial) return {
      grdt, effectiveDate, complete: false, partial: true, status: "EVIDÊNCIA DE POSTAGEM INCOMPLETA",
      explanation: grdt
        ? `A LD informa a GRDT ${grdt}, mas a Data Efetiva de Emissão está vazia ou inválida${source ? ` (${source})` : ""}.`
        : `A LD informa a Data Efetiva de Emissão ${formatDateBR(effectiveDate)}, mas o número da GRDT está vazio${source ? ` (${source})` : ""}.`,
      source, sheet: text(item.sheet), row: Number(item.row) || 0,
    };
    return { grdt: "", effectiveDate: "", complete: false, partial: false, status: "SEM EVIDÊNCIA DE POSTAGEM NA LD", explanation: `A linha não possui número da GRDT nem Data Efetiva de Emissão${source ? ` (${source})` : ""}.`, source, sheet: text(item.sheet), row: Number(item.row) || 0 };
  }

  function meaningfulFiscalComment(value) {
    const normalized = norm(value);
    return Boolean(normalized && !/^(OK|ACEITO SEM COMENTARIOS?|SEM COMENTARIOS?|N\/A|NA|-)$/.test(normalized));
  }


  function outcomeForHistory(history) {
    if (!history) return { kind: "unknown", label: "SEM RESULTADO", confidence: "baixa" };
    return P && P.classifyEvidence
      ? P.classifyEvidence({ status: history.status, comment: history.fiscalComment })
      : { kind: "unknown", label: text(history.status) || "SEM RESULTADO", confidence: "baixa" };
  }

  function outcomeForLd(record) {
    const value = text(record && record.allocationStatus);
    const kind = C && C.allocationState ? C.allocationState(value).kind : norm(value) === "NAO ALOCADO" ? "not_allocated" : norm(value) === "ALOCADO" ? "allocated" : value ? "unknown" : "empty";
    if (kind === "allocated") return { kind: "accepted", label: "ALOCADO CONFORME LD", confidence: "alta" };
    if (kind === "not_allocated") return { kind: "not_allocated", label: "NÃO ALOCADO CONFORME LD", confidence: "alta" };
    if (kind === "unknown") return { kind: "unknown", label: value || "RESULTADO NÃO RECONHECIDO", confidence: "baixa" };
    return { kind: "empty", label: "SEM CONFIRMAÇÃO NA LD", confidence: "baixa" };
  }

  function effectiveFiscalComment(record, confirmation, history) {
    const ldComment = text(record && record.fiscalComment);
    const confirmationComment = text(confirmation && confirmation.comment);
    const historyComment = text(history && history.fiscalComment);
    if (confirmation && confirmation.outcome && confirmation.outcome.kind === "rejected" && confirmationComment) return confirmationComment;
    if (meaningfulFiscalComment(ldComment)) return ldComment;
    if (confirmationComment) return confirmationComment;
    if (meaningfulFiscalComment(historyComment)) return historyComment;
    return ldComment || historyComment;
  }

  function confirmationSourceLabel(confirmation) {
    return P && P.sourceLabel ? P.sourceLabel(confirmation) : [text(confirmation && confirmation.source), text(confirmation && confirmation.sourceSheet), confirmation && confirmation.sourceRow ? `linha ${confirmation.sourceRow}` : ""].filter(Boolean).join(" · ");
  }

  function chooseAllocationResolution(record, history, confirmationResolution) {
    if (confirmationResolution && confirmationResolution.conflict) {
      return { kind: "conflict", label: "CONFLITO NAS CONFIRMAÇÕES", sourceType: "confirmation", source: "Pasta de confirmações", evidence: null };
    }
    const confirmation = confirmationResolution && confirmationResolution.evidence || null;
    if (confirmation && confirmation.outcome && ["accepted", "rejected", "pending"].includes(confirmation.outcome.kind)) {
      return { ...confirmation.outcome, sourceType: "confirmation", source: confirmationSourceLabel(confirmation), evidence: confirmation };
    }
    const historyOutcome = outcomeForHistory(history);
    if (["accepted", "rejected", "pending"].includes(historyOutcome.kind)) {
      return { ...historyOutcome, sourceType: "control", source: [text(history && history.source) || "Central de alocação", text(history && history.sourceSheet), history && history.rowNumber ? `linha ${history.rowNumber}` : ""].filter(Boolean).join(" · "), evidence: history };
    }
    const ldOutcome = outcomeForLd(record);
    return { ...ldOutcome, sourceType: "ld", source: [text(record && record.source), text(record && record.sheet) ? `aba ${record.sheet}` : "", record && record.row ? `linha ${record.row}` : ""].filter(Boolean).join(" · "), evidence: record };
  }

  function appendReallocationObservation(output, previousAllocation, comment, source) {
    if (!output) return output;
    const note = [`NOVA ALOCAÇÃO APÓS RECUSA${previousAllocation ? ` DA ${previousAllocation}` : ""}`, comment ? `MOTIVO: ${comment}` : "", source ? `FONTE: ${source}` : ""].filter(Boolean).join(" — ");
    output.observation = [text(output.observation), note].filter(Boolean).join(" | ");
    return output;
  }

  function resolutionExplanation(record, resolution, confirmation, history, effectiveComment, existingAllocation) {
    const parts = [];
    const label = text(resolution && resolution.label);
    if (resolution && resolution.kind === "accepted") {
      parts.push(existingAllocation ? `A confirmação mais recente indica que o documento está alocado em ${existingAllocation}.` : "A confirmação mais recente indica que o documento já está alocado, mesmo sem número preenchido no campo ALOCAÇÃO.");
    } else if (resolution && resolution.kind === "rejected") {
      parts.push(existingAllocation ? `A alocação ${existingAllocation} foi recusada e não deve ser tratada como alocação aceita.` : "A confirmação mais recente registra recusa da alocação.");
      parts.push("O documento foi preparado para uma nova alocação.");
    } else if (resolution && resolution.kind === "not_allocated") {
      parts.push("A LD confirma que o documento está NÃO ALOCADO e pode seguir para nova alocação.");
      if (existingAllocation) parts.push(`O número ${existingAllocation} é apenas um registro anterior; sozinho ele não comprova que a alocação foi aceita.`);
    } else if (resolution && resolution.kind === "pending") {
      parts.push(`A confirmação mais recente está pendente${label ? ` (${label})` : ""}; nenhuma nova alocação foi preparada automaticamente.`);
    } else if (resolution && resolution.kind === "conflict") {
      parts.push("Foram encontradas confirmações contraditórias para o mesmo documento e para a mesma prioridade de retorno.");
    } else {
      parts.push("Não foi encontrada confirmação segura de que o documento está alocado ou liberado para nova alocação.");
      if (existingAllocation) parts.push(`Existe o número ${existingAllocation}, mas o número da alocação isoladamente não comprova aceite.`);
    }
    if (effectiveComment) parts.push(`Comentário da Fiscal: ${effectiveComment}.`);
    else if (resolution && resolution.kind === "rejected") parts.push("A recusa foi identificada pelo status, mas não há comentário explicando o motivo.");
    if (resolution && resolution.source) parts.push(`Fonte da decisão: ${resolution.source}.`);
    const stage = text(record && record.allocationStage);
    if (stage && !/^(0|N\/A|NA|-)$/.test(norm(stage))) parts.push(`Etapa registrada na LD: ${stage}.`);
    const version = recordVersion(record);
    if (version) parts.push(`Versão da LD enviada: ${version}.`);
    return parts.join(" ");
  }

  function allocationExplanation(record, mode, history) {
    const item = record || {};
    const status = text(item.allocationStatus);
    const allocation = text(history && history.allocation || item.allocation || recordValue(item, ["ALOCAÇÃO"]));
    const stage = text(item.allocationStage);
    const fiscal = text(item.fiscalComment);
    const version = text(item.ldVersion);
    const source = [text(item.source), text(item.sheet) ? `aba ${item.sheet}` : "", item.row ? `linha ${item.row}` : ""].filter(Boolean).join(" · ");
    const parts = [];
    if (mode === "allocated") {
      parts.push(allocation ? `O documento já está alocado em ${allocation}.` : "A LD confirma que o documento já está alocado.");
      if (status) parts.push(`Confirmação de documentos previstos: ${status}.`);
    } else if (mode === "not_allocated") {
      parts.push(`A coluna “Confirmação de DOCUMENTOS PREVISTOS” está marcada como ${status || "NÃO ALOCADO"}.`);
      if (meaningfulFiscalComment(fiscal)) parts.push(`Motivo registrado pela Fiscal: ${fiscal}.`);
      else if (fiscal) parts.push(`O comentário “${fiscal}” não explica operacionalmente por que o documento ainda não foi alocado.`);
      else parts.push("A LD não contém comentário da Fiscal explicando o motivo operacional da não alocação.");
      if (allocation) parts.push(`Existe o número de alocação ${allocation}, mas a confirmação da linha continua como não alocada; confira a atualização da LD.`);
      else parts.push("Nenhum número de alocação foi registrado nessa linha.");
    } else {
      parts.push(status ? `O valor de confirmação “${status}” não permite decisão automática.` : "A confirmação de documentos previstos está vazia ou a coluna não foi localizada.");
    }
    if (stage && !/^(0|N\/A|NA|-)$/.test(norm(stage))) parts.push(`Etapa da alocação: ${stage}.`);
    if (version) parts.push(`Versão da LD enviada: ${version}.`);
    else parts.push("A Versão da LD enviada não está preenchida nessa linha.");
    if (source) parts.push(`Evidência: ${source}.`);
    return parts.join(" ");
  }

  function resultEvidence(record, decision, reason, history) {
    const item = record || {};
    const postingEvidence = postingEvidenceForRecord(item);
    return {
      allocationReason: reason || allocationExplanation(item, decision === SKIP ? "allocated" : decision === READY ? "not_allocated" : "review", history),
      allocationStatus: text(item.allocationStatus),
      existingAllocation: text(history && history.allocation || item.allocation || recordValue(item, ["ALOCAÇÃO"])),
      allocationStage: text(item.allocationStage),
      fiscalComment: text(item.fiscalComment),
      grdt: postingEvidence.grdt,
      effectiveDate: postingEvidence.effectiveDate,
      postingEvidence,
      postingStatus: postingEvidence.status,
      sigemStatus: text(item.sigemStatus || item.status),
    };
  }

  function analyze(entries, records, control, options) {
    const index = C.buildIndex(records || [], options && options.ldHistory || []);
    const evidenceContext = buildDatabookEvidenceContext(records, control, options);
    const histories = exactHistoryMap(control, options && options.historyRows || []);
    const confirmationIndex = P && P.buildIndex ? P.buildIndex(options && options.confirmationRows || []) : null;
    const results = [];
    const seenDocuments = new Set();
    let duplicateCount = 0;
    const allocationDate = text(options && options.allocationDate);

    (entries || []).forEach((entry) => {
      const hintedSheet = entry.hintedSheet || C.inferSheetFromName(entry.raw);
      const matches = C.matchDocuments(entry.raw, index, hintedSheet);
      if (matches.length !== 1) {
        results.push({
          decision: REVIEW, selected: false, document: text(entry.raw),
          reason: matches.length ? "Mais de um documento da LD foi identificado." : "Documento não encontrado na LD.",
          allocationReason: matches.length ? "Mais de uma linha possível foi encontrada; nenhuma foi escolhida." : "Não há linha na LD para comprovar a situação de alocação.",
          postingStatus: "SEM EVIDÊNCIA DE POSTAGEM NA LD", postingEvidence: null, source: entry,
        });
        return;
      }

      const matched = matches[0];
      if (seenDocuments.has(matched.documentKey)) { duplicateCount += 1; return; }
      seenDocuments.add(matched.documentKey);

      const ldConflict = F && F.analyzeGroup ? F.analyzeGroup(matched.group, { hintedSheet }) : null;
      const blockingConflictFields = ldConflict && ldConflict.hasConflict
        ? ldConflict.fields.filter((field) => !["Alocação", "Situação de alocação"].includes(field))
        : [];
      if (blockingConflictFields.length) {
        results.push({
          decision: REVIEW, selected: false, document: matched.document,
          sheet: [...new Set(ldConflict.candidates.map((candidate) => candidate.sheet).filter(Boolean))].join(" · "),
          reason: `Conflito na LD. Valores diferentes em: ${blockingConflictFields.join(", ")}. Nenhuma linha foi escolhida para gerar a alocação.`,
          allocationReason: `A situação não foi decidida porque existem divergências técnicas: ${blockingConflictFields.join(", ")}.`,
          warnings: [F.evidenceText(ldConflict)], conflictLd: `SIM — ${blockingConflictFields.join(", ")}`, ldConflict,
          postingStatus: "CONFLITO NA LD", postingEvidence: null, record: null, source: entry,
        });
        return;
      }

      let candidates = matched.group.records.slice();
      if (hintedSheet) {
        const hinted = candidates.filter((record) => norm(record.sheet) === norm(hintedSheet));
        if (hinted.length) candidates = hinted;
      }
      const record = latestRecord(candidates);
      const history = histories.get(looseKey(matched.document)) || null;
      const confirmationResolution = P && P.resolve ? P.resolve(confirmationIndex, matched.documentKey) : { evidence: null, conflict: false, candidates: [] };
      const confirmation = confirmationResolution.evidence || null;
      const resolution = chooseAllocationResolution(record, history, confirmationResolution);
      const existingAllocation = text(confirmation && confirmation.allocation || history && history.allocation || record && record.allocation || recordValue(record, ["ALOCAÇÃO"]));
      const fiscalComment = effectiveFiscalComment(record, confirmation, history);
      const allocationReason = resolutionExplanation(record, resolution, confirmation, history, fiscalComment, existingAllocation);
      const postingEvidence = postingEvidenceForRecord(record);
      const allocationStatusAvailable = candidates.some(hasAllocationStatusColumn);
      const base = control.baseDocuments.get(record.documentKey) || control.baseDocuments.get(looseKey(record.document)) || null;
      const rawLdDatabook = recordValue(record, ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"]);
      const exactDatabook = completeDatabook(rawLdDatabook) ? rawLdDatabook : history && completeDatabook(history.databook) ? history.databook : "";
      const eapLevels = levelsForEap(control, record);
      const exactLevels = eapLevels.some(Boolean) ? eapLevels : base && base.levels && base.levels.some(Boolean) ? base.levels : history && history.levels && history.levels.some(Boolean) ? history.levels : levelsForDatabook(control.levelsByDatabook, exactDatabook);
      const inference = !exactDatabook || !exactLevels.some(Boolean) ? inferDatabookEvidence(record, evidenceContext, index) : null;
      const output = outputFromRecord(record, history, base, control, allocationDate, inference);
      const ldVersion = recordVersion(record, control.latestLdVersion);
      const warnings = [];
      if (!output.workflow) warnings.push("Workflow vazio");
      if (!output.databook) warnings.push("Caminho Data Book vazio");
      if (!output.levels.slice(0, 6).some(Boolean)) warnings.push("Níveis N1 a N6 vazios");
      if (!ldVersion) warnings.push("Versão da LD vazia");
      if (output.databook && output.databookEvidence && /^history$|^ld$|^catalog$/.test(output.databookEvidence.sourceType)) warnings.push(`Databook por ${output.databookEvidence.source}`);
      if (ldConflict && ldConflict.hasConflict && !blockingConflictFields.length) warnings.push("A LD possui divergência apenas nos campos de alocação; a decisão utilizou a confirmação mais recente.");

      const common = {
        document: record.document,
        sheet: record.sheet,
        record,
        history,
        base,
        ldVersion,
        allocationStatusAvailable,
        existingAllocation,
        previousAllocation: existingAllocation,
        databookInference: inference,
        output,
        source: entry,
        warnings,
        allocationReason,
        fiscalComment,
        confirmationStatus: text(confirmation && confirmation.status),
        confirmationComment: text(confirmation && confirmation.comment),
        confirmationOutcome: text(resolution && resolution.label),
        confirmationSource: text(resolution && resolution.source),
        confirmationAllocation: text(confirmation && confirmation.allocation),
        confirmationDate: text(confirmation && confirmation.returnDate),
        allocationDecisionSource: text(resolution && resolution.sourceType),
        allocationStatus: text(record && record.allocationStatus),
        allocationStage: text(record && record.allocationStage),
        grdt: postingEvidence.grdt,
        effectiveDate: postingEvidence.effectiveDate,
        postingEvidence,
        postingStatus: postingEvidence.status,
        sigemStatus: text(record && (record.sigemStatus || record.status)),
      };

      if (resolution.kind === "accepted") {
        results.push({ ...common, decision: SKIP, selected: false, reason: allocationReason, reallocationRequired: false });
        return;
      }

      if (resolution.kind === "rejected" || resolution.kind === "not_allocated") {
        const reallocationRequired = resolution.kind === "rejected";
        if (reallocationRequired) appendReallocationObservation(output, existingAllocation, fiscalComment, resolution.source);
        if (postingEvidence.complete || postingEvidence.partial) {
          const postingReason = postingEvidence.complete
            ? `${postingEvidence.explanation} Apesar da recusa ou do status não alocado, não é seguro gerar nova alocação enquanto a postagem registrada na LD não for regularizada.`
            : `${postingEvidence.explanation} Confira a evidência antes de gerar a nova alocação.`;
          results.push({ ...common, decision: REVIEW, selected: false, reason: `${allocationReason} ${postingReason}`, allocationReason: `${allocationReason} ${postingReason}`, reallocationRequired });
          return;
        }
        results.push({ ...common, decision: READY, selected: true, reason: allocationReason, reallocationRequired });
        return;
      }

      const reason = resolution.kind === "conflict"
        ? `${allocationReason} Fontes conflitantes: ${(confirmationResolution.candidates || []).map((item) => `${text(item.status)}${item.comment ? ` — ${item.comment}` : ""}`).join(" | ")}.`
        : allocationReason;
      results.push({ ...common, decision: REVIEW, selected: false, reason, allocationReason: reason, reallocationRequired: false });
    });

    return { results, duplicateCount, index };
  }

  function allocationRow(result) {
    const output = result.output || {};
    return [
      output.document || result.document || "",
      output.plannedDate || "",
      output.workflow || "",
      output.active || "",
      output.action || "",
      output.baselineDate || "",
      output.purpose || "",
      output.critical || "",
      output.observation || "",
      output.databook || "",
      ...Array.from({ length: 6 }, (_, index) => (output.levels || [])[index] || ""),
    ];
  }

  function controlRow(result, meta) {
    const record = result.record || {};
    const base = result.base || {};
    const output = result.output || {};
    return [
      record.sheet || result.sheet || "",
      result.ldVersion || recordVersion(record),
      text(meta.allocationDate),
      "",
      "",
      "",
      text(meta.status) || "PENDENTE ENVIO DE LD",
      text(meta.allocationCode),
      base.document ? 1 : 0,
      ...allocationRow(result),
      ...Array.from({ length: 4 }, (_, index) => (output.levels || [])[index + 6] || ""),
    ];
  }

  function selectedReady(results, selectedDocuments) {
    const selected = selectedDocuments instanceof Set ? selectedDocuments : null;
    return (results || []).filter((result) => result.decision === READY && (!selected || selected.has(key(result.document))));
  }

  return {
    READY,
    REVIEW,
    SKIP,
    ALLOCATION_HEADERS,
    CONTROL_HEADERS,
    text,
    norm,
    key,
    pathKey,
    completeDatabook,
    documentFamily,
    normalizeEap,
    documentEap,
    recordEap,
    levelsFromEapBase,
    levelsForEap,
    titleKind,
    titleSimilarity,
    subjectTags,
    suggestCatalogDatabook: chooseCatalogEvidence,
    recordValue,
    hasAllocationStatusColumn,
    newestLdVersion,
    recordVersion,
    splitBaseLevels,
    parseControlWorkbook,
    parseDatabookWorkbook,
    parseHistoricalAllocationWorkbook,
    parseAllocationCode,
    suggestAllocationCode,
    parseRelationWorkbook,
    parseTextRelation,
    analyze,
    outcomeForHistory,
    outcomeForLd,
    chooseAllocationResolution,
    postingEvidenceForRecord,
    allocationExplanation,
    allocationRow,
    controlRow,
    selectedReady,
  };
});
