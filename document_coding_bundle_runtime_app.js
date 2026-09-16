(function (root) {
  "use strict";
  const Base = root.RECONDocumentCoding;
  const Core = root.RECONDocumentCodingCore;
  const Parsers = root.RECONDocumentCodingParsers;
  const PDF = root.RECONDocumentCodingPDF;
  const Bundle = root.RECONDocumentCodingBundleCore;
  const Runtime = root.RECONDocumentCodingPDFRuntime;
  const CV = root.RECONDocumentCodingCV;
  if (!Base || !Core || !Parsers || !PDF || !Bundle) return;

  let installed = false;
  let generating = false;
  const D = root.document;
  const state = Base.state;
  const esc = (v) => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const txt = (v) => v == null ? "" : String(v).trim();

  function toast(message, tone) {
    const node = D.getElementById("toast"); if (!node) return;
    node.textContent = message; node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 7000);
  }
  function progress(value, message) {
    const bar = D.getElementById("coding-progress-bar");
    const label = D.getElementById("coding-progress-text");
    if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`;
    if (label) label.textContent = message || "";
  }
  function parsedOf(item) {
    if (item.sourceParsed) return item.sourceParsed;
    return item.parsed && item.parsed.type !== "bundle" ? item.parsed : null;
  }
  function representative() {
    const id = state.bundle && state.bundle.representativeId;
    return state.documents.find((item) => item.id === id) || state.documents[0] || null;
  }
  async function parseOne(item, signal) {
    if (parsedOf(item)) return parsedOf(item);
    const isPdf = item.type === "pdf" || /\.pdf$/i.test(item.file.name);
    const candidates = isPdf && Runtime ? Runtime.candidates() : [""];
    let last;
    for (let i = 0; i < candidates.length; i += 1) {
      try {
        if (isPdf && Runtime && candidates[i]) Runtime.setWorker(candidates[i]);
        const parsed = await Parsers.parseDocument(item.file, { signal, pageConcurrency: 1 });
        item.sourceParsed = parsed;
        return parsed;
      } catch (error) {
        last = error;
        if (!isPdf || !/worker|503|load script|network|fetch/i.test(txt(error && error.message))) break;
      }
    }
    throw new Error(`${item.file.name}: ${last && last.message || "falha ao analisar PDF"}`);
  }
  function part(item, index) {
    const p = parsedOf(item);
    return { itemId:item.id, file:item.file, name:item.file.name, type:item.type, parsed:p, text:p && p.text || "", pageCount:p && p.pageCount || 0, hash:p && p.hash || "", originalIndex:index };
  }
  function secondaryAnalysis(item, final, role) {
    const p = parsedOf(item);
    const data = p ? Core.extractTechnicalData({ filename:item.file.name, text:p.text }) : {};
    if (data.classification) data.classification = Object.assign({}, data.classification, { label:role && role.label || data.classification.label });
    return { data, code:final && final.code || "", ruleId:"parte-do-documento-consolidado", rule:{label:"Parte do documento consolidado"}, complete:false, confidence:final && final.confidence || Core.CONFIDENCE.REVIEW, status:Core.STATUS.REVIEW, familyKey:"", sequence:"", message:`Parte do documento consolidado. O código ${final && final.code || "final"} pertence ao conjunto.` };
  }

  async function analyzeAll() {
    if (state.analyzing || !state.documents.length) { if (!state.documents.length) toast("Adicione os PDFs do documento.", "warn"); return; }
    state.analyzing = true;
    state.abortController = new AbortController();
    const button = D.getElementById("coding-analyze"); if (button) button.disabled = true;
    let failures = 0;
    try {
      // Leitura estritamente serial: um PDF por vez.
      for (let i = 0; i < state.documents.length; i += 1) {
        const item = state.documents[i]; item.error = ""; item.status = "reading";
        progress(i / state.documents.length * .68, `Analisando ${i + 1}/${state.documents.length}: ${item.file.name}`);
        try { item.sourceParsed = await parseOne(item, state.abortController.signal); item.status = "parsed"; }
        catch (error) { failures += 1; item.status = "error"; item.error = error.message; }
        await new Promise((resolve) => root.setTimeout(resolve, 0));
      }
      if (failures) {
        state.bundle = { status:"error", errors:state.documents.filter((x)=>x.error).map((x)=>({name:x.file.name,error:x.error})) };
        Base.render(); decorate();
        progress(1, `${failures} PDF(s) com erro`);
        toast("Nenhum código foi criado parcialmente. Corrija os PDFs indicados e analise novamente.", "error");
        return;
      }

      const raw = state.documents.map(part);
      const cvHint = Bundle.likelyCv(raw);
      const ordered = Bundle.orderParts(raw, cvHint);
      const combinedText = Bundle.buildCombinedText(ordered);
      const rep = state.documents[0];
      let analysis = Core.analyzeDocument({ filename:cvHint ? "CURRICULO_CONSOLIDADO_RNEST.pdf" : `DOCUMENTO_CONSOLIDADO_${rep.file.name}`, text:combinedText, overrides:rep.overrides || {} }, state.ldIndex, { reserved:[] });
      if (CV && analysis.ruleId === "et-cv" && CV.decorateAnalysis) analysis = CV.decorateAnalysis(analysis, combinedText, { roleId:rep.overrides && rep.overrides.cvRole || "" });
      rep.parsed = { type:"bundle", text:combinedText, pageCount:Bundle.pageCount(ordered), hash:Bundle.bundleHash(ordered), parts:Bundle.sourceSummary(ordered), warnings:ordered.flatMap((x)=>x.parsed && x.parsed.warnings || []) };
      rep.analysis = analysis; rep.status = analysis.complete ? "analyzed" : "review"; rep.selected = true; rep.bundleRepresentative = true;
      const roleMap = new Map(ordered.map((x)=>[x.itemId,x.bundleRole]));
      state.documents.slice(1).forEach((item)=>{ item.parsed=item.sourceParsed; item.analysis=secondaryAnalysis(item,analysis,roleMap.get(item.id)); item.status="bundled"; item.selected=false; item.bundleRepresentative=false; });
      state.bundle = { status:"analyzed", representativeId:rep.id, parts:ordered, combinedText, isCv:Boolean(analysis.ruleId === "et-cv" || cvHint), hasCvEvaluationSource:Bundle.hasCvEvaluation(ordered), sourcePageCount:Bundle.pageCount(ordered) };
      Base.render(); decorate();
      progress(1, `${state.documents.length} arquivo(s) → 1 documento · 1 código: ${analysis.code || "confirmar"}`);
    } finally {
      state.analyzing = false; state.abortController = null; if (button) button.disabled = false;
    }
  }

  function filename(analysis) {
    if (Core.finalFilename) return Core.finalFilename(analysis.code || "DOCUMENTO", analysis.data && analysis.data.title || "CONSOLIDADO");
    return `${analysis.code || "DOCUMENTO"} - ${analysis.data && analysis.data.title || "CONSOLIDADO"}.pdf`;
  }
  async function generate(preview) {
    if (generating) return; generating = true;
    try {
      if (!state.bundle || state.bundle.status !== "analyzed") await analyzeAll();
      if (!state.bundle || state.bundle.status !== "analyzed") return;
      const rep = representative(), analysis = rep && rep.analysis;
      if (!analysis || !analysis.complete) throw new Error("O código consolidado ainda está incompleto.");
      if ([Core.CONFIDENCE.CONFLICT,Core.CONFIDENCE.IMPOSSIBLE].includes(analysis.confidence)) throw new Error("Há conflito normativo; revise antes de gerar.");
      if (analysis.confidence === Core.CONFIDENCE.REVIEW && !rep.userConfirmedReview) {
        if (!root.confirm("O código ainda requer confirmação. Deseja confirmar e gerar o PDF consolidado?")) return;
        rep.userConfirmedReview = true;
      }
      if (!state.template || !state.template.bytes) throw new Error("Configure a capa Petrobras oficial antes de gerar.");
      const coverData = Object.assign({}, analysis.data || {}, { code:analysis.code, documentNumber:analysis.code, contract:analysis.data && analysis.data.contract || (state.bundle.isCv ? "5900.0130870.25.2" : ""), title:analysis.data && analysis.data.title || (state.bundle.isCv ? "AVALIAÇÃO DE CURRÍCULO" : "DOCUMENTO CONSOLIDADO") });
      const bytes = await PDF.generateFinalBundle({ templateBytes:state.template.bytes, parts:state.bundle.parts.map((x)=>({file:x.file,type:x.type,role:x.bundleRole && x.bundleRole.id})), sourcePageCounts:state.bundle.parts.map((x)=>x.pageCount || 0), coverData, coverOptions:{allowUnmappedTemplate:Boolean(state.templateValidation && !state.templateValidation.exact)}, analysis, combinedText:state.bundle.combinedText, isCv:state.bundle.isCv, hasCvEvaluationSource:state.bundle.hasCvEvaluationSource, onProgress:({completed,total})=>progress(.1+completed/Math.max(1,total)*.85,`Unindo PDFs ${completed}/${total}`) });
      rep.generated = { bytes, filename:filename(analysis), at:new Date().toISOString(), consolidated:true };
      progress(1, `PDF consolidado pronto · ${analysis.code}`);
      if (preview) { const url=PDF.blobUrl(bytes); root.open(url,"_blank","noopener"); root.setTimeout(()=>URL.revokeObjectURL(url),60000); }
      else { PDF.download(bytes,rep.generated.filename); toast(`Documento único gerado: ${rep.generated.filename}`,"success"); }
    } finally { generating=false; }
  }

  function inject() {
    const module=D.getElementById("module-coding"); if(!module) return;
    if(!D.getElementById("coding-bundle-style")){ const s=D.createElement("style"); s.id="coding-bundle-style"; s.textContent="#coding-bundle-panel{border:1px solid var(--border,#dfe4ea);border-left:4px solid #0e61a2;border-radius:12px;padding:12px 14px;margin:12px 0;background:var(--surface,#fff)}#coding-bundle-panel.has-error{border-left-color:#b42318}.coding-bundle-head{display:flex;justify-content:space-between;gap:12px}.coding-bundle-head small,.coding-bundle-head strong,.coding-bundle-head span{display:block}.coding-bundle-head strong{font-size:15px;margin:3px 0}.coding-bundle-head span,.coding-bundle-order small{font-size:11px;color:var(--muted,#68737d)}.coding-bundle-order{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.coding-bundle-order>span{display:grid;grid-template-columns:20px 1fr;gap:2px 6px;border:1px solid var(--border,#e2e7eb);border-radius:8px;padding:6px 8px;font-size:11px}.coding-bundle-order b{grid-row:1/3;border-radius:50%;background:rgba(14,97,162,.12);width:20px;height:20px;display:grid;place-items:center}.coding-bundle-note{font-size:11px;line-height:1.45;color:var(--muted,#596572)}"; D.head.appendChild(s); }
    if(!D.getElementById("coding-bundle-panel")){ const p=D.createElement("div"); p.id="coding-bundle-panel"; const tb=module.querySelector(".coding-toolbar"); tb && tb.insertAdjacentElement("beforebegin",p); }
    const card=D.getElementById("coding-document-drop") && D.getElementById("coding-document-drop").closest(".coding-card"); if(card&&card.querySelector("p")) card.querySelector("p").innerHTML="Adicione todos os PDFs que pertencem ao mesmo documento. O RECON lê <strong>um por vez</strong>, analisa o conjunto e gera <strong>um único código e um único PDF</strong>.";
    const g=D.getElementById("coding-generate-selected"); if(g) g.textContent="Gerar PDF consolidado";
    const gv=D.getElementById("coding-generate-valid"); if(gv) gv.hidden=true;
    const zip=D.getElementById("coding-download-zip"); if(zip) zip.hidden=true;
  }
  function panel() {
    const p=D.getElementById("coding-bundle-panel"); if(!p) return;
    if(!state.bundle || state.bundle.status==="error"){ const errors=state.bundle&&state.bundle.errors||[]; p.classList.toggle("has-error",!!errors.length); p.innerHTML=errors.length?`<strong>Documento consolidado bloqueado</strong><p>${errors.map((e)=>`${esc(e.name)}: ${esc(e.error)}`).join("<br>")}</p>`:"<strong>Modo consolidado ativo</strong><p>Os arquivos serão lidos um por vez e interpretados como um único documento. A saída terá uma capa Petrobras e somente um código.</p>"; return; }
    const a=representative()&&representative().analysis, parts=state.bundle.parts||[]; p.classList.remove("has-error"); p.innerHTML=`<div class="coding-bundle-head"><div><small>DOCUMENTO CONSOLIDADO</small><strong>${esc(a&&a.code||"Código requer confirmação")}</strong><span>${parts.length} arquivo(s) · ${state.bundle.sourcePageCount||0} página(s) · 1 PDF final</span></div><span class="coding-pill coding-review">${state.bundle.isCv?"Currículo — modelo RNEST/T2":"Código único"}</span></div><div class="coding-bundle-order">${parts.map((x,i)=>`<span><b>${i+1}</b>${esc(x.file.name)}<small>${esc(x.bundleRole&&x.bundleRole.label||"Parte do documento")}</small></span>`).join("")}</div>${state.bundle.isCv?"<p class='coding-bundle-note'>Currículo segue o modelo fornecido: avaliação → Curriculum Vitae → comprovações → assinatura/log. Se faltar a avaliação, o RECON cria a estrutura com parecer PENDENTE, nunca aprovação automática.</p>":""}`;
  }
  function decorate() {
    inject(); panel(); const rep=representative();
    const count=D.getElementById("coding-document-count"); if(count&&state.documents.length) count.textContent=`${state.documents.length} arquivo(s) · 1 documento consolidado`;
    D.querySelectorAll('#module-coding [data-action="generate"],#module-coding [data-action="preview"]').forEach((b)=>b.hidden=true);
    D.querySelectorAll('#module-coding [data-action="edit"]').forEach((b)=>{const r=b.closest("[data-coding-id]"); b.hidden=!!(rep&&r&&r.dataset.codingId!==rep.id);});
    const ga=D.getElementById("coding-generate-active"); if(ga) ga.textContent="Gerar PDF consolidado";
    const pa=D.getElementById("coding-preview-active"); if(pa) pa.textContent="Visualizar PDF consolidado";
  }
  function capture(event) {
    const b=event.target&&event.target.closest&&event.target.closest("button"); if(!b||!b.closest("#module-coding")) return;
    if(["coding-generate-selected","coding-generate-valid","coding-download-zip","coding-generate-active"].includes(b.id)||b.matches('[data-action="generate"]')){event.preventDefault();event.stopImmediatePropagation();generate(false).catch((e)=>{console.error(e);toast(e.message,"error");});}
    else if(b.id==="coding-preview-active"||b.matches('[data-action="preview"]')){event.preventDefault();event.stopImmediatePropagation();generate(true).catch((e)=>{console.error(e);toast(e.message,"error");});}
  }

  const patched=Object.freeze(Object.assign({},Base,{analyzeAll,generateBundle:generate,render:function(){Base.render();decorate();}}));
  root.RECONDocumentCoding=patched;
  function install(){if(installed)return;installed=true;inject();D.addEventListener("click",capture,true);root.addEventListener("recon:ui-update",decorate);root.setTimeout(decorate,0);}
  install();
})(window);
