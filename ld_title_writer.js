(function (root, factory) {
  const contracts = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const preservation = root.RECONLdPreservation || (typeof module === "object" && module.exports ? require("./ld_preservation.js") : null);
  const api = factory(contracts, preservation);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RECONTitleWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contracts, Preservation) {
  "use strict";

  function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
  function norm(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " "); }
  function xmlEscape(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
  function xmlDecode(value) { return String(value || "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function findTitleColumn(sheet, XLSX) {
    if (!sheet || !sheet["!ref"]) return -1;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const maxRow = Math.min(range.e.r, range.s.r + 30);
    for (let row = range.s.r; row <= maxRow; row += 1) {
      let hasDocument = false; let titleColumn = -1;
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        const value = norm(cell && (cell.w !== undefined ? cell.w : cell.v));
        if (value === "DOCUMENTO" || value.startsWith("DOCUMENTO ") || value === "CODIGO DO DOCUMENTO" || value === "CODIGO DOCUMENTO") hasDocument = true;
        if (value === "TITULO" || value.includes("TITULO DO DOCUMENTO")) titleColumn = column;
      }
      if (hasDocument && titleColumn >= 0) return titleColumn;
    }
    return -1;
  }

  function workbookSheetPaths(zip) {
    const workbookXml = zip.file("xl/workbook.xml");
    const relsXml = zip.file("xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relsXml) throw new Error("Estrutura interna da LD não reconhecida.");
    return Promise.all([workbookXml.async("string"), relsXml.async("string")]).then(([workbook, rels]) => {
      const relations = new Map();
      const relPattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/g;
      let match;
      while ((match = relPattern.exec(rels))) relations.set(match[1], match[2]);
      const paths = new Map();
      const sheetPattern = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g;
      while ((match = sheetPattern.exec(workbook))) {
        const target = relations.get(match[2]);
        if (!target) continue;
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
        paths.set(xmlDecode(match[1]), path.replace(/\\/g, "/"));
      }
      return paths;
    });
  }

  function cleanCellAttributes(attributes) {
    return String(attributes || "")
      .replace(/\s+t\s*=\s*"[^"]*"/gi, "")
      .replace(/\s+t\s*=\s*'[^']*'/gi, "");
  }

  function patchCellXml(xml, cellRef, rowNumber, value) {
    const escapedRef = escapeRegExp(cellRef);
    const content = `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
    const renderCell = (attributes) => `<c${cleanCellAttributes(attributes)} t="inlineStr">${content}</c>`;
    const full = new RegExp(`<c\\b([^>]*\\br="${escapedRef}"[^>]*)>[\\s\\S]*?<\\/c>`, "i");
    if (full.test(xml)) return xml.replace(full, (_all, attributes) => renderCell(attributes));
    const self = new RegExp(`<c\\b([^>]*\\br="${escapedRef}"[^>]*)\\/>`, "i");
    if (self.test(xml)) return xml.replace(self, (_all, attributes) => renderCell(attributes));
    const row = new RegExp(`(<row\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(<\\/row>)`, "i");
    if (!row.test(xml)) throw new Error(`Linha ${rowNumber} não localizada na estrutura interna da LD.`);
    return xml.replace(row, (_all, open, cells, close) => `${open}${cells}<c r="${cellRef}" t="inlineStr">${content}</c>${close}`);
  }

  async function planChanges(file, approvedRows, XLSX, JSZip) {
    if (!file || !/\.(xlsx|xlsm)$/i.test(file.name || "")) throw new Error("Use uma LD nos formatos .xlsx ou .xlsm.");
    const rows = (approvedRows || []).filter((row) => row && row.decision === "approved" && text(row.proposed));
    if (!rows.length) throw new Error("Nenhum título foi aprovado para alteração.");
    const original = await file.arrayBuffer();
    const workbook = XLSX.read(original, { type: "array", cellDates: true, cellFormula: true, bookVBA: true });
    const zip = await JSZip.loadAsync(original);
    const sheetPaths = await workbookSheetPaths(zip);
    const changes = [];
    for (const row of rows) {
      const sheetName = text(row.sheet);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error(`A aba ${sheetName} não foi localizada na LD original.`);
      const titleColumn = findTitleColumn(sheet, XLSX);
      if (titleColumn < 0) throw new Error(`A coluna TÍTULO não foi localizada na aba ${sheetName}.`);
      const cellRef = XLSX.utils.encode_cell({ r: Number(row.row) - 1, c: titleColumn });
      const target = sheet[cellRef];
      if (target && target.f) throw new Error(`O título do documento ${text(row.document) || "informado"} é uma fórmula e não será sobrescrito.`);
      const currentValue = text(target && (target.w !== undefined ? target.w : target.v));
      if (text(row.current) && currentValue !== text(row.current)) {
        throw new Error(`O título do documento ${text(row.document) || "informado"} mudou desde a análise. Analise a LD novamente.`);
      }
      const address = XLSX.utils.decode_cell(cellRef);
      const merged = (sheet["!merges"] || []).find((range) => address.r >= range.s.r && address.r <= range.e.r && address.c >= range.s.c && address.c <= range.e.c);
      if (merged && (address.r !== merged.s.r || address.c !== merged.s.c)) {
        throw new Error(`A célula ${cellRef} faz parte de uma mesclagem e não é a célula principal. O título não será alterado.`);
      }
      const path = sheetPaths.get(sheetName);
      if (!path || !zip.file(path)) throw new Error(`A estrutura interna da aba ${sheetName} não foi localizada.`);
      changes.push({
        sheet: sheetName,
        row: Number(row.row),
        cell: cellRef,
        oldValue: text(row.current),
        newValue: text(row.proposed),
        document: text(row.document),
        kind: "title",
        path,
      });
    }
    const validation = Contracts ? Contracts.validateChangeSet(changes) : { valid: true, errors: [], changes };
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const grouped = new Map();
    validation.changes.forEach((change, index) => {
      const path = changes[index].path;
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push({ cellRef: change.cell, rowNumber: change.row, value: change.newValue, sheetName: change.sheet, document: change.document });
    });
    return { rows, original, workbook, zip, changes: validation.changes, grouped };
  }

  async function apply(file, approvedRows, XLSX, JSZip) {
    const plan = await planChanges(file, approvedRows, XLSX, JSZip);
    const { rows, zip, grouped } = plan;
    const originalZip = await JSZip.loadAsync(plan.original);
    const expectedChangedXml = new Map();
    for (const [path, changes] of grouped) {
      let xml = await zip.file(path).async("string");
      changes.forEach((change) => { xml = patchCellXml(xml, change.cellRef, change.rowNumber, change.value); });
      zip.file(path, xml);
      expectedChangedXml.set(path, xml);
    }
    const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const outputZip = await JSZip.loadAsync(output);
    const preservation = Preservation
      ? await Preservation.verify(originalZip, outputZip, expectedChangedXml)
      : { valid: true, totalParts: 0, unchangedParts: 0, changedParts: expectedChangedXml.size, changedPaths: [...expectedChangedXml.keys()] };
    const reopened = XLSX.read(output, { type: "array", cellDates: true, cellFormula: true, bookVBA: true });
    plan.changes.forEach((change) => {
      const sheet = reopened.Sheets[change.sheet];
      const cell = sheet && sheet[change.cell];
      const actual = text(cell && (cell.w !== undefined ? cell.w : cell.v));
      if (actual !== change.newValue) throw new Error(`A alteração do documento ${change.document || "informado"} não foi confirmada na cópia final.`);
    });
    const extension = /\.xlsm$/i.test(file.name) ? ".xlsm" : ".xlsx";
    const base = file.name.replace(/\.(xlsx|xlsm)$/i, "");
    const date = new Date();
    const part = (value, size) => String(value).padStart(size || 2, "0");
    const stamp = `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}_${part(date.getMilliseconds(), 3)}`;
    return {
      buffer: output,
      fileName: `${base}_TITULOS_REVISADOS_RECON_${stamp}${extension}`,
      count: rows.length,
      changes: plan.changes,
      preservation,
      summary: {
        title: "A cópia da LD foi gerada.",
        explanation: `${rows.length} título(s) aprovado(s) foram alterados. ${preservation.totalParts || "Todas as"} partes internas foram conferidas e a LD original permaneceu intacta.`,
      },
    };
  }

  return { apply, planChanges, findTitleColumn, patchCellXml };
});
