(function (root) {
  "use strict";

  const doc = root.document;
  const CV = root.RECONDocumentCodingCV;
  const Profile = root.RECONDocumentCodingCVProfile;
  if (!doc || !CV || !Profile) return;

  let installed = false;
  let apiRef = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function toast(message, tone) {
    const node = doc.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 5000);
  }

  function injectStyles() {
    if (doc.getElementById("document-coding-cv-styles")) return;
    const style = doc.createElement("style");
    style.id = "document-coding-cv-styles";
    style.textContent = `
#coding-cv-compliance{margin:18px 0 4px;border:1px solid var(--border,#dfe4ea);border-radius:14px;overflow:hidden;background:var(--surface,#fff)}
#coding-cv-compliance .cv-head{padding:14px;border-bottom:1px solid var(--border,#e7ebef);background:rgba(14,97,162,.04)}
#coding-cv-compliance .cv-head h4{margin:2px 0 5px;font-size:15px}#coding-cv-compliance .cv-head p{margin:0;color:var(--muted,#68737d);font-size:11px;line-height:1.45}
#coding-cv-compliance .cv-toolbar{display:flex;gap:8px;align-items:end;flex-wrap:wrap;padding:12px;border-bottom:1px solid var(--border,#e7ebef)}
#coding-cv-compliance .cv-toolbar label{flex:1;min-width:260px;font-size:11px;color:var(--muted,#68737d)}#coding-cv-compliance select{width:100%;margin-top:4px;padding:8px;border:1px solid var(--border,#ccd4dc);border-radius:8px;background:var(--surface,#fff);color:inherit}
#coding-cv-compliance .cv-status{margin:12px;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:800}.cv-status.ok{background:#def6e7;color:#136a38}.cv-status.review{background:#fff1c8;color:#755200}.cv-status.error{background:#ffe2e0;color:#8d241e}
#coding-cv-compliance .cv-meta{padding:0 12px 10px;font-size:11px;color:var(--muted,#68737d)}
#coding-cv-compliance table{width:100%;border-collapse:collapse}#coding-cv-compliance th,#coding-cv-compliance td{padding:8px 10px;border-top:1px solid var(--border,#edf0f3);font-size:11px;vertical-align:top;text-align:left}#coding-cv-compliance th{font-size:10px;text-transform:uppercase;letter-spacing:.04em}
#coding-cv-compliance .cv-state{font-weight:800;white-space:nowrap}.cv-state.met,.cv-state.evidence,.cv-state.declared{color:#166534}.cv-state.missing,.cv-state.missing-evidence{color:#9a3412}.cv-state.manual-review,.cv-state.external,.cv-state.declaration,.cv-state.process,.cv-state.review{color:#8a5d00}
#coding-cv-compliance .cv-candidates{padding:0 12px 12px;font-size:11px;color:var(--muted,#68737d)}#coding-cv-compliance .cv-note{padding:12px;border-top:1px solid var(--border,#e7ebef);font-size:11px;line-height:1.5;background:rgba(181,121,0,.05)}
`;
    doc.head.appendChild(style);
  }

  function activeItem() {
    const api = apiRef || root.RECONDocumentCoding;
    if (!api || !api.state || !api.state.activeId) return null;
    return (api.state.documents || []).find((item) => item.id === api.state.activeId) || null;
  }

  function refresh(item) {
    if (!item || !item.analysis || item.analysis.ruleId !== "et-cv") return null;
    const roleId = item.overrides && item.overrides.cvRole || "";
    const evaluation = CV.evaluate(item.parsed && item.parsed.text || "", { roleId });
    item.analysis.cvCompliance = evaluation;
    item.analysis.cvProfile = Profile.SOURCE.id;
    return evaluation;
  }

  function statusLabel(value) {
    return {
      met: "OK",
      evidence: "EVIDÊNCIA NO ARQUIVO",
      declared: "DECLARADO NO CV",
      missing: "LACUNA",
      "missing-evidence": "COMPROVAÇÃO PENDENTE",
      "manual-review": "CONFERÊNCIA MANUAL",
      external: "VALIDAÇÃO PETROBRAS",
      declaration: "CONFIRMAR NA MOBILIZAÇÃO",
      process: "REGRA DE PROCESSO",
      review: "REVISAR",
    }[value] || String(value || "").toUpperCase();
  }

  function roleOptions(selected) {
    const groups = new Map();
    CV.roleOptions().forEach((role) => {
      if (!groups.has(role.group)) groups.set(role.group, []);
      groups.get(role.group).push(role);
    });
    let html = `<option value="">— Selecionar / confirmar função —</option>`;
    groups.forEach((roles, group) => {
      html += `<optgroup label="${esc(group || "Outros")}">`;
      roles.forEach((role) => { html += `<option value="${esc(role.id)}" ${selected === role.id ? "selected" : ""}>${esc(role.title)} · item ${esc(role.item)}</option>`; });
      html += `</optgroup>`;
    });
    return html;
  }

  function renderActive() {
    const body = doc.getElementById("coding-drawer-body");
    if (!body) return;
    const previous = doc.getElementById("coding-cv-compliance");
    if (previous) previous.remove();
    const item = activeItem();
    if (!item || !item.analysis || item.analysis.ruleId !== "et-cv") return;
    const evaluation = refresh(item);
    if (!evaluation) return;
    const selectedRole = item.overrides && item.overrides.cvRole || evaluation.role && evaluation.role.id || "";
    const role = evaluation.role;
    const rows = (evaluation.criteria || []).map((criterion) => `<tr><td><span class="cv-state ${esc(criterion.status)}">${esc(statusLabel(criterion.status))}</span></td><td><strong>${esc(criterion.label)}</strong><br><small>${esc(criterion.detail)}</small>${criterion.evidence ? `<br><small><strong>Evidência:</strong> ${esc(criterion.evidence)}</small>` : ""}</td><td>${esc(criterion.sourceItem)}</td></tr>`).join("");
    const candidates = !role && evaluation.roleCandidates && evaluation.roleCandidates.length
      ? `<div class="cv-candidates"><strong>Funções candidatas detectadas:</strong> ${evaluation.roleCandidates.map((candidate) => `${esc(candidate.role.title)} (${Math.round(candidate.score)})`).join(" · ")}. Confirme a função para aplicar os critérios corretos.</div>` : "";
    const supplements = (evaluation.supplementalSources || []).map((source) => `${source.id} Rev. ${source.revision} — ${source.scope}`).join("; ");
    const section = doc.createElement("section");
    section.id = "coding-cv-compliance";
    section.innerHTML = `
      <div class="cv-head"><small>VALIDAÇÃO CONTRATUAL DE CURRÍCULO</small><h4>${esc(Profile.SOURCE.id)} Rev. ${esc(Profile.SOURCE.revision)} — RNEST/T2</h4><p>O Apêndice C é tratado como perfil contratual específico. O RECON não inventa formação, tempo de experiência, certificação, conselho ou projeto não demonstrado.</p></div>
      <div class="cv-toolbar"><label>Função contratual<select id="coding-cv-role">${roleOptions(selectedRole)}</select></label><button class="secondary-button compact" id="coding-cv-copy-template" type="button">Copiar estrutura de CV conforme 10C</button></div>
      <div class="cv-status ${esc(evaluation.status.severity)}">${esc(evaluation.status.label)}</div>
      <div class="cv-meta"><strong>Função avaliada:</strong> ${esc(role ? role.title : "não confirmada")} ${role ? `· item ${esc(role.item)}` : ""}<br><strong>Experiência detectável no texto:</strong> ${esc(evaluation.claimedExperienceYears || 0)} ano(s) — valor indicativo, sujeito à CTPS e aos vínculos/projetos.<br>${supplements ? `<strong>Fontes complementares aplicáveis:</strong> ${esc(supplements)}` : ""}</div>
      ${candidates}
      <table><thead><tr><th>Situação</th><th>Critério</th><th>Fonte 10C</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="cv-note"><strong>Importante:</strong> ${esc(evaluation.disclaimer)} A ausência de evidência não é preenchida automaticamente. Qualquer flexibilização permanece sujeita à aprovação exclusiva da Fiscalização PETROBRAS.</div>`;
    body.appendChild(section);
  }

  async function copyText(value) {
    try { await root.navigator.clipboard.writeText(value); }
    catch (_) {
      const area = doc.createElement("textarea"); area.value = value; doc.body.appendChild(area); area.select(); doc.execCommand("copy"); area.remove();
    }
  }

  function install(api) {
    apiRef = api || root.RECONDocumentCoding;
    injectStyles();
    if (installed) return;
    installed = true;

    doc.addEventListener("click", (event) => {
      const action = event.target && event.target.closest && event.target.closest("[data-action]");
      if (action && (action.dataset.action === "details" || action.dataset.action === "edit") && action.closest("#module-coding")) root.setTimeout(renderActive, 0);
      const copy = event.target && event.target.closest && event.target.closest("#coding-cv-copy-template");
      if (copy) {
        const item = activeItem();
        if (!item) return;
        const evaluation = refresh(item);
        copyText(CV.draft(item.parsed && item.parsed.text || "", evaluation)).then(() => toast("Estrutura de CV conforme o Apêndice C copiada.", "success")).catch((error) => toast(error.message, "error"));
      }
    });

    doc.addEventListener("change", (event) => {
      if (!event.target || event.target.id !== "coding-cv-role") return;
      const item = activeItem();
      if (!item) return;
      item.overrides = Object.assign({}, item.overrides || {}, { cvRole: event.target.value || "" });
      refresh(item);
      renderActive();
    });

    root.addEventListener("recon:ui-update", (event) => {
      if (event.detail && event.detail.module === "coding") root.setTimeout(renderActive, 0);
    });
  }

  root.RECONDocumentCodingCVApp = Object.freeze({ install, renderActive, refresh });
})(window);
