(function (root, factory) {
  const api = factory(root, root.TriagemCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ReconLdCompatibility = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, C) {
  "use strict";

  const FIELD_DEFS = [
    { key: "document", label: "Documento", standard: ["DOCUMENTO", "DOCUMENTO Nº", "CODIGO DOCUMENTO", "CODIGO DO DOCUMENTO"], aliases: ["NOME DOCUMENTO", "NUMERO DOCUMENTO", "IDENTIFICADOR DOCUMENTO"] },
    { key: "revision", label: "Revisão", standard: ["REVISAO", "REV.", "REV"], aliases: ["VERSAO DOCUMENTO", "REVISAO DOCUMENTO", "REVISAO ATUAL"] },
    { key: "sigemStatus", label: "Status SIGEM", standard: ["STATUS SIGEM"], aliases: ["SITUACAO SIGEM", "SITUACAO NO SIGEM", "ESTADO SIGEM"] },
    { key: "status", label: "Status", standard: ["STATUS"], aliases: ["SITUACAO", "ESTADO", "STATUS DOCUMENTO"] },
    { key: "title", label: "Título", standard: ["TITULO", "TITULO DO DOCUMENTO"], aliases: ["DESCRICAO DOCUMENTO", "NOME DO DOCUMENTO"] },
    { key: "grdt", label: "GRDT", standard: ["GRDT", "NUMERO GRDT", "Nº GRDT"], aliases: ["EGRDT", "GRDT RELACIONADA", "DOCUMENTO GRDT"] },
    { key: "effectiveDate", label: "Data efetiva de emissão", standard: ["DATA EFETIVA DE EMISSAO", "DATA DE EMISSAO"], aliases: ["DATA EFETIVA", "EMISSAO EFETIVA"] },
    { key: "format", label: "Formato", standard: ["FORMATO"], aliases: ["FORMATO DOCUMENTO"] },
    { key: "discipline", label: "Disciplina", standard: ["DISCIPLINA"], aliases: ["AREA DISCIPLINA", "DISCIPLINA DOCUMENTO"] },
    { key: "documentType", label: "Tipo de documento", standard: ["TIPO DE DOCUMENTO", "TIPO DOCUMENTO"], aliases: ["TIPO DOC", "CATEGORIA DOCUMENTAL"] },
    { key: "purpose", label: "Propósito", standard: ["PROPOSITO", "FINALIDADE", "PROPOSITO DE EMISSAO", "FINALIDADE DA REVISAO"], aliases: ["MOTIVO DE EMISSAO"] },
    { key: "databook", label: "Caminho Databook", standard: ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"], aliases: ["DATABOOK", "CAMINHO DO DATABOOK", "LOCAL DATABOOK"] },
    { key: "fiscalComment", label: "Comentário da Fiscal", standard: ["COMENTARIO DA FISCAL"], aliases: ["COMENTARIO FISCAL", "COMENTARIOS DA FISCAL", "RETORNO DA FISCAL"] },
    { key: "allocationStatus", label: "Confirmação de alocação", standard: ["CONFIRMACAO DE DOCUMENTOS PREVISTOS"], aliases: ["STATUS DE ALOCACAO", "SITUACAO DE ALOCACAO", "ALOCADO"] },
    { key: "allocationStage", label: "Etapa da alocação", standard: ["ETAPA DA ALOCACAO"], aliases: ["FASE DA ALOCACAO", "ETAPA ALOCACAO"] },
    { key: "modified", label: "Modificado em", standard: ["MODIFICADO EM"], aliases: ["DATA DE MODIFICACAO", "ULTIMA MODIFICACAO"] },
    { key: "included", label: "Incluído em", standard: ["INCLUIDO EM"], aliases: ["DATA DE INCLUSAO", "CRIADO EM"] },
    { key: "allocation", label: "Alocação", standard: ["ALOCACAO"], aliases: ["NUMERO DA ALOCACAO", "Nº ALOCACAO"] },
  ];
  const REQUIRED_TECHNICAL = ["document", "revision"];
  const REQUIRED_HISTORY = ["document", "revision"];
  const TECHNICAL_FIELDS = new Set(["document", "revision", "title", "format", "discipline", "documentType", "purpose", "databook", "fiscalComment", "allocationStatus", "allocationStage", "allocation"]);
  const HISTORY_FIELDS = new Set(["document", "revision", "sigemStatus", "status", "grdt", "effectiveDate", "modified", "included"]);
  const entries = new WeakMap();
  const pending = new WeakMap();
  let currentFile = null;

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function norm(value) {
    return C ? C.norm(value) : text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function cellValue(sheet, row, column) {
    if (!sheet || !root.XLSX) return "";
    const item = sheet[root.XLSX.utils.encode_cell({ r: row, c: column })];
    return item ? text(item.w !== undefined ? item.w : item.v) : "";
  }

  function matchHeader(value) {
    const header = norm(value);
    if (!header) return null;
    if (/^DOCUMENTO\s+/.test(header) && !/^DOCUMENTOS\s+/.test(header)) return { field: "document", kind: "standard", score: 100 };
    for (const field of FIELD_DEFS) {
      if (field.standard.some((item) => norm(item) === header)) return { field: field.key, kind: "standard", score: 100 };
    }
    for (const field of FIELD_DEFS) {
      if (field.aliases.some((item) => norm(item) === header)) return { field: field.key, kind: "alias", score: 92 };
    }
    for (const field of FIELD_DEFS) {
      const candidates = [...field.standard, ...field.aliases].map(norm);
      if (candidates.some((candidate) => header.includes(candidate) || candidate.includes(header))) {
        if (header.length >= 6) return { field: field.key, kind: "suggested", score: 76 };
      }
    }
    return null;
  }

  function mapHeaders(headers) {
    const columns = {};
    const matches = {};
    headers.forEach((header, column) => {
      const match = matchHeader(header);
      if (!match || columns[match.field] !== undefined) return;
      columns[match.field] = column;
      matches[match.field] = { ...match, header: text(header), column };
    });
    return { columns, matches };
  }

  function rowHeaders(sheet, row, startColumn, endColumn) {
    const headers = [];
    for (let column = startColumn; column <= endColumn; column += 1) headers[column] = cellValue(sheet, row, column);
    return headers;
  }

  function rowScore(mapped) {
    const columns = mapped.columns;
    let score = Object.keys(columns).length * 3;
    if (columns.document !== undefined) score += 35;
    if (columns.revision !== undefined) score += 22;
    if (columns.sigemStatus !== undefined || columns.status !== undefined) score += 16;
    if (columns.grdt !== undefined) score += 7;
    if (columns.effectiveDate !== undefined) score += 7;
    return score;
  }

  function detectCellMode(sheet, headerRow, columns, range) {
    let formulas = 0;
    let values = 0;
    let dateMode = "não identificada";
    const dateColumn = columns.effectiveDate;
    const fields = Object.values(columns);
    for (let row = headerRow + 1; row <= Math.min(range.e.r, headerRow + 80); row += 1) {
      fields.forEach((column) => {
        const item = sheet[root.XLSX.utils.encode_cell({ r: row, c: column })];
        if (!item || item.v === undefined || item.v === "") return;
        if (item.f) formulas += 1;
        else values += 1;
      });
      if (dateColumn !== undefined && dateMode === "não identificada") {
        const item = sheet[root.XLSX.utils.encode_cell({ r: row, c: dateColumn })];
        if (item && item.v !== undefined && item.v !== "") {
          if (item.v instanceof Date) dateMode = "data do Excel";
          else if (typeof item.v === "number") dateMode = "número serial do Excel";
          else if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(text(item.v))) dateMode = "texto brasileiro";
          else if (/^\d{4}-\d{2}-\d{2}/.test(text(item.v))) dateMode = "texto ISO";
          else dateMode = "texto";
        }
      }
    }
    return { formulas, values, dateMode, sourceMode: formulas && values ? "fórmulas e valores" : formulas ? "fórmulas" : "valores" };
  }

  function inspectSheet(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) return { name: sheetName, role: "ignore", headerRow: 0, headers: [], columns: {}, matches: {}, score: 0, sourceMode: "vazio", dateMode: "não identificada" };
    const range = root.XLSX.utils.decode_range(sheet["!ref"]);
    const endColumn = Math.min(range.e.c, 100);
    const candidates = [];
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 99); row += 1) {
      const headers = rowHeaders(sheet, row, range.s.c, endColumn);
      const mapped = mapHeaders(headers);
      const nonEmpty = headers.filter(Boolean).length;
      if (!nonEmpty) continue;
      candidates.push({ row, headers, ...mapped, score: rowScore(mapped), preview: headers.filter(Boolean).slice(0, 4).join(" · ") });
    }
    const best = candidates.sort((left, right) => right.score - left.score || left.row - right.row)[0]
      || { row: range.s.r, headers: [], columns: {}, matches: {}, score: 0, preview: "" };
    const mode = detectCellMode(sheet, best.row, best.columns, range);
    return {
      name: sheetName,
      role: "ignore",
      headerRow: best.row,
      headers: best.headers,
      columns: { ...best.columns },
      matches: { ...best.matches },
      score: best.score,
      candidates,
      ...mode,
    };
  }

  function inspect(workbook) {
    const sheets = (workbook.SheetNames || []).map((sheetName) => inspectSheet(workbook, sheetName));
    const usable = sheets.filter((sheet) => sheet.columns.document !== undefined && sheet.columns.revision !== undefined);
    const historyCandidates = usable.map((sheet) => {
      const name = norm(sheet.name);
      const historyScore = (name === "COLAR SIGEM" ? 40 : name.includes("SIGEM") ? 22 : 0)
        + (sheet.columns.sigemStatus !== undefined ? 12 : 0)
        + (sheet.columns.included !== undefined ? 7 : 0)
        + (sheet.columns.modified !== undefined ? 7 : 0)
        + (sheet.columns.status !== undefined ? 3 : 0);
      return { sheet, historyScore };
    }).sort((left, right) => right.historyScore - left.historyScore);
    const history = historyCandidates[0] && historyCandidates[0].historyScore >= 8 ? historyCandidates[0].sheet : null;
    sheets.forEach((sheet) => {
      if (sheet === history) sheet.role = "history";
      else if (usable.includes(sheet)) sheet.role = "technical";
    });

    const issues = [];
    const changes = [];
    const technical = sheets.filter((sheet) => sheet.role === "technical");
    if (!technical.length) issues.push("Nenhuma aba técnica foi identificada.");
    if (!history) issues.push("A base de status do SIGEM não foi identificada.");
    sheets.filter((sheet) => sheet.role !== "ignore").forEach((sheet) => {
      const required = sheet.role === "history" ? REQUIRED_HISTORY : REQUIRED_TECHNICAL;
      required.forEach((field) => {
        if (sheet.columns[field] === undefined) issues.push(`${sheet.name}: campo ${FIELD_DEFS.find((item) => item.key === field).label} não localizado.`);
      });
      if (sheet.role === "history" && sheet.columns.sigemStatus === undefined && sheet.columns.status === undefined) issues.push(`${sheet.name}: Status SIGEM não localizado.`);
      Object.values(sheet.matches).forEach((match) => {
        if (match.kind !== "standard") changes.push(`${sheet.name}: “${match.header}” associado a ${FIELD_DEFS.find((item) => item.key === match.field).label}.`);
      });
      const normalizedName = norm(sheet.name);
      const expectedTechnicalModes = { "N-1710": "fórmulas e valores", ET: "fórmulas e valores", CV: "fórmulas e valores", RNC: "valores" };
      if (sheet.role === "technical" && expectedTechnicalModes[normalizedName] === undefined) {
        changes.push(`A aba “${sheet.name}” foi associada como aba técnica.`);
      }
      if (sheet.role === "technical" && expectedTechnicalModes[normalizedName]
        && sheet.sourceMode !== expectedTechnicalModes[normalizedName]) {
        changes.push(`${sheet.name}: conteúdo identificado como ${sheet.sourceMode}; o padrão anterior era ${expectedTechnicalModes[normalizedName]}.`);
      }
      if (sheet.role === "history" && normalizedName === "COLAR SIGEM" && sheet.sourceMode !== "valores") {
        changes.push(`${sheet.name}: conteúdo identificado como ${sheet.sourceMode}; o padrão anterior era valores.`);
      }
      if (sheet.columns.effectiveDate !== undefined && !["data do Excel", "não identificada"].includes(sheet.dateMode)) {
        changes.push(`${sheet.name}: Data efetiva de emissão identificada como ${sheet.dateMode}.`);
      }
    });
    if (history && norm(history.name) !== "COLAR SIGEM") changes.push(`A aba “${history.name}” foi associada à base de status do SIGEM.`);
    return {
      sheets,
      issues: [...new Set(issues)],
      changes: [...new Set(changes)],
      requiresConfirmation: issues.length > 0 || changes.length > 0,
    };
  }

  function profileFromInspection(inspection) {
    const sheets = {};
    (inspection.sheets || []).forEach((sheet) => {
      sheets[sheet.name] = { role: sheet.role, headerRow: sheet.headerRow, columns: { ...sheet.columns } };
    });
    return { version: 1, sheets };
  }

  function validateProfile(profile) {
    const configs = Object.entries(profile && profile.sheets || {});
    const issues = [];
    const technical = configs.filter(([, config]) => config.role === "technical");
    const history = configs.filter(([, config]) => config.role === "history");
    if (!technical.length) issues.push("Nenhuma aba técnica foi reconhecida automaticamente.");
    if (history.length !== 1) issues.push("A base SIGEM não foi reconhecida automaticamente de forma única.");
    technical.forEach(([name, config]) => REQUIRED_TECHNICAL.forEach((field) => {
      if (config.columns[field] === undefined) issues.push(`${name}: campo não localizado: ${FIELD_DEFS.find((item) => item.key === field).label}.`);
    }));
    history.forEach(([name, config]) => {
      REQUIRED_HISTORY.forEach((field) => {
        if (config.columns[field] === undefined) issues.push(`${name}: campo não localizado: ${FIELD_DEFS.find((item) => item.key === field).label}.`);
      });
      if (config.columns.sigemStatus === undefined && config.columns.status === undefined) issues.push(`${name}: campo não localizado: Status ou Status SIGEM.`);
    });
    configs.filter(([, config]) => config.role !== "ignore").forEach(([name, config]) => {
      const used = new Map();
      Object.entries(config.columns || {}).forEach(([field, column]) => {
        if (!used.has(column)) used.set(column, []);
        used.get(column).push(field);
      });
      used.forEach((fields, column) => {
        if (fields.length > 1) {
          const labels = fields.map((field) => FIELD_DEFS.find((item) => item.key === field)?.label || field).join(" e ");
          issues.push(`${name}: a coluna ${Number(column) + 1} foi reconhecida para mais de um campo (${labels}). Cada coluna deve ter uma única função.`);
        }
      });
    });
    return [...new Set(issues)];
  }

  async function readWorkbook(file) {
    if (root.RECONWorkbookWorker) return root.RECONWorkbookWorker.read(file, { cellDates: true, cellFormula: true });
    const data = root.RECONFileAccess ? await root.RECONFileAccess.readArrayBuffer(file) : await file.arrayBuffer();
    return root.XLSX.read(data, { type: "array", cellDates: true, cellFormula: true });
  }

  function dispatch(file) {
    if (typeof document === "undefined") return;
    document.dispatchEvent(new CustomEvent("recon:ld-compatibility", { detail: { file, ready: ready(file), inspection: inspectionFor(file) } }));
  }

  async function prepare(file, options) {
    if (!file) return null;
    if (entries.has(file)) {
      const existing = entries.get(file);
      return existing;
    }
    if (!pending.has(file)) {
      pending.set(file, (async () => {
        const workbook = await readWorkbook(file);
        const inspection = inspect(workbook);
        const entry = {
          file,
          workbook,
          inspection,
          profile: profileFromInspection(inspection),
          confirmed: true,
        };
        entries.set(file, entry);
        dispatch(file);
        return entry;
      })());
    }
    try {
      const entry = await pending.get(file);
      return entry;
    } finally {
      pending.delete(file);
    }
  }

  function entryFor(file) { return file ? entries.get(file) || null : null; }
  function profileFor(file) { return entryFor(file) && entryFor(file).profile || null; }
  function inspectionFor(file) { return entryFor(file) && entryFor(file).inspection || null; }
  function workbookFor(file) { return entryFor(file) && entryFor(file).workbook || null; }
  function ready(file) { return Boolean(entryFor(file)); }

  // A gaveta de confirmação manual foi removida da interface: a estrutura da LD
  // passou a ser reconhecida automaticamente. open() e close() continuam
  // existindo porque fazem parte da API pública do módulo, mas não há mais
  // #ld-compatibility-overlay nem #ld-compatibility-drawer no index.html para
  // manipular — procurá-los só produzia referências mortas.
  function close() {}

  function open() {
    // A estrutura é reconhecida automaticamente. Não existe confirmação manual.
    close();
  }

  return {
    FIELD_DEFS,
    inspect,
    profileFromInspection,
    validateProfile,
    prepare,
    profileFor,
    inspectionFor,
    workbookFor,
    ready,
    open,
    close,
  };
});
