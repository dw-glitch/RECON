(function (root) {
  "use strict";
  const Base = root.RECONDocumentCodingPDF;
  const Safe = root.RECONDocumentCodingPDFSafe;
  if (!Base || !Safe || typeof Base.generateFinalBundle !== "function") return;

  const CACHE_LIMIT = 96 * 1024 * 1024;
  function text(value) { return value == null ? "" : String(value).trim(); }
  function extType(part, file) { return text(part && (part.type || part.inputType)).toLowerCase() || text(file && file.name).split(".").pop().toLowerCase(); }
  function yieldUi() { return new Promise((resolve) => root.setTimeout(resolve, 0)); }

  async function hashBytes(input) {
    const bytes = Safe.toBytes(input);
    if (root.crypto && root.crypto.subtle) {
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 8192))) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
    return `fallback-${bytes.length}-${hash.toString(16)}`;
  }

  async function materialize(part, signal) {
    if (signal && signal.aborted) throw new DOMException("Operação cancelada", "AbortError");
    const file = part && (part.file || part.inputFile) || part;
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("Arquivo de origem inválido no pacote final.");
    const type = extType(part, file);
    let bytes;
    if (type === "pdf") bytes = new Uint8Array(await file.arrayBuffer());
    else if (type === "docx") {
      const adapter = root.RECONDocumentCodingDocxPdfAdapter;
      if (!adapter || typeof adapter.convert !== "function") throw new Error(`${file.name || "DOCX"}: a conversão DOCX→PDF fiel não está disponível neste ambiente.`);
      bytes = Safe.toBytes(await adapter.convert(file, { signal }));
    } else throw new Error(`${file.name || "Arquivo"}: tipo ${type || "desconhecido"} não suportado na consolidação.`);
    return { file, type, bytes, name: file.name || "arquivo.pdf", replaceExistingCover: Boolean(part && part.replaceExistingCover), role: part && part.role };
  }

  async function preflight(PDFLib, parts, signal, onProgress) {
    const prepared = [];
    const seen = new Map();
    const duplicates = [];
    let cachedBytes = 0;
    for (let i = 0; i < parts.length; i += 1) {
      const source = await materialize(parts[i], signal);
      const valid = Safe.validatePdfBytes(source.bytes, { fileName: source.name, stage: "pré-validação" });
      const loaded = await Safe.loadPdfSafely(PDFLib, valid.bytes, { fileName: source.name, stage: "pré-validação", probeEncrypted: true });
      const hash = await hashBytes(valid.bytes);
      if (seen.has(hash)) duplicates.push({ first: seen.get(hash), duplicate: source.name });
      else seen.set(hash, source.name);
      const keep = cachedBytes + valid.size <= CACHE_LIMIT;
      if (keep) cachedBytes += valid.size;
      prepared.push({
        part: parts[i], file: source.file, name: source.name, type: source.type, role: source.role,
        replaceExistingCover: source.replaceExistingCover, bytes: keep ? valid.bytes : null,
        pageCount: loaded.metadata.pageCount, encryptedFallback: loaded.metadata.encryptedFallback,
        size: valid.size, hash,
      });
      source.bytes = null;
      if (typeof onProgress === "function") onProgress({ phase: "preflight", completed: i + 1, total: parts.length, fileName: source.name });
      await yieldUi();
    }
    if (duplicates.length) {
      const list = duplicates.map((item) => `${item.duplicate} (igual a ${item.first})`).join("; ");
      const error = new Error(`Arquivo repetido detectado no documento consolidado: ${list}. Remova a duplicidade ou confirme o conjunto corrigido antes de gerar.`);
      error.code = "PDF_DUPLICATE_SOURCE";
      error.userMessage = error.message;
      throw error;
    }
    return prepared;
  }

  async function bytesFor(entry, signal) {
    if (entry.bytes) return entry.bytes;
    const source = await materialize(entry.part, signal);
    return source.bytes;
  }

  async function append(PDFLib, output, input, startAt, name, stage) {
    const loaded = await Safe.loadPdfSafely(PDFLib, input, { fileName: name, stage, probeEncrypted: true });
    const start = Math.max(0, Number(startAt || 0));
    const count = loaded.document.getPageCount();
    const indexes = Array.from({ length: Math.max(0, count - start) }, (_, i) => i + start);
    if (!indexes.length) return 0;
    try {
      const pages = await output.copyPages(loaded.document, indexes);
      pages.forEach((page) => output.addPage(page));
      return pages.length;
    } catch (error) {
      throw Safe.friendly(error, { fileName: name, stage });
    }
  }

  async function generateFinalBundle(params) {
    const p = params || {};
    if (!p.templateBytes) throw new Error("Template de capa não configurado.");
    const parts = p.parts || p.inputFiles || [];
    if (!parts.length) throw new Error("Nenhum arquivo foi informado para o documento consolidado.");
    const PDFLib = await Base.ensurePdfLib();
    let prepared = [];
    try {
      // Valida TODOS os arquivos antes de começar a montagem pesada. Assim um
      // PDF protegido/corrompido nunca aparece apenas no fim do processo.
      prepared = await preflight(PDFLib, parts, p.signal, p.onProgress);
      const sourcePages = prepared.reduce((sum, entry) => sum + entry.pageCount, 0);
      const includeCvEvaluation = Boolean(p.isCv && !p.hasCvEvaluationSource);
      const expectedPages = 1 + sourcePages + (includeCvEvaluation ? 2 : 0);
      const coverData = Object.assign({}, p.coverData || {}, { sheet: expectedPages > 1 ? `1 de ${expectedPages}` : "1 de 1" });
      const coverBytes = await Base.generateCover(p.templateBytes, coverData, p.coverOptions || {});
      const output = await PDFLib.PDFDocument.create();
      await append(PDFLib, output, coverBytes, 0, "Capa Petrobras", "montagem da capa");

      if (includeCvEvaluation) {
        const evaluationBytes = await Base.createCvEvaluationPdf(p.analysis, p.combinedText || "");
        await append(PDFLib, output, evaluationBytes, 0, "Avaliação de Currículo", "montagem da avaliação");
      }

      for (let i = 0; i < prepared.length; i += 1) {
        const entry = prepared[i];
        const input = await bytesFor(entry, p.signal);
        await append(PDFLib, output, input, entry.replaceExistingCover ? 1 : 0, entry.name, "montagem do documento final");
        entry.bytes = null;
        if (typeof p.onProgress === "function") p.onProgress({ phase: "merge", completed: i + 1, total: prepared.length, fileName: entry.name });
        await yieldUi();
      }

      const code = text(p.analysis && p.analysis.code || coverData.code);
      const title = text(p.analysis && p.analysis.data && p.analysis.data.title || coverData.title);
      output.setTitle(code ? `${code} - ${title}` : title || "Documento consolidado");
      output.setSubject(p.isCv ? "Dossiê consolidado de currículo RNEST/T2" : "Documento técnico consolidado pelo RECON");
      output.setCreator("RECON — Codificação de Documentos");
      output.setProducer("RECON / pdf-lib");
      const finalBytes = await Safe.savePdfSafely(output, { fileName: code || "PDF final", stage: "salvar documento consolidado" });
      // Verificação estrutural final: reabre o resultado sem ignoreEncryption e
      // confirma a quantidade de páginas antes de disponibilizar o download.
      const verified = await Safe.loadPdfSafely(PDFLib, finalBytes, { fileName: code || "PDF final", stage: "verificação final", probeEncrypted: false });
      if (verified.metadata.pageCount !== expectedPages) throw new Error(`PDF final inconsistente: esperado ${expectedPages} página(s), gerado ${verified.metadata.pageCount}.`);
      return finalBytes;
    } finally {
      prepared.forEach((entry) => { entry.bytes = null; });
      prepared = [];
    }
  }

  root.RECONDocumentCodingPDF = Object.freeze(Object.assign({}, Base, { generateFinalBundle }));
})(typeof globalThis !== "undefined" ? globalThis : this);