import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const XLSX = require(path.join(root, "xlsx.full.min.js"));

const [inputPath, outputFile = path.join(root, "valve_reparo_catalog.js")] = process.argv.slice(2);
if (!inputPath || !fs.existsSync(inputPath)) {
  throw new Error("Informe o caminho do Mapa de VMs Reparo/Medição (.xlsb ou .xlsx).");
}

const SHEET_NAME = "MAPA - VM";
const EXPECTED_TAGS = 736;

function text(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

const workbook = XLSX.read(fs.readFileSync(inputPath), { type: "buffer", cellText: false, cellDates: true });
const sheet = workbook.Sheets[SHEET_NAME];
if (!sheet) throw new Error(`A aba "${SHEET_NAME}" não foi encontrada em ${path.basename(inputPath)}.`);

const rowsRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
const headerIndex = rowsRaw.findIndex((row) => row.some((cell) => text(cell) === "TAG"));
if (headerIndex < 0) throw new Error('Cabeçalho "TAG" não encontrado na aba MAPA - VM.');
const headerRow = rowsRaw[headerIndex].map(text);
const columnIndex = (name) => headerRow.indexOf(name);
const REQUIRED = ["TAG", "TIPO", "Ø", "RECEBIMENTO_RIR", "DISCIPLINA"];
const missing = REQUIRED.filter((name) => columnIndex(name) < 0);
if (missing.length) throw new Error(`Colunas ausentes na aba MAPA - VM: ${missing.join(", ")}.`);

const rows = [];
for (let index = headerIndex + 1; index < rowsRaw.length; index += 1) {
  const row = rowsRaw[index];
  const tag = text(row[columnIndex("TAG")]);
  if (!tag) continue;
  const rawType = text(row[columnIndex("TIPO")]);
  const type = rawType === "0" ? "" : rawType;
  const diameter = text(row[columnIndex("Ø")]);
  const document = text(row[columnIndex("RECEBIMENTO_RIR")]);
  const discipline = text(row[columnIndex("DISCIPLINA")]);
  rows.push([tag, type, diameter, document, discipline]);
}

const unique = new Set(rows.map((row) => row[0]));
if (unique.size !== EXPECTED_TAGS || rows.length !== EXPECTED_TAGS) {
  throw new Error(`Extração divergente: ${rows.length} linhas e ${unique.size} TAGs únicas; eram esperadas ${EXPECTED_TAGS}.`);
}

const catalog = {
  meta: {
    source: path.basename(inputPath),
    sheet: SHEET_NAME,
    rows: rows.length,
  },
  columns: ["tag", "type", "diameter", "document", "discipline"],
  rows,
};

const source = `(function(root){root.RECONValveReparoCatalog=${JSON.stringify(catalog)};})(typeof globalThis !== "undefined" ? globalThis : this);\n`;
fs.writeFileSync(outputFile, source);
console.log(JSON.stringify({ outputFile, rows: rows.length, uniqueTags: unique.size }));
