"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const XLSX = require("../xlsx.full.min.js");

const code = "C1O_RNEST_U32_3.8.5.1_CVL_MTEC_P-B-32009A";
const other = "C1O_RNEST_U32_3.8.5.1_CVL_MTAM_P-B-32009B";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const artifacts = path.resolve("artifacts/titles");
  fs.mkdirSync(artifacts, { recursive: true });
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers:"block", viewport:{width:1440,height:950} });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.goto(process.env.RECON_URL || "http://127.0.0.1:8765/#titles", { waitUntil:"domcontentloaded" });
    await page.waitForFunction(() => window.RECONModuleLoader?.state("titles") === "ready", null, {timeout:90000});
    assert.equal(await page.locator("#module-titles").isVisible(), true);
    const revision = await page.evaluate(() => window.RECONDocumentTitleStandard?.STANDARD?.revision);
    assert.equal(revision,"R","A interface carregou padrão antigo");

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["DOCUMENTO","TÍTULO","REVISÃO","DISCIPLINA"],
      [code,"TÍTULO ANTIGO", "0", "CIVIL"],
      [other,"TÍTULO QUE DEVE PERMANECER", "0", "CIVIL"]
    ]);
    XLSX.utils.book_append_sheet(wb,sheet,"ET");
    const buffer = XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
    await page.locator("#relations-ld").setInputFiles({name:"LD-TITULOS-TESTE.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer});
    await page.waitForFunction(() => !document.querySelector("#title-analyze")?.disabled, null, {timeout:90000});
    await page.locator('input[name="title-scope-mode"][value="specific"]').check();
    await page.locator("#title-code-file").setInputFiles({name:"codigos.csv",mimeType:"text/csv",buffer:Buffer.from('DOCUMENTO;TÍTULO\\n'+code+';"RELATÓRIO, COM VÍRGULA"'.replace(/\\n/g,"\n"),"utf8")});
    await page.waitForFunction(() => (document.querySelector("#title-code-file-meta")?.textContent || "").includes("1 código"),null,{timeout:20000});
    await page.locator("#title-code-prepare").click();
    assert.match(await page.locator("#title-code-meta").innerText(),/1 localizado/);
    await page.locator("#title-analyze").click();
    await page.locator("#title-body .title-review-card").first().waitFor({state:"visible",timeout:90000});
    const cards=page.locator("#title-body .title-review-card");
    assert.equal(await cards.count(),1,"CSV deve restringir análise ao código");
    assert.match(await cards.first().innerText(),/MTEC|MONTAGEM DE ESTRUTURAS/i);
    assert.equal(await page.locator('#title-issue option[value="document_type"]').count(),1);
    assert.equal(await page.locator('#title-source-filter option[value="global_tag"]').count(),1);
    await page.locator('#title-issue').selectOption("document_type");
    assert.equal(await cards.count(),1,"O filtro 'Tipo documental' deve localizar o erro");
    await page.locator('#title-issue').selectOption("");
    await page.locator('#title-body button[data-action="approve"]').first().click();
    assert.equal(await page.locator("#title-apply-ld").isDisabled(),false);
    const downloadPromise = page.waitForEvent("download",{timeout:90000});
    await page.locator("#title-apply-ld").click();
    if(await page.locator("#p1-confirm-dialog").isVisible().catch(()=>false)){
      await page.locator("#p1-confirm-ok").click();
    } else if(await page.locator("#p1-confirm-ok").isVisible().catch(()=>false)) {
      await page.locator("#p1-confirm-ok").click();
    }
    const download=await downloadPromise;
    const output=XLSX.read(fs.readFileSync(await download.path()),{type:"buffer"});
    const revised=output.Sheets.ET;
    assert.match(String(revised.B2.v),/MONTAGEM DE ESTRUTURAS DE CONCRETO/i);
    assert.equal(revised.B3.v,"TÍTULO QUE DEVE PERMANECER");
    assert.equal(revised.C2.v,"0");
    await page.screenshot({path:path.join(artifacts,"titulos-validado.png"),fullPage:true});
    await page.locator('[data-module="relations"]').click();
    await page.locator('[data-module="titles"]').click();
    assert.equal(await page.locator("#module-titles").isVisible(),true);
    assert.deepEqual(pageErrors,[], "JavaScript sem exceções no navegador");
    console.log("TITLE_BROWSER: OK — entrada direta #titles, Rev R, CSV, filtros, aprovação, XLSX e retorno à tela");
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch(err => {console.error(err);process.exitCode=1;});
