(function (root, factory) {
  const Base = typeof module === "object" && module.exports ? null : root.RECONDocumentCodingPDF;
  const api = factory(root, Base);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && Base) root.RECONDocumentCodingPDF = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, Base) {
  "use strict";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }

  function modelFrom(analysis, combinedText) {
    const data = analysis && analysis.data || {};
    const cv = analysis && analysis.cvCompliance || {};
    const raw = text(combinedText);
    const match = (regex) => {
      const found = raw.match(regex);
      return found && text(found[1]);
    };
    const role = cv.role || null;
    const professional = match(/NOME\s+DO\s+PROFISSIONAL\s*:\s*([^\n\r]+)/i)
      || match(/(?:^|\n)NOME\s*:\s*([^\n\r]+)/i)
      || "REQUER CONFIRMAÇÃO";
    const organogramRole = match(/CARGO\s+NO\s+ORGANOGRAMA\s*:\s*([^\n\r]+)/i)
      || role && role.title || "REQUER CONFIRMAÇÃO";
    const undertaking = match(/EMPREENDIMENTO\s*:\s*([^\n\r]+)/i)
      || "UNIDADES RNEST — CONFIRMAR ESCOPO";
    const item = role && role.item || match(/AP[EÊ]NDICE\s+C\s*-?\s*ITEM\s*([0-9.]+)/i) || "REQUER CONFIRMAÇÃO";
    const criteria = (cv.criteria || []).filter((entry) => entry && entry.sourceItem && (!role || entry.sourceItem === role.item));
    const requirementLines = criteria.length
      ? criteria.slice(0, 12).map((entry) => `${entry.label}: ${entry.detail}`)
      : ["Requisitos contratuais: consultar Anexo X – Apêndice C conforme a função identificada."];
    const evidence = (cv.criteria || []).filter((entry) => entry && entry.evidence).slice(0, 10).map((entry) => `${entry.label}: ${entry.evidence}`);
    return {
      code: text(analysis && analysis.code),
      contract: text(data.contract) || "5900.0130870.25.2",
      client: "PETROBRAS - RNEST",
      undertaking,
      professional,
      organogramRole,
      contractFunction: role ? `Anexo X – Apêndice C - Item ${role.item} - ${role.title}` : `Anexo X – Apêndice C - Item ${item}`,
      requirementLines,
      candidateEvidence: evidence.length ? evidence : ["Resumo automático sem evidência suficiente; requer conferência documental."],
      claimedExperienceYears: Number(cv.claimedExperienceYears || 0),
      statusLabel: cv.status && cv.status.label || "REVISÃO DOCUMENTAL PENDENTE",
      opinion: "PENDENTE DE AVALIAÇÃO / NÃO APROVADO AUTOMATICAMENTE",
      revision: text(data.revision) || "0",
      date: text(data.date) || new Date().toISOString().slice(0, 10),
    };
  }

  function wrap(font, value, size, width) {
    const words = text(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const probe = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(probe, size) <= width) current = probe;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
    return lines;
  }

  function drawBox(page, x, y, width, height, PDFLib, borderWidth) {
    page.drawRectangle({ x, y, width, height, borderColor: PDFLib.rgb(0, 0, 0), borderWidth: borderWidth == null ? 0.8 : borderWidth });
  }

  function drawWrapped(page, font, value, x, topY, width, size, lineHeight, maxLines) {
    const lines = wrap(font, value, size, width).slice(0, maxLines || 99);
    let y = topY;
    lines.forEach((line) => { page.drawText(line, { x, y, size, font }); y -= lineHeight; });
    return y;
  }

  async function createCvEvaluationPdf(analysis, combinedText) {
    if (!Base) throw new Error("Compositor PDF base indisponível.");
    const PDFLib = await Base.ensurePdfLib();
    const model = modelFrom(analysis, combinedText);
    const doc = await PDFLib.PDFDocument.create();
    const regular = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const A4 = Base.A4 || { width: 595.32, height: 842.04 };
    const margin = 34;
    const w = A4.width - margin * 2;

    const page1 = doc.addPage([A4.width, A4.height]);
    let y = A4.height - margin;
    drawBox(page1, margin, y - 70, w, 70, PDFLib, 1.1);
    page1.drawText("AVALIAÇÃO DE CURRÍCULO", { x: margin + 180, y: y - 28, size: 13, font: bold });
    page1.drawText(`DOCUMENTO: ${model.code || "CÓDIGO PENDENTE"}`, { x: margin + 10, y: y - 50, size: 8.5, font: bold });
    page1.drawText(`DATA: ${model.date}`, { x: margin + w - 150, y: y - 50, size: 8.5, font: bold });
    y -= 82;
    const headerRows = [
      `CLIENTE: ${model.client}     CONTRATO Nº.: ${model.contract}`,
      `EMPREENDIMENTO: ${model.undertaking}`,
      `NOME DO PROFISSIONAL: ${model.professional}`,
      `CARGO NO ORGANOGRAMA: ${model.organogramRole}`,
      `REQUISITO/FUNÇÃO CONTRATUAL: ${model.contractFunction}`,
    ];
    headerRows.forEach((line) => {
      drawBox(page1, margin, y - 28, w, 28, PDFLib);
      drawWrapped(page1, bold, line, margin + 7, y - 11, w - 14, 8.2, 10, 2);
      y -= 28;
    });

    const sectionHeight = 205;
    drawBox(page1, margin, y - sectionHeight, w, sectionHeight, PDFLib, 1.0);
    page1.drawText("1 - REQUISITO CONTRATUAL DE EXPERIÊNCIA, QUALIFICAÇÃO E CERTIFICAÇÃO", { x: margin + 12, y: y - 17, size: 9.2, font: bold });
    let sy = y - 36;
    model.requirementLines.forEach((line, idx) => {
      sy = drawWrapped(page1, regular, `${idx + 1}. ${line}`, margin + 12, sy, w - 24, 7.5, 9.4, 4) - 3;
    });
    y -= sectionHeight;

    const remaining = Math.max(145, y - margin - 10);
    drawBox(page1, margin, y - remaining, w, remaining, PDFLib, 1.0);
    page1.drawText("2 - RESUMO DA EXPERIÊNCIA, QUALIFICAÇÃO E CERTIFICAÇÃO DO CANDIDATO", { x: margin + 12, y: y - 17, size: 9.2, font: bold });
    sy = y - 36;
    model.candidateEvidence.forEach((line) => {
      sy = drawWrapped(page1, regular, `• ${line}`, margin + 12, sy, w - 24, 7.5, 9.4, 4) - 3;
    });
    page1.drawText(`Status documental RECON: ${model.statusLabel}`, { x: margin + 12, y: margin + 16, size: 8.0, font: bold });

    const page2 = doc.addPage([A4.width, A4.height]);
    y = A4.height - margin;
    drawBox(page2, margin, y - 55, w, 55, PDFLib, 1.1);
    page2.drawText("AVALIAÇÃO DE CURRÍCULO", { x: margin + 190, y: y - 23, size: 12, font: bold });
    page2.drawText(`DOCUMENTO: ${model.code || "CÓDIGO PENDENTE"}`, { x: margin + 12, y: y - 42, size: 8, font: bold });
    y -= 70;
    drawBox(page2, margin, y - 205, w, 205, PDFLib, 1.0);
    page2.drawText("3 - CONTADOR DE EXPERIÊNCIA - ANEXO X - APÊNDICE C - RNEST", { x: margin + 65, y: y - 20, size: 9.4, font: bold });
    const rows = [
      ["Candidato", model.professional],
      ["Cargo Pretendido", model.organogramRole],
      ["Experiência identificada/declarada", model.claimedExperienceYears ? `${model.claimedExperienceYears} ano(s)` : "REQUER CONFERÊNCIA"],
      ["Atende ao Apêndice C?", "PENDENTE DE CONFERÊNCIA DOCUMENTAL"],
    ];
    let ry = y - 48;
    rows.forEach(([label, value]) => {
      drawBox(page2, margin + 14, ry - 28, 165, 28, PDFLib);
      drawBox(page2, margin + 179, ry - 28, w - 193, 28, PDFLib);
      page2.drawText(label, { x: margin + 20, y: ry - 17, size: 7.8, font: bold });
      drawWrapped(page2, regular, value, margin + 185, ry - 17, w - 205, 7.8, 9, 2);
      ry -= 28;
    });
    page2.drawText("Observação: o contador automático auxilia a conferência, mas vínculos, períodos, função e aderência específica devem ser comprovados pelos anexos.", { x: margin + 15, y: y - 188, size: 6.7, font: regular });
    y -= 220;
    drawBox(page2, margin, y - 150, w, 150, PDFLib, 1.0);
    page2.drawText("4 - AVALIAÇÃO", { x: margin + 225, y: y - 20, size: 10, font: bold });
    page2.drawText(`PARECER: ${model.opinion}`, { x: margin + 14, y: y - 49, size: 8.4, font: bold });
    page2.drawText("A aprovação ou flexibilização não é atribuída automaticamente pelo RECON.", { x: margin + 14, y: y - 71, size: 7.5, font: regular });
    page2.drawText("COMENTÁRIOS: ______________________________________________________________________", { x: margin + 14, y: y - 100, size: 7.2, font: regular });
    page2.drawText("RESPONSÁVEL / ASSINATURA / DATA: ______________________________________________________", { x: margin + 14, y: y - 128, size: 7.2, font: regular });
    y -= 170;
    drawBox(page2, margin, y - 75, w, 75, PDFLib);
    page2.drawText("ÍNDICE DE REVISÕES", { x: margin + 220, y: y - 18, size: 9, font: bold });
    page2.drawText(`REV. ${model.revision}`, { x: margin + 15, y: y - 45, size: 8, font: bold });
    page2.drawText(model.revision === "0" ? "Emissão Inicial." : "Revisão do dossiê de currículo.", { x: margin + 85, y: y - 45, size: 8, font: regular });

    doc.setTitle(`${model.code || "CV"} - Avaliação de Currículo`);
    doc.setSubject("Avaliação de currículo estruturada conforme o modelo RNEST/T2 fornecido ao RECON");
    doc.setCreator("RECON — Codificação de Documentos");
    return new Uint8Array(await doc.save({ useObjectStreams: true, addDefaultPage: false }));
  }

  async function loadPdfInput(part, signal) {
    if (signal && signal.aborted) throw new DOMException("Operação cancelada", "AbortError");
    const file = part && (part.file || part.inputFile) || part;
    const type = text(part && (part.type || part.inputType)).toLowerCase() || text(file && file.name).split(".").pop().toLowerCase();
    if (type === "pdf") return new Uint8Array(await file.arrayBuffer());
    if (type === "docx") {
      const adapter = root.RECONDocumentCodingDocxPdfAdapter;
      if (!adapter || typeof adapter.convert !== "function") throw new Error(`O arquivo ${file && file.name || "DOCX"} precisa de conversão DOCX→PDF fiel antes da consolidação.`);
      return new Uint8Array(await adapter.convert(file, { signal }));
    }
    throw new Error(`Tipo não suportado na consolidação PDF: ${type || "desconhecido"}.`);
  }

  async function generateFinalBundle(params) {
    if (!Base) throw new Error("Compositor PDF base indisponível.");
    const p = params || {};
    if (!p.templateBytes) throw new Error("Template de capa não configurado.");
    const parts = p.parts || p.inputFiles || [];
    if (!parts.length) throw new Error("Nenhum arquivo foi informado para o documento consolidado.");
    const PDFLib = await Base.ensurePdfLib();
    const sourcePages = (p.sourcePageCounts || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const includeCvEvaluation = Boolean(p.isCv && !p.hasCvEvaluationSource);
    const expectedPages = 1 + sourcePages + (includeCvEvaluation ? 2 : 0);
    const coverData = Object.assign({}, p.coverData || {}, { sheet: expectedPages > 1 ? `1 de ${expectedPages}` : "1 de 1" });
    const coverBytes = await Base.generateCover(p.templateBytes, coverData, p.coverOptions || {});
    const output = await PDFLib.PDFDocument.create();

    async function appendBytes(pdfBytes, startAt) {
      const source = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: false, updateMetadata: false });
      const indexes = [];
      for (let i = Number(startAt || 0); i < source.getPageCount(); i += 1) indexes.push(i);
      if (indexes.length) {
        const copied = await output.copyPages(source, indexes);
        copied.forEach((page) => output.addPage(page));
      }
    }

    await appendBytes(coverBytes, 0);
    if (includeCvEvaluation) {
      const evaluationBytes = await createCvEvaluationPdf(p.analysis, p.combinedText || "");
      await appendBytes(evaluationBytes, 0);
    }

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const input = await loadPdfInput(part, p.signal);
      await appendBytes(input, part && part.replaceExistingCover ? 1 : 0);
      if (typeof p.onProgress === "function") p.onProgress({ completed: i + 1, total: parts.length });
      await new Promise((resolve) => root.setTimeout(resolve, 0));
    }

    const code = text(p.analysis && p.analysis.code || coverData.code);
    const title = text(p.analysis && p.analysis.data && p.analysis.data.title || coverData.title);
    output.setTitle(code ? `${code} - ${title}` : title || "Documento consolidado");
    output.setSubject(p.isCv ? "Dossiê consolidado de currículo RNEST/T2" : "Documento técnico consolidado pelo RECON");
    output.setCreator("RECON — Codificação de Documentos");
    output.setProducer("RECON / pdf-lib");
    return new Uint8Array(await output.save({ useObjectStreams: true, addDefaultPage: false }));
  }

  const exported = Object.freeze(Object.assign({}, Base || {}, {
    modelCvEvaluation: modelFrom,
    createCvEvaluationPdf,
    generateFinalBundle,
  }));
  return exported;
});
