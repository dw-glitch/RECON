(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingPDF = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const PDF_LIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const APPROVED_COVER_SHA256 = "ead0a55d21c7d14e99d2aca5fa0d4f73aaf0e28e6f561a3b9a601612cce2adfc";
  const COVER_ID = "petrobras-rnest-n381-cover-v1";
  const A4 = Object.freeze({ width: 595.32, height: 842.04 });

  // Coordenadas derivadas da CAPA (1).pdf fornecida para o projeto. O template
  // original continua sendo a fonte visual: os retângulos abaixo apagam apenas
  // valores variáveis, preservando linhas, marca e tipografia estrutural.
  const COVER_FIELDS = Object.freeze({
    documentNumber: { x: 365, top: 29, w: 202, h: 20, size: 10.5, bold: true, align: "center" },
    client: { x: 199, top: 48, w: 268, h: 18, size: 9.8, align: "center" },
    sheet: { x: 500, top: 48, w: 67, h: 18, size: 9.2, align: "center" },
    program: { x: 199, top: 65, w: 268, h: 18, size: 8.6, align: "center" },
    area: { x: 199, top: 82, w: 268, h: 18, size: 8.6, align: "center" },
    title: { x: 154, top: 106, w: 321, h: 23, size: 9.5, bold: true, align: "center" },
    management: { x: 476, top: 100, w: 91, h: 13, size: 6.6, align: "center" },
    classification: { x: 476, top: 115, w: 91, h: 14, size: 7.5, align: "center" },
    company: { x: 73, top: 139, w: 136, h: 14, size: 7.2, bold: true, align: "center" },
    technicalResponsible: { x: 211, top: 139, w: 253, h: 14, size: 7.1, bold: true, align: "center" },
    contract: { x: 73, top: 168, w: 137, h: 16, size: 7.2, bold: true, align: "center" },
    crea: { x: 212, top: 168, w: 55, h: 16, size: 7.2, bold: true, align: "center" },
    internalCode: { x: 269, top: 168, w: 196, h: 16, size: 6.6, bold: true, align: "center" },
    revisionDescription: { x: 112, top: 241, w: 450, h: 22, size: 8.5, align: "left" },
    revision: { x: 74, top: 241, w: 35, h: 22, size: 9.0, align: "center" },
    date: { x: 137, top: 726, w: 73, h: 11, size: 6.5, align: "center" },
    executor: { x: 137, top: 737, w: 73, h: 11, size: 6.3, align: "center" },
    verifier: { x: 137, top: 748, w: 73, h: 11, size: 6.1, align: "center" },
    approver: { x: 137, top: 760, w: 73, h: 11, size: 6.1, align: "center" },
  });

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && value.buffer instanceof ArrayBuffer) return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    throw new Error("Bytes de PDF inválidos.");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...root.document.querySelectorAll("script")].find((node) => node.src === src);
      if (existing) {
        if (root.PDFLib) return resolve(root.PDFLib);
        existing.addEventListener("load", () => resolve(root.PDFLib), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Não foi possível carregar ${src}`)), { once: true });
        return;
      }
      const script = root.document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => root.PDFLib ? resolve(root.PDFLib) : reject(new Error("pdf-lib carregou sem expor PDFLib."));
      script.onerror = () => reject(new Error("A biblioteca local de composição PDF não está disponível e o CDN foi bloqueado pela rede."));
      root.document.head.appendChild(script);
    });
  }

  async function ensurePdfLib() {
    if (root.PDFLib) return root.PDFLib;
    if (!root.document) throw new Error("pdf-lib indisponível fora do navegador.");
    return loadScript(PDF_LIB_URL);
  }

  function fieldRect(field) {
    return { x: field.x, y: A4.height - field.top - field.h, width: field.w, height: field.h };
  }

  function truncateToWidth(font, value, size, maxWidth) {
    let output = text(value);
    if (!output) return "";
    if (font.widthOfTextAtSize(output, size) <= maxWidth) return output;
    while (output.length > 4 && font.widthOfTextAtSize(`${output}…`, size) > maxWidth) output = output.slice(0, -1);
    return `${output.trim()}…`;
  }

  function drawFittedText(page, font, boldFont, value, field, color) {
    const raw = text(value);
    if (!raw) return;
    const f = field.bold ? boldFont : font;
    let size = field.size || 8;
    const min = Math.min(5.2, size);
    while (size > min && f.widthOfTextAtSize(raw, size) > field.w - 5) size -= 0.25;
    const printable = truncateToWidth(f, raw, size, field.w - 5);
    const width = f.widthOfTextAtSize(printable, size);
    let x = field.x + 2.5;
    if (field.align === "center") x = field.x + Math.max(2.5, (field.w - width) / 2);
    if (field.align === "right") x = field.x + field.w - width - 2.5;
    const y = A4.height - field.top - field.h + Math.max(1.5, (field.h - size) / 2);
    page.drawText(printable, { x, y, size, font: f, color });
  }

  async function sha256Buffer(buffer) {
    if (!root.crypto || !root.crypto.subtle) return "";
    const digest = await root.crypto.subtle.digest("SHA-256", bytes(buffer));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function validateTemplate(templateBytes) {
    const PDFLib = await ensurePdfLib();
    const input = bytes(templateBytes);
    const hash = await sha256Buffer(input);
    let pageCount = 0;
    let size = null;
    try {
      const doc = await PDFLib.PDFDocument.load(input, { ignoreEncryption: false, updateMetadata: false });
      pageCount = doc.getPageCount();
      const page = doc.getPage(0);
      size = page.getSize();
    } catch (error) {
      return { valid: false, hash, reason: `PDF de capa inválido: ${error.message}` };
    }
    const isA4 = size && Math.abs(size.width - A4.width) < 3 && Math.abs(size.height - A4.height) < 3;
    const exact = hash === APPROVED_COVER_SHA256;
    return {
      valid: isA4,
      exact,
      mapped: exact,
      hash,
      pageCount,
      size,
      reason: exact ? "Template oficial CAPA (1).pdf reconhecido pelo hash." : isA4 ? "PDF A4 válido, porém não é a versão mapeada da CAPA (1).pdf. Gere apenas após revisar o preview." : "O template não possui dimensão A4 compatível.",
    };
  }

  function coverValues(data) {
    const d = data || {};
    const rev = text(d.revision) || "0";
    const date = text(d.date);
    const datePt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : date;
    return {
      documentNumber: text(d.code || d.documentNumber),
      client: text(d.client) || "REFINO, GÁS E ENERGIA",
      sheet: text(d.sheet) || "1 de —",
      program: text(d.program) || "REFINARIA DO NORDESTE - ABREU E LIMA - RNEST",
      area: text(d.area || d.unitDescription || (d.unit ? `${d.unit}` : "")),
      title: text(d.title),
      management: text(d.management) || "SRGE/SI-IV/RNEST-T2",
      classification: text(d.classificationLabel) || "INTERNA",
      company: text(d.company),
      technicalResponsible: text(d.technicalResponsible),
      contract: text(d.contract),
      crea: text(d.crea),
      internalCode: text(d.internalCode),
      revision: rev,
      revisionDescription: text(d.revisionDescription) || (rev === "0" ? "EMISSÃO ORIGINAL" : "REVISÃO"),
      date: datePt,
      executor: text(d.executor),
      verifier: text(d.verifier),
      approver: text(d.approver),
    };
  }

  async function generateCover(templateBytes, data, options) {
    const opts = options || {};
    const PDFLib = await ensurePdfLib();
    const validation = await validateTemplate(templateBytes);
    if (!validation.valid) throw new Error(validation.reason);
    if (!validation.mapped && !opts.allowUnmappedTemplate) throw new Error("O PDF selecionado não corresponde ao template oficial mapeado. Confira e autorize explicitamente antes de gerar.");

    const source = await PDFLib.PDFDocument.load(bytes(templateBytes), { updateMetadata: false });
    const out = await PDFLib.PDFDocument.create();
    const [copied] = await out.copyPages(source, [0]);
    out.addPage(copied);
    const page = out.getPage(0);
    const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
    const boldFont = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const white = PDFLib.rgb(1, 1, 1);
    const black = PDFLib.rgb(0, 0, 0);
    const values = coverValues(data);

    Object.entries(COVER_FIELDS).forEach(([key, field]) => {
      const rect = fieldRect(field);
      // O inset de 0,7 pt evita apagar as linhas estruturais do formulário.
      page.drawRectangle({ x: rect.x + 0.7, y: rect.y + 0.7, width: Math.max(0, rect.width - 1.4), height: Math.max(0, rect.height - 1.4), color: white, borderWidth: 0 });
      drawFittedText(page, font, boldFont, values[key], field, black);
    });

    out.setTitle(values.documentNumber ? `${values.documentNumber} - ${values.title}` : values.title || "Documento técnico");
    out.setSubject("Capa de documento técnico gerada pelo RECON com base no template Petrobras fornecido");
    out.setCreator("RECON — Codificação de Documentos");
    out.setProducer("RECON / pdf-lib");
    return new Uint8Array(await out.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
  }

  async function mergePdf(coverBytes, originalBytes, options) {
    const opts = options || {};
    const PDFLib = await ensurePdfLib();
    const cover = await PDFLib.PDFDocument.load(bytes(coverBytes), { updateMetadata: false });
    const original = await PDFLib.PDFDocument.load(bytes(originalBytes), { ignoreEncryption: false, updateMetadata: false });
    const output = await PDFLib.PDFDocument.create();
    const coverPages = await output.copyPages(cover, [0]);
    coverPages.forEach((page) => output.addPage(page));
    const start = opts.replaceExistingCover ? 1 : 0;
    const indexes = [];
    for (let i = start; i < original.getPageCount(); i += 1) indexes.push(i);
    if (indexes.length) {
      const pages = await output.copyPages(original, indexes);
      pages.forEach((page) => output.addPage(page));
    }
    output.setTitle(text(opts.title));
    output.setSubject("Documento técnico consolidado pelo RECON");
    output.setCreator("RECON — Codificação de Documentos");
    output.setProducer("RECON / pdf-lib");
    return new Uint8Array(await output.save({ useObjectStreams: true, addDefaultPage: false }));
  }

  async function generateFinalPdf(params) {
    const p = params || {};
    if (!p.templateBytes) throw new Error("Template de capa não configurado.");
    if (!p.inputFile) throw new Error("Arquivo original não informado.");
    const type = String(p.inputType || "").toLowerCase();
    const cover = await generateCover(p.templateBytes, p.coverData || {}, p.coverOptions || {});
    let bodyBytes;
    if (type === "pdf") {
      bodyBytes = new Uint8Array(await p.inputFile.arrayBuffer());
    } else if (type === "docx") {
      const adapter = root.RECONDocumentCodingDocxPdfAdapter;
      if (!adapter || typeof adapter.convert !== "function") {
        throw new Error("A análise DOCX está disponível, mas a conversão fiel DOCX→PDF exige um adaptador de conversão compatível com o deploy. O RECON não rasteriza nem simula Word para evitar degradar o documento.");
      }
      bodyBytes = bytes(await adapter.convert(p.inputFile, { signal: p.signal }));
    } else {
      throw new Error(`Tipo de entrada não suportado para PDF final: ${type || "desconhecido"}.`);
    }
    return mergePdf(cover, bodyBytes, {
      replaceExistingCover: Boolean(p.replaceExistingCover),
      title: p.coverData && `${text(p.coverData.code)} - ${text(p.coverData.title)}`,
    });
  }

  function blobUrl(pdfBytes) {
    return URL.createObjectURL(new Blob([bytes(pdfBytes)], { type: "application/pdf" }));
  }

  function download(pdfBytes, filename) {
    const url = blobUrl(pdfBytes);
    const link = root.document.createElement("a");
    link.href = url;
    link.download = filename || "documento.pdf";
    root.document.body.appendChild(link);
    link.click();
    link.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function capabilities() {
    return {
      pdfLibLoaded: Boolean(root.PDFLib),
      pdfLibUrl: PDF_LIB_URL,
      exactCoverHash: APPROVED_COVER_SHA256,
      docxPdfAdapter: Boolean(root.RECONDocumentCodingDocxPdfAdapter && typeof root.RECONDocumentCodingDocxPdfAdapter.convert === "function"),
      preservesPdfPages: true,
      coverUsesOriginalTemplate: true,
    };
  }

  return Object.freeze({
    PDF_LIB_URL,
    APPROVED_COVER_SHA256,
    COVER_ID,
    A4,
    COVER_FIELDS,
    ensurePdfLib,
    sha256Buffer,
    validateTemplate,
    coverValues,
    generateCover,
    mergePdf,
    generateFinalPdf,
    blobUrl,
    download,
    capabilities,
  });
});
