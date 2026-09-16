(function (root) {
  "use strict";
  const Base = root.RECONDocumentCodingParsers;
  const Safe = root.RECONDocumentCodingPDFSafe;
  if (!Base || !Safe) return;

  function typeOf(file) { return Base.detectedType(file); }
  function cachedFile(file, buffer) {
    const proxy = Object.create(file || null);
    Object.defineProperty(proxy, "arrayBuffer", { value: async () => buffer, enumerable: false });
    return proxy;
  }

  async function parseDocument(file, options) {
    const check = Base.validateInputFile(file, ["pdf", "docx"]);
    if (!check.valid) throw new Error(check.reason);
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (error) {
      throw new Error(`${file && file.name || "Arquivo"}: não foi possível ler os bytes do arquivo.`);
    }
    const proxy = cachedFile(file, buffer);
    if (typeOf(file) === "pdf") {
      // Não confia apenas em extensão/MIME. Rejeita PDF falso antes do PDF.js.
      Safe.validatePdfBytes(buffer, { fileName: file.name, stage: "leitura" });
    }
    try {
      // O parser base pode chamar arrayBuffer mais de uma vez (extração + hash),
      // mas o proxy sempre devolve o mesmo buffer já carregado, evitando I/O e cópias repetidas.
      return await Base.parseDocument(proxy, options || {});
    } catch (error) {
      if (typeOf(file) === "pdf") throw Safe.classifyPdfJsError(error, { fileName: file.name, stage: "análise" });
      throw error;
    } finally {
      buffer = null;
    }
  }

  root.RECONDocumentCodingParsers = Object.freeze(Object.assign({}, Base, { parseDocument }));
})(typeof globalThis !== "undefined" ? globalThis : this);