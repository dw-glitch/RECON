(function (root) {
  "use strict";
  const Base = root.RECONDocumentCodingPDF;
  const Safe = root.RECONDocumentCodingPDFSafe;
  if (!Base || !Safe) return;

  function text(value) { return value == null ? "" : String(value).trim(); }
  function rect(field, A4) { return { x: field.x, y: A4.height - field.top - field.h, width: field.w, height: field.h }; }
  function truncate(font, value, size, width) {
    let output = text(value);
    if (!output || font.widthOfTextAtSize(output, size) <= width) return output;
    while (output.length > 4 && font.widthOfTextAtSize(`${output}…`, size) > width) output = output.slice(0, -1);
    return `${output.trim()}…`;
  }
  function draw(page, font, bold, value, field, A4, color) {
    const raw = text(value); if (!raw) return;
    const chosen = field.bold ? bold : font;
    let size = field.size || 8;
    const min = Math.min(5.2, size);
    while (size > min && chosen.widthOfTextAtSize(raw, size) > field.w - 5) size -= .25;
    const printable = truncate(chosen, raw, size, field.w - 5);
    const width = chosen.widthOfTextAtSize(printable, size);
    let x = field.x + 2.5;
    if (field.align === "center") x = field.x + Math.max(2.5, (field.w - width) / 2);
    if (field.align === "right") x = field.x + field.w - width - 2.5;
    const y = A4.height - field.top - field.h + Math.max(1.5, (field.h - size) / 2);
    page.drawText(printable, { x, y, size, font: chosen, color });
  }

  async function validateTemplate(templateBytes) {
    const PDFLib = await Base.ensurePdfLib();
    const input = Safe.toBytes(templateBytes);
    const hash = await Base.sha256Buffer(input);
    try {
      const loaded = await Safe.loadPdfSafely(PDFLib, input, { fileName: "Capa Petrobras", stage: "validação da capa", probeEncrypted: true });
      const page = loaded.document.getPage(0);
      const size = page.getSize();
      const A4 = Base.A4;
      const isA4 = Math.abs(size.width - A4.width) < 3 && Math.abs(size.height - A4.height) < 3;
      const exact = hash === Base.APPROVED_COVER_SHA256;
      return { valid: isA4, exact, mapped: exact, hash, pageCount: loaded.metadata.pageCount, size, encryptedFallback: loaded.metadata.encryptedFallback,
        reason: exact ? "Template oficial CAPA (1).pdf reconhecido pelo hash." : isA4 ? "PDF A4 válido, porém não é a versão mapeada da CAPA (1).pdf. Gere apenas após revisar o preview." : "O template não possui dimensão A4 compatível." };
    } catch (error) {
      const friendly = Safe.friendly(error, { fileName: "Capa Petrobras", stage: "validação da capa" });
      return { valid: false, exact: false, mapped: false, hash, reason: friendly.userMessage || friendly.message, errorCode: friendly.code };
    }
  }

  async function generateCover(templateBytes, data, options) {
    const opts = options || {};
    const PDFLib = await Base.ensurePdfLib();
    const validation = await validateTemplate(templateBytes);
    if (!validation.valid) throw new Error(validation.reason);
    if (!validation.mapped && !opts.allowUnmappedTemplate) throw new Error("O PDF selecionado não corresponde ao template oficial mapeado. Confira e autorize explicitamente antes de gerar.");
    const loaded = await Safe.loadPdfSafely(PDFLib, templateBytes, { fileName: "Capa Petrobras", stage: "criação da capa", probeEncrypted: true });
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(loaded.document, [0]);
    out.addPage(copied[0]);
    const page = out.getPage(0);
    const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const white = PDFLib.rgb(1, 1, 1), black = PDFLib.rgb(0, 0, 0);
    const values = Base.coverValues(data);
    Object.entries(Base.COVER_FIELDS).forEach(([key, field]) => {
      const r = rect(field, Base.A4);
      page.drawRectangle({ x: r.x + .7, y: r.y + .7, width: Math.max(0, r.width - 1.4), height: Math.max(0, r.height - 1.4), color: white, borderWidth: 0 });
      draw(page, font, bold, values[key], field, Base.A4, black);
    });
    out.setTitle(values.documentNumber ? `${values.documentNumber} - ${values.title}` : values.title || "Documento técnico");
    out.setSubject("Capa de documento técnico gerada pelo RECON com base no template Petrobras fornecido");
    out.setCreator("RECON — Codificação de Documentos");
    out.setProducer("RECON / pdf-lib");
    return Safe.savePdfSafely(out, { fileName: "Capa Petrobras", stage: "salvar capa", saveOptions: { updateFieldAppearances: false } });
  }

  async function mergePdf(coverBytes, originalBytes, options) {
    const opts = options || {};
    const PDFLib = await Base.ensurePdfLib();
    const output = await PDFLib.PDFDocument.create();
    await Safe.copyPdfPagesSafely(PDFLib, output, coverBytes, [0], { fileName: "Capa Petrobras", stage: "merge da capa" });
    const originalLoaded = await Safe.loadPdfSafely(PDFLib, originalBytes, { fileName: opts.fileName || "Documento original", stage: "merge do documento", probeEncrypted: true });
    const start = opts.replaceExistingCover ? 1 : 0;
    const indexes = Array.from({ length: Math.max(0, originalLoaded.document.getPageCount() - start) }, (_, i) => i + start);
    if (indexes.length) {
      try {
        const pages = await output.copyPages(originalLoaded.document, indexes);
        pages.forEach((page) => output.addPage(page));
      } catch (error) {
        throw Safe.friendly(error, { fileName: opts.fileName || "Documento original", stage: "cópia das páginas" });
      }
    }
    output.setTitle(text(opts.title));
    output.setSubject("Documento técnico consolidado pelo RECON");
    output.setCreator("RECON — Codificação de Documentos");
    output.setProducer("RECON / pdf-lib");
    return Safe.savePdfSafely(output, { fileName: opts.fileName || "PDF final", stage: "salvar PDF final" });
  }

  async function generateFinalPdf(params) {
    const p = params || {};
    if (!p.templateBytes) throw new Error("Template de capa não configurado.");
    if (!p.inputFile) throw new Error("Arquivo original não informado.");
    const type = String(p.inputType || "").toLowerCase();
    const cover = await generateCover(p.templateBytes, p.coverData || {}, p.coverOptions || {});
    let bodyBytes;
    if (type === "pdf") bodyBytes = new Uint8Array(await p.inputFile.arrayBuffer());
    else if (type === "docx") {
      const adapter = root.RECONDocumentCodingDocxPdfAdapter;
      if (!adapter || typeof adapter.convert !== "function") throw new Error("A análise DOCX está disponível, mas a conversão fiel DOCX→PDF exige um adaptador de conversão compatível com o deploy. O RECON não rasteriza nem simula Word para evitar degradar o documento.");
      bodyBytes = Safe.toBytes(await adapter.convert(p.inputFile, { signal: p.signal }));
    } else throw new Error(`Tipo de entrada não suportado para PDF final: ${type || "desconhecido"}.`);
    return mergePdf(cover, bodyBytes, { replaceExistingCover: Boolean(p.replaceExistingCover), title: p.coverData && `${text(p.coverData.code)} - ${text(p.coverData.title)}`, fileName: p.inputFile.name });
  }

  function capabilities() {
    return Object.assign({}, Base.capabilities(), { safePdfLayer: true, encryptedPdfFallback: true, pdfSignatureValidation: true });
  }

  root.RECONDocumentCodingPDF = Object.freeze(Object.assign({}, Base, { validateTemplate, generateCover, mergePdf, generateFinalPdf, capabilities }));
})(typeof globalThis !== "undefined" ? globalThis : this);