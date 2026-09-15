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

  async function sha256(file) {
    if (!root.crypto || !root.crypto.subtle) return "";
    const buffer = await file.arrayBuffer();
    const digest = await root.crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    const pages = [];
    let nonEmptyPages = 0;
    const chunkSize = Math.max(1, Math.min(8, Number(opts.pageConcurrency || 3)));

    for (let start = 1; start <= pdf.numPages; start += chunkSize) {
      if (opts.signal && opts.signal.aborted) throw new DOMException("Cancelado", "AbortError");
      const pageNumbers = [];
      for (let p = start; p < start + chunkSize && p <= pdf.numPages; p += 1) pageNumbers.push(p);
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
        if (typeof opts.onProgress === "function") opts.onProgress({ processedPages: pages.length, totalPages: pdf.numPages });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (typeof pdf.cleanup === "function") pdf.cleanup();
    if (typeof pdf.destroy === "function") await pdf.destroy();
    const fullText = pages.map((item) => `[PÁGINA ${item.page}]\n${item.text}`).join("\n");
    const scanned = pdf.numPages > 0 && nonEmptyPages / pdf.numPages < 0.35;
    const ocrRequired = scanned || fullText.replace(/\s+/g, "").length < Math.max(80, pdf.numPages * 20);
    const warnings = [];
    if (ocrRequired) warnings.push("Pouco texto nativo detectado. OCR é necessário para classificação segura deste PDF.");

    if (ocrRequired && root.RECONDocumentCodingOCRAdapter && typeof root.RECONDocumentCodingOCRAdapter.extract === "function") {
      const ocr = await root.RECONDocumentCodingOCRAdapter.extract(file, { signal: opts.signal, pageCount: pdf.numPages });
      if (ocr && ocr.text) {
        return Object.assign({ type: "pdf", filename: file.name, pageCount: pdf.numPages, scanned, ocrRequired: false, warnings }, ocr, { nativeText: fullText });
      }
    }

    return {
      type: "pdf",
      filename: file.name,
      text: fullText,
      pages,
      pageCount: pdf.numPages,
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

  async function parseLdWorkbook(file) {
    const check = validateInputFile(file, ["xlsx"]);
    if (!check.valid) throw new Error(check.reason);
    if (!root.XLSX) throw new Error("Biblioteca XLSX não carregada.");
    const data = new Uint8Array(await file.arrayBuffer());
    const workbook = root.XLSX.read(data, { type: "array", cellDates: true, dense: false });
    const rows = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;
      const sheetRows = root.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      sheetRows.forEach((row, index) => {
        const clean = {};
        Object.keys(row).forEach((key) => { clean[key] = normalizeCellValue(row[key]); });
        rows.push({ row: clean, meta: { name: file.name, sheet: sheetName, rowNumber: index + 2 } });
      });
    });
    return { filename: file.name, sheetNames: workbook.SheetNames.slice(), rows, count: rows.length, hash: await sha256(file) };
  }

  async function mapPool(items, worker, options) {
    const opts = options || {};
    const concurrency = Math.max(1, Math.min(8, Number(opts.concurrency || 3)));
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
    extension,
    detectedType,
    validateInputFile,
    sha256,
    xmlText,
    parseDocx,
    parsePdf,
    parseDocument,
    parseLdWorkbook,
    mapPool,
  });
});
