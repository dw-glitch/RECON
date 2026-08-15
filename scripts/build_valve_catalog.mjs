import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [inputPdf, outputFile = "valve_list_catalog.js"] = process.argv.slice(2);
if (!inputPdf) throw new Error("Informe o PDF da LI de válvulas.");

const extracted = spawnSync("pdftotext", ["-layout", inputPdf, "-"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (extracted.status !== 0) throw new Error(extracted.stderr || "Não foi possível extrair a LI de válvulas.");

const rows = [];
let page = 1;
for (const line of extracted.stdout.split(/\r?\n/)) {
  if (line.includes("\f")) page += (line.match(/\f/g) || []).length;
  const tagMatch = line.match(/\bVM-\d+[A-Z]?\b/i);
  if (!tagMatch) continue;
  const typeMatch = line.match(/Válvula\s+(?:de\s+Retenção|Três\s+Vias|[A-ZÀ-Ÿ][A-Za-zÀ-ÿ-]*)/i);
  if (!typeMatch) throw new Error(`Tipo não identificado para ${tagMatch[0]} na página ${page}.`);
  const between = line.slice(tagMatch.index + tagMatch[0].length, typeMatch.index).trim();
  const diameter = (between.match(/(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+)\s*"/) || [""])[0].replace(/\s+/g, " ");
  rows.push([
    tagMatch[0].toUpperCase(),
    typeMatch[0].replace(/\s+/g, " "),
    diameter,
    page,
    /\bCANCELADA\b/i.test(line) ? 1 : 0,
  ]);
}

const unique = new Set(rows.map((row) => row[0]));
if (rows.length !== 3066 || unique.size !== 3066) {
  throw new Error(`Extração divergente: ${rows.length} linhas e ${unique.size} TAGs únicas; eram esperadas 3.066.`);
}

const catalog = {
  meta: {
    source: path.basename(inputPdf),
    document: "LI-5290.00-22313-940-CHZ-202",
    revision: "C",
    title: "LISTA DE VÁLVULAS",
    pages: 83,
    extractedTags: rows.length,
  },
  columns: ["tag", "type", "diameter", "page", "cancelled"],
  rows,
};

const source = `(function(root){root.RECONValveListCatalog=${JSON.stringify(catalog)};})(typeof globalThis!=="undefined"?globalThis:this);\n`;
fs.writeFileSync(outputFile, source);
console.log(JSON.stringify({ outputFile, rows: rows.length, cancelled: rows.filter((row) => row[4]).length }));
