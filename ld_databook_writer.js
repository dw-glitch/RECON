(function (root, factory) {
  const contracts = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const preservation = root.RECONLdPreservation || (typeof module === "object" && module.exports ? require("./ld_preservation.js") : null);
  const allocationCore = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const api = factory(contracts, preservation, allocationCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RECONDatabookWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contracts, Preservation, AllocationCore) {
  "use strict";

  function rawText(value) { return value === null || value === undefined ? "" : String(value); }
  function text(value) { return rawText(value).trim(); }
  function norm(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " "); }
  function xmlEscape(value) { return rawText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
  function xmlDecode(value) { return rawText(value).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function findDatabookColumn(sheet, XLSX) {
    if (!sheet || !sheet["!ref"]) return -1;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const maxRow = Math.min(range.e.r, range.s.r + 35);
    for (let row = range.s.r; row <= maxRow; row += 1) {
      let hasDocument = false; let databookColumn = -1;
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        const value = norm(cell && (cell.w !== undefined ? cell.w : cell.v));
        if (value === "DOCUMENTO" || value.startsWith("DOCUMENTO ") || value === "CODIGO DO DOCUMENTO" || value === "CODIGO DOCUMENTO") hasDocument = true;
        if (value === "CAMINHO DATA BOOK" || value === "CAMINHO DATABOOK" || value.includes("CAMINHO DO DATA BOOK")) databookColumn = column;
      }
      if (hasDocument && databookColumn >= 0) return databookColumn;
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
    const rows = (approvedRows || []).filter((row) => row && row.decision === "approved" && row.controlledSource && text(row.proposed));
    if (!rows.length) throw new Error("Nenhum Caminho Databook confirmado por alocação foi selecionado.");
    const original = await file.arrayBuffer();
    const workbook = XLSX.read(original, { type: "array", cellDates: true, cellFormula: true, bookVBA: true });
    const zip = await JSZip.loadAsync(original);
    const sheetPaths = await workbookSheetPaths(zip);
    const changes = [];

    for (const row of rows) {
      const sheetName = text(row.sheet);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error(`A aba ${sheetName} não foi localizada na LD original.`);
      const databookColumn = Number(row.column) > 0 ? Number(row.column) - 1 : findDatabookColumn(sheet, XLSX);
      if (databookColumn < 0) throw new Error(`A coluna CAMINHO DATABOOK não foi localizada na aba ${sheetName}.`);
      const cellRef = XLSX.utils.encode_cell({ r: Number(row.row) - 1, c: databookColumn });
      const target = sheet[cellRef];
      if (target && target.f) throw new Error(`O Caminho Databook do documento ${text(row.document) || "informado"} é uma fórmula e não será sobrescrito.`);
      const currentValue = rawText(target && (target.v !== undefined ? target.v : target.w));
      if (text(row.current) && text(currentValue) !== text(row.current)) {
        throw new Error(`O Caminho Databook do documento ${text(row.document) || "informado"} mudou desde a análise. Analise a LD novamente.`);
      }
      if (AllocationCore && AllocationCore.completeDatabook && AllocationCore.completeDatabook(currentValue)) {
        throw new Error(`O documento ${text(row.document) || "informado"} já possui Caminho Databook completo. O preenchimento automático altera somente campos vazios ou incompletos.`);
      }
      const address = XLSX.utils.decode_cell(cellRef);
      const merged = (sheet["!merges"] || []).find((range) => address.r >= range.s.r && address.r <= range.e.r && address.c >= range.s.c && address.c <= range.e.c);
      if (merged && (address.r !== merged.s.r || address.c !== merged.s.c)) {
        throw new Error(`A célula ${cellRef} faz parte de uma mesclagem e não é a célula principal. O caminho não será alterado.`);
      }
      const path = sheetPaths.get(sheetName);
      if (!path || !zip.file(path)) throw new Error(`A estrutura interna da aba ${sheetName} não foi localizada.`);
      changes.push({
        sheet: sheetName,
        row: Number(row.row),
        cell: cellRef,
        oldValue: currentValue,
        newValue: rawText(row.proposed),
        document: text(row.document),
        kind: "databook",
        path,
        source: text(row.controlledSourceFile),
        allocation: text(row.allocation),
      });
    }

    const validation = Contracts ? Contracts.validateChangeSet(changes) : { valid: true, errors: [] };
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const grouped = new Map();
    changes.forEach((change) => {
      if (!grouped.has(change.path)) grouped.set(change.path, []);
      grouped.get(change.path).push({ cellRef: change.cell, rowNumber: change.row, value: change.newValue, sheetName: change.sheet, document: change.document });
    });
    return { rows, original, workbook, zip, changes, grouped };
  }

  async function apply(file, approvedRows, XLSX, JSZip) {
    const plan = await planChanges(file, approvedRows, XLSX, JSZip);
    const originalZip = await JSZip.loadAsync(plan.original);
    const expectedChangedXml = new Map();
    for (const [path, changes] of plan.grouped) {
      let xml = await plan.zip.file(path).async("string");
      changes.forEach((change) => { xml = patchCellXml(xml, change.cellRef, change.rowNumber, change.value); });
      plan.zip.file(path, xml);
      expectedChangedXml.set(path, xml);
    }
    const output = await plan.zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const outputZip = await JSZip.loadAsync(output);
    const preservation = Preservation
      ? await Preservation.verify(originalZip, outputZip, expectedChangedXml)
      : { valid: true, totalParts: 0, unchangedParts: 0, changedParts: expectedChangedXml.size, changedPaths: [...expectedChangedXml.keys()] };
    const reopened = XLSX.read(output, { type: "array", cellDates: true, cellFormula: true, bookVBA: true });
    plan.changes.forEach((change) => {
      const sheet = reopened.Sheets[change.sheet];
      const cell = sheet && sheet[change.cell];
      const actual = rawText(cell && (cell.v !== undefined ? cell.v : cell.w));
      if (actual !== change.newValue) throw new Error(`O Caminho Databook do documento ${change.document || "informado"} não foi confirmado exatamente na cópia final.`);
    });
    const extension = /\.xlsm$/i.test(file.name) ? ".xlsm" : ".xlsx";
    const base = file.name.replace(/\.(xlsx|xlsm)$/i, "");
    const date = new Date();
    const part = (value, size) => String(value).padStart(size || 2, "0");
    const stamp = `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}_${part(date.getMilliseconds(), 3)}`;
    return {
      buffer: output,
      fileName: `${base}_DATABOOK_PREENCHIDO_RECON_${stamp}${extension}`,
      count: plan.rows.length,
      changes: plan.changes,
      preservation,
      summary: {
        title: "A cópia da LD foi gerada.",
        explanation: `${plan.rows.length} Caminho(s) Databook confirmado(s) pela alocação foram copiados exatamente. A LD original permaneceu intacta.`,
      },
    };
  }

  return { apply, planChanges, findDatabookColumn, patchCellXml };
});
