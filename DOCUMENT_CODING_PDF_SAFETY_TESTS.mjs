import assert from 'node:assert/strict';
import runtimeModule from './document_coding_pdf_runtime.js';

const { Safe, wrapPdf } = runtimeModule;
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));
const pdf = (kind='SRC', pages=1, suffix='') => enc(`%PDF-${kind}:${pages}:${suffix}`);

function makePdfLib() {
  class MockDoc {
    constructor(count=0) { this.pages = Array.from({length:count}, (_,i)=>({ id:i, getSize:()=>({width:i%2?842:595.32,height:i%2?595.32:842.04}), drawText(){}, drawRectangle(){} })); }
    getPageCount(){ return this.pages.length; }
    getPage(i){ return this.pages[i]; }
    async copyPages(source,indexes){ if (source.copyBlocked) throw new Error('copy blocked by encryption'); return indexes.map((i)=>source.pages[i]); }
    addPage(page){ this.pages.push(page || {getSize:()=>({width:595.32,height:842.04}),drawText(){},drawRectangle(){}}); return this.pages[this.pages.length-1]; }
    async save(){ return pdf('OUT', this.pages.length); }
    async embedFont(){ return { widthOfTextAtSize:(v,s)=>String(v).length*s*.5 }; }
    setTitle(){} setSubject(){} setCreator(){} setProducer(){}
  }
  const PDFDocument = {
    async load(input, options={}) {
      const s = dec(input);
      if (!s.includes('%PDF-')) throw new Error('Invalid PDF xref');
      if (s.includes('%PDF-BAD')) throw new Error('Invalid PDF xref table');
      if (s.includes('%PDF-PWD')) {
        if (!options.ignoreEncryption) { const e = new Error('Input document to PDFDocument.load is encrypted'); e.name='EncryptedPDFError'; throw e; }
        throw Object.assign(new Error('Password required'), { name:'PasswordException' });
      }
      if (s.includes('%PDF-ENC') && !options.ignoreEncryption) { const e = new Error('Input document to PDFDocument.load is encrypted'); e.name='EncryptedPDFError'; throw e; }
      const m = s.match(/:(\d+)/); const count = m ? Number(m[1]) : 1;
      const doc = new MockDoc(count);
      if (s.includes('COPYBLOCK')) doc.copyBlocked = true;
      return doc;
    },
    async create(){ return new MockDoc(0); },
  };
  return {
    PDFDocument,
    StandardFonts:{Helvetica:'Helvetica',HelveticaBold:'HelveticaBold'},
    rgb:(r,g,b)=>({r,g,b}),
  };
}

const PDFLib = makePdfLib();
function makeBase() {
  return {
    A4:{width:595.32,height:842.04},
    APPROVED_COVER_SHA256:'cover-hash',
    COVER_FIELDS:{},
    ensurePdfLib:async()=>PDFLib,
    sha256Buffer:async()=> 'cover-hash',
    coverValues:(d)=>({documentNumber:d?.code||'',title:d?.title||'',revision:'0'}),
    capabilities:()=>({preservesPdfPages:true}),
    createCvEvaluationPdf:async()=>pdf('EVAL',2,'cv'),
    generateFinalBundle:async()=>{ throw new Error('unsafe bundle should have been replaced'); },
  };
}
const Wrapped = wrapPdf(makeBase());
const file = (name, bytes, type='application/pdf') => ({ name, type, size:bytes.length, async arrayBuffer(){ return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength); } });
const common = { templateBytes:pdf('COVER',1), coverData:{code:'TEST-001',title:'Teste'}, analysis:{code:'TEST-001',data:{title:'Teste'}}, isCv:false, hasCvEvaluationSource:false };

let checks = 0;
async function test(name, fn){ await fn(); checks++; console.log(`OK ${String(checks).padStart(2,'0')} — ${name}`); }

