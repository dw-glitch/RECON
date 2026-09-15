(function (root) {
  "use strict";

  const doc = root.document;
  const Core = root.RECONDocumentCodingCore;
  const Normative = root.RECONDocumentCodingNormative;
  const Parsers = root.RECONDocumentCodingParsers;
  const Storage = root.RECONDocumentCodingStorage;
  const PDF = root.RECONDocumentCodingPDF;
  if (!doc || !Core || !Normative || !Parsers || !Storage || !PDF) return;

  const state = {
    initialized: false,
    documents: [],
    ldRows: [],
    ldIndex: Core.buildLdIndex([]),
    ldFiles: [],
    template: null,
    templateValidation: null,
    analyzing: false,
    abortController: null,
    activeId: "",
  };

  const $ = (selector, scope) => (scope || doc).querySelector(selector);
  const $$ = (selector, scope) => [...(scope || doc).querySelectorAll(selector)];

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function toast(message, tone) {
    const node = doc.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 7000);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function confidenceClass(value) {
    return {
      confirmed: "coding-ok",
      high: "coding-high",
      review: "coding-review",
      conflict: "coding-conflict",
      impossible: "coding-error",
    }[value] || "coding-neutral";
  }

  function injectStyles() {
    if (doc.getElementById("document-coding-styles")) return;
    const style = doc.createElement("style");
    style.id = "document-coding-styles";
    style.textContent = `
#module-coding .coding-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}
#module-coding .coding-card{background:var(--surface,#fff);border:1px solid var(--border,#dfe4ea);border-radius:14px;padding:14px;min-height:128px}
#module-coding .coding-card h3{margin:0 0 6px;font-size:15px}.coding-card p{margin:0 0 10px;color:var(--muted,#5f6b7a);font-size:12px;line-height:1.45}
#module-coding .coding-drop{border:1.5px dashed #9aa6b2;border-radius:12px;padding:12px;text-align:center;cursor:pointer;background:rgba(127,127,127,.035)}
#module-coding .coding-drop.dragover{outline:3px solid rgba(14,97,162,.12);border-color:#0e61a2}
#module-coding .coding-capabilities{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}.coding-capabilities span{border-radius:999px;padding:5px 9px;font-size:11px;background:rgba(127,127,127,.08)}
#module-coding .coding-warning{border-left:4px solid #b57900;background:#fff7dc;padding:10px 12px;border-radius:10px;margin:10px 0;font-size:12px;line-height:1.45}
#module-coding .coding-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}
#module-coding .coding-progress{height:8px;border-radius:999px;background:rgba(127,127,127,.14);overflow:hidden;min-width:160px;flex:1}.coding-progress>span{display:block;height:100%;background:#0e61a2;width:0;transition:width .2s ease}
#module-coding .coding-table-wrap{overflow:auto;border:1px solid var(--border,#dfe4ea);border-radius:14px;background:var(--surface,#fff)}
#module-coding .coding-table{width:100%;border-collapse:collapse;min-width:1320px}.coding-table th,.coding-table td{padding:9px 10px;border-bottom:1px solid var(--border,#e7ebef);font-size:12px;text-align:left;vertical-align:top}.coding-table th{position:sticky;top:0;background:var(--surface,#fff);z-index:2;font-size:11px;text-transform:uppercase;letter-spacing:.035em}.coding-table small{display:block;color:var(--muted,#6e7781);margin-top:3px}.coding-table code{font-size:11px;white-space:nowrap}
#module-coding .coding-pill{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:10.5px;font-weight:700;white-space:nowrap}.coding-ok{background:#def6e7;color:#136a38}.coding-high{background:#e7f1ff;color:#174f8f}.coding-review{background:#fff1c8;color:#755200}.coding-conflict,.coding-error{background:#ffe2e0;color:#8d241e}.coding-neutral{background:#edf0f3;color:#505a64}
#module-coding .coding-actions{display:flex;gap:5px;flex-wrap:wrap}.coding-actions button{font-size:11px;padding:5px 7px}
#module-coding .coding-empty{padding:34px;text-align:center;color:var(--muted,#6e7781)}
#module-coding .coding-drawer{position:fixed;top:0;right:0;width:min(650px,96vw);height:100vh;background:var(--surface,#fff);border-left:1px solid var(--border,#dfe4ea);box-shadow:-20px 0 45px rgba(0,0,0,.12);z-index:1200;overflow:auto;padding:18px}.coding-drawer[hidden]{display:none}.coding-drawer-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;position:sticky;top:-18px;background:var(--surface,#fff);z-index:3;padding:18px 0 10px;border-bottom:1px solid var(--border,#e7ebef)}
#module-coding .coding-editor{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.coding-editor label{font-size:11px;color:var(--muted,#5f6b7a)}.coding-editor input,.coding-editor select{width:100%;margin-top:4px;padding:8px;border:1px solid var(--border,#ccd4dc);border-radius:8px;background:var(--surface,#fff);color:inherit}.coding-editor .full{grid-column:1/-1}
#module-coding .coding-reason{border:1px solid var(--border,#e0e4e8);border-radius:10px;padding:10px;margin:8px 0}.coding-reason strong{display:block;font-size:12px}.coding-reason small{display:block;margin-top:4px;color:var(--muted,#68737d)}
#module-coding .coding-admin{margin-top:18px;border-top:1px solid var(--border,#e7ebef);padding-top:14px}.coding-admin table{width:100%;border-collapse:collapse}.coding-admin td,.coding-admin th{padding:6px;font-size:11px;border-bottom:1px solid var(--border,#eee)}
@media(max-width:900px){#module-coding .coding-grid{grid-template-columns:1fr}.coding-editor{grid-template-columns:1fr}}
`;
    doc.head.appendChild(style);
  }

  function shell() {
    return `
<div class="coding-grid">
  <section class="coding-card"><h3>1. Documentos</h3><p>PDF e DOCX. A leitura percorre o documento inteiro; PDF pesquisável usa texto nativo e PDFs com pouco texto são sinalizados para OCR.</p><div class="coding-drop" id="coding-document-drop"><strong>Adicionar documentos</strong><br><small>Arraste PDFs ou DOCX aqui</small></div><input id="coding-document-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple hidden><small id="coding-document-count">0 arquivo(s)</small></section>
  <section class="coding-card"><h3>2. LDs de referência</h3><p>Carregue todas as LDs relevantes. O módulo indexa código, título, TAG, disciplina, família N-1710 e estruturas ET antes de sugerir sequenciais.</p><div class="coding-drop" id="coding-ld-drop"><strong>Adicionar LDs</strong><br><small>XLSX/XLS, sem alterar os arquivos</small></div><input id="coding-ld-input" type="file" accept=".xlsx,.xls,.xlsm" multiple hidden><small id="coding-ld-count">Nenhuma LD carregada</small></section>
  <section class="coding-card"><h3>3. Capa Petrobras</h3><p>Use o PDF oficial como template. O arquivo é guardado localmente no navegador e somente os campos variáveis são sobrepostos.</p><div class="coding-drop" id="coding-cover-drop"><strong>Configurar capa</strong><br><small>CAPA (1).pdf fornecida ao projeto</small></div><input id="coding-cover-input" type="file" accept="application/pdf,.pdf" hidden><small id="coding-cover-status">Nenhum template configurado</small></section>
</div>
<div class="coding-capabilities" id="coding-capabilities"></div>
<div class="coding-warning" id="coding-architecture-warning" hidden></div>
<div class="coding-toolbar">
  <button class="primary-button" id="coding-analyze" type="button">Analisar e codificar</button>
  <button class="secondary-button" id="coding-generate-selected" type="button">Gerar selecionados</button>
  <button class="secondary-button" id="coding-generate-valid" type="button">Gerar todos válidos</button>
  <button class="secondary-button" id="coding-download-zip" type="button">Baixar ZIP do lote</button>
  <button class="secondary-button" id="coding-export-xlsx" type="button">Exportar relação Excel</button>
  <button class="text-action" id="coding-clear" type="button">Limpar sessão</button>
  <div class="coding-progress" aria-label="Progresso"><span id="coding-progress-bar"></span></div><small id="coding-progress-text">Aguardando documentos</small>
</div>
<div class="coding-table-wrap"><table class="coding-table"><thead><tr><th><input id="coding-select-all" type="checkbox" aria-label="Selecionar todos"></th><th>Arquivo</th><th>Título</th><th>Tipo</th><th>Disciplina</th><th>TAG</th><th>Norma / regra</th><th>Código LD</th><th>Código proposto</th><th>Rev.</th><th>Confiança</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="coding-table-body"></tbody></table><div class="coding-empty" id="coding-empty">Adicione documentos para iniciar.</div></div>
<aside class="coding-drawer" id="coding-drawer" hidden aria-label="Detalhes da codificação"><div class="coding-drawer-head"><div><small>CODIFICAÇÃO DE DOCUMENTOS</small><h3 id="coding-drawer-title">Análise</h3></div><button class="secondary-button compact" id="coding-drawer-close" type="button">Fechar</button></div><div id="coding-drawer-body"></div></aside>
<div class="coding-admin"><details><summary><strong>Base Normativa de Codificação</strong> — versões ativas e capacidades</summary><div id="coding-norms"></div></details></div>
`;
  }

  function renderCapabilities() {
    const storageCaps = Storage.capabilities();
    const pdfCaps = PDF.capabilities();
    const node = $("#coding-capabilities");
    node.innerHTML = [
      ["ET ativa", `${Normative.latestNorm("ET-5290.00-22000-912-1LV-001").revision}`],
      ["N-1710", `${Normative.latestNorm("N-1710").revision}`],
      ["Auditoria local", storageCaps.auditPersistence ? "ativa" : "indisponível"],
      ["Reserva entre abas", storageCaps.webLocks ? "ativa" : "limitada"],
      ["Reserva entre dispositivos", storageCaps.crossDeviceAtomic ? "ativa" : "não configurada"],
      ["DOCX→PDF fiel", pdfCaps.docxPdfAdapter ? "ativo" : "adaptador ausente"],
    ].map(([label, value]) => `<span><strong>${escape(label)}:</strong> ${escape(value)}</span>`).join("");
    const warning = $("#coding-architecture-warning");
    const notes = [];
    if (!storageCaps.crossDeviceAtomic) notes.push("O RECON atual é uma aplicação estática sem backend transacional. A reserva é atômica entre abas deste navegador, mas não pode garantir, sozinha, que dois computadores diferentes recebam sequenciais distintos. O módulo expõe RECONDocumentCodingSharedSequenceAdapter para um serviço corporativo transacional quando ele for disponibilizado; até lá, códigos novos ficam marcados como exigindo confirmação antes do registro definitivo.");
    if (!pdfCaps.docxPdfAdapter) notes.push("DOCX é lido e codificado integralmente, porém o RECON não faz uma conversão falsa/rasterizada. Para PDF final de DOCX é necessário um conversor compatível com o deploy, exposto por RECONDocumentCodingDocxPdfAdapter. PDFs já funcionam com preservação de páginas/vetores.");
    warning.hidden = !notes.length;
    warning.textContent = notes.join(" ");
  }

  function renderNorms() {
    const container = $("#coding-norms");
    const rows = Normative.NORMS.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => `<tr><td>${escape(item.id)}</td><td>${escape(item.revision)}</td><td>${escape(item.date)}</td><td><span class="coding-pill ${item.status === "active" ? "coding-ok" : "coding-neutral"}">${escape(item.status === "active" ? "ativa" : "histórica")}</span></td></tr>`).join("");
    container.innerHTML = `<table><thead><tr><th>Norma</th><th>Rev.</th><th>Data</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table><p><small>Hierarquia implementada: regra específica da ET/projeto → anexos/contrato → N-1710 → LD como evidência operacional → conteúdo do documento. A IA/semântica não escreve o código final; o motor só monta grupos validados.</small></p>`;
  }

  function setProgress(value, message) {
    const n = Math.max(0, Math.min(1, Number(value || 0)));
    $("#coding-progress-bar").style.width = `${Math.round(n * 100)}%`;
    $("#coding-progress-text").textContent = message || `${Math.round(n * 100)}%`;
  }

  function idForFile(file) {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${file.name}`;
  }

  function addDocuments(files) {
    [...files].forEach((file) => {
      const check = Parsers.validateInputFile(file, ["pdf", "docx"]);
      if (!check.valid) { toast(`${file.name}: ${check.reason}`, "error"); return; }
      state.documents.push({ id: idForFile(file), file, type: check.type, selected: true, status: "queued", parsed: null, analysis: null, generated: null, error: "", overrides: {}, manualChanges: [] });
    });
    render();
  }

  async function addLds(files) {
    const input = [...files];
    if (!input.length) return;
    setProgress(0, "Lendo LDs…");
    const results = await Parsers.mapPool(input, Parsers.parseLdWorkbook, { concurrency: 2, onProgress: ({ completed, total }) => setProgress(completed / total, `LDs: ${completed}/${total}`) });
    results.forEach((result, index) => {
      if (!result.ok) { toast(`${input[index].name}: ${result.error.message}`, "error"); return; }
      state.ldFiles.push(result.value);
      state.ldRows.push(...result.value.rows);
    });
    state.ldIndex = Core.buildLdIndex(state.ldRows);
    render();
    setProgress(1, `${state.ldIndex.count.toLocaleString("pt-BR")} registro(s) de LD indexados`);
  }

  async function configureCover(file) {
    if (!file) return;
    const check = Parsers.validateInputFile(file, ["pdf"]);
    if (!check.valid) throw new Error(check.reason);
    setProgress(0.25, "Validando capa…");
    const buffer = await file.arrayBuffer();
    const validation = await PDF.validateTemplate(buffer);
    if (!validation.valid) throw new Error(validation.reason);
    const record = {
      id: PDF.COVER_ID,
      name: file.name,
      mime: file.type || "application/pdf",
      size: file.size,
      hash: validation.hash,
      exact: validation.exact,
      bytes: buffer,
    };
    await Storage.saveTemplate(record);
    state.template = record;
    state.templateValidation = validation;
    render();
    setProgress(1, validation.exact ? "Capa oficial reconhecida" : "Capa carregada — revisar preview");
  }

  function detectExistingCover(parsed) {
    if (!parsed || parsed.type !== "pdf") return { detected: false, confidence: 0 };
    const first = parsed.pages && parsed.pages[0] && parsed.pages[0].text || "";
    const N = Core.norm(first);
    let score = 0;
    if (N.includes("INDICE DE REVISOES")) score += 0.35;
    if (N.includes("FORMULARIO") && N.includes("N-381")) score += 0.35;
    if (N.includes("PETROBRAS")) score += 0.15;
    if (N.includes("RESPONSAVEL TECNICO") || N.includes("DOCUMENTO INTERNO")) score += 0.15;
    return { detected: score >= 0.65, confidence: score, firstPageText: first };
  }

  async function analyzeAll() {
    if (state.analyzing) return;
    if (!state.documents.length) { toast("Adicione pelo menos um documento.", "warn"); return; }
    state.analyzing = true;
    state.abortController = new AbortController();
    $("#coding-analyze").disabled = true;
    try {
      const pending = state.documents.filter((item) => !item.parsed || item.status === "error");
      const parsedResults = await Parsers.mapPool(pending, async (item) => Parsers.parseDocument(item.file, { signal: state.abortController.signal }), {
        concurrency: 3,
        signal: state.abortController.signal,
        onProgress: ({ completed, total }) => setProgress(total ? completed / total * 0.65 : 0, `Lendo documentos: ${completed}/${total}`),
      });
      parsedResults.forEach((result, index) => {
        const item = pending[index];
        if (result.ok) {
          item.parsed = result.value;
          item.coverDetection = detectExistingCover(result.value);
          item.status = result.value.ocrRequired ? "review" : "parsed";
          item.error = "";
        } else {
          item.status = "error";
          item.error = result.error && result.error.message || "Falha ao ler arquivo";
        }
      });

      // A etapa normativa é propositalmente sequencial por lote. As reservas em
      // memória entram no cálculo do próximo documento da mesma família, evitando
      // que 50 arquivos novos recebam todos o mesmo próximo número.
      const reservations = [];
      let done = 0;
      for (const item of state.documents) {
        if (!item.parsed || item.status === "error") { done += 1; continue; }
        const analysis = Core.analyzeDocument({ filename: item.file.name, text: item.parsed.text, overrides: item.overrides }, state.ldIndex, { reserved: reservations });
        item.analysis = analysis;
        item.status = analysis.status;
        if (analysis.complete && analysis.familyKey && analysis.sequence && !analysis.existing && analysis.status !== Core.STATUS.CONFLICT) {
          reservations.push({ familyKey: analysis.familyKey, sequence: Number(analysis.sequence), code: analysis.code });
        }
        if (item.parsed.ocrRequired && analysis.confidence !== Core.CONFIDENCE.CONFLICT) {
          item.analysis.confidence = Core.CONFIDENCE.REVIEW;
          item.analysis.status = Core.STATUS.REVIEW;
          item.analysis.message = `OCR necessário antes da confirmação. ${item.analysis.message || ""}`.trim();
        }
        done += 1;
        setProgress(0.65 + (done / state.documents.length) * 0.35, `Codificando: ${done}/${state.documents.length}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      render();
      setProgress(1, `Análise concluída: ${state.documents.filter((x) => x.analysis && x.analysis.complete).length}/${state.documents.length} com código completo`);
    } finally {
      state.analyzing = false;
      $("#coding-analyze").disabled = false;
      state.abortController = null;
    }
  }

  function row(item) {
    const analysis = item.analysis;
    const data = analysis && analysis.data || item.parsed && Core.extractTechnicalData({ filename: item.file.name, text: item.parsed.text }) || {};
    const confidence = analysis && analysis.confidence || (item.status === "error" ? "impossible" : "review");
    const match = analysis && analysis.ldMatch || analysis && analysis.matchInfo && analysis.matchInfo.match;
    const rule = analysis && analysis.ruleId || "—";
    const code = analysis && analysis.code || "—";
    const statusMessage = item.error || analysis && analysis.message || (item.status === "queued" ? "Aguardando análise" : "—");
    return `<tr data-coding-id="${escape(item.id)}"><td><input type="checkbox" data-coding-select ${item.selected ? "checked" : ""}></td><td><strong>${escape(item.file.name)}</strong><small>${escape(formatBytes(item.file.size))}${item.parsed && item.parsed.pageCount ? ` · ${item.parsed.pageCount} pág.` : ""}</small></td><td>${escape(data.title || "—")}</td><td>${escape(data.classification && data.classification.label || "—")}</td><td>${escape(data.discipline || "—")}</td><td>${escape(data.tag || "—")}</td><td>${escape(rule)}<small>${escape(analysis && analysis.rule && analysis.rule.label || "")}</small></td><td>${escape(match && match.code || "—")}</td><td><code>${escape(code)}</code></td><td>${escape(data.revision || "—")}</td><td><span class="coding-pill ${confidenceClass(confidence)}">${escape(Core.CONFIDENCE_LABEL[confidence] || confidence)}</span></td><td title="${escape(statusMessage)}">${escape(statusMessage.slice(0, 90))}${statusMessage.length > 90 ? "…" : ""}</td><td><div class="coding-actions"><button class="secondary-button compact" data-action="details" type="button">Análise</button><button class="secondary-button compact" data-action="edit" type="button">Editar</button><button class="secondary-button compact" data-action="preview" type="button">Capa</button><button class="secondary-button compact" data-action="generate" type="button">Gerar</button></div></td></tr>`;
  }

  function render() {
    if (!state.initialized) return;
    const body = $("#coding-table-body");
    body.innerHTML = state.documents.map(row).join("");
    $("#coding-empty").hidden = state.documents.length > 0;
    $("#coding-document-count").textContent = `${state.documents.length} arquivo(s)`;
    $("#coding-ld-count").textContent = state.ldFiles.length ? `${state.ldFiles.length} LD(s) · ${state.ldIndex.count.toLocaleString("pt-BR")} registro(s)` : "Nenhuma LD carregada";
    const cover = $("#coding-cover-status");
    if (!state.template) cover.textContent = "Nenhum template configurado";
    else if (state.templateValidation && state.templateValidation.exact) cover.textContent = `${state.template.name} · oficial reconhecida`;
    else cover.textContent = `${state.template.name} · requer conferência visual`;
    const selectAll = $("#coding-select-all");
    selectAll.checked = Boolean(state.documents.length) && state.documents.every((item) => item.selected);
    selectAll.indeterminate = state.documents.some((item) => item.selected) && !selectAll.checked;
    renderCapabilities();
  }

  function findItem(id) {
    return state.documents.find((item) => item.id === id) || null;
  }

  function selectedItems(validOnly) {
    return state.documents.filter((item) => item.selected && (!validOnly || item.analysis && item.analysis.complete && ![Core.CONFIDENCE.CONFLICT, Core.CONFIDENCE.IMPOSSIBLE].includes(item.analysis.confidence)));
  }

  function editorField(field, label, value, options) {
    const opts = options || {};
    if (opts.select) {
      const choices = opts.select.map((item) => `<option value="${escape(item.value)}" ${String(item.value) === String(value) ? "selected" : ""}>${escape(item.label)}</option>`).join("");
      return `<label class="${opts.full ? "full" : ""}">${escape(label)}<select data-edit-field="${escape(field)}"><option value="">—</option>${choices}</select></label>`;
    }
    return `<label class="${opts.full ? "full" : ""}">${escape(label)}<input data-edit-field="${escape(field)}" value="${escape(value || "")}" ${opts.readonly ? "readonly" : ""}></label>`;
  }

  function openDrawer(item, editMode) {
    if (!item) return;
    state.activeId = item.id;
    const analysis = item.analysis;
    const data = analysis && analysis.data || item.parsed && Core.extractTechnicalData({ filename: item.file.name, text: item.parsed.text }) || {};
    $("#coding-drawer-title").textContent = item.file.name;
    const reportCodes = Object.keys(Normative.REPORT_CODES).sort().map((value) => ({ value, label: `${value} — ${Normative.REPORT_CODES[value]}` }));
    const disciplines = Object.keys(Normative.ET_DISCIPLINES).sort().map((value) => ({ value, label: `${value} — ${Normative.ET_DISCIPLINES[value]}` }));
    const groups = analysis && analysis.groups || [];
    const body = $("#coding-drawer-body");
    body.innerHTML = `
      <div class="coding-warning" ${item.coverDetection && item.coverDetection.detected ? "" : "hidden"}>O arquivo aparenta já possuir uma capa N-381 (${Math.round((item.coverDetection && item.coverDetection.confidence || 0) * 100)}% de confiança). A substituição da primeira página nunca será automática: escolha isso apenas na geração.</div>
      <div class="coding-editor">
        ${editorField("title", "Título", data.title, { full: true })}
        ${editorField("category", "Categoria N-1710", data.category)}
        ${editorField("discipline", "Disciplina", data.discipline, { select: disciplines })}
        ${editorField("tag", "TAG / nt-", data.tag, { full: true })}
        ${editorField("installation", "Instalação", data.installation)}
        ${editorField("activityArea", "Área de atividade", data.activityArea)}
        ${editorField("serviceClass", "Classe", data.serviceClass)}
        ${editorField("origin", "Origem", data.origin)}
        ${editorField("emitter", "Emissor ET", data.emitter)}
        ${editorField("unit", "Unidade ET", data.unit)}
        ${editorField("eap", "EAP", data.eap)}
        ${editorField("reportCode", "Código de relatório", data.reportCode, { select: reportCodes })}
        ${editorField("contract", "Contrato", data.contract)}
        ${editorField("revision", "Revisão", data.revision)}
        ${editorField("date", "Data (AAAA-MM-DD)", data.date)}
        ${editorField("sequence", "Sequencial manual (opcional)", data.sequence || "")}
      </div>
      <div class="coding-toolbar"><button class="primary-button" id="coding-save-edit" type="button">Salvar e recalcular</button><button class="secondary-button" id="coding-preview-active" type="button">Visualizar capa</button><button class="secondary-button" id="coding-generate-active" type="button">Gerar documento</button></div>
      <h4>Por que este código?</h4>
      <p>${escape(analysis && analysis.message || "Execute a análise para obter a fundamentação.")}</p>
      ${groups.length ? groups.map((group) => `<div class="coding-reason"><strong>${escape(group.label || group.field)} → ${escape(group.value || "—")}</strong><small>${escape(group.source || "Fonte não registrada")}</small></div>`).join("") : ""}
      ${analysis && analysis.matchInfo && analysis.matchInfo.candidates && analysis.matchInfo.candidates.length ? `<h4>Correspondências possíveis na LD</h4>${analysis.matchInfo.candidates.map((candidate) => `<div class="coding-reason"><strong>${escape(candidate.code)}</strong><small>${escape(candidate.title || "")} · ${escape(candidate.ld || "LD")}</small></div>`).join("")}` : ""}
      <h4>Evidências do arquivo</h4><div class="coding-reason"><strong>Hash SHA-256</strong><small>${escape(item.parsed && item.parsed.hash || "—")}</small></div><div class="coding-reason"><strong>Leitura</strong><small>${escape(item.parsed && item.parsed.ocrRequired ? "PDF com pouco texto nativo — OCR necessário" : "Texto nativo/documento estruturado lido")}</small></div>
    `;
    $("#coding-drawer").hidden = false;
    $("#coding-save-edit").addEventListener("click", () => saveActiveEdits(item));
    $("#coding-preview-active").addEventListener("click", () => previewCover(item));
    $("#coding-generate-active").addEventListener("click", () => generateOne(item, true));
    if (!editMode) $$("[data-edit-field]", body).forEach((node) => { node.disabled = false; });
  }

  function saveActiveEdits(item) {
    const next = {};
    $$("[data-edit-field]", $("#coding-drawer-body")).forEach((node) => { next[node.dataset.editField] = node.value.trim(); });
    const previous = Object.assign({}, item.overrides);
    item.overrides = Object.assign({}, item.overrides, next);
    Object.keys(next).forEach((field) => {
      if (String(previous[field] || "") !== String(next[field] || "")) item.manualChanges.push({ field, from: previous[field] || "", to: next[field], at: new Date().toISOString() });
    });
    const reserved = state.documents.filter((other) => other.id !== item.id && other.analysis && other.analysis.complete && other.analysis.familyKey).map((other) => ({ familyKey: other.analysis.familyKey, sequence: Number(other.analysis.sequence), code: other.analysis.code }));
    item.analysis = Core.analyzeDocument({ filename: item.file.name, text: item.parsed.text, overrides: item.overrides }, state.ldIndex, { reserved });
    item.status = item.analysis.status;
    render();
    openDrawer(item, true);
    toast("Dados revalidados e código recalculado.", "success");
  }

  async function templateBytes() {
    if (!state.template) {
      const stored = await Storage.getTemplate(PDF.COVER_ID).catch(() => null);
      if (stored) {
        state.template = stored;
        state.templateValidation = await PDF.validateTemplate(stored.bytes);
      }
    }
    if (!state.template) throw new Error("Configure primeiro o PDF oficial de capa Petrobras.");
    return state.template.bytes;
  }

  function coverDataFor(item) {
    const analysis = item.analysis;
    const data = analysis && analysis.data || {};
    return Object.assign({}, data, item.overrides || {}, {
      code: analysis && analysis.code || data.existingCode || "",
      title: item.overrides.title || data.title,
      unitDescription: data.unit && Normative.ET_UNITS[data.unit] ? `${Normative.ET_UNITS[data.unit]} (${data.unit})` : data.unit,
    });
  }

  async function previewCover(item) {
    try {
      if (!item.analysis || !item.analysis.code) throw new Error("O documento ainda não possui um código completo.");
      const cover = await PDF.generateCover(await templateBytes(), coverDataFor(item), { allowUnmappedTemplate: Boolean(state.templateValidation && !state.templateValidation.exact) });
      const url = PDF.blobUrl(cover);
      root.open(url, "_blank", "noopener,noreferrer");
      root.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) { toast(error.message, "error"); }
  }

  async function askCoverMode(item) {
    if (!item.coverDetection || !item.coverDetection.detected) return false;
    return root.confirm("Este PDF aparenta já ter uma capa. OK = substituir a primeira página; Cancelar = manter a primeira página e adicionar a nova capa antes dela.");
  }

  async function generateOne(item, downloadNow) {
    if (!item.analysis || !item.analysis.complete || [Core.CONFIDENCE.CONFLICT, Core.CONFIDENCE.IMPOSSIBLE].includes(item.analysis.confidence)) throw new Error(`${item.file.name}: codificação ainda não está válida para geração.`);
    const replaceExistingCover = item.type === "pdf" ? await askCoverMode(item) : false;
    const output = await PDF.generateFinalPdf({ templateBytes: await templateBytes(), inputFile: item.file, inputType: item.type, coverData: coverDataFor(item), replaceExistingCover, coverOptions: { allowUnmappedTemplate: Boolean(state.templateValidation && !state.templateValidation.exact) } });
    const filename = Core.finalFilename(item.analysis.code, item.analysis.data.title);
    item.generated = { bytes: output, filename, createdAt: new Date().toISOString() };
    await Storage.putAudit(Core.auditRecord(item.analysis, { fileHash: item.parsed && item.parsed.hash, manualChanges: item.manualChanges, result: "generated" })).catch(() => {});
    if (downloadNow) PDF.download(output, filename);
    render();
    return item.generated;
  }

  async function generateMany(items) {
    const results = [];
    let completed = 0;
    for (const item of items) {
      try { results.push({ item, ok: true, value: await generateOne(item, false) }); }
      catch (error) { results.push({ item, ok: false, error }); item.error = error.message; }
      completed += 1;
      setProgress(completed / items.length, `Gerando: ${completed}/${items.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    render();
    return results;
  }

  async function generateSelected(validOnly) {
    const items = selectedItems(validOnly);
    if (!items.length) { toast("Nenhum documento selecionado e válido para geração.", "warn"); return; }
    const results = await generateMany(items);
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    toast(`${ok} documento(s) gerado(s)${failed ? `; ${failed} falharam e podem ser reprocessados.` : "."}`, failed ? "warn" : "success");
  }

  function processingRows() {
    return state.documents.map((item) => {
      const a = item.analysis || {};
      const d = a.data || {};
      return {
        "Arquivo original": item.file.name,
        "Arquivo final": item.generated && item.generated.filename || "",
        "Código": a.code || "",
        "Título": d.title || "",
        "Revisão": d.revision || "",
        "Disciplina": d.discipline || "",
        "TAG": d.tag || "",
        "Norma/regra": a.ruleId || "",
        "Sequência": a.sequence || "",
        "Confiança": Core.CONFIDENCE_LABEL[a.confidence] || a.confidence || "",
        "Observações": item.error || a.message || "",
      };
    });
  }

  async function exportExcel(downloadNow) {
    if (!root.ExcelJS) throw new Error("ExcelJS não carregado.");
    const workbook = new root.ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Codificações");
    const rows = processingRows();
    const headers = Object.keys(rows[0] || { "Arquivo original": "" });
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(headers.map((key) => row[key])));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    headers.forEach((_, index) => { sheet.getColumn(index + 1).width = Math.min(55, Math.max(14, ...sheet.getColumn(index + 1).values.map((v) => String(v || "").length + 2))); });
    const buffer = await workbook.xlsx.writeBuffer();
    if (downloadNow !== false) {
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const link = doc.createElement("a"); link.href = url; link.download = `RECON_Codificacoes_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); root.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    return new Uint8Array(buffer);
  }

  async function downloadZip() {
    if (!root.JSZip) throw new Error("JSZip não carregado.");
    const items = selectedItems(true);
    if (!items.length) throw new Error("Selecione documentos válidos.");
    const missing = items.filter((item) => !item.generated);
    if (missing.length) await generateMany(missing);
    const zip = new root.JSZip();
    items.filter((item) => item.generated).forEach((item) => zip.file(item.generated.filename, item.generated.bytes));
    const report = processingRows();
    zip.file("relatorio_processamento.json", JSON.stringify(report, null, 2));
    try { zip.file("relacao_codigo_documento.xlsx", await exportExcel(false)); } catch (_) { /* JSON já preserva o relatório */ }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } }, ({ percent }) => setProgress(percent / 100, `Compactando ZIP: ${Math.round(percent)}%`));
    const url = URL.createObjectURL(blob); const link = doc.createElement("a"); link.href = url; link.download = `RECON_Documentos_${new Date().toISOString().slice(0, 10)}.zip`; link.click(); root.setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function bindDrop(dropSelector, inputSelector, handler) {
    const drop = $(dropSelector); const input = $(inputSelector);
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("dragover"); handler(event.dataTransfer.files); });
    input.addEventListener("change", () => { handler(input.files); input.value = ""; });
  }

  function bind() {
    bindDrop("#coding-document-drop", "#coding-document-input", addDocuments);
    bindDrop("#coding-ld-drop", "#coding-ld-input", (files) => addLds(files).catch((e) => toast(e.message, "error")));
    bindDrop("#coding-cover-drop", "#coding-cover-input", (files) => configureCover(files[0]).catch((e) => toast(e.message, "error")));
    $("#coding-analyze").addEventListener("click", () => analyzeAll().catch((e) => toast(e.message, "error")));
    $("#coding-generate-selected").addEventListener("click", () => generateSelected(false).catch((e) => toast(e.message, "error")));
    $("#coding-generate-valid").addEventListener("click", () => generateSelected(true).catch((e) => toast(e.message, "error")));
    $("#coding-download-zip").addEventListener("click", () => downloadZip().catch((e) => toast(e.message, "error")));
    $("#coding-export-xlsx").addEventListener("click", () => exportExcel(true).catch((e) => toast(e.message, "error")));
    $("#coding-clear").addEventListener("click", () => { if (state.documents.length && !root.confirm("Limpar a sessão de codificação? As LDs e o template de capa permanecem disponíveis.")) return; state.documents = []; render(); setProgress(0, "Aguardando documentos"); });
    $("#coding-select-all").addEventListener("change", (event) => { state.documents.forEach((item) => { item.selected = event.target.checked; }); render(); });
    $("#coding-drawer-close").addEventListener("click", () => { $("#coding-drawer").hidden = true; state.activeId = ""; });
    $("#coding-table-body").addEventListener("change", (event) => {
      if (!event.target.matches("[data-coding-select]")) return;
      const row = event.target.closest("[data-coding-id]"); const item = findItem(row && row.dataset.codingId); if (item) item.selected = event.target.checked; render();
    });
    $("#coding-table-body").addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]"); if (!button) return;
      const row = button.closest("[data-coding-id]"); const item = findItem(row && row.dataset.codingId); if (!item) return;
      if (button.dataset.action === "details" || button.dataset.action === "edit") openDrawer(item, button.dataset.action === "edit");
      if (button.dataset.action === "preview") previewCover(item);
      if (button.dataset.action === "generate") generateOne(item, true).catch((e) => toast(e.message, "error"));
    });
  }

  async function init() {
    const container = $("#module-coding-body");
    if (!container) return;
    if (state.initialized) { render(); return; }
    injectStyles();
    container.innerHTML = shell();
    state.initialized = true;
    bind();
    renderNorms();
    try {
      const stored = await Storage.getTemplate(PDF.COVER_ID);
      if (stored && stored.bytes) {
        state.template = stored;
        state.templateValidation = await PDF.validateTemplate(stored.bytes);
      }
    } catch (_) { /* IndexedDB opcional */ }
    render();
  }

  root.addEventListener("recon:module", (event) => {
    if (event.detail && event.detail.module === "coding") init().catch((e) => toast(e.message, "error"));
  });

  root.RECONDocumentCoding = Object.freeze({
    init,
    state,
    analyzeAll,
    addDocuments,
    addLds,
    configureCover,
    generateOne,
    exportExcel,
    render,
  });
})(window);
