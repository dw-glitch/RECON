(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingParsers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ACCEPTED = Object.freeze({
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
  });

  // As LDs reais possuem abas auxiliares enormes (por exemplo "Colar SIGEM")
  // e, em alguns casos, um !ref contaminado por formatação até quase XFD.
  // Nunca devemos percorrer o retângulo inteiro informado pelo Excel.
  const LD_MAX_COLUMNS = 400;
  const LD_MAX_ROWS = 100000;
  const LD_HEADER_SCAN_ROWS = 120;

  function extension(name) {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function detectedType(file) {
    const mime = String(file && file.type || "").toLowerCase();
    const ext = extension(file && file.name);
    if (mime === "application/pdf" || ext === "pdf") return "pdf";
    if (mime.includes("wordprocessingml") || ext === "docx") return "docx";
    if (mime.includes("spreadsheet") || mime.includes("excel") || ["xlsx", "xls", "xlsm"].includes(ext)) return "xlsx";
    return "unknown";
  }

  function validateInputFile(file, expected) {
    if (!file || typeof file.arrayBuffer !== "function") return { valid: false, reason: "Arquivo inválido." };
    const type = detectedType(file);
    if (expected && !expected.includes(type)) return { valid: false, reason: `Tipo ${type || "desconhecido"} não permitido neste campo.` };
    if (!["pdf", "docx", "xlsx"].includes(type)) return { valid: false, reason: "Somente PDF, DOCX e planilhas Excel são aceitos pelo módulo." };
    if (file.size <= 0) return { valid: false, reason: "Arquivo vazio." };
    return { valid: true, type };
  }

  async function sha256Buffer(buffer) {
    if (!root.crypto || !root.crypto.subtle || !buffer) return "";
    const digest = await root.crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256(file) {
    return sha256Buffer(await file.arrayBuffer());
  }

  function xmlText(xmlString) {
    if (!xmlString) return "";
    if (root.DOMParser) {
      const doc = new root.DOMParser().parseFromString(xmlString, "application/xml");
      return [...doc.querySelectorAll("w\\:t, t")].map((node) => node.textContent || "").join(" ").replace(/\s+/g, " ").trim();
    }
    return String(xmlString).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  }

  async function parseDocx(file, options) {
    const opts = options || {};
    const JSZip = root.JSZip;
    if (!JSZip) throw new Error("JSZip não carregado; não foi possível abrir o DOCX.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
    const names = Object.keys(zip.files);
    const targets = names.filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name));
    const properties = names.filter((name) => /^docProps\/(core|app)\.xml$/i.test(name));
    const pieces = [];
    for (const name of [...targets, ...properties]) {
      if (opts.signal && opts.signal.aborted) throw new DOMException("Cancelado", "AbortError");
      const xml = await zip.file(name).async("string");
      const value = xmlText(xml);
      if (value) pieces.push({ source: name, text: value });
    }
    const fullText = pieces.map((item) => `[${item.source}]\n${item.text}`).join("\n");
    return {
      type: "docx",
      filename: file.name,
      text: fullText,
      sections: pieces,
      pageCount: null,
      textLength: fullText.length,
      scanned: false,
      ocrRequired: false,
      warnings: [],
    };
  }

  async function parsePdf(file, options) {
    const opts = options || {};
    const pdfjs = root.pdfjsLib || root.PDFJS;
    if (!pdfjs || typeof pdfjs.getDocument !== "function") throw new Error("PDF.js não carregado; não foi possível ler o PDF.");
    const buffer = await file.arrayBuffer();
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableAutoFetch: false, disableStream: false });
    const pdf = await task.promise;
    const pageCount = pdf.numPages;
    const pages = [];
    let nonEmptyPages = 0;
    const chunkSize = Math.max(1, Math.min(8, Number(opts.pageConcurrency || 3)));

    for (let start = 1; start <= pageCount; start += chunkSize) {
      if (opts.signal && opts.signal.aborted) throw new DOMException("Cancelado", "AbortError");
      const pageNumbers = [];
      for (let p = start; p < start + chunkSize && p <= pageCount; p += 1) pageNumbers.push(p);
      const batch = await Promise.all(pageNumbers.map(async (pageNumber) => {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ normalizeWhitespace: true });
        const pageText = (content.items || []).map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
        if (typeof page.cleanup === "function") page.cleanup();
        return { page: pageNumber, text: pageText };
      }));
      batch.forEach((entry) => {
        if (entry.text.length >= 15) nonEmptyPages += 1;
        pages.push(entry);
        if (typeof opts.onProgress === "function") opts.onProgress({ processedPages: pages.length, totalPages: pageCount });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (typeof pdf.cleanup === "function") pdf.cleanup();
    if (typeof pdf.destroy === "function") await pdf.destroy();
    const fullText = pages.map((item) => `[PÁGINA ${item.page}]\n${item.text}`).join("\n");
    const scanned = pageCount > 0 && nonEmptyPages / pageCount < 0.35;
    const ocrRequired = scanned || fullText.replace(/\s+/g, "").length < Math.max(80, pageCount * 20);
    const warnings = [];
    if (ocrRequired) warnings.push("Pouco texto nativo detectado. OCR é necessário para classificação segura deste PDF.");

    if (ocrRequired && root.RECONDocumentCodingOCRAdapter && typeof root.RECONDocumentCodingOCRAdapter.extract === "function") {
      const ocr = await root.RECONDocumentCodingOCRAdapter.extract(file, { signal: opts.signal, pageCount });
      if (ocr && ocr.text) {
        return Object.assign({ type: "pdf", filename: file.name, pageCount, scanned, ocrRequired: false, warnings }, ocr, { nativeText: fullText });
      }
    }

    return {
      type: "pdf",
      filename: file.name,
      text: fullText,
      pages,
      pageCount,
      textLength: fullText.length,
      scanned,
      ocrRequired,
      warnings,
    };
  }

  async function parseDocument(file, options) {
    const check = validateInputFile(file, ["pdf", "docx"]);
    if (!check.valid) throw new Error(check.reason);
    const parsed = check.type === "pdf" ? await parsePdf(file, options) : await parseDocx(file, options);
    parsed.hash = await sha256(file);
    parsed.size = file.size;
    parsed.mime = file.type || (check.type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    return parsed;
  }

  function normalizeCellValue(value) {
    if (value instanceof Date) return value.toISOString();
    return value === null || value === undefined ? "" : value;
  }

  function normSheetName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isAuxiliaryLdSheetName(name) {
    const value = normSheetName(name);
    if (!value) return true;
    if (value === "CAPA" || value === "COLAR SIGEM" || value === "LEGENDA") return true;
    if (/^INDICADOR(?:\s|$)/.test(value)) return true;
    if (/^(?:T|G)$/.test(value)) return true;
    if (/^(?:DASHBOARD|GRAFICO|GRAFICOS)(?:\s|$)/.test(value)) return true;
    return false;
  }

  function selectLdSheetNames(sheetNames) {
    const input = Array.isArray(sheetNames) ? sheetNames : [];
    const selected = input.filter((name) => !isAuxiliaryLdSheetName(name));
    // Nunca volte automaticamente a "Colar SIGEM"/CAPA. Caso uma planilha só
    // possua abas desconhecidas, elas permanecem candidatas e o detector de
    // cabeçalho decide se são uma LD de fato.
    return selected;
  }

  function sheetCell(sheet, row, column) {
    if (!sheet || !root.XLSX || !root.XLSX.utils) return "";
    const item = sheet[root.XLSX.utils.encode_cell({ r: row, c: column })];
    if (!item) return "";
    const value = item.w !== undefined && item.w !== null && item.w !== "" ? item.w : item.v;
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function normHeader(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function headerAssessment(cells) {
    const normalized = (cells || []).map(normHeader);
    const hasDocument = normalized.some((cell) => cell === "DOCUMENTO" || cell.startsWith("DOCUMENTO ") || cell.includes("CODIGO DO DOCUMENTO") || cell === "CODIGO DOCUMENTO" || cell === "N DOCUMENTO");
    const hasTitle = normalized.some((cell) => cell === "TITULO" || cell.includes("TITULO DO DOCUMENTO"));
    const hasRevision = normalized.some((cell) => cell === "REVISAO" || cell === "REV" || cell === "REV.");
    const hasDiscipline = normalized.some((cell) => cell === "DISCIPLINA" || cell.includes("DISCIPLINA"));
    const hasStatus = normalized.some((cell) => cell === "STATUS" || cell.includes("STATUS SIGEM"));
    const hasItem = normalized.some((cell) => cell === "ITEM");
    const hasTracking = normalized.some((cell) => cell.includes("GRDT") || cell.includes("ALOCA") || cell.includes("TAXONOMIA") || cell === "EAP");
    const score = (hasDocument ? 8 : 0) + (hasTitle ? 3 : 0) + (hasRevision ? 2 : 0) + (hasDiscipline ? 2 : 0) + (hasStatus ? 1 : 0) + (hasItem ? 1 : 0) + (hasTracking ? 1 : 0);
    return { score, hasDocument, hasTitle, hasRevision, hasDiscipline, hasStatus };
  }

  function findLdHeader(sheet) {
    if (!sheet || !sheet["!ref"] || !root.XLSX || !root.XLSX.utils) return null;
    let range;
    try { range = root.XLSX.utils.decode_range(sheet["!ref"]); }
    catch (_) { return null; }
    const lastColumn = Math.min(range.e.c, LD_MAX_COLUMNS - 1);
    const lastRow = Math.min(range.e.r, range.s.r + LD_HEADER_SCAN_ROWS - 1, LD_MAX_ROWS - 1);
    let best = null;
    for (let r = range.s.r; r <= lastRow; r += 1) {
      const cells = [];
      for (let c = range.s.c; c <= lastColumn; c += 1) cells.push(sheetCell(sheet, r, c));
      const assessment = headerAssessment(cells);
      if (!best || assessment.score > best.score) best = Object.assign({ row: r }, assessment);
      if (assessment.hasDocument && assessment.score >= 12) return Object.assign({ row: r }, assessment);
    }
    return best && best.hasDocument && best.score >= 9 ? best : null;
  }

  function cellHasValue(cell) {
    if (!cell || typeof cell !== "object") return false;
    if (cell.v !== undefined && cell.v !== null && String(cell.v) !== "") return true;
    if (cell.w !== undefined && cell.w !== null && String(cell.w) !== "") return true;
    if (cell.f !== undefined && cell.f !== null && String(cell.f) !== "") return true;
    return false;
  }

  function logicalLdRange(sheet, headerRow) {
    let maxRow = Number(headerRow);
    let maxColumn = 0;
    const keys = Object.keys(sheet || {});
    for (const address of keys) {
      if (!address || address[0] === "!") continue;
      let decoded;
      try { decoded = root.XLSX.utils.decode_cell(address); }
      catch (_) { continue; }
      if (decoded.r < headerRow || decoded.r >= LD_MAX_ROWS || decoded.c >= LD_MAX_COLUMNS) continue;
      if (!cellHasValue(sheet[address])) continue;
      if (decoded.r > maxRow) maxRow = decoded.r;
      if (decoded.c > maxColumn) maxColumn = decoded.c;
    }
    return {
      s: { r: headerRow, c: 0 },
      e: { r: Math.max(headerRow, maxRow), c: Math.max(0, maxColumn) },
    };
  }

  function parseLdSheet(sheet, sheetName, fileName) {
    const header = findLdHeader(sheet);
    if (!header) return { rows: [], diagnostic: { sheet: sheetName, included: false, reason: "Cabeçalho de LD não identificado" } };
    const safeRange = logicalLdRange(sheet, header.row);
    const width = safeRange.e.c - safeRange.s.c + 1;
    const height = safeRange.e.r - safeRange.s.r + 1;
    if (width <= 0 || height <= 1) return { rows: [], diagnostic: { sheet: sheetName, included: false, reason: "Aba sem linhas de documentos" } };

    const sheetRows = root.XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      blankrows: false,
      range: safeRange,
    });
    const rows = [];
    sheetRows.forEach((row, index) => {
      const clean = {};
      let filled = 0;
      Object.keys(row || {}).forEach((key) => {
        clean[key] = normalizeCellValue(row[key]);
        if (clean[key] !== "") filled += 1;
      });
      if (!filled) return;
      rows.push({ row: clean, meta: { name: fileName, sheet: sheetName, rowNumber: header.row + index + 2 } });
    });
    return {
      rows,
      diagnostic: {
        sheet: sheetName,
        included: true,
        headerRow: header.row + 1,
        rows: rows.length,
        columns: width,
        safeRange: root.XLSX.utils.encode_range(safeRange),
      },
    };
  }

  async function parseLdWorkbook(file) {
    const check = validateInputFile(file, ["xlsx"]);
    if (!check.valid) throw new Error(check.reason);
    if (!root.XLSX) throw new Error("Biblioteca XLSX não carregada.");

    // Uma única leitura do arquivo: antes o hash fazia um segundo arrayBuffer(),
    // dobrando o pico de memória para LDs grandes.
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);

    // 1) Leitura leve apenas do catálogo de abas.
    const manifest = root.XLSX.read(data, { type: "array", bookSheets: true, bookProps: false });
    const allSheetNames = Array.isArray(manifest.SheetNames) ? manifest.SheetNames.slice() : [];
    const candidates = selectLdSheetNames(allSheetNames);
    if (!candidates.length) throw new Error("Nenhuma aba candidata a LD foi encontrada. As abas auxiliares (CAPA/Colar SIGEM/indicadores) foram ignoradas por segurança.");

    // 2) Abre somente as abas candidatas. Isso impede que "Colar SIGEM" com
    // dezenas de milhares de linhas seja descompactada/convertida sem necessidade.
    const workbook = root.XLSX.read(data, {
      type: "array",
      cellDates: true,
      dense: false,
      sheets: candidates,
    });

    const rows = [];
    const diagnostics = [];
    const includedSheetNames = [];
    for (const sheetName of candidates) {
      const sheet = workbook.Sheets && workbook.Sheets[sheetName];
      if (!sheet) continue;
      const parsed = parseLdSheet(sheet, sheetName, file.name);
      diagnostics.push(parsed.diagnostic);
      if (parsed.rows.length) {
        includedSheetNames.push(sheetName);
        for (const item of parsed.rows) rows.push(item);
      }
      // Entrega tempo ao navegador entre abas grandes para evitar watchdog/
      // STATUS_BREAKPOINT em máquinas corporativas mais limitadas.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (!rows.length) {
      const inspected = diagnostics.map((item) => `${item.sheet}: ${item.reason || "0 registros"}`).join("; ");
      throw new Error(`Nenhuma tabela de documentos foi identificada nas abas candidatas. ${inspected}`);
    }

    const hash = await sha256Buffer(buffer);
    return {
      filename: file.name,
      sheetNames: includedSheetNames,
      allSheetNames,
      skippedSheetNames: allSheetNames.filter((name) => !includedSheetNames.includes(name)),
      rows,
      count: rows.length,
      hash,
      diagnostics,
    };
  }

  async function mapPool(items, worker, options) {
    const opts = options || {};
    const requestedConcurrency = Math.max(1, Math.min(8, Number(opts.concurrency || 3)));
    // A leitura de uma LD pode expandir dezenas de MB de XML para objetos JS.
    // Duas LDs simultâneas foram suficientes para derrubar a aba do Edge com
    // STATUS_BREAKPOINT. LDs são, portanto, processadas estritamente uma a uma.
    const concurrency = worker === parseLdWorkbook ? 1 : requestedConcurrency;
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;
    async function runner() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        if (opts.signal && opts.signal.aborted) throw new DOMException("Cancelado", "AbortError");
        try {
          results[index] = { ok: true, value: await worker(items[index], index) };
        } catch (error) {
          results[index] = { ok: false, error };
          if (opts.stopOnError) throw error;
        } finally {
          completed += 1;
          if (typeof opts.onProgress === "function") opts.onProgress({ completed, total: items.length, index });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => runner()));
    return results;
  }

  return Object.freeze({
    ACCEPTED,
    LD_MAX_COLUMNS,
    LD_MAX_ROWS,
    LD_HEADER_SCAN_ROWS,
    extension,
    detectedType,
    validateInputFile,
    sha256,
    sha256Buffer,
    xmlText,
    parseDocx,
    parsePdf,
    parseDocument,
    normSheetName,
    isAuxiliaryLdSheetName,
    selectLdSheetNames,
    headerAssessment,
    findLdHeader,
    logicalLdRange,
    parseLdSheet,
    parseLdWorkbook,
    mapPool,
  });
});
