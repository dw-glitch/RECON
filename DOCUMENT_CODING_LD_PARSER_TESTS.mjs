import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function columnName(n) {
  let x = n + 1;
  let out = "";
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}
function columnIndex(name) {
  let out = 0;
  for (const ch of String(name || "").toUpperCase()) out = out * 26 + ch.charCodeAt(0) - 64;
  return out - 1;
}
function encodeCell({ r, c }) { return `${columnName(c)}${r + 1}`; }
function decodeCell(address) {
  const m = String(address).match(/^([A-Z]+)(\d+)$/i);
  if (!m) throw new Error(`invalid cell ${address}`);
  return { c: columnIndex(m[1]), r: Number(m[2]) - 1 };
}
function decodeRange(value) {
  const [a, b = a] = String(value).split(":");
  return { s: decodeCell(a), e: decodeCell(b) };
}
function encodeRange(range) { return `${encodeCell(range.s)}:${encodeCell(range.e)}`; }

globalThis.XLSX = { utils: { encode_cell: encodeCell, decode_cell: decodeCell, decode_range: decodeRange, encode_range: encodeRange } };
const Parsers = require("./document_coding_parsers.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error.stack || error); }
}

test("abas auxiliares pesadas de LD não entram na análise documental", () => {
  const selected = Parsers.selectLdSheetNames(["CAPA ", "N-1710", "CV", "RNC", "Colar SIGEM", "T", "G", "INDICADOR N-1710"]);
  assert.deepEqual(selected, ["N-1710", "CV", "RNC"]);
});

test("range contaminado A:XEP não expande a leitura além das células reais", () => {
  const sheet = { "!ref": "A1:XEP3685" };
  const headers = ["ITEM", "DOCUMENTO", "REVISÃO", "TÍTULO", "UNIDADE/ÁREA", "DISCIPLINA", "PRAZO"];
  headers.forEach((value, index) => { sheet[encodeCell({ r: 5, c: index })] = { v: value, w: value }; });
  sheet.A7 = { v: 1 };
  sheet.B7 = { v: "5900.0130870.25.2-C1O-CV-GER-0001" };
  sheet.C7 = { v: "0" };
  sheet.D7 = { v: "Curriculo - Gerência - Gerente do Contrato" };
  sheet.F7 = { v: "GER" };
  sheet.A3685 = { v: "último registro" };
  // Formatação/célula residual distante que fazia sheet_to_json varrer milhares
  // de colunas em cada linha no código antigo.
  sheet.XEP1 = { v: "resíduo fora da tabela" };

  const header = Parsers.findLdHeader(sheet);
  assert.ok(header);
  assert.equal(header.row, 5);
  const logical = Parsers.logicalLdRange(sheet, header.row);
  assert.equal(logical.s.r, 5);
  assert.ok(logical.e.c < 20, `largura lógica inesperada: ${logical.e.c + 1} colunas`);
  assert.equal(logical.e.r, 3684);
});

test("limites defensivos permanecem adequados às LDs reais sem aceitar XFD/XEP", () => {
  assert.equal(Parsers.LD_MAX_COLUMNS, 400);
  assert.ok(Parsers.LD_MAX_ROWS >= 30000);
  assert.ok(Parsers.LD_HEADER_SCAN_ROWS >= 60);
});

console.log(`\nParser LD: ${passed} teste(s) aprovados, ${failed} falha(s).`);
if (failed) process.exit(1);
