(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RECONDocumentCodingPDFSafe = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ERROR = Object.freeze({
    EMPTY: "PDF_EMPTY",
    NOT_PDF: "PDF_NOT_PDF",
    ENCRYPTED: "PDF_ENCRYPTED_UNSUPPORTED",
    PASSWORD: "PDF_PASSWORD_REQUIRED",
    CORRUPT: "PDF_CORRUPT",
    COPY: "PDF_COPY_FAILED",
    SAVE: "PDF_SAVE_FAILED",
  });

  function text(value) { return value == null ? "" : String(value).trim(); }
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
  function isEncryptionError(error) {
    const value = errorText(error);
    return /encryptedpdferror|input document.*encrypted|encrypted pdf|encryption/.test(value);
  }
  function isPasswordError(error) {
    const value = errorText(error);
    return /passwordexception|password required|need[_ -]?password|incorrect password|senha/.test(value);
  }
  function isCorruptError(error) {
    const value = errorText(error);
    return /invalid pdf|parse|xref|trailer|corrupt|malformed|unexpected eof|end of file/.test(value);
  }
  function friendly(error, context) {
    if (error && error.name === "RECONPdfError") return error;
    const name = text(context && context.fileName) || "PDF";
    if (isPasswordError(error)) return makeError(ERROR.PASSWORD, `${name}: este PDF exige senha ou possui uma proteção que impede o processamento automático. Remova a proteção/senha e tente novamente.`, error, context);
    if (isEncryptionError(error)) return makeError(ERROR.ENCRYPTED, `${name}: este PDF possui criptografia/proteção que não pôde ser processada com segurança. Remova a proteção e tente novamente.`, error, context);
    if (isCorruptError(error)) return makeError(ERROR.CORRUPT, `${name}: não foi possível interpretar este PDF. O arquivo pode estar corrompido ou incompleto.`, error, context);
    return makeError(ERROR.CORRUPT, `${name}: não foi possível processar este PDF.`, error, context);
  }
  function diagnostic(event, context, extra) {
    if (!root || !root.console || typeof root.console.info !== "function") return;
    const ctx = context || {};
    const data = Object.assign({ arquivo: text(ctx.fileName) || "PDF", etapa: text(ctx.stage) || "pdf" }, extra || {});
    // Não inclui texto/conteúdo do documento, apenas metadados técnicos mínimos.
    root.console.info(`[RECON PDF] ${event}`, data);
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
    const validated = validatePdfBytes(input, opts);
    const baseOptions = Object.assign({ updateMetadata: false }, opts.loadOptions || {});
    delete baseOptions.ignoreEncryption;
    try {
      const document = await PDFLib.PDFDocument.load(validated.bytes, Object.assign({}, baseOptions, { ignoreEncryption: false }));
      const pageCount = document.getPageCount();
      if (!pageCount) throw makeError(ERROR.CORRUPT, `${text(opts.fileName) || "PDF"}: o PDF não possui páginas válidas.`);
      return { document, bytes: validated.bytes, metadata: { pageCount, encryptedFallback: false, size: validated.size, headerOffset: validated.headerOffset } };
    } catch (firstError) {
      if (!isEncryptionError(firstError)) throw friendly(firstError, opts);
      diagnostic("criptografia detectada; tentando modo compatível", opts, { tentativaNormal: "encrypted" });
      try {
        const document = await PDFLib.PDFDocument.load(validated.bytes, Object.assign({}, baseOptions, { ignoreEncryption: true }));
        const pageCount = document.getPageCount();
        if (!pageCount) throw new Error("PDF sem páginas após ignoreEncryption");
        if (opts.probeEncrypted !== false) await probeCopy(PDFLib, document, opts);
        diagnostic("PDF protegido processável", opts, { tentativaIgnoreEncryption: "sucesso", paginas: pageCount, tamanho: validated.size });
        return { document, bytes: validated.bytes, metadata: { pageCount, encryptedFallback: true, size: validated.size, headerOffset: validated.headerOffset } };
      } catch (fallbackError) {
        diagnostic("PDF protegido bloqueado", opts, { tentativaIgnoreEncryption: "falhou", erro: text(fallbackError && fallbackError.name) || "erro" });
        if (fallbackError && fallbackError.name === "RECONPdfError") throw fallbackError;
        throw friendly(fallbackError, opts);
      }
    }
  }
  async function copyPdfPagesSafely(PDFLib, output, input, indexes, options) {
    const loaded = await loadPdfSafely(PDFLib, input, Object.assign({}, options || {}, { probeEncrypted: true }));
    const source = loaded.document;
    const pageCount = source.getPageCount();
    const wanted = Array.isArray(indexes) ? indexes : Array.from({ length: pageCount }, (_, i) => i);
    if (wanted.some((index) => !Number.isInteger(index) || index < 0 || index >= pageCount)) throw makeError(ERROR.COPY, `${text(options && options.fileName) || "PDF"}: índice de página inválido durante a montagem.`);
    try {
      const copied = await output.copyPages(source, wanted);
      copied.forEach((page) => output.addPage(page));
      return { count: copied.length, metadata: loaded.metadata };
    } catch (error) {
      throw makeError(ERROR.COPY, `${text(options && options.fileName) || "PDF"}: não foi possível copiar as páginas para o PDF final.`, error, options);
    }
  }
  async function savePdfSafely(document, options) {
    try {
      return new Uint8Array(await document.save(Object.assign({ useObjectStreams: true, addDefaultPage: false }, options && options.saveOptions || {})));
    } catch (error) {
      throw makeError(ERROR.SAVE, `${text(options && options.fileName) || "PDF final"}: não foi possível salvar o PDF montado.`, error, options);
    }
  }
  function classifyPdfJsError(error, context) { return friendly(error, context); }
  function duplicateHashes(items) {
    const seen = new Map();
    const duplicates = [];
    (items || []).forEach((item) => {
      const hash = text(item && item.hash);
      if (!hash) return;
      if (seen.has(hash)) duplicates.push({ hash, first: seen.get(hash), duplicate: item });
      else seen.set(hash, item);
    });
    return duplicates;
  }

  return Object.freeze({ ERROR, toBytes, headerOffset, validatePdfBytes, isEncryptionError, isPasswordError, friendly, diagnostic, loadPdfSafely, copyPdfPagesSafely, savePdfSafely, classifyPdfJsError, duplicateHashes });
});