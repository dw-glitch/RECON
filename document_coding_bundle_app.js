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
  let generationRunning = false;

  function doc() { return root.document; }
  function text(value) { return value == null ? "" : String(value).trim(); }
  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function toast(message, tone) {
    const node = doc().getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 7000);
  }
  function progress(value, message) {
    const bar = doc().getElementById("coding-progress-bar");
    const label = doc().getElementById("coding-progress-text");
    const n = Math.max(0, Math.min(1, Number(value || 0)));
    if (bar) bar.style.width = `${Math.round(n * 100)}%`;
    if (label) label.textContent = message || `${Math.round(n * 100)}%`;
  }
  function activeRepresentative(state) {
    if (!state || !state.documents || !state.documents.length) return null;
    const id = state.bundle && state.bundle.representativeId;
    return state.documents.find((item) => item.id === id) || state.documents[0] || null;
  }

  function sourceParsed(item) {
    if (!item) return null;
    if (item.sourceParsed) return item.sourceParsed;
    if (item.parsed && item.parsed.type !== "bundle") return item.parsed;
    return null;
  }

  async function parseWithWorkerFallback(item, signal) {
    if (sourceParsed(item)) return sourceParsed(item);
    const isPdf = /\.pdf$/i.test(item.file && item.file.name || "") || item.type === "pdf";
    const candidates = isPdf && Runtime && typeof Runtime.candidates === "function" ? Runtime.candidates() : [""];
    const errors = [];
    for (let i = 0; i < candidates.length; i += 1) {
      if (signal && signal.aborted) throw new DOMException("Operação cancelada", "AbortError");
      try {
        if (isPdf && Runtime && candidates[i]) Runtime.setWorker(candidates[i]);
        const parsed = await Parsers.parseDocument(item.file, { signal, pageConcurrency: 1 });
        item.sourceParsed = parsed;
        return parsed;
      } catch (error) {
        errors.push(error);
        const message = text(error && error.message);
        const workerLike = /worker|503|load script|loading chunk|network|fetch/i.test(message);
        if (!isPdf || !workerLike || i === candidates.length - 1) break;
      }
    }
    const last = errors[errors.length - 1];
    const detail = last && last.message ? last.message : "falha desconhecida";
    throw new Error(`${item.file && item.file.name || "PDF"}: não foi possível ler o PDF. O RECON tentou os workers PDF.js compatíveis em sequência. Detalhe: ${detail}`);
  }

  function buildPart(item, index) {
    const parsed = sourceParsed(item);
    return {
      itemId: item.id,
      file: item.file,
      name: item.file && item.file.name,
      type: item.type,
      parsed,
      text: parsed && parsed.text || "",
      pageCount: parsed && parsed.pageCount || 0,
      hash: parsed && parsed.hash || "",
      originalIndex: index,
    };
  }

  function partAnalysis(item, finalAnalysis, role) {
    const parsed = sourceParsed(item);
    const data = parsed ? Core.extractTechnicalData({ filename: item.file.name, text: parsed.text }) : {};
    if (data.classification) data.classification = Object.assign({}, data.classification, { label: role && role.label || data.classification.label });
    return {
      data,
      code: finalAnalysis && finalAnalysis.code || "",
      ruleId: "parte-do-documento-consolidado",
      rule: { label: "Parte do documento consolidado" },
      complete: false,
      confidence: finalAnalysis && finalAnalysis.confidence || Core.CONFIDENCE.REVIEW,
      status: Core.STATUS.REVIEW,
      familyKey: "",
      sequence: "",
      message: `Arquivo analisado individualmente e incorporado ao documento consolidado. O código ${finalAnalysis && finalAnalysis.code || "final"} pertence ao conjunto, não a este arquivo isoladamente.`,
    };
  }

  async function analyzeBundle() {
    const state = Base.state;
    if (!state || state.analyzing) return;
    if (!state.documents.length) { toast("Adicione pelo menos um PDF ou DOCX.", "warn"); return; }
    state.analyzing = true;
    state.abortController = new AbortController();
    const analyzeButton = doc().getElementById("coding-analyze");
    if (analyzeButton) analyzeButton.disabled = true;
    let failed = 0;
    try {
      // Requisitos do usuário: um arquivo por vez. Nunca expandimos vários PDFs
      // simultaneamente no renderer, reduzindo o pico de memória e isolando erros.
      for (let i = 0; i < state.documents.length; i += 1) {
        const item = state.documents[i];
        item.status = "reading";
        item.error = "";
        progress((i / state.documents.length) * 0.68, `Analisando PDF ${i + 1}/${state.documents.length}: ${item.file.name}`);
        try {
          const parsed = await parseWithWorkerFallback(item, state.abortController.signal);
          item.sourceParsed = parsed;
          item.status = "parsed";
        } catch (error) {
          failed += 1;
          item.status = "error";
          item.error = error.message;
        }
        await new Promise((resolve) => root.setTimeout(resolve, 0));
      }

      if (failed) {
        state.bundle = { status: "error", errors: state.documents.filter((item) => item.error).map((item) => ({ name: item.file.name, error: item.error })) };
        Base.render();
        decorateUi();
        progress(1, `${failed} arquivo(s) com erro — documento consolidado não gerado`);
        toast(`A análise terminou com ${failed} erro(s). Nenhum código foi criado parcialmente: corrija os PDFs indicados e tente novamente.`, "error");
        return;
      }

      const rawParts = state.documents.map(buildPart);
      const cvMode = Bundle.likelyCv(rawParts);
      const ordered = Bundle.orderParts(rawParts, cvMode);
      const combinedText = Bundle.buildCombinedText(ordered);
      const representative = state.documents[0];
      const syntheticFilename = cvMode ? "CURRICULO_CONSOLIDADO_RNEST.pdf" : `DOCUMENTO_CONSOLIDADO_${representative.file.name}`;
      progress(0.74, "Consolidando conteúdo e aplicando normas/LDs…");

      let analysis = Core.analyzeDocument({
        filename: syntheticFilename,
        text: combinedText,
        overrides: representative.overrides || {},
      }, state.ldIndex, { reserved: [] });
      if (CV && analysis && analysis.ruleId === "et-cv" && typeof CV.decorateAnalysis === "function") {
        analysis = CV.decorateAnalysis(analysis, combinedText, { roleId: representative.overrides && representative.overrides.cvRole || "" });
      }

      const bundleParsed = {
        type: "bundle",
        text: combinedText,
        pageCount: Bundle.pageCount(ordered),
        hash: Bundle.bundleHash(ordered),
        parts: Bundle.sourceSummary(ordered),
        warnings: ordered.flatMap((part) => part.parsed && part.parsed.warnings || []),
      };
      representative.parsed = bundleParsed;
      representative.analysis = analysis;
      representative.status = analysis && analysis.complete ? "analyzed" : "review";
      representative.selected = true;
      representative.bundleRepresentative = true;

      const roleById = new Map(ordered.map((part) => [part.itemId, part.bundleRole]));
      state.documents.slice(1).forEach((item) => {
        item.parsed = item.sourceParsed;
        item.analysis = partAnalysis(item, analysis, roleById.get(item.id));
        item.status = "bundled";
        item.selected = false;
        item.bundleRepresentative = false;
      });

      state.bundle = {
        status: "analyzed",
        representativeId: representative.id,
        parts: ordered,
        combinedText,
        isCv: Boolean(analysis && analysis.ruleId === "et-cv" || cvMode),
        hasCvEvaluationSource: Bundle.hasCvEvaluation(ordered),
        sourcePageCount: Bundle.pageCount(ordered),
      };
      progress(0.9, `Código único proposto: ${analysis && analysis.code || "requer confirmação"}`);
      Base.render();
      decorateUi();
      progress(1, `${state.documents.length} arquivo(s) → 1 documento · 1 código`);
    } finally {
      state.analyzing = false;
      state.abortController = null;
      if (analyzeButton) analyzeButton.disabled = false;
    }
  }

  function bundleFilename(analysis) {
    if (!analysis) return "DOCUMENTO_CONSOLIDADO.pdf";
    if (Core.finalFilename) return Core.finalFilename(analysis.code || "DOCUMENTO", analysis.data && analysis.data.title || "CONSOLIDADO");
    return `${text(analysis.code) || "DOCUMENTO"} - ${text(analysis.data && analysis.data.title) || "CONSOLIDADO"}.pdf`;
  }

  async function generateBundle(previewOnly) {
    if (generationRunning) return;
    generationRunning = true;
    try {
      const state = Base.state;
      if (!state.bundle || state.bundle.status !== "analyzed") await analyzeBundle();
      if (!state.bundle || state.bundle.status !== "analyzed") return;
      const representative = activeRepresentative(state);
      const analysis = representative && representative.analysis;
      if (!analysis || !analysis.complete) throw new Error("O documento consolidado ainda não possui codificação completa.");
      if ([Core.CONFIDENCE.CONFLICT, Core.CONFIDENCE.IMPOSSIBLE].includes(analysis.confidence)) throw new Error("A codificação possui conflito ou dado normativo ausente; revise antes de gerar.");
      if (analysis.confidence === Core.CONFIDENCE.REVIEW && !representative.userConfirmedReview) {
        const ok = root.confirm("O código consolidado ainda está como “Requer confirmação”. Deseja confirmar conscientemente e gerar um único PDF com este código?");
        if (!ok) return;
        representative.userConfirmedReview = true;
      }
      if (!state.template || !state.template.bytes) throw new Error("Configure primeiro a capa Petrobras oficial.");

      progress(0.05, "Preparando capa com o código consolidado…");
      const parts = state.bundle.parts.map((part) => ({ file: part.file, type: part.type, role: part.bundleRole && part.bundleRole.id }));
      const sourcePageCounts = state.bundle.parts.map((part) => part.pageCount || 0);
      const coverData = Object.assign({}, analysis.data || {}, {
        code: analysis.code,
        documentNumber: analysis.code,
        contract: analysis.data && analysis.data.contract || (state.bundle.isCv ? "5900.0130870.25.2" : ""),
        title: analysis.data && analysis.data.title || (state.bundle.isCv ? "AVALIAÇÃO DE CURRÍCULO" : "DOCUMENTO CONSOLIDADO"),
      });
      const bytes = await PDF.generateFinalBundle({
        templateBytes: state.template.bytes,
        parts,
        sourcePageCounts,
        coverData,
        coverOptions: { allowUnmappedTemplate: Boolean(state.templateValidation && !state.templateValidation.exact) },
        analysis,
        combinedText: state.bundle.combinedText,
        isCv: state.bundle.isCv,
        hasCvEvaluationSource: state.bundle.hasCvEvaluationSource,
        onProgress: ({ completed, total }) => progress(0.15 + (completed / Math.max(1, total)) * 0.8, `Unindo PDFs: ${completed}/${total}`),
      });
      representative.generated = { bytes, filename: bundleFilename(analysis), at: new Date().toISOString(), consolidated: true };
      progress(1, `PDF consolidado pronto · ${analysis.code}`);
      if (previewOnly) {
        const url = PDF.blobUrl(bytes);
        root.open(url, "_blank", "noopener");
        root.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        PDF.download(bytes, representative.generated.filename);
        toast(`Documento único gerado: ${representative.generated.filename}`, "success");
      }
    } finally { generationRunning = false; }
  }

  function renderBundlePanel() {
    const state = Base.state;
    const panel = doc().getElementById("coding-bundle-panel");
    if (!panel) return;
    if (!state.bundle || state.bundle.status === "error") {
      const errors = state.bundle && state.bundle.errors || [];
      panel.innerHTML = errors.length
        ? `<strong>Documento consolidado bloqueado</strong><p>${errors.map((entry) => `${escape(entry.name)}: ${escape(entry.error)}`).join("<br>")}</p>`
        : `<strong>Modo consolidado ativo</strong><p>Todos os arquivos adicionados serão analisados <b>um por vez</b>, interpretados em conjunto e receberão <b>um único código</b>. A saída será um único PDF com a capa Petrobras na frente.</p>`;
      panel.classList.toggle("has-error", Boolean(errors.length));
      return;
    }
    const representative = activeRepresentative(state);
    const analysis = representative && representative.analysis;
    const parts = state.bundle.parts || [];
    panel.classList.remove("has-error");
    panel.innerHTML = `
      <div class="coding-bundle-head"><div><small>DOCUMENTO CONSOLIDADO</small><strong>${escape(analysis && analysis.code || "Código requer confirmação")}</strong><span>${parts.length} arquivo(s) · ${state.bundle.sourcePageCount || 0} página(s) de origem · 1 PDF final</span></div><span class="coding-pill ${analysis && analysis.confidence === Core.CONFIDENCE.CONFIRMED ? "coding-ok" : "coding-review"}">${escape(state.bundle.isCv ? "Currículo — modelo RNEST/T2" : "Código único")}</span></div>
      <div class="coding-bundle-order">${parts.map((part, index) => `<span><b>${index + 1}</b>${escape(part.file.name)}<small>${escape(part.bundleRole && part.bundleRole.label || "Parte do documento")}</small></span>`).join("")}</div>
      ${state.bundle.isCv ? `<p class="coding-bundle-note">Para currículo, a composição segue o modelo fornecido: avaliação de currículo → Curriculum Vitae → comprovações/anexos → logs/assinaturas. Se a avaliação não estiver entre os PDFs enviados, o RECON cria as páginas estruturais de avaliação com parecer <b>pendente</b>; nunca marca “Aprovado” automaticamente.</p>` : ""}`;
  }

  function injectUi() {
    const module = doc().getElementById("module-coding");
    if (!module) return;
    if (!doc().getElementById("coding-bundle-style")) {
      const style = doc().createElement("style");
      style.id = "coding-bundle-style";
      style.textContent = `
#coding-bundle-panel{border:1px solid var(--border,#dfe4ea);border-left:4px solid #0e61a2;border-radius:12px;padding:12px 14px;margin:12px 0;background:var(--surface,#fff)}#coding-bundle-panel.has-error{border-left-color:#b42318}.coding-bundle-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.coding-bundle-head small,.coding-bundle-head strong,.coding-bundle-head span{display:block}.coding-bundle-head strong{font-size:15px;margin:3px 0}.coding-bundle-head span{font-size:11px;color:var(--muted,#68737d)}.coding-bundle-order{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.coding-bundle-order>span{display:grid;grid-template-columns:20px 1fr;column-gap:6px;align-items:center;border:1px solid var(--border,#e2e7eb);border-radius:8px;padding:6px 8px;font-size:11px}.coding-bundle-order b{grid-row:1/3;border-radius:99px;background:rgba(14,97,162,.12);width:20px;height:20px;display:grid;place-items:center}.coding-bundle-order small{color:var(--muted,#68737d)}.coding-bundle-note{font-size:11px;line-height:1.45;margin:10px 0 0;color:var(--muted,#596572)}
`;
      doc().head.appendChild(style);
    }
    if (!doc().getElementById("coding-bundle-panel")) {
      const panel = doc().createElement("div");
      panel.id = "coding-bundle-panel";
      const toolbar = module.querySelector(".coding-toolbar");
      toolbar && toolbar.insertAdjacentElement("beforebegin", panel);
    }
    const card = doc().getElementById("coding-document-drop") && doc().getElementById("coding-document-drop").closest(".coding-card");
    const description = card && card.querySelector("p");
    if (description) description.innerHTML = "Adicione todos os PDFs que pertencem ao mesmo documento. O RECON lê <strong>um por vez</strong>, cruza o conteúdo e gera <strong>um código e um PDF consolidado</strong>.";
    const generate = doc().getElementById("coding-generate-selected");
    if (generate) generate.textContent = "Gerar PDF consolidado";
    const generateValid = doc().getElementById("coding-generate-valid");
    if (generateValid) generateValid.hidden = true;
    const zip = doc().getElementById("coding-download-zip");
    if (zip) zip.hidden = true;
  }

  function decorateUi() {
    injectUi();
    const state = Base.state;
    const representative = activeRepresentative(state);
    const count = doc().getElementById("coding-document-count");
    if (count && state.documents.length) count.textContent = `${state.documents.length} arquivo(s) · 1 documento consolidado`;
    doc().querySelectorAll('#module-coding [data-action="generate"],#module-coding [data-action="preview"]').forEach((button) => { button.hidden = true; });
    doc().querySelectorAll('#module-coding [data-action="edit"]').forEach((button) => {
      const row = button.closest("[data-coding-id]");
      button.hidden = Boolean(representative && row && row.dataset.codingId !== representative.id);
    });
    const drawerGenerate = doc().getElementById("coding-generate-active");
    if (drawerGenerate) drawerGenerate.textContent = "Gerar PDF consolidado";
    const drawerPreview = doc().getElementById("coding-preview-active");
    if (drawerPreview) drawerPreview.textContent = "Visualizar PDF consolidado";
    renderBundlePanel();
  }

  function captureGeneration(event) {
    const button = event.target && event.target.closest && event.target.closest("button");
    if (!button || !button.closest("#module-coding")) return;
    const downloadIds = new Set(["coding-generate-selected", "coding-generate-valid", "coding-download-zip", "coding-generate-active"]);
    const previewIds = new Set(["coding-preview-active"]);
    if (downloadIds.has(button.id) || button.matches('[data-action="generate"]')) {
      event.preventDefault(); event.stopImmediatePropagation();
      generateBundle(false).catch((error) => { console.error(error); toast(error.message, "error"); });
    } else if (previewIds.has(button.id) || button.matches('[data-action="preview"]')) {
      event.preventDefault(); event.stopImmediatePropagation();
      generateBundle(true).catch((error) => { console.error(error); toast(error.message, "error"); });
    }
  }

  const patched = Object.freeze(Object.assign({}, Base, {
    analyzeAll: analyzeBundle,
    generateBundle,
    render: function render() { Base.render(); decorateUi(); },
  }));
  root.RECONDocumentCoding = patched;

  const originalInit = Base.init;
  patched.init = patched.init; // documentação/intenção; Object.freeze impede mutação e o init original continua exposto.

  function install() {
    if (installed) return;
    installed = true;
    injectUi();
    doc().addEventListener("click", captureGeneration, true);
    root.addEventListener("recon:ui-update", decorateUi);
    root.setTimeout(decorateUi, 0);
  }

  // O app base já terá criado a API; o bootstrap chama init logo em seguida.
  // Instalamos o comportamento agora e deixamos o init original cuidar do shell/bindings.
  install();
})(window);
