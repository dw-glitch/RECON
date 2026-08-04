(function (root, factory) {
  const allocation = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const core = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const api = factory(allocation, core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AllocationWorkbook = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (A, C) {
  "use strict";

  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const OFFICIAL_SHEET_NAME = "GERAL";
  const OFFICIAL_COLUMN_COUNT = 16;
  const OFFICIAL_LAST_COLUMN = "P";
  const yellowColumns = new Set([1, 2, 5, 7, 10, 11, 12, 13, 14, 15, 16]);
  const controlYellowColumns = new Set([10, 11, 14, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);

  function asDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = C && C.parseDate ? C.parseDate(value) : new Date(value);
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  function copyRow(values) {
    return values.map((value) => value === null || value === undefined || value === "" ? null : value);
  }

  function styleHeader(row, options) {
    row.height = 31;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const dark = options && options.darkColumns && columnNumber <= options.darkColumns;
      const yellow = options && options.yellowColumns && options.yellowColumns.has(columnNumber);
      cell.font = { name: dark ? "Aptos Narrow" : "Calibri", size: dark ? 11 : 10, bold: true, color: { argb: dark ? "FFFFFFFF" : "FF000000" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = dark
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }
        : yellow
          ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }
          : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      cell.border = dark ? {
        top: { style: "thin", color: { argb: "FF9EADBC" } },
        left: { style: "thin", color: { argb: "FF9EADBC" } },
        bottom: { style: "thin", color: { argb: "FF9EADBC" } },
        right: { style: "thin", color: { argb: "FF9EADBC" } },
      } : {};
    });
  }

  function styleDataRow(row, columnCount, dateColumns, rowIndex) {
    row.height = 30;
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      cell.font = { name: "Aptos", size: 9.5, color: { argb: "FF24384B" } };
      cell.alignment = { horizontal: columnNumber === 1 || columnNumber === 3 || columnNumber === 10 ? "left" : "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex % 2 ? "FFF8FAFC" : "FFFFFFFF" } };
      cell.border = {
        top: { style: "hair", color: { argb: "FFB8B8B8" } },
        left: { style: "hair", color: { argb: "FFB8B8B8" } },
        bottom: { style: "hair", color: { argb: "FFB8B8B8" } },
        right: { style: "hair", color: { argb: "FFB8B8B8" } },
      };
      if (dateColumns.has(columnNumber) && cell.value) cell.numFmt = "dd/mm/yyyy";
    }
  }

  function dateCells(values, dateIndexes) {
    const output = copyRow(values);
    dateIndexes.forEach((index) => {
      const date = asDate(output[index]);
      if (date) output[index] = date;
    });
    return output;
  }

  function setRowValues(sheet, rowNumber, values) {
    const row = sheet.getRow(rowNumber);
    values.forEach((value, index) => { row.getCell(index + 1).value = value === "" || value === undefined ? null : value; });
    return row;
  }

  function decodeTemplate(base64) {
    const value = String(base64 || "");
    if (!value) throw new Error("Modelo oficial de alocação indisponível.");
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") return Buffer.from(value, "base64");
    if (typeof atob !== "function") throw new Error("O navegador não conseguiu abrir o modelo oficial de alocação.");
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function xmlEscape(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function excelSerial(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const date = asDate(value);
    if (!date) return null;
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000 + 25569);
  }

  function inlineCell(reference, style, value, options) {
    const settings = options || {};
    if (value === null || value === undefined || value === "") return `<c r="${reference}" s="${style}"/>`;
    if (settings.date) {
      const serial = excelSerial(value);
      if (serial !== null) return `<c r="${reference}" s="${style}"><v>${serial}</v></c>`;
    }
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${reference}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function allocationRowXml(rowNumber, values) {
    const row = values || [];
    const workflowStyle = rowNumber <= 27 ? 5 : 4;
    const cells = [
      inlineCell(`A${rowNumber}`, 8, row[0]),
      inlineCell(`B${rowNumber}`, 8, row[1], { date: true }),
      inlineCell(`C${rowNumber}`, workflowStyle, row[2]),
      row[3] === null || row[3] === undefined || row[3] === "" ? "" : inlineCell(`D${rowNumber}`, 6, row[3]),
      inlineCell(`E${rowNumber}`, 6, row[4]),
      inlineCell(`F${rowNumber}`, 6, row[5], { date: true }),
      inlineCell(`G${rowNumber}`, 7, row[6]),
      inlineCell(`H${rowNumber}`, 6, row[7]),
      inlineCell(`I${rowNumber}`, 6, row[8]),
      inlineCell(`J${rowNumber}`, 6, row[9]),
      inlineCell(`K${rowNumber}`, 6, row[10]),
      inlineCell(`L${rowNumber}`, 6, row[11]),
      inlineCell(`M${rowNumber}`, 6, row[12]),
      inlineCell(`N${rowNumber}`, 3, row[13]),
      inlineCell(`O${rowNumber}`, 3, row[14]),
      inlineCell(`P${rowNumber}`, 3, row[15]),
    ].join("");
    return `<row r="${rowNumber}" spans="1:16" x14ac:dyDescent="0.35">${cells}</row>`;
  }

  function blankAllocationRowXml(rowNumber) {
    return allocationRowXml(rowNumber, Array(16).fill(null));
  }

  function updateFilterDatabase(workbookXml, lastFilterRow) {
    return workbookXml.replace(
      /(<definedName\b[^>]*name="_xlnm\._FilterDatabase"[^>]*>)[\s\S]*?(<\/definedName>)/,
      (_match, opening, closing) => `${opening}${OFFICIAL_SHEET_NAME}!$A$1:$${OFFICIAL_LAST_COLUMN}$${lastFilterRow}${closing}`,
    );
  }

  async function validateOfficialAllocationTemplate(zip) {
    const workbookEntry = zip.file("xl/workbook.xml");
    const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
    const stylesEntry = zip.file("xl/styles.xml");
    const themeEntry = zip.file("xl/theme/theme1.xml");
    if (!workbookEntry || !sheetEntry || !stylesEntry || !themeEntry) {
      throw new Error("O modelo oficial de alocação está incompleto.");
    }

    const workbookXml = await workbookEntry.async("string");
    if (!new RegExp(`<sheet\\b[^>]*name="${OFFICIAL_SHEET_NAME}"`).test(workbookXml)) {
      throw new Error(`O modelo oficial precisa manter a aba ${OFFICIAL_SHEET_NAME}.`);
    }

    const sheetXml = await sheetEntry.async("string");
    const headerMatch = sheetXml.match(/<row\b[^>]*r="1"[^>]*>[\s\S]*?<\/row>/);
    if (!headerMatch) throw new Error("O cabeçalho do modelo oficial de alocação não foi localizado.");
    const headerReferences = Array.from(headerMatch[0].matchAll(/<c\b[^>]*r="([A-Z]+)1"/g), (match) => match[1]);
    if (headerReferences.length !== OFFICIAL_COLUMN_COUNT || headerReferences[0] !== "A" || headerReferences.at(-1) !== OFFICIAL_LAST_COLUMN) {
      throw new Error("O modelo oficial foi alterado: a alocação deve ter exatamente 16 colunas, de A até P.");
    }
    if (/<c\b[^>]*r="Q1"/.test(headerMatch[0])) {
      throw new Error("O modelo oficial contém coluna adicional e não pode ser exportado.");
    }
    return { workbookXml, sheetXml, workbookEntry, sheetEntry };
  }

  function updateCoreProperties(coreXml) {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    let output = coreXml
      .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, "<dc:creator>RECON 1.26.26</dc:creator>")
      .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy>RECON 1.26.26</cp:lastModifiedBy>");
    output = output.replace(
      /(<dcterms:modified\b[^>]*>)[\s\S]*?(<\/dcterms:modified>)/,
      (_match, opening, closing) => `${opening}${now}${closing}`,
    );
    return output;
  }

  async function buildAllocation(results, ExcelJS) {
    const template = typeof globalThis !== "undefined" ? globalThis.RECONAllocationTemplate : null;
    const Zip = typeof globalThis !== "undefined" ? globalThis.JSZip : null;
    if (!template || !template.base64) throw new Error("Modelo oficial de alocação não foi carregado.");
    if (!Zip || typeof Zip.loadAsync !== "function") throw new Error("Biblioteca ZIP indisponível para gerar a alocação no modelo oficial.");

    const list = results || [];
    const dataEndRow = list.length + 1;
    const lastStyledRow = Math.max(126, dataEndRow);
    const lastFilterRow = Math.max(104, dataEndRow);
    const zip = await Zip.loadAsync(decodeTemplate(template.base64));
    const officialTemplate = await validateOfficialAllocationTemplate(zip);
    const sheetEntry = officialTemplate.sheetEntry;
    const workbookEntry = officialTemplate.workbookEntry;

    let sheetXml = officialTemplate.sheetXml;
    const headerMatch = sheetXml.match(/<row\b[^>]*r="1"[^>]*>[\s\S]*?<\/row>/);
    if (!headerMatch) throw new Error("O cabeçalho do modelo oficial de alocação não foi localizado.");
    const rows = [headerMatch[0]];
    list.forEach((result, index) => {
      rows.push(allocationRowXml(index + 2, dateCells(A.allocationRow(result), [1, 5])));
    });
    for (let rowNumber = dataEndRow + 1; rowNumber <= lastStyledRow; rowNumber += 1) rows.push(blankAllocationRowXml(rowNumber));

    sheetXml = sheetXml
      .replace(/<dimension\b[^>]*ref="[^"]*"[^>]*\/>/, `<dimension ref="A1:${OFFICIAL_LAST_COLUMN}${lastStyledRow}"/>`)
      .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rows.join("")}</sheetData>`)
      .replace(/(<autoFilter\b[^>]*ref=")[^"]*(")/, (_match, opening, closing) => `${opening}A1:${OFFICIAL_LAST_COLUMN}${lastFilterRow}${closing}`);
    zip.file("xl/worksheets/sheet1.xml", sheetXml);

    const workbookXml = updateFilterDatabase(await workbookEntry.async("string"), lastFilterRow);
    zip.file("xl/workbook.xml", workbookXml);
    const coreEntry = zip.file("docProps/core.xml");
    if (coreEntry) zip.file("docProps/core.xml", updateCoreProperties(await coreEntry.async("string")));

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  async function buildControlLines(results, meta, ExcelJS) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RECON";
    workbook.created = new Date();
    workbook.modified = new Date();
    const sheet = workbook.addWorksheet("Central de alocação", { properties: { defaultRowHeight: 15 } });
    sheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2", showGridLines: false, zoomScale: 90, zoomScaleNormal: 90 }];
    const headerRow = setRowValues(sheet, 1, A.CONTROL_HEADERS.map((header) => String(header)));
    styleHeader(headerRow, { darkColumns: 9, yellowColumns: controlYellowColumns });

    (results || []).forEach((result, index) => {
      const row = setRowValues(sheet, index + 2, dateCells(A.controlRow(result, meta), [2, 10, 14]));
      styleDataRow(row, A.CONTROL_HEADERS.length, new Set([3, 11, 15]), index);
      row.getCell(1).font = { name: "Aptos Narrow", size: 11 };
      row.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
      row.getCell(9).font = { name: "Aptos Narrow", size: 9 };
    });

    [11, 17, 17, 18, 42, 18, 28, 28, 8, 40, 17.86, 31.86, 10, 11, 15, 24, 12, 28, 62.86, 14, 18, 29, 24, 18, 18, 18, 18, 18, 18]
      .forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.autoFilter = { from: "A1", to: `AC${Math.max(1, sheet.rowCount)}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1", margins: { left: .2, right: .2, top: .45, bottom: .45, header: .2, footer: .2 } };
    sheet.headerFooter.oddFooter = "&LRECON · CENTRAL DE ALOCAÇÃO&C&P de &N&R&D";
    return workbook.xlsx.writeBuffer();
  }

  function formatDateBR(value) {
    const parsed = C && C.parseDate ? C.parseDate(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return A.text(value);
    return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
  }

  function reportDecision(result) {
    if (result && result.decision === A.READY && result.reallocationRequired) return "SIM — PREPARAR NOVA ALOCAÇÃO";
    if (result && result.decision === A.READY) return "SIM — PODE ALOCAR";
    if (result && result.decision === A.SKIP) return "NÃO — JÁ ALOCADO";
    return "NÃO — REVISAR";
  }

  function reportSituation(result) {
    if (result && result.decision === A.READY && result.reallocationRequired) return "Alocação anterior recusada — nova alocação preparada";
    if (result && result.decision === A.READY) return "Pronto para nova alocação";
    if (result && result.decision === A.SKIP) return "Documento já alocado";
    return "Necessita conferência";
  }

  function addReportBrand(workbook, sheet) {
    try {
      const brand = typeof globalThis !== "undefined" ? globalThis.RECONBrand : null;
      if (!brand || !brand.addReportLogo) return;
      const image = brand.addReportLogo(workbook);
      sheet.addImage(image, { tl: { col: 0.15, row: 0.15 }, ext: { width: 170, height: 62 } });
    } catch (_) { /* relatório continua íntegro sem imagem */ }
  }

  function reportHeaders() {
    return [
      "PODE ALOCAR?", "SITUAÇÃO", "DOCUMENTO", "ARQUIVO LD", "ABA LD", "LINHA LD", "VERSÃO DA LD ENVIADA",
      "CONFIRMAÇÃO NA LD", "RESULTADO DA CONFIRMAÇÃO", "COMENTÁRIO DA CONFIRMAÇÃO", "FONTE DA CONFIRMAÇÃO",
      "DATA DA CONFIRMAÇÃO", "ALOCAÇÃO ANTERIOR", "MOTIVO DA ALOCAÇÃO / NÃO ALOCAÇÃO", "ETAPA DA ALOCAÇÃO",
      "COMENTÁRIO DA FISCAL UTILIZADO", "NÚMERO DA GRDT NA LD", "DATA EFETIVA DE EMISSÃO DA GRDT",
      "SITUAÇÃO DE POSTAGEM", "EVIDÊNCIA DE POSTAGEM", "STATUS SIGEM", "WORKFLOW", "CAMINHO DATABOOK", "OBSERVAÇÕES",
    ];
  }

  function reportRow(result) {
    const record = result && result.record || {};
    const output = result && result.output || {};
    const evidence = result && result.postingEvidence || {};
    return [
      reportDecision(result), reportSituation(result), result && result.document || "", result && result.ldSource || record.source || "", result && result.sheet || record.sheet || "", Number(record.row) || "",
      result && result.ldVersion || record.ldVersion || "", result && result.allocationStatus || record.allocationStatus || "",
      result && result.confirmationOutcome || "", result && result.confirmationComment || "", result && result.confirmationSource || "",
      formatDateBR(result && result.confirmationDate), result && result.previousAllocation || result && result.existingAllocation || record.allocation || "",
      result && result.allocationReason || result && result.reason || "", result && result.allocationStage || record.allocationStage || "",
      result && result.fiscalComment || record.fiscalComment || "", result && result.grdt || record.grdt || "",
      formatDateBR(result && result.effectiveDate || record.effectiveDate), result && result.postingStatus || evidence.status || "SEM EVIDÊNCIA DE POSTAGEM NA LD",
      evidence.explanation || "", result && result.sigemStatus || record.sigemStatus || "", output.workflow || "", output.databook || "", output.observation || result && result.reason || "",
    ];
  }

  async function buildAnalysisReport(results, meta, ExcelJS) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RECON 1.26.26";
    workbook.created = new Date();
    workbook.modified = new Date();
    const settings = meta || {};
    const list = results || [];
    const counts = list.reduce((acc, result) => {
      acc.total += 1;
      if (result.decision === A.READY) acc.ready += 1;
      else if (result.decision === A.SKIP) acc.skip += 1;
      else acc.review += 1;
      if (result.postingEvidence && result.postingEvidence.complete) acc.posted += 1;
      if (result.reallocationRequired && result.decision === A.READY) acc.reallocation += 1;
      return acc;
    }, { total: 0, ready: 0, skip: 0, review: 0, posted: 0, reallocation: 0 });

    const summary = workbook.addWorksheet("Resumo", { properties: { defaultRowHeight: 18 } });
    summary.views = [{ showGridLines: false, zoomScale: 95 }];
    summary.mergeCells("A1:F3");
    summary.getCell("A1").value = "RECON — ANÁLISE DE ALOCAÇÃO";
    summary.getCell("A1").font = { name: "Aptos Display", size: 22, bold: true, color: { argb: "FFFFFFFF" } };
    summary.getCell("A1").alignment = { vertical: "middle", horizontal: "right" };
    summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F63" } };
    addReportBrand(workbook, summary);
    const info = [
      ["LDs analisadas", settings.ldName || ""], ["Gerado em", settings.generatedAt || new Date().toLocaleString("pt-BR")],
      ["Total analisado", counts.total], ["Pode alocar", counts.ready], ["Já alocado", counts.skip],
      ["Revisar", counts.review], ["Nova alocação após recusa", counts.reallocation], ["Postado conforme LD", counts.posted],
    ];
    info.forEach((item, index) => {
      const row = summary.getRow(index + 5); row.values = item;
      row.getCell(1).font = { name: "Aptos", bold: true, color: { argb: "FF123F63" } };
      row.getCell(2).font = { name: "Aptos", color: { argb: "FF263A4A" } };
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F6" } };
    });
    summary.getColumn(1).width = 29; summary.getColumn(2).width = 55;
    summary.getCell("A15").value = "Critério de segurança";
    summary.getCell("A15").font = { bold: true, color: { argb: "FF123F63" } };
    summary.mergeCells("B15:F18");
    summary.getCell("B15").value = "O campo ALOCAÇÃO isoladamente não comprova aceite. A decisão prioriza a pasta de confirmações, depois o STATUS DA ALOCAÇÃO do controle e, por último, a Confirmação de DOCUMENTOS PREVISTOS da LD. Uma confirmação recusada prepara nova alocação e leva o comentário da Fiscal para a observação. Número da GRDT e Data Efetiva preenchidos na LD continuam bloqueando decisão automática até regularização.";
    summary.getCell("B15").alignment = { wrapText: true, vertical: "top" };

    const sheet = workbook.addWorksheet("Análise", { properties: { defaultRowHeight: 18 } });
    sheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2", showGridLines: false, zoomScale: 85 }];
    const headers = reportHeaders();
    const header = setRowValues(sheet, 1, headers);
    styleHeader(header, { darkColumns: headers.length });
    list.forEach((result, index) => {
      const row = setRowValues(sheet, index + 2, reportRow(result));
      styleDataRow(row, headers.length, new Set(), index);
      const decisionCell = row.getCell(1);
      const value = String(decisionCell.value || "");
      decisionCell.font = { name: "Aptos", size: 9.5, bold: true, color: { argb: value.startsWith("SIM") ? "FF0B6B50" : value.includes("JÁ") ? "FF8A3F19" : "FF9A5C0B" } };
      decisionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: value.startsWith("SIM") ? "FFE8F5EF" : value.includes("JÁ") ? "FFFFEEE8" : "FFFFF4DF" } };
    });
    [24, 34, 46, 38, 12, 11, 21, 24, 34, 58, 52, 18, 28, 78, 22, 58, 32, 23, 28, 68, 22, 35, 52, 72]
      .forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.autoFilter = { from: "A1", to: `X${Math.max(1, sheet.rowCount)}` };
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1", margins: { left: .2, right: .2, top: .45, bottom: .45, header: .2, footer: .2 } };
    sheet.headerFooter.oddFooter = "&LRECON · ANÁLISE DE ALOCAÇÃO&C&P de &N&R&D";
    return workbook.xlsx.writeBuffer();
  }

  function valueText(value) {
    if (value === null || value === undefined) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    if (typeof value === "object" && "result" in value) return valueText(value.result);
    return String(value).trim();
  }

  async function verify(buffer, expectedResults, allocationCode, ExcelJS) {
    const expected = expectedResults || [];
    const allocationBook = new ExcelJS.Workbook();
    await allocationBook.xlsx.load(buffer.allocation);
    const allocationSheet = allocationBook.getWorksheet(OFFICIAL_SHEET_NAME);
    if (!allocationSheet) throw new Error(`A planilha ${OFFICIAL_SHEET_NAME} não foi criada.`);
    if (allocationBook.worksheets.length !== 1) throw new Error("A alocação oficial deve conter somente a aba GERAL do modelo.");
    A.ALLOCATION_HEADERS.forEach((header, index) => {
      const actual = valueText(allocationSheet.getCell(1, index + 1).value);
      if (actual !== header) throw new Error(`Cabeçalho da alocação inválido na coluna ${index + 1}: esperado “${header}”, encontrado “${actual}”.`);
    });
    if (A.ALLOCATION_HEADERS.length !== OFFICIAL_COLUMN_COUNT) throw new Error("A estrutura da alocação oficial deve ter exatamente 16 colunas.");
    for (let columnNumber = OFFICIAL_COLUMN_COUNT + 1; columnNumber <= Math.max(allocationSheet.columnCount, OFFICIAL_COLUMN_COUNT + 1); columnNumber += 1) {
      for (let rowNumber = 1; rowNumber <= allocationSheet.rowCount; rowNumber += 1) {
        if (valueText(allocationSheet.getCell(rowNumber, columnNumber).value)) {
          throw new Error(`A alocação oficial não pode conter dados além da coluna ${OFFICIAL_LAST_COLUMN}.`);
        }
      }
    }
    const allocationDocuments = [];
    for (let rowNumber = 2; rowNumber <= allocationSheet.rowCount; rowNumber += 1) {
      const document = valueText(allocationSheet.getCell(rowNumber, 1).value);
      if (document) allocationDocuments.push({ rowNumber, document });
    }
    if (allocationDocuments.length !== expected.length) throw new Error("A quantidade de documentos da alocação não confere.");

    const controlBook = new ExcelJS.Workbook();
    await controlBook.xlsx.load(buffer.control);
    const controlSheet = controlBook.getWorksheet("Central de alocação");
    if (!controlSheet) throw new Error("A planilha de linhas da Central de alocação não foi criada.");
    A.CONTROL_HEADERS.forEach((header, index) => {
      const actual = valueText(controlSheet.getCell(1, index + 1).value);
      if (actual !== header) throw new Error(`Cabeçalho do controle inválido na coluna ${index + 1}: esperado “${header}”, encontrado “${actual}”.`);
    });
    if (controlSheet.rowCount !== expected.length + 1) throw new Error("A quantidade de linhas do controle não confere.");

    expected.forEach((result, index) => {
      const allocationDocument = valueText(allocationSheet.getCell(index + 2, 1).value);
      const controlDocument = valueText(controlSheet.getCell(index + 2, 10).value);
      const controlAllocation = valueText(controlSheet.getCell(index + 2, 8).value);
      if (A.key(allocationDocument) !== A.key(result.document) || A.key(controlDocument) !== A.key(result.document)) {
        throw new Error(`Documento divergente na linha ${index + 2}.`);
      }
      if (controlAllocation !== allocationCode) throw new Error(`Número da alocação divergente na linha ${index + 2}.`);
    });
    return true;
  }

  return { MIME, buildAllocation, buildControlLines, buildAnalysisReport, verify };
});