await test('PDF comum', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('SRC',1),{fileName:'normal.pdf'}); assert.equal(r.metadata.encryptedFallback,false); });
await test('PDF marcado como encrypted', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('ENC',2),{fileName:'encrypted.pdf'}); assert.equal(r.metadata.encryptedFallback,true); assert.equal(r.metadata.pageCount,2); });
await test('PDF protegido processável com ignoreEncryption', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('ENC',3),{fileName:'restrito.pdf'}); assert.equal(r.metadata.pageCount,3); });
await test('PDF que realmente exige senha', async()=>{ await assert.rejects(()=>Safe.loadPdfSafely(PDFLib,pdf('PWD',1),{fileName:'senha.pdf'}),e=>e.code===Safe.ERROR.PASSWORD); });
await test('PDF corrompido', async()=>{ await assert.rejects(()=>Safe.loadPdfSafely(PDFLib,pdf('BAD',1),{fileName:'corrompido.pdf'}),e=>e.code===Safe.ERROR.CORRUPT); });
await test('arquivo falso com extensão PDF', async()=>{ assert.throws(()=>Safe.validatePdfBytes(enc('isto nao e pdf'),{fileName:'falso.pdf'}),e=>e.code===Safe.ERROR.NOT_PDF); });
await test('PDF de 1 página', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('SRC',1),{}); assert.equal(r.metadata.pageCount,1); });
await test('PDF de muitas páginas', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('SRC',350),{}); assert.equal(r.metadata.pageCount,350); });
await test('PDF paisagem preserva objeto de página', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('SRC',2),{}); assert.deepEqual(r.document.getPage(1).getSize(),{width:842,height:595.32}); });
await test('PDF misto A3/A4 não é rasterizado', async()=>{ const r=await Safe.loadPdfSafely(PDFLib,pdf('SRC',2),{}); assert.equal(typeof r.document.getPage(0).drawText,'function'); assert.equal(r.metadata.pageCount,2); });
await test('vários PDFs juntos', async()=>{ const out=await Wrapped.generateFinalBundle({...common,parts:[{file:file('a.pdf',pdf('SRC',1,'a')),type:'pdf'},{file:file('b.pdf',pdf('SRC',2,'b')),type:'pdf'}]}); assert.match(dec(out),/%PDF-OUT:4/); });
await test('PDF + DOCX', async()=>{ globalThis.RECONDocumentCodingDocxPdfAdapter={convert:async()=>pdf('DOCX',1,'docx')}; const out=await Wrapped.generateFinalBundle({...common,parts:[{file:file('a.pdf',pdf('SRC',1,'pdf')),type:'pdf'},{file:file('b.docx',enc('PK docx'),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),type:'docx'}]}); assert.match(dec(out),/%PDF-OUT:3/); });
await test('PDF + capa', async()=>{ const out=await Wrapped.generateFinalBundle({...common,parts:[{file:file('a.pdf',pdf('SRC',1,'covercase')),type:'pdf'}]}); assert.match(dec(out),/%PDF-OUT:2/); });
await test('capa + PDF + anexos', async()=>{ const out=await Wrapped.generateFinalBundle({...common,parts:[1,2,3].map(i=>({file:file(`p${i}.pdf`,pdf('SRC',1,`x${i}`)),type:'pdf'}))}); assert.match(dec(out),/%PDF-OUT:4/); });
await test('arquivo com acento no nome', async()=>{ await assert.rejects(()=>Safe.loadPdfSafely(PDFLib,pdf('PWD',1),{fileName:'currículo joão.pdf'}),e=>e.message.includes('currículo joão.pdf')); });
await test('arquivo com nome longo', async()=>{ const name='Documento muito longo '.repeat(20)+'.pdf'; await assert.rejects(()=>Safe.loadPdfSafely(PDFLib,enc('x'),{fileName:name}),e=>e.message.includes(name)); });
await test('arquivo repetido', async()=>{ const same=pdf('SRC',1,'igual'); await assert.rejects(()=>Wrapped.generateFinalBundle({...common,parts:[{file:file('a.pdf',same),type:'pdf'},{file:file('copia.pdf',same),type:'pdf'}]}),e=>e.code===Safe.ERROR.DUPLICATE); });
await test('geração consecutiva de vários documentos', async()=>{ const a=await Wrapped.generateFinalBundle({...common,parts:[{file:file('1.pdf',pdf('SRC',1,'g1')),type:'pdf'}]}); const b=await Wrapped.generateFinalBundle({...common,parts:[{file:file('2.pdf',pdf('SRC',2,'g2')),type:'pdf'}]}); assert.notEqual(dec(a),dec(b)); });
await test('falha no meio do processamento identifica arquivo', async()=>{ await assert.rejects(()=>Wrapped.generateFinalBundle({...common,parts:[{file:file('ok.pdf',pdf('SRC',1,'ok')),type:'pdf'},{file:file('bloqueado.pdf',pdf('PWD',1,'pwd')),type:'pdf'},{file:file('depois.pdf',pdf('SRC',1,'after')),type:'pdf'}]}),e=>e.message.includes('bloqueado.pdf')); });
await test('nova tentativa após falha', async()=>{ try{await Wrapped.generateFinalBundle({...common,parts:[{file:file('falha.pdf',pdf('PWD',1)),type:'pdf'}]});}catch{} const out=await Wrapped.generateFinalBundle({...common,parts:[{file:file('corrigido.pdf',pdf('SRC',1,'retry')),type:'pdf'}]}); assert.match(dec(out),/%PDF-OUT:2/); });

assert.equal(checks,20);
console.log(`DOCUMENT_CODING_PDF_SAFETY_TESTS.mjs: ${checks}/20 testes concluídos.`);
