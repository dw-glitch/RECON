const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const XLSX=require('../xlsx.full.min.js');
const out=path.resolve('artifacts/discipline-matrix');fs.mkdirSync(out,{recursive:true});
function workbook(rows){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'Documentos');return Buffer.from(XLSX.write(w,{type:'buffer',bookType:'xlsx'}));}
async function main(){
 const browser=await chromium.launch({headless:true});
 const reports=[];
 try{
  const apps=(process.env.MATRIX_APPS||'RECON').split(',');
  for(const app of apps){
   const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const base=(process.env.MATRIX_BASE_URL||'http://127.0.0.1:8765')+(apps.length>1 ? '/'+app+'/' : '/');
   await page.goto(base,{waitUntil:'domcontentloaded'});
   if(app==='GRCON'){
    await page.addStyleTag({content:'html.grcon-cloud-pending body > :not(.grcon-cloud-auth):not(script){visibility:visible!important}#grcon-cloud-auth{display:none!important}'});
    await page.locator('.ops-nav-button[data-grcon-view="additional-tools"]').click();
    await page.locator('[data-grcon-view="discipline-matrix"]').click();
   }else await page.locator('[data-module="matrix"]').click();
   await page.locator('#matrix-discipline').waitFor();
   await page.locator('#matrix-discipline').selectOption('tubulacao');
   await page.locator('#matrix-phase').selectOption('executivo');
   await page.locator('#matrix-file-0').setInputFiles({name:'LD-matriz.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook([['DOCUMENTO','TITULO','DISCIPLINA','EAP'],['DE-5290.00-22313-940-CHZ-001','DESENHO ISOMETRICO','TUBULACAO','1.1']])});
   await page.waitForFunction(()=>!window.DisciplineDocumentMatrixUi.state.busy);
   await page.locator('#matrix-file-3').setInputFiles({name:'Documentos-Previstos.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook([['DOCUMENTO'],['DE-5290.00-22313-940-CHZ-001']])});
   await page.waitForFunction(()=>!window.DisciplineDocumentMatrixUi.state.busy);
   await page.locator('#matrix-analyze').click();
   assert.match(await page.locator('#matrix-summary').innerText(),/1 identificadas/);
   assert.match(await page.locator('#matrix-body').innerText(),/consta em Documentos Previstos/);
   const snapshot=await page.evaluate(()=>window.DisciplineDocumentMatrixUi.state.snapshot);
   assert.equal(snapshot.summary.blocks,0);assert.equal(snapshot.sources.length,2);
   const downloadPromise=page.waitForEvent('download');await page.locator('#matrix-json').click();const download=await downloadPromise;
   const bytes=fs.readFileSync(await download.path(),'utf8');assert.equal(JSON.parse(bytes).matrixVersion,'discipline-matrix-1');reports.push(bytes);
   // A troca de disciplina não mantém um relatório ou exportação desatualizado.
   await page.locator('#matrix-discipline').selectOption('instrumentacao');
   assert.equal(await page.locator('#matrix-json').isDisabled(),true);
   await page.locator('#matrix-analyze').click();assert.equal(await page.locator('#matrix-body tr').count(),47);
   // Entrada incompleta permanece candidata, sem presumir a classe como disciplina.
   await page.locator('#matrix-discipline').selectOption('tubulacao');
   await page.locator('#matrix-scope').fill('1.2');await page.locator('#matrix-analyze').click();
   assert.match(await page.locator('#matrix-summary').innerText(),/0 identificadas/);
   await page.locator('#matrix-import').setInputFiles({name:'matriz-outro-app.json',mimeType:'application/json',buffer:Buffer.from(reports[0])});
   await page.waitForFunction(()=>window.DisciplineDocumentMatrixUi.state.imported);
   assert.match(await page.locator('#matrix-status').innerText(),/Relatório importado/);
   await page.screenshot({path:path.join(out,app+'-desktop.png'),fullPage:true});
   await page.setViewportSize({width:1024,height:768});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2),false,'Sem estouro horizontal da página');
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(out,app+'-1024-dark.png'),fullPage:true});
   if(app==='GRCON')await page.locator('.ops-nav-button[data-grcon-view="control"]').click();else await page.locator('[data-module="relations"]').click();
   assert.equal(await page.locator('#discipline-matrix-root').isVisible(),false,'Navegação de retorno funciona');
   assert.deepEqual(errors,[]);await context.close();console.log(app+': matriz, fonte XLSX, alocação consultiva, exportação/importação, recorte e navegação OK');
  }
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1);});
