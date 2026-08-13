import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const XLSX = require(path.join(root, "xlsx.full.min.js"));

const inputPath = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(inputPath)) {
  throw new Error("Informe o caminho da planilha SCON de Componentes e Programação.");
}

const VERSION = "2026-08-13";
const SOURCE_FILE = path.basename(inputPath);
const SOURCE_SHEET = "WRHDT_VW_EXTRATO_COMPONENTES + WRHDT_BI_VW_EXTRATO_PROGRAMACAO";
const COLUMNS = ["document", "titleComplement", "fullDescription", "sconTag", "discipline", "itemType", "drawingReference", "row"];
const FILES = Object.freeze({
  ANDAIME: "scon_andaime.js",
  APOIO: "scon_apoio.js",
  CIVIL: "scon_civil.js",
  ELETRICA: "scon_eletrica.js",
  EQP_DINAMICO: "scon_eqp_dinamico.js",
  EQP_ESTATICO: "scon_eqp_estatico.js",
  EST_METALICA: "scon_est_metalica.js",
  HVAC: "scon_hvac.js",
  INSTRUMENTACAO: "scon_instrumentacao.js",
  SEGURANCA: "scon_seguranca.js",
  TUBULACAO: "scon_tubulacao.js",
  CANTEIRO: "scon_canteiro.js",
  LOA: "scon_loa.js",
  RECURSOS_ETF: "scon_recursos_etf.js",
});

function text(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function headerKey(value) {
  return normalized(value).replace(/[^A-Z0-9]+/g, "");
}

function disciplineKey(value) {
  return normalized(value).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cleanTitleComplement(description) {
  const parts = text(description).split(/\s*\|\s*/).map(text).filter(Boolean);
  return parts[2] || parts.at(-1) || "";
}

function cellValue(row, index) {
  const cell = index >= 0 && row && row[index];
  return text(cell && cell.v);
}

function json(value) {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const workbook = XLSX.read(fs.readFileSync(inputPath), {
  type: "buffer",
  dense: true,
  cellFormula: false,
  cellStyles: false,
});

const unique = new Map();
const sheetCounts = {};
for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const rows = sheet["!data"] || sheet;
  const headers = (rows[0] || []).map((cell) => headerKey(cell && cell.v));
  const find = (...names) => names.map(headerKey).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const tagIndex = find("TAG");
  const descriptionIndex = find("TAG_DESC", "TAG_DESCRICAO");
  const disciplineIndex = find("DISCIPLINA");
  const typeIndex = find("TIPO");
  if ([tagIndex, descriptionIndex, disciplineIndex, typeIndex].some((index) => index < 0)) {
    throw new Error(`A aba ${sheetName} não contém TAG, descrição, disciplina e tipo.`);
  }

  let usable = 0;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const tag = cellValue(row, tagIndex);
    const fullDescription = cellValue(row, descriptionIndex);
    const discipline = cellValue(row, disciplineIndex);
    const itemType = cellValue(row, typeIndex);
    const titleComplement = cleanTitleComplement(fullDescription);
    if (!tag || !fullDescription || !titleComplement || !discipline) continue;
    usable += 1;
    const dedupeKey = [tag, fullDescription, discipline, itemType].map(normalized).join("|");
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, {
        disciplineKey: disciplineKey(discipline),
        row: [tag, titleComplement, fullDescription, tag, discipline, itemType, "", rowIndex + 1],
      });
    }
  }
  sheetCounts[sheetName] = usable;
}

const grouped = new Map();
for (const entry of unique.values()) {
  if (!FILES[entry.disciplineKey]) throw new Error(`Disciplina sem arquivo de catálogo: ${entry.disciplineKey}`);
  if (!grouped.has(entry.disciplineKey)) grouped.set(entry.disciplineKey, []);
  grouped.get(entry.disciplineKey).push(entry.row);
}

const counts = {};
for (const [discipline, fileName] of Object.entries(FILES)) {
  const rows = (grouped.get(discipline) || []).sort((left, right) => normalized(left[3]).localeCompare(normalized(right[3]), "pt-BR"));
  const catalog = {
    version: VERSION,
    sourceFile: SOURCE_FILE,
    sheet: SOURCE_SHEET,
    columns: COLUMNS,
    discipline,
    rows,
  };
  const source = `(function(root){root.RECON_SCON_CHUNKS=root.RECON_SCON_CHUNKS||{};root.RECON_SCON_CHUNKS[${json(discipline)}]=${json(catalog)};})(typeof globalThis!=="undefined"?globalThis:this);\n`;
  fs.writeFileSync(path.join(root, fileName), source, "utf8");
  counts[discipline] = rows.length;
}

console.log(JSON.stringify({ version: VERSION, sourceFile: SOURCE_FILE, sheets: sheetCounts, total: unique.size, counts }, null, 2));
