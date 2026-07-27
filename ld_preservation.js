(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONLdPreservation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function sameBytes(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
    return true;
  }

  function sameMetadata(left, right) {
    return Boolean(left && right)
      && Boolean(left.dir) === Boolean(right.dir)
      && String(left.comment || "") === String(right.comment || "")
      && String(left.unixPermissions || "") === String(right.unixPermissions || "")
      && String(left.dosPermissions || "") === String(right.dosPermissions || "");
  }

  async function verify(originalZip, outputZip, expectedChangedXml) {
    if (!originalZip || !outputZip) throw new Error("A estrutura interna da LD não pôde ser conferida.");
    const expected = expectedChangedXml instanceof Map ? expectedChangedXml : new Map(Object.entries(expectedChangedXml || {}));
    // Compactadores podem materializar ou omitir entradas de diretório vazias
    // sem alterar qualquer parte real da pasta de trabalho. A auditoria compara
    // todos os arquivos internos, que são o conteúdo controlado da LD.
    const originalNames = Object.keys(originalZip.files).filter((name) => !originalZip.files[name].dir).sort();
    const outputNames = Object.keys(outputZip.files).filter((name) => !outputZip.files[name].dir).sort();
    if (originalNames.length !== outputNames.length || originalNames.some((name, index) => name !== outputNames[index])) {
      throw new Error("A cópia da LD adicionou ou removeu partes internas inesperadamente.");
    }

    let unchangedParts = 0;
    let changedParts = 0;
    for (const name of originalNames) {
      const before = originalZip.files[name];
      const after = outputZip.files[name];
      if (!sameMetadata(before, after)) throw new Error(`Os metadados internos de ${name} foram alterados inesperadamente.`);
      if (expected.has(name)) {
        const actualXml = await after.async("string");
        if (actualXml !== expected.get(name)) throw new Error(`A aba ${name} recebeu alterações além dos títulos aprovados.`);
        changedParts += 1;
        continue;
      }
      const beforeBytes = await before.async("uint8array");
      const afterBytes = await after.async("uint8array");
      if (!sameBytes(beforeBytes, afterBytes)) throw new Error(`A parte interna ${name} foi alterada sem aprovação.`);
      unchangedParts += 1;
    }
    if (changedParts !== expected.size) throw new Error("Nem todas as abas autorizadas foram conferidas na cópia final.");
    return { valid: true, totalParts: unchangedParts + changedParts, unchangedParts, changedParts, changedPaths: [...expected.keys()] };
  }

  return Object.freeze({ sameBytes, verify });
});
