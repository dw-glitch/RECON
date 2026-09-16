(function (root) {
  "use strict";

  const PDFJS_VERSION = "3.11.174";
  const WORKER_CANDIDATES = Object.freeze([
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`,
  ]);
  const ERROR = Object.freeze({
    EMPTY: "PDF_EMPTY",
    NOT_PDF: "PDF_NOT_PDF",
    ENCRYPTED: "PDF_ENCRYPTED_UNSUPPORTED",
    PASSWORD: "PDF_PASSWORD_REQUIRED",
    CORRUPT: "PDF_CORRUPT",
    COPY: "PDF_COPY_FAILED",
    SAVE: "PDF_SAVE_FAILED",
    DUPLICATE: "PDF_DUPLICATE_SOURCE",
  });
  const PREFLIGHT_CACHE_LIMIT = 96 * 1024 * 1024;
  let activeWorker = "";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function pdfjs() { return root.pdfjsLib || root.PDFJS || null; }
  function localWorker() {
    const offline = root.RECONOfflineResources;
    if (!offline || typeof offline.has !== "function" || typeof offline.objectUrl !== "function") return "";
    try { return offline.has("pdf.worker.min.js") ? offline.objectUrl("pdf.worker.min.js") : ""; }
    catch (_) { return ""; }
  }
  function setWorker(src) {
    const lib = pdfjs();
    if (!lib || !lib.GlobalWorkerOptions) return "";
    const chosen = src || localWorker() || WORKER_CANDIDATES[0];
    lib.GlobalWorkerOptions.workerSrc = chosen;
    activeWorker = chosen;
    return chosen;
  }
  function candidates() {
    const local = localWorker();
    return [...new Set([local, ...WORKER_CANDIDATES].filter(Boolean))];
  }
  function status() {
    return {
      pdfjsVersion: pdfjs() && pdfjs().version || "",
      expectedVersion: PDFJS_VERSION,
      activeWorker: activeWorker || pdfjs() && pdfjs().GlobalWorkerOptions && pdfjs().GlobalWorkerOptions.workerSrc || "",
      localWorkerAvailable: Boolean(localWorker()),
      candidates: candidates(),
    };
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && value.buffer instanceof ArrayBuffer) return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    throw makeError(ERROR.EMPTY, "O PDF não possui bytes válidos para processamento.");
  }
  function makeError(code, message, cause, meta) {
    const error = new Error(message);
    error.name = "RECONPdfError";
    error.code = code;
    error.userMessage = message;
    if (cause) error.cause = cause;
    error.meta = Object.assign({}, meta || {});
    return error;
  }
  function headerOffset(input) {
    const bytes = toBytes(input);
    const limit = Math.min(bytes.length, 1024);
    for (let i = 0; i <= limit - 5; i += 1) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return i;
    }
    return -1;
  }
  function validatePdfBytes(input, context) {
    const bytes = toBytes(input);
    const name = text(context && context.fileName) || "arquivo.pdf";
    if (!bytes.length) throw makeError(ERROR.EMPTY, `${name}: o arquivo está vazio.`);
    const offset = headerOffset(bytes);
    if (offset < 0) throw makeError(ERROR.NOT_PDF, `${name}: o conteúdo não possui assinatura PDF válida, apesar da extensão/nome do arquivo.`);
    return { bytes, size: bytes.byteLength, headerOffset: offset };
  }
  function errorText(error) { return `${text(error && error.name)} ${text(error && error.message)}`.toLowerCase(); }
  function isEncryptionError(error) { return /encryptedpdferror|input document.*encrypted|encrypted pdf|encryption/.test(errorText(error)); }
  function isPasswordError(error) { return /passwordexception|password required|need[_ -]?password|incorrect password|senha/.test(errorText(error)); }
  function isCorruptError(error) { return /invalid pdf|parse|xref|trailer|corrupt|malformed|unexpected eof|end of file|missing pdf/.test(errorText(error)); }
  function friendly(error, context) {
    if (error && error.name === "RECONPdfError") return error;
    const name = text(context && context.fileName) || "PDF";
    if (isPasswordError(error)) return makeError(ERROR.PASSWORD, `${name}: este PDF exige senha ou possui uma proteção que impede o processamento automático. Remova a proteção/senha e tente novamente.`, error, context);
    if (isEncryptionError(error)) return makeError(ERROR.ENCRYPTED, `${name}: este PDF possui criptografia/proteção que não pôde ser processada com segurança. Remova a proteção e tente novamente.`, error, context);
    if (isCorruptError(error)) return makeError(ERROR.CORRUPT, `${name}: não foi possível interpretar este PDF. O arquivo pode estar corrompido ou incompleto.`, error, context);
    return makeError(ERROR.CORRUPT, `${name}: não foi possível processar este PDF.`, error, context);
  }
  function diagnostic(event, context, extra) {
    if (!root.console || typeof root.console.info !== "function") return;
    const ctx = context || {};
    root.console.info(`[RECON PDF] ${event}`, Object.assign({ arquivo: text(ctx.fileName) || "PDF", etapa: text(ctx.stage) || "pdf" }, extra || {}));
  }
  function uiFailure(error) {
    if (!root.document) return;
    const label = root.document.getElementById("coding-progress-text");
    const bar = root.document.getElementById("coding-progress-bar");
    if (label) label.textContent = error && (error.userMessage || error.message) || "Falha no processamento do PDF";
    if (bar) bar.style.width = "100%";
  }
  async function probeCopy(PDFLib, source, context) {
    const count = source.getPageCount();
    if (!count) throw makeError(ERROR.CORRUPT, `${text(context && context.fileName) || "PDF"}: o PDF não possui páginas válidas.`);
    const probe = await PDFLib.PDFDocument.create();
    try {
      const copied = await probe.copyPages(source, [0]);
      if (!copied.length) throw new Error("Nenhuma página copiada");
      probe.addPage(copied[0]);
      const saved = await probe.save({ useObjectStreams: true, addDefaultPage: false });
      const reopened = await PDFLib.PDFDocument.load(saved, { ignoreEncryption: false, updateMetadata: false });
      if (reopened.getPageCount() !== 1) throw new Error("Página de teste inválida após salvar/reabrir");
      return true;
    } catch (error) {
      throw makeError(ERROR.ENCRYPTED, `${text(context && context.fileName) || "PDF"}: a proteção permite identificar o arquivo, mas impede copiar suas páginas com segurança. Remova a proteção/senha e tente novamente.`, error, context);
    }
  }
  async function loadPdfSafely(PDFLib, input, options) {
    if (!PDFLib || !PDFLib.PDFDocument || typeof PDFLib.PDFDocument.load !== "function") throw new Error("pdf-lib indisponível.");
    const opts = options || {};
    const valid = validatePdfBytes(input, opts);
    const loadOptions = Object.assign({ updateMetadata: false }, opts.loadOptions || {});
    delete loadOptions.ignoreEncryption;
    try {
      const document = await PDFLib.PDFDocument.load(valid.bytes, Object.assign({}, loadOptions, { ignoreEncryption: false }));
      const pageCount = document.getPageCount();
      if (!pageCount) throw makeError(ERROR.CORRUPT, `${text(opts.fileName) || "PDF"}: o PDF não possui páginas válidas.`);
      return { document, bytes: valid.bytes, metadata: { pageCount, encryptedFallback: false, size: valid.size, headerOffset: valid.headerOffset } };
    } catch (firstError) {
      if (!isEncryptionError(firstError)) throw friendly(firstError, opts);
      diagnostic("criptografia detectada; tentando modo compatível", opts, { tentativaNormal: "falhou-encrypted" });
      try {
        const document = await PDFLib.PDFDocument.load(valid.bytes, Object.assign({}, loadOptions, { ignoreEncryption: true }));
        const pageCount = document.getPageCount();
        if (!pageCount) throw new Error("PDF sem páginas após ignoreEncryption");
        if (opts.probeEncrypted !== false) await probeCopy(PDFLib, document, opts);
        diagnostic("PDF protegido processável", opts, { tentativaIgnoreEncryption: "sucesso", paginas: pageCount, tamanho: valid.size });
        return { document, bytes: valid.bytes, metadata: { pageCount, encryptedFallback: true, size: valid.size, headerOffset: valid.headerOffset } };
      } catch (fallbackError) {
        diagnostic("PDF protegido bloqueado", opts, { tentativaIgnoreEncryption: "falhou", erro: text(fallbackError && fallbackError.name) || "erro" });
        if (fallbackError && fallbackError.name === "RECONPdfError") throw fallbackError;
        throw friendly(fallbackError, opts);
      }
    }
  }
  async function savePdfSafely(document, options) {
    try { return new Uint8Array(await document.save(Object.assign({ useObjectStreams: true, addDefaultPage: false }, options && options.saveOptions || {}))); }
    catch (error) { throw makeError(ERROR.SAVE, `${text(options && options.fileName) || "PDF final"}: não foi possível salvar o PDF montado.`, error, options); }
  }
  async function hashBytes(input) {
    const bytes = toBytes(input);
    if (root.crypto && root.crypto.subtle) {
      const digest = await root.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 8192))) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
    return `fallback-${bytes.length}-${hash.toString(16)}`;
  }

  const Safe = Object.freeze({ ERROR, toBytes, headerOffset, validatePdfBytes, isEncryptionError, isPasswordError, friendly, diagnostic, loadPdfSafely, savePdfSafely, hashBytes });
  root.RECONDocumentCodingPDFSafe = Safe;

  function wrapParsers(Base) {
    if (!Base || Base.__pdfSafetyWrapped) return Base;
    async function parseDocument(file, options) {
      const check = Base.validateInputFile(file, ["pdf", "docx"]);
      if (!check.valid) throw new Error(check.reason);
      let buffer = await file.arrayBuffer();
      const hash = await Base.sha256Buffer(buffer);
      const proxy = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, arrayBuffer: async () => buffer };
      try {
        let parsed;
        if (check.type === "pdf") {
          validatePdfBytes(buffer, { fileName: file.name, stage: "leitura" });
          try { parsed = await Base.parsePdf(proxy, options || {}); }
          catch (error) { throw friendly(error, { fileName: file.name, stage: "análise" }); }
        } else parsed = await Base.parseDocx(proxy, options || {});
        parsed.hash = hash;
        parsed.size = file.size;
        parsed.mime = file.type || (check.type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        return parsed;
      } finally { buffer = null; }
    }
    return Object.freeze(Object.assign({}, Base, { parseDocument, __pdfSafetyWrapped: true }));
  }

  function coverHelpers(Base) {
    function truncate(font, value, size, width) {
      let output = text(value);
      if (!output || font.widthOfTextAtSize(output, size) <= width) return output;
      while (output.length > 4 && font.widthOfTextAtSize(`${output}…`, size) > width) output = output.slice(0, -1);
      return `${output.trim()}…`;
    }
    function draw(page, font, bold, value, field, color) {
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
      const y = Base.A4.height - field.top - field.h + Math.max(1.5, (field.h - size) / 2);
      page.drawText(printable, { x, y, size, font: chosen, color });
    }
    return { draw };
  }

  function wrapBasePdf(Base) {
    const helpers = coverHelpers(Base);
    async function validateTemplate(templateBytes) {
      const PDFLib = await Base.ensurePdfLib();
      const input = toBytes(templateBytes);
      const hash = await Base.sha256Buffer(input);
      try {
        const loaded = await loadPdfSafely(PDFLib, input, { fileName: "Capa Petrobras", stage: "validação da capa", probeEncrypted: true });
        const size = loaded.document.getPage(0).getSize();
        const isA4 = Math.abs(size.width - Base.A4.width) < 3 && Math.abs(size.height - Base.A4.height) < 3;
        const exact = hash === Base.APPROVED_COVER_SHA256;
        return { valid: isA4, exact, mapped: exact, hash, pageCount: loaded.metadata.pageCount, size, encryptedFallback: loaded.metadata.encryptedFallback,
          reason: exact ? "Template oficial CAPA (1).pdf reconhecido pelo hash." : isA4 ? "PDF A4 válido, porém não é a versão mapeada da CAPA (1).pdf. Gere apenas após revisar o preview." : "O template não possui dimensão A4 compatível." };
      } catch (error) {
        const e = friendly(error, { fileName: "Capa Petrobras", stage: "validação da capa" });
        return { valid: false, exact: false, mapped: false, hash, reason: e.userMessage || e.message, errorCode: e.code };
      }
    }
    async function generateCover(templateBytes, data, options) {
      const opts = options || {};
      const PDFLib = await Base.ensurePdfLib();
      const validation = await validateTemplate(templateBytes);
      if (!validation.valid) throw new Error(validation.reason);
      if (!validation.mapped && !opts.allowUnmappedTemplate) throw new Error("O PDF selecionado não corresponde ao template oficial mapeado. Confira e autorize explicitamente antes de gerar.");
      const loaded = await loadPdfSafely(PDFLib, templateBytes, { fileName: "Capa Petrobras", stage: "criação da capa", probeEncrypted: true });
      const out = await PDFLib.PDFDocument.create();
      const copied = await out.copyPages(loaded.document, [0]); out.addPage(copied[0]);
      const page = out.getPage(0);
      const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      const bold = await out.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const white = PDFLib.rgb(1, 1, 1), black = PDFLib.rgb(0, 0, 0);
      const values = Base.coverValues(data);
      Object.entries(Base.COVER_FIELDS).forEach(([key, field]) => {
        const y = Base.A4.height - field.top - field.h;
        page.drawRectangle({ x: field.x + .7, y: y + .7, width: Math.max(0, field.w - 1.4), height: Math.max(0, field.h - 1.4), color: white, borderWidth: 0 });
        helpers.draw(page, font, bold, values[key], field, black);
      });
      out.setTitle(values.documentNumber ? `${values.documentNumber} - ${values.title}` : values.title || "Documento técnico");
      out.setSubject("Capa de documento técnico gerada pelo RECON com base no template Petrobras fornecido"); out.setCreator("RECON — Codificação de Documentos"); out.setProducer("RECON / pdf-lib");
      return savePdfSafely(out, { fileName: "Capa Petrobras", stage: "salvar capa", saveOptions: { updateFieldAppearances: false } });
    }
    async function mergePdf(coverBytes, originalBytes, options) {
      const opts = options || {}, PDFLib = await Base.ensurePdfLib();
      const output = await PDFLib.PDFDocument.create();
      const cover = await loadPdfSafely(PDFLib, coverBytes, { fileName: "Capa Petrobras", stage: "merge da capa", probeEncrypted: true });
      const cp = await output.copyPages(cover.document, [0]); cp.forEach((page) => output.addPage(page));
      const original = await loadPdfSafely(PDFLib, originalBytes, { fileName: opts.fileName || "Documento original", stage: "merge do documento", probeEncrypted: true });
      const start = opts.replaceExistingCover ? 1 : 0;
      const indexes = Array.from({ length: Math.max(0, original.document.getPageCount() - start) }, (_, i) => i + start);
      if (indexes.length) {
        try { const pages = await output.copyPages(original.document, indexes); pages.forEach((page) => output.addPage(page)); }
        catch (error) { throw friendly(error, { fileName: opts.fileName || "Documento original", stage: "cópia das páginas" }); }
      }
      output.setTitle(text(opts.title)); output.setSubject("Documento técnico consolidado pelo RECON"); output.setCreator("RECON — Codificação de Documentos"); output.setProducer("RECON / pdf-lib");
      return savePdfSafely(output, { fileName: opts.fileName || "PDF final", stage: "salvar PDF final" });
    }
    async function generateFinalPdf(params) {
      const p = params || {};
      if (!p.templateBytes) throw new Error("Template de capa não configurado.");
      if (!p.inputFile) throw new Error("Arquivo original não informado.");
      const cover = await generateCover(p.templateBytes, p.coverData || {}, p.coverOptions || {});
      const type = String(p.inputType || "").toLowerCase();
      let bodyBytes;
      if (type === "pdf") bodyBytes = new Uint8Array(await p.inputFile.arrayBuffer());
      else if (type === "docx") {
        const adapter = root.RECONDocumentCodingDocxPdfAdapter;
        if (!adapter || typeof adapter.convert !== "function") throw new Error("A análise DOCX está disponível, mas a conversão fiel DOCX→PDF exige um adaptador de conversão compatível com o deploy. O RECON não rasteriza nem simula Word para evitar degradar o documento.");
        bodyBytes = toBytes(await adapter.convert(p.inputFile, { signal: p.signal }));
      } else throw new Error(`Tipo de entrada não suportado para PDF final: ${type || "desconhecido"}.`);
      return mergePdf(cover, bodyBytes, { replaceExistingCover: Boolean(p.replaceExistingCover), title: p.coverData && `${text(p.coverData.code)} - ${text(p.coverData.title)}`, fileName: p.inputFile.name });
    }
    function capabilities() { return Object.assign({}, Base.capabilities(), { safePdfLayer: true, encryptedPdfFallback: true, pdfSignatureValidation: true }); }
    return Object.freeze(Object.assign({}, Base, { validateTemplate, generateCover, mergePdf, generateFinalPdf, capabilities, __pdfSafetyWrapped: true }));
  }

  async function materializePart(part, signal) {
    if (signal && signal.aborted) throw new DOMException("Operação cancelada", "AbortError");
    const file = part && (part.file || part.inputFile) || part;
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("Arquivo de origem inválido no pacote final.");
    const type = text(part && (part.type || part.inputType)).toLowerCase() || text(file.name).split(".").pop().toLowerCase();
    let bytes;
    if (type === "pdf") bytes = new Uint8Array(await file.arrayBuffer());
    else if (type === "docx") {
      const adapter = root.RECONDocumentCodingDocxPdfAdapter;
      if (!adapter || typeof adapter.convert !== "function") throw new Error(`${file.name || "DOCX"}: a conversão DOCX→PDF fiel não está disponível neste ambiente.`);
      bytes = toBytes(await adapter.convert(file, { signal }));
    } else throw new Error(`${file.name || "Arquivo"}: tipo ${type || "desconhecido"} não suportado na consolidação.`);
    return { part, file, type, bytes, name: file.name || "arquivo.pdf", replaceExistingCover: Boolean(part && part.replaceExistingCover) };
  }
  async function preflight(PDFLib, parts, signal, onProgress) {
    const prepared = [], seen = new Map(), duplicates = [];
    let cached = 0;
    for (let i = 0; i < parts.length; i += 1) {
      const source = await materializePart(parts[i], signal);
      const valid = validatePdfBytes(source.bytes, { fileName: source.name, stage: "pré-validação" });
      const loaded = await loadPdfSafely(PDFLib, valid.bytes, { fileName: source.name, stage: "pré-validação", probeEncrypted: true });
      const hash = await hashBytes(valid.bytes);
      if (seen.has(hash)) duplicates.push({ first: seen.get(hash), duplicate: source.name }); else seen.set(hash, source.name);
      const keep = cached + valid.size <= PREFLIGHT_CACHE_LIMIT; if (keep) cached += valid.size;
      prepared.push({ part: source.part, file: source.file, type: source.type, name: source.name, replaceExistingCover: source.replaceExistingCover, bytes: keep ? valid.bytes : null, pageCount: loaded.metadata.pageCount, encryptedFallback: loaded.metadata.encryptedFallback, size: valid.size, hash });
      source.bytes = null;
      diagnostic("pré-validação concluída", { fileName: source.name, stage: "pré-validação" }, { paginas: loaded.metadata.pageCount, tamanho: valid.size, ignoreEncryption: loaded.metadata.encryptedFallback });
      if (typeof onProgress === "function") onProgress({ phase: "preflight", completed: i + 1, total: parts.length, fileName: source.name });
      await new Promise((resolve) => root.setTimeout(resolve, 0));
    }
    if (duplicates.length) {
      const list = duplicates.map((x) => `${x.duplicate} (igual a ${x.first})`).join("; ");
      throw makeError(ERROR.DUPLICATE, `Arquivo repetido detectado no documento consolidado: ${list}. Remova a duplicidade antes de gerar.`);
    }
    return prepared;
  }
  async function appendPdf(PDFLib, output, input, startAt, name, stage) {
    const loaded = await loadPdfSafely(PDFLib, input, { fileName: name, stage, probeEncrypted: true });
    const start = Math.max(0, Number(startAt || 0));
    const indexes = Array.from({ length: Math.max(0, loaded.document.getPageCount() - start) }, (_, i) => i + start);
    if (!indexes.length) return 0;
    try { const pages = await output.copyPages(loaded.document, indexes); pages.forEach((page) => output.addPage(page)); return pages.length; }
    catch (error) { throw makeError(ERROR.COPY, `${name}: não foi possível copiar as páginas para o PDF final.`, error, { fileName: name, stage }); }
  }
  function wrapBundlePdf(Base) {
    if (!Base || typeof Base.generateFinalBundle !== "function" || Base.__bundlePdfSafetyWrapped) return Base;
    async function generateFinalBundle(params) {
      const p = params || {};
      if (!p.templateBytes) throw new Error("Template de capa não configurado.");
      const parts = p.parts || p.inputFiles || [];
      if (!parts.length) throw new Error("Nenhum arquivo foi informado para o documento consolidado.");
      const PDFLib = await Base.ensurePdfLib();
      let prepared = [];
      try {
        prepared = await preflight(PDFLib, parts, p.signal, p.onProgress);
        const sourcePages = prepared.reduce((sum, entry) => sum + entry.pageCount, 0);
        const includeCvEvaluation = Boolean(p.isCv && !p.hasCvEvaluationSource);
        const expectedPages = 1 + sourcePages + (includeCvEvaluation ? 2 : 0);
        const coverData = Object.assign({}, p.coverData || {}, { sheet: expectedPages > 1 ? `1 de ${expectedPages}` : "1 de 1" });
        const coverBytes = await Base.generateCover(p.templateBytes, coverData, p.coverOptions || {});
        const output = await PDFLib.PDFDocument.create();
        await appendPdf(PDFLib, output, coverBytes, 0, "Capa Petrobras", "montagem da capa");
        if (includeCvEvaluation) {
          const evaluation = await Base.createCvEvaluationPdf(p.analysis, p.combinedText || "");
          await appendPdf(PDFLib, output, evaluation, 0, "Avaliação de Currículo", "montagem da avaliação");
        }
        for (let i = 0; i < prepared.length; i += 1) {
          const entry = prepared[i];
          const bytes = entry.bytes || (await materializePart(entry.part, p.signal)).bytes;
          await appendPdf(PDFLib, output, bytes, entry.replaceExistingCover ? 1 : 0, entry.name, "montagem do documento final");
          entry.bytes = null;
          if (typeof p.onProgress === "function") p.onProgress({ phase: "merge", completed: i + 1, total: prepared.length, fileName: entry.name });
          await new Promise((resolve) => root.setTimeout(resolve, 0));
        }
        const code = text(p.analysis && p.analysis.code || coverData.code), title = text(p.analysis && p.analysis.data && p.analysis.data.title || coverData.title);
        output.setTitle(code ? `${code} - ${title}` : title || "Documento consolidado");
        output.setSubject(p.isCv ? "Dossiê consolidado de currículo RNEST/T2" : "Documento técnico consolidado pelo RECON"); output.setCreator("RECON — Codificação de Documentos"); output.setProducer("RECON / pdf-lib");
        const finalBytes = await savePdfSafely(output, { fileName: code || "PDF final", stage: "salvar documento consolidado" });
        const verified = await loadPdfSafely(PDFLib, finalBytes, { fileName: code || "PDF final", stage: "verificação final", probeEncrypted: false });
        if (verified.metadata.pageCount !== expectedPages) throw new Error(`PDF final inconsistente: esperado ${expectedPages} página(s), gerado ${verified.metadata.pageCount}.`);
        return finalBytes;
      } catch (error) {
        const e = error && error.name === "RECONPdfError" ? error : friendly(error, { fileName: "Documento consolidado", stage: "geração final" });
        uiFailure(e);
        throw e;
      } finally {
        prepared.forEach((entry) => { entry.bytes = null; });
        prepared = [];
      }
    }
    return Object.freeze(Object.assign({}, Base, { generateFinalBundle, __bundlePdfSafetyWrapped: true }));
  }
  function wrapPdf(Base) {
    if (!Base) return Base;
    let wrapped = Base.__pdfSafetyWrapped ? Base : wrapBasePdf(Base);
    if (typeof wrapped.generateFinalBundle === "function") wrapped = wrapBundlePdf(wrapped);
    return wrapped;
  }
  function intercept(name, wrapper) {
    let value = root[name];
    if (value) value = wrapper(value);
    const descriptor = Object.getOwnPropertyDescriptor(root, name);
    if (descriptor && descriptor.configurable === false) { if (value) root[name] = value; return; }
    Object.defineProperty(root, name, {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(next) { value = wrapper(next); },
    });
  }

  setWorker();
  intercept("RECONDocumentCodingParsers", wrapParsers);
  intercept("RECONDocumentCodingPDF", wrapPdf);

  const Runtime = Object.freeze({ PDFJS_VERSION, WORKER_CANDIDATES, setWorker, candidates, status, PDFSafe: Safe });
  root.RECONDocumentCodingPDFRuntime = Runtime;
  if (typeof module === "object" && module.exports) module.exports = { Runtime, Safe, wrapParsers, wrapPdf };
})(typeof window !== "undefined" ? window : globalThis);
