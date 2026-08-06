(function (root) {
  "use strict";

  // Disponível hoje só em navegadores baseados em Chromium (Edge, Chrome).
  // Fora deles, a permissão nunca aparece e o app segue com o fluxo de
  // baixar uma cópia nova, que já funciona em qualquer navegador.
  function isSupported() {
    return typeof root.showOpenFilePicker === "function" && Boolean(root.isSecureContext);
  }

  const SPREADSHEET_TYPES = [{
    description: "Planilhas Excel",
    accept: {
      "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
  }];

  async function pickForEdit() {
    if (!isSupported()) {
      throw new Error("Este navegador não permite salvar diretamente no arquivo. Use o Edge ou o Chrome, ou baixe uma cópia normalmente.");
    }
    let handles;
    try {
      handles = await root.showOpenFilePicker({ types: SPREADSHEET_TYPES, excludeAcceptAllOption: false, multiple: false });
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new Error("Não foi possível abrir o seletor de arquivos do navegador.");
    }
    const handle = handles[0];
    const file = await handle.getFile();
    return { handle, file };
  }

  async function ensureWritePermission(handle) {
    const options = { mode: "readwrite" };
    if (typeof handle.queryPermission === "function" && (await handle.queryPermission(options)) === "granted") return true;
    if (typeof handle.requestPermission !== "function") {
      throw new Error("Este navegador não confirma permissão de escrita; salve uma cópia em vez de editar no lugar.");
    }
    if ((await handle.requestPermission(options)) === "granted") return true;
    throw new Error("Permissão para salvar no arquivo original foi negada pelo navegador.");
  }

  // createWritable() grava num arquivo temporário e só substitui o original no
  // close() — se a gravação falhar no meio (queda de energia, aba fechada), o
  // arquivo original permanece intacto em vez de ficar corrompido pela metade.
  async function writeBuffer(handle, buffer) {
    await ensureWritePermission(handle);
    const writable = await handle.createWritable();
    try {
      await writable.write(buffer);
    } catch (error) {
      try { await writable.abort(); } catch (_) { /* já falhou; nada a fazer */ }
      throw error;
    }
    await writable.close();
  }

  async function sameFile(handle, file) {
    if (!handle || !file) return false;
    try {
      const current = await handle.getFile();
      return current.name === file.name && current.lastModified === file.lastModified && current.size === file.size;
    } catch (_) {
      return false;
    }
  }

  root.RECONFileHandles = Object.freeze({ isSupported, pickForEdit, ensureWritePermission, writeBuffer, sameFile });
})(window);
