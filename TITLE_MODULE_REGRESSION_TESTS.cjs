"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const XLSX = require("./xlsx.full.min.js");
const JSZip = require("./jszip.min.js");
const Standard = require("./document_title_standard_r.js");
const Codes = require("./title_codes_csv.js");
const Writer = require("./ld_title_writer.js");

(async function main() {
  const html = fs.readFileSync("index.html", "utf8");
  const loader = fs.readFileSync("recon_module_loader.js", "utf8");
  const worker = fs.readFileSync("recon_compute_worker.js", "utf8");
  const serviceWorker = fs.readFileSync("sw.js", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  assert.equal(Standard.STANDARD.revision, "R", "O padrão ativo deve ser a Rev. R");
  for (const group6 of ["MTAM", "MTEC", "RCCM", "RIRFE"]) {
    const result = Standard.resolve(`C1O_RNEST_U32_3.8.5.1_CVL_${group6}_TESTE-001`);
    assert.equal(result.code, group6, `Grupo 6 ${group6}`);
    assert.ok(result.title, `Título da Rev. R para ${group6}`);
    assert.match(result.source, /Rev\. R/);
  }
  for (const source of [loader, worker]) {
    const standard = source.indexOf('"document_title_standard.js"');
    const revR = source.indexOf('"document_title_standard_r.js"');
    const audit = source.indexOf('"audit_core.js"');
    assert.ok(standard >= 0 && revR > standard && audit > revR, "Ordem da Rev. R antes de audit_core.js");
  }
  assert.match(serviceWorker, /"document_title_standard_r\.js"/);
  assert.match(serviceWorker, /"title_codes_csv\.js"/);
  for (const id of ["title-reference", "title-reference-meta"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const option of ["wrong_tag", "document_type", "global_tag"]) assert.ok(html.includes(`<option value="${option}">`), option);
  assert.match(html, /1\.26\.58/);
  assert.match(serviceWorker, /const VERSION = "1\.26\.58"/);
  assert.match(readme, /Versão atual: \*\*1\.26\.58\*\*/);

  const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const clean = (value) => String(value || "").trim().replace(/\.(?:pdf|xlsx?)$/i, "");
  const parse = (content) => Codes.parse(content, { clean, norm });
  const a = "C1O_RNEST_U32_3.8.5.1_TUB_RIR_VM-320003";
  const b = "C1O_RNEST_U32_6.23.4.1_EST_PPT_P-B-32009A";
  assert.deepEqual(parse(`DOCUMENTO;TÍTULO;REVISÃO\n${a};"RELATÓRIO, COM VÍRGULA";0\n${b};"TÍTULO; COM PONTO E VÍRGULA";A`), [a,b], "CSV ponto e vírgula");
  assert.deepEqual(parse(`"CÓDIGO DO DOCUMENTO","TÍTULO","REVISÃO"\n"${a}","DESCRIÇÃO COM , VÍRGULAS","0"`), [a], "CSV vírgula");
  assert.deepEqual(parse(`sep=;\nDOCUMENTO;TÍTULO\n${b};"texto com ""aspas"""`), [b], "sep=;");
  assert.deepEqual(parse(`DOCUMENTO\tTÍTULO\n${a}\tTEXTO`), [a], "TSV");
  assert.deepEqual(parse(`\uFEFFDOCUMENTO;TÍTULO\r\n${a};TESTE`), [a], "BOM");
  assert.deepEqual(parse(`${a}\n${b}`), [a,b], "lista de códigos sem cabeçalho");
  assert.throws(() => parse('TÍTULO;REVISÃO\nTEXTO;0'), /coluna DOCUMENTO/);
  assert.throws(() => parse('DOCUMENTO,TÍTULO\n"não fechado'), /aspas não fechadas/);

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["DOCUMENTO","TÍTULO","REVISÃO","FORMULA"],
    [a,"TÍTULO ANTIGO","0",null],
    [b,null,"A",null],
    ["C1O_RNEST_U32_3.8.5.1_TUB_RIR_VM-399999","MANTER INTACTO","0",null]
  ]);
  sheet["D2"] = { t: "n", f: "1+2", v: 3 };
  XLSX.utils.book_append_sheet(wb, sheet, "ET");
  const original = Uint8Array.from(XLSX.write(wb, { type:"array", bookType:"xlsx" }));
  const file = { name:"LD-TESTE.xlsx", arrayBuffer:async()=>original.buffer.slice(original.byteOffset,original.byteOffset + original.byteLength) };
  const decisions = [
    {decision:"approved",sheet:"ET",row:2,document:a,current:"TÍTULO ANTIGO",proposed:"RELATÓRIO CORRIGIDO"},
    {decision:"approved",sheet:"ET",row:3,document:b,current:"",proposed:"PREPARAÇÃO PARA TRANSPORTE"},
    {decision:"kept",sheet:"ET",row:4,document:"outro",current:"MANTER INTACTO",proposed:"ALTERAÇÃO PROIBIDA"}
  ];
  const result = await Writer.apply(file, decisions, XLSX, JSZip);
  assert.equal(result.count, 2);
  assert.match(result.fileName, /_TITULOS_REVISADOS_RECON_/);
  const reopened = XLSX.read(result.buffer, {type:"array",cellFormula:true});
  assert.equal(reopened.Sheets.ET.B2.v,"RELATÓRIO CORRIGIDO");
  assert.equal(reopened.Sheets.ET.B3.v,"PREPARAÇÃO PARA TRANSPORTE");
  assert.equal(reopened.Sheets.ET.B4.v,"MANTER INTACTO");
  assert.equal(reopened.Sheets.ET.C2.v,"0");
  assert.equal(reopened.Sheets.ET.C3.v,"A");
  assert.equal(reopened.Sheets.ET.D2.f,"1+2");
  const z0=await JSZip.loadAsync(original);
  const z1=await JSZip.loadAsync(result.buffer);
  const names=Object.keys(z0.files).filter(name=>!z0.files[name].dir);
  for(const name of names.filter(name=>name!=="xl/worksheets/sheet1.xml")){
    const oldBytes=await z0.file(name).async("uint8array");
    const newBytes=await z1.file(name).async("uint8array");
    assert.deepEqual(newBytes,oldBytes, `Parte interna alterada indevidamente: ${name}`);
  }
  console.log("TITLE_MODULE_REGRESSION_TESTS: OK — Rev R, CSV, filtros, cópia XLSX e preservação de partes");
})().catch(err=>{console.error(err);process.exitCode=1;});
