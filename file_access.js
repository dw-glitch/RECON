(function (root) {
  "use strict";

  const cache = new Map();
  const MAX_CACHE_BYTES = 128 * 1024 * 1024;
  const MAX_ENTRY_BYTES = 48 * 1024 * 1024;
  let cachedBytes = 0;

  function sleep(milliseconds) {
    return new Promise((resolve) => root.setTimeout(resolve, milliseconds));
  }

  function fileName(file) {
    return String(file && file.name || "arquivo selecionado");
  }

  function readWithFileReader(file) {
    return new Promise((resolve, reject) => {
      if (typeof root.FileReader !== "function") {
        reject(new Error("FileReader indisponível."));
        return;
      }
      const reader = new root.FileReader();
      reader.addEventListener("load", () => resolve(reader.result), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("Falha ao ler o arquivo.")), { once: true });
      reader.addEventListener("abort", () => reject(new Error("Leitura cancelada.")), { once: true });
      reader.readAsArrayBuffer(file);
    });
  }

  function ensureArrayBuffer(value) {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    throw new Error("O navegador não devolveu os bytes do arquivo.");
  }

  async function readRaw(file) {
    const attempts = [];
    if (file && typeof file.arrayBuffer === "function") attempts.push(() => file.arrayBuffer());
    if (file && typeof file.slice === "function") attempts.push(() => file.slice(0, file.size, file.type).arrayBuffer());
    attempts.push(() => readWithFileReader(file));

    let lastError = null;
    for (let index = 0; index < attempts.length; index += 1) {
      try {
        const buffer = ensureArrayBuffer(await attempts[index]());
        if (Number(file.size) > 0 && buffer.byteLength === 0) throw new Error("O arquivo foi lido sem conteúdo.");
        return buffer;
      } catch (error) {
        lastError = error;
        if (index < attempts.length - 1) await sleep(80);
      }
    }
    throw lastError || new Error("Falha ao ler o arquivo.");
  }

  function readableError(file, error) {
    const name = fileName(file);
    const message = `Não foi possível ler “${name}”. Feche o arquivo no Excel, copie-o para uma pasta local do computador, selecione-o novamente e tente outra vez. Arquivos abertos diretamente da rede, OneDrive ou SharePoint podem perder a permissão de leitura no Edge.`;
    const output = new Error(message);
    output.name = "RECONFileReadError";
    output.fileName = name;
    output.originalName = String(error && error.name || "NotReadableError");
    output.originalMessage = String(error && error.message || error || "");
    return output;
  }

  function trimCache(protectedFile) {
    while (cachedBytes > MAX_CACHE_BYTES && cache.size > 1) {
      const oldest = cache.keys().next().value;
      if (oldest === protectedFile) {
        const entry = cache.get(oldest);
        cache.delete(oldest);
        cache.set(oldest, entry);
        continue;
      }
      const entry = cache.get(oldest);
      cache.delete(oldest);
      cachedBytes -= Number(entry && entry.size || 0);
    }
  }

  async function readArrayBuffer(file, options) {
    if (!file) throw readableError(file, new Error("Arquivo não informado."));
    const config = options || {};
    const useCache = config.cache !== false && Number(file.size) <= MAX_ENTRY_BYTES;

    if (useCache && cache.has(file)) {
      const entry = cache.get(file);
      const buffer = entry.buffer || await entry.promise;
      return buffer.slice(0);
    }

    const promise = readRaw(file);
    if (useCache) cache.set(file, { promise, buffer: null, size: 0 });
    try {
      const buffer = await promise;
      if (useCache) {
        cache.set(file, { promise: Promise.resolve(buffer), buffer, size: buffer.byteLength });
        cachedBytes += buffer.byteLength;
        trimCache(file);
      }
      return buffer.slice(0);
    } catch (error) {
      if (useCache) cache.delete(file);
      throw readableError(file, error);
    }
  }

  function clear(file) {
    if (file && cache.has(file)) {
      const entry = cache.get(file);
      cachedBytes -= Number(entry && entry.size || 0);
      cache.delete(file);
      return;
    }
    if (!file) {
      cache.clear();
      cachedBytes = 0;
    }
  }

  root.addEventListener("beforeunload", () => clear());
  root.RECONFileAccess = Object.freeze({
    readArrayBuffer,
    clear,
    cached: (file) => cache.has(file),
    cacheBytes: () => cachedBytes,
  });
})(window);
