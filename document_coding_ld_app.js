(function (root) {
  "use strict";

  const doc = root.document;
  const Core = root.RECONDocumentCodingCore;
  const LD = root.RECONDocumentCodingLDCore;
  const Profile = root.RECONN1710Profile;
  if (!doc || !Core || !LD) return;

  let installed = false;
  let observer = null;
  let cache = { signature: "", index: null };

  function api() { return root.RECONDocumentCoding; }
  function state() { return api() && api().state; }
  function text(value) { return value == null ? "" : String(value).trim(); }
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
    root.setTimeout(() => { node.className = "toast"; }, 6500);
  }

  function schemaSignature() {
    const s = state();
    return (s && s.ldFiles || []).map((file) => `${file.filename}:${file.hash || ""}:${file.count || 0}`).join("|");
  }

  function schemaIndex() {
    const s = state();
    if (!s) return LD.buildSchemaIndex([], []);
    const signature = schemaSignature();
    if (cache.index && cache.signature === signature) return cache.index;
    cache = {
      signature,
      index: LD.buildSchemaIndex(s.ldFiles || [], s.ldIndex && s.ldIndex.rows || []),
    };
    return cache.index;
  }

  function qualifyAnalyses() {
    if (!Profile) return;
    const s = state();
    (s && s.documents || []).forEach((item) => {
      if (item.analysis) Profile.qualifyGroupSources(item.analysis);
    });
  }

  function generateForItem(item) {
    if (!item || !item.analysis) return null;
    Profile && Profile.qualifyGroupSources(item.analysis);
    item.ldLine = LD.generateLine(item.analysis, schemaIndex(), item.ldLineEdits || {});
    return item.ldLine;
  }

  function generateAll(selectedOnly) {
    qualifyAnalyses();
    const s = state();
    const items = (s && s.documents || []).filter((item) => !selectedOnly || item.selected);
    let generated = 0;
    items.forEach((item) => {
      if (!item.analysis || !item.analysis.complete) return;
      generateForItem(item);
      generated += 1;
    });
    renderPanel();
    augmentRows();
    toast(`${generated} linha(s) da LD analisada(s).`, "success");
    return items.map((item) => item.ldLine).filter(Boolean);
  }

  async function copyText(value) {
    if (!value) return;
    try {
      await root.navigator.clipboard.writeText(value);
    } catch (_) {
      const area = doc.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      doc.body.appendChild(area);
      area.select();
      doc.execCommand("copy");
      area.remove();
    }
  }

  function readyLines(lines) {
    return (lines || []).filter((line) => line && line.status !== "existing" && line.schema && line.headers.length);
  }

  async function copyGroup(group, withHeader) {
    const lines = readyLines(group.lines);
    if (!lines.length) throw new Error("Este grupo não possui linhas novas para copiar.");
    const blocked = lines.filter((line) => !line.valid);
    if (blocked.length) {
      const ok = root.confirm(`${blocked.length} linha(s) possuem campos marcados como requer confirmação. Deseja copiar mesmo assim?`);
      if (!ok) return;
    }
    await copyText(LD.linesToTsv(lines, withHeader));
    toast(`${lines.length} linha(s) copiadas para colar diretamente no Excel.`, "success");
  }

  function itemById(id) {
    const s = state();
    return (s && s.documents || []).find((item) => item.id === id) || null;
  }

  function lineGroups() {
    const s = state();
    return LD.groupLines((s && s.documents || []).map((item) => item.ldLine).filter(Boolean));
  }

  function locationText(line) {
    if (!line) return "—";
    if (line.status === "existing" && line.existing) return `Já existe na linha ${line.existing.rowNumber}`;
    return line.position && line.position.label || "Requer confirmação";
  }

  function renderLineTable(group) {
    const headers = group.headers || [];
    const rows = group.lines || [];
    return `<div class="coding-ld-table-wrap"><table class="coding-ld-table"><thead><tr><th>Documento</th>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}<th>Situação</th></tr></thead><tbody>${rows.map((line) => {
      const item = (state().documents || []).find((candidate) => candidate.ldLine === line);
      const existing = line.status === "existing";
      return `<tr data-ld-line-item="${escape(item && item.id || "")}"><td><strong>${escape(item && item.file && item.file.name || "")}</strong><small>${escape(locationText(line))}</small></td>${line.values.map((value, index) => {
        const header = headers[index];
        const source = line.sources && line.sources[index];
        const missing = line.missing && line.missing.includes(header);
        return `<td><input class="coding-ld-cell ${missing ? "needs-confirmation" : ""}" data-ld-header="${escape(header)}" value="${escape(value)}" ${existing ? "readonly" : ""} title="${escape(source && source.source || "")}"></td>`;
      }).join("")}<td><span class="coding-pill ${existing ? "coding-neutral" : line.valid ? "coding-ok" : "coding-review"}">${existing ? "Já existente" : line.valid ? "Pronta" : "Requer confirmação"}</span></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function renderPanel() {
    const panel = doc.getElementById("coding-ld-lines-panel");
    if (!panel) return;
    const groups = lineGroups();
    if (!groups.length) {
      panel.innerHTML = `<div class="coding-empty">Depois da análise, use <strong>Gerar Linhas da LD</strong> para identificar LD, aba, localização e conteúdo pronto para Excel.</div>`;
      return;
    }
    panel.innerHTML = groups.map((group, index) => {
      const newCount = group.lines.filter((line) => line.status !== "existing").length;
      const existingCount = group.lines.length - newCount;
      return `<section class="coding-ld-group" data-ld-group="${index}"><div class="coding-ld-group-head"><div><strong>${escape(group.file)}</strong><span>Aba: ${escape(group.sheet)}</span><small>${newCount} nova(s)${existingCount ? ` · ${existingCount} já existente(s)` : ""}</small></div><div class="coding-actions"><button class="secondary-button compact" data-ld-copy="${index}" type="button">Copiar linhas</button><button class="secondary-button compact" data-ld-copy-header="${index}" type="button">Copiar com cabeçalho</button><button class="secondary-button compact" data-ld-export="${index}" type="button">Exportar .xlsx</button></div></div>${renderLineTable(group)}</section>`;
    }).join("");
  }

  function revalidateItem(item) {
    const s = state();
    if (!item || !item.parsed) return;
    const reserved = (s.documents || []).filter((other) => other !== item && other.analysis && other.analysis.familyKey && other.analysis.sequence)
      .map((other) => ({ familyKey: other.analysis.familyKey, sequence: Number(other.analysis.sequence), code: other.analysis.code }));
    item.analysis = Core.analyzeDocument({ filename: item.file.name, text: item.parsed.text, overrides: item.overrides || {} }, s.ldIndex, { reserved });
    Profile && Profile.qualifyGroupSources(item.analysis);
    generateForItem(item);
    if (api() && typeof api().render === "function") api().render();
    renderPanel();
    augmentRows();
  }

  function onCellChange(input) {
    const tr = input.closest("[data-ld-line-item]");
    const item = itemById(tr && tr.dataset.ldLineItem);
    if (!item || !item.ldLine || item.ldLine.status === "existing") return;
    const header = input.dataset.ldHeader;
    item.ldLineEdits = item.ldLineEdits || {};
    item.ldLineEdits[header] = input.value;
    const semantic = LD.semanticForHeader(header);
    if (semantic) {
      item.overrides = Object.assign({}, item.overrides || {}, { [semantic]: input.value.trim() });
      revalidateItem(item);
    } else {
      generateForItem(item);
      renderPanel();
    }
  }

  function safeSheetName(value, used) {
    let base = text(value).replace(/[\\/*?:\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Linhas LD";
    let name = base;
    let n = 2;
    while (used.has(name)) { const suffix = ` ${n++}`; name = `${base.slice(0, 31 - suffix.length)}${suffix}`; }
    used.add(name);
    return name;
  }

  async function exportGroups(groups, filename) {
    if (!root.ExcelJS) throw new Error("ExcelJS não carregado.");
    const workbook = new root.ExcelJS.Workbook();
    const used = new Set();
    (groups || []).forEach((group) => {
      const sheet = workbook.addWorksheet(safeSheetName(`${group.file} ${group.sheet}`, used));
      sheet.addRow(group.headers);
      group.lines.filter((line) => line.status !== "existing").forEach((line) => {
        const row = sheet.addRow(line.values.map((value) => text(value)));
        row.eachCell((cell) => { cell.numFmt = "@"; });
      });
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      group.headers.forEach((_, index) => { sheet.getColumn(index + 1).width = 18; });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename || `RECON_Linhas_LD_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    root.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function injectStyles() {
    if (doc.getElementById("coding-ld-styles")) return;
    const style = doc.createElement("style");
    style.id = "coding-ld-styles";
    style.textContent = `
#coding-ld-lines-panel{margin-top:16px}.coding-ld-group{border:1px solid var(--border,#dfe4ea);border-radius:14px;background:var(--surface,#fff);margin:12px 0;overflow:hidden}.coding-ld-group-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border,#e7ebef)}.coding-ld-group-head strong,.coding-ld-group-head span,.coding-ld-group-head small{display:block}.coding-ld-group-head span,.coding-ld-group-head small{font-size:11px;color:var(--muted,#68737d);margin-top:2px}.coding-ld-table-wrap{overflow:auto;max-height:420px}.coding-ld-table{border-collapse:collapse;min-width:100%;width:max-content}.coding-ld-table th,.coding-ld-table td{border-bottom:1px solid var(--border,#edf0f2);padding:7px;min-width:135px;font-size:11px;vertical-align:top}.coding-ld-table th{position:sticky;top:0;background:var(--surface,#fff);z-index:2}.coding-ld-table td:first-child{min-width:220px;position:sticky;left:0;background:var(--surface,#fff);z-index:1}.coding-ld-table small{display:block;color:var(--muted,#68737d);margin-top:4px}.coding-ld-cell{width:100%;min-width:120px;border:1px solid transparent;background:transparent;color:inherit;padding:5px;border-radius:6px}.coding-ld-cell:hover,.coding-ld-cell:focus{border-color:var(--border,#c8d1da);background:rgba(127,127,127,.04);outline:none}.coding-ld-cell.needs-confirmation{border-color:#d39a19;background:#fff7df}.coding-ld-norms{margin:10px 0}.coding-ld-norms table{width:100%;border-collapse:collapse}.coding-ld-norms td,.coding-ld-norms th{font-size:11px;padding:6px;border-bottom:1px solid var(--border,#eee)}
`;
    doc.head.appendChild(style);
  }

  function injectNormProfile() {
    if (!Profile) return;
    const norms = doc.getElementById("coding-norms");
    if (!norms || norms.querySelector(".coding-ld-norms")) return;
    const section = doc.createElement("div");
    section.className = "coding-ld-norms";
    section.innerHTML = `<h4>N-1710 — partes/revisões efetivamente carregadas</h4><table><thead><tr><th>Parte</th><th>Revisão</th><th>Data</th><th>Arquivo</th></tr></thead><tbody>${Profile.activeParts().map((part) => `<tr><td>${escape(part.label)}</td><td>${escape(part.revision)}</td><td>${escape(part.date)}</td><td>${escape(part.file)}</td></tr>`).join("")}</tbody></table>`;
    norms.appendChild(section);
  }

  function injectControls() {
    const module = doc.getElementById("module-coding");
    if (!module) return false;
    injectStyles();
    const toolbar = module.querySelector(".coding-toolbar");
    if (toolbar && !doc.getElementById("coding-generate-ld-lines")) {
      const generate = doc.createElement("button");
      generate.className = "secondary-button";
      generate.id = "coding-generate-ld-lines";
      generate.type = "button";
      generate.textContent = "Gerar Linhas da LD";
      const exportButton = doc.createElement("button");
      exportButton.className = "secondary-button";
      exportButton.id = "coding-export-ld-lines";
      exportButton.type = "button";
      exportButton.textContent = "Exportar Linhas da LD";
      toolbar.insertBefore(generate, toolbar.querySelector(".coding-progress"));
      toolbar.insertBefore(exportButton, toolbar.querySelector(".coding-progress"));
      generate.addEventListener("click", () => generateAll(true));
      exportButton.addEventListener("click", async () => {
        try {
          if (!lineGroups().length) generateAll(true);
          await exportGroups(lineGroups(), `RECON_Linhas_LD_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (error) { toast(error.message, "error"); }
      });
    }
    const tableWrap = module.querySelector(".coding-table-wrap");
    if (tableWrap && !doc.getElementById("coding-ld-lines-panel")) {
      const panel = doc.createElement("div");
      panel.id = "coding-ld-lines-panel";
      tableWrap.insertAdjacentElement("afterend", panel);
      renderPanel();
    }
    injectNormProfile();
    return true;
  }

  function augmentRows() {
    const s = state();
    if (!s) return;
    doc.querySelectorAll("#coding-table-body [data-coding-id]").forEach((row) => {
      const item = itemById(row.dataset.codingId);
      const actions = row.querySelector(".coding-actions");
      if (!actions || actions.querySelector("[data-action=ld-line]")) return;
      const button = doc.createElement("button");
      button.className = "secondary-button compact";
      button.dataset.action = "ld-line";
      button.type = "button";
      button.textContent = "Linha LD";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!item.analysis || !item.analysis.complete) { toast("Analise e valide a codificação antes de gerar a linha da LD.", "warn"); return; }
        generateForItem(item);
        renderPanel();
        const panel = doc.getElementById("coding-ld-lines-panel");
        panel && panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.insertBefore(button, actions.lastElementChild);
    });
  }

  function bindPanelActions() {
    doc.addEventListener("click", async (event) => {
      const copy = event.target.closest("[data-ld-copy]");
      const copyHeader = event.target.closest("[data-ld-copy-header]");
      const exportButton = event.target.closest("[data-ld-export]");
      const groups = lineGroups();
      try {
        if (copy) await copyGroup(groups[Number(copy.dataset.ldCopy)], false);
        if (copyHeader) await copyGroup(groups[Number(copyHeader.dataset.ldCopyHeader)], true);
        if (exportButton) {
          const group = groups[Number(exportButton.dataset.ldExport)];
          await exportGroups([group], `RECON_Linhas_${text(group.file).replace(/\.[^.]+$/, "")}_${text(group.sheet)}.xlsx`);
        }
      } catch (error) { toast(error.message, "error"); }
    });
    doc.addEventListener("change", (event) => {
      if (event.target.matches("#coding-ld-lines-panel [data-ld-header]")) onCellChange(event.target);
    });
  }

  function install() {
    if (installed) { injectControls(); augmentRows(); return; }
    if (!injectControls()) return;
    installed = true;
    bindPanelActions();
    observer = new MutationObserver(() => { injectControls(); augmentRows(); injectNormProfile(); });
    const module = doc.getElementById("module-coding");
    observer.observe(module, { childList: true, subtree: true });
    augmentRows();
  }

  root.addEventListener("recon:module-ready", (event) => {
    if (event.detail && event.detail.module === "coding") install();
  });
  root.addEventListener("recon:module", (event) => {
    if (event.detail && event.detail.module === "coding") root.setTimeout(install, 0);
  });

  root.RECONDocumentCodingLD = Object.freeze({
    install,
    schemaIndex,
    generateForItem,
    generateAll,
    lineGroups,
    exportGroups,
    renderPanel,
  });
})(window);