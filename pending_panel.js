(function () {
  "use strict";

  const Core = window.RECONPendingCore;
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => Core.text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const state = { open: false, filter: "all", items: [], groups: [] };
  const labels = { error: "Erro", warning: "Alerta", suggestion: "Sugestão" };
  const els = {
    open: $("#recon-pending-open"), badge: $("#recon-pending-badge"), overlay: $("#recon-pending-overlay"), drawer: $("#recon-pending-drawer"), close: $("#recon-pending-close"),
    summary: $("#recon-pending-summary"), list: $("#recon-pending-list"), empty: $("#recon-pending-empty"), filters: [...document.querySelectorAll("[data-pending-risk]")],
  };

  function auditItems() {
    const audit = window.RECONAudits && window.RECONAudits.state;
    if (!audit) return [];
    return [
      ...(audit.databookRows || []).filter((row) => row.issue !== "ok" && row.decision === "pending").map((row) => Core.fromAuditRow("databook", row)),
      ...(audit.titleRows || []).filter((row) => row.issue !== "ok" && row.decision === "pending").map((row) => Core.fromAuditRow("title", row)),
    ];
  }

  function relationItems() {
    const rows = window.RECONRelations && window.RECONRelations.state && window.RECONRelations.state.rows || [];
    return rows.filter((row) => row.found === false || row.ldConflict && row.ldConflict.hasConflict).map((row, index) => ({
      id: `relations:${index}:${Core.text(row.requested || row.document)}`, module: "relations", moduleLabel: "Relações", kind: "relations",
      document: Core.text(row.requested || row.document) || `Linha ${index + 1}`, title: row.found === false ? "Documento não encontrado" : "Conflito na LD",
      reason: Core.text(row.reason) || (row.found === false ? "O documento não foi localizado na LD." : "Existem linhas conflitantes na LD."),
      current: "", proposed: "", origin: "Comparação da relação informada com os documentos da LD.", evidence: Core.text(row.source || row.sheetName) || "Entrada da relação",
      sheet: Core.text(row.sheet) || "—", row: Core.text(row.row || row.rowNumber) || "—", column: "—", columnHeader: "", risk: "error", canApprove: false,
    }));
  }

  function allocationItems() {
    const allocation = window.RECONAllocation && window.RECONAllocation.state;
    const review = window.AllocationCore && window.AllocationCore.REVIEW || "revisar";
    return (allocation && allocation.results || []).filter((row) => row.decision === review).map((row, index) => ({
      id: `allocation:${index}:${Core.text(row.document)}`, module: "allocation", moduleLabel: "Alocação", kind: "allocation", document: Core.text(row.document) || `Item ${index + 1}`,
      title: row.ldConflict && row.ldConflict.hasConflict ? "Conflito na LD" : "Alocação precisa de conferência", reason: Core.text(row.reason) || "Os dados não permitem concluir a alocação.",
      current: "", proposed: "", origin: "Análise dos dados de alocação disponíveis na LD e no controle.", evidence: (row.warnings || []).join(" · ") || Core.text(row.reason),
      sheet: Core.text(row.sheet || row.record && row.record.sheet) || "—", row: Core.text(row.record && row.record.row) || "—", column: "—", columnHeader: "", risk: row.ldConflict ? "error" : "warning", canApprove: false,
    }));
  }

  function renamerItems() {
    const rows = window.RECONRenamer && window.RECONRenamer.state && window.RECONRenamer.state.items || [];
    return rows.filter((row) => row.status === "blocked" || row.needsReview && !row.confirmed).map((row, index) => ({
      id: `renamer:${row.id || index}`, module: "renamer", moduleLabel: "Renomeação", kind: "renamer", document: Core.text(row.originalName) || `PDF ${index + 1}`,
      title: row.status === "blocked" ? "Arquivo com erro" : "Nome precisa de conferência", reason: Core.text(row.error || row.message) || "Confira o número identificado antes de renomear.",
      current: Core.text(row.originalName), proposed: Core.text(row.finalName), origin: "Leitura do PDF e aplicação do padrão de renomeação escolhido.", evidence: row.page ? `PDF · página ${row.page}` : "PDF selecionado",
      sheet: "Não se aplica", row: row.page ? `Página ${row.page}` : "—", column: "—", columnHeader: "", risk: row.status === "blocked" ? "error" : "warning", canApprove: false,
    }));
  }

  function collect() {
    state.items = [...auditItems(), ...relationItems(), ...allocationItems(), ...renamerItems()];
    state.groups = Core.groupItems(state.items);
    return state.items;
  }

  function evidenceMarkup(item) {
    const column = item.columnHeader ? `${item.column} · ${item.columnHeader}` : item.column;
    return `<dl class="pending-evidence"><div><dt>Aba</dt><dd>${escapeHtml(item.sheet || "—")}</dd></div><div><dt>Linha</dt><dd>${escapeHtml(item.row || "—")}</dd></div><div><dt>Coluna</dt><dd>${escapeHtml(column || "—")}</dd></div></dl>`;
  }

  function itemMarkup(item, grouped) {
    return `<article class="pending-item risk-${escapeHtml(item.risk)}">
      <header><span class="pending-risk ${escapeHtml(item.risk)}">${labels[item.risk] || "Alerta"}</span><span class="pending-module">${escapeHtml(item.moduleLabel)}</span></header>
      <h3>${escapeHtml(item.document || "Item sem documento")}</h3><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.reason)}</p>
      ${item.proposed ? `<div class="pending-change"><span><small>Atual</small>${escapeHtml(item.current || "—")}</span><b>→</b><span><small>Sugestão</small>${escapeHtml(item.proposed)}</span></div>` : ""}
      <div class="pending-origin"><span>Origem da sugestão</span><p>${escapeHtml(item.origin)}</p><small>${escapeHtml(item.evidence)}</small></div>
      ${evidenceMarkup(item)}${grouped ? '<span class="pending-identical">Evidência idêntica no grupo</span>' : ""}
    </article>`;
  }

  function render() {
    collect();
    const counts = state.items.reduce((out, item) => { out[item.risk] += 1; return out; }, { error: 0, warning: 0, suggestion: 0 });
    if (els.badge) { els.badge.textContent = String(state.items.length); els.badge.hidden = state.items.length === 0; }
    if (els.summary) els.summary.innerHTML = `<div class="error"><span>Erros</span><strong>${counts.error}</strong></div><div class="warning"><span>Alertas</span><strong>${counts.warning}</strong></div><div class="suggestion"><span>Sugestões</span><strong>${counts.suggestion}</strong></div>`;
    const groups = state.groups.map((group) => ({ ...group, items: group.items.filter((item) => state.filter === "all" || item.risk === state.filter) })).filter((group) => group.items.length);
    if (els.list) els.list.innerHTML = groups.map((group) => `<section class="pending-group ${group.canGroupApprove && group.items.length > 1 ? "groupable" : ""}">
      ${group.canGroupApprove && group.items.length > 1 ? `<div class="pending-group-head"><div><strong>${group.items.length} sugestões com evidência idêntica</strong><span>A aprovação será aplicada somente a este grupo.</span></div><button data-approve-signature="${escapeHtml(group.signature)}" type="button">Aprovar grupo</button></div>` : ""}
      <div class="pending-group-items">${group.items.map((item) => itemMarkup(item, group.canGroupApprove && group.items.length > 1)).join("")}</div>
    </section>`).join("");
    if (els.empty) els.empty.hidden = groups.length > 0;
  }

  function open() { state.open = true; render(); els.overlay.hidden = false; els.drawer.hidden = false; els.drawer.setAttribute("aria-hidden", "false"); document.body.classList.add("pending-panel-open"); window.setTimeout(() => els.close.focus(), 0); }
  function close() { state.open = false; els.overlay.hidden = true; els.drawer.hidden = true; els.drawer.setAttribute("aria-hidden", "true"); document.body.classList.remove("pending-panel-open"); els.open.focus(); }

  async function approveGroup(signature) {
    const group = state.groups.find((candidate) => candidate.signature === signature);
    if (!group || !Core.verifyIdentical(group.items, signature)) return;
    const module = group.items[0].module;
    if (!group.items.every((item) => item.module === module)) return;
    const approved = window.RECONAudits && window.RECONAudits.approveEvidenceGroup && window.RECONAudits.approveEvidenceGroup(module === "databook" ? "databook" : "title", group.items.map((item) => item.sourceId), signature);
    if (approved) render();
  }

  els.open.addEventListener("click", open); els.close.addEventListener("click", close); els.overlay.addEventListener("click", close);
  els.filters.forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.pendingRisk || "all"; els.filters.forEach((candidate) => { const active = candidate === button; candidate.classList.toggle("active", active); candidate.setAttribute("aria-pressed", String(active)); }); render(); }));
  els.list.addEventListener("click", (event) => { const button = event.target.closest("[data-approve-signature]"); if (button) approveGroup(button.dataset.approveSignature); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.open) close(); });
  ["recon:ui-update", "recon:ld-ready", "recon:ld-cleared"].forEach((name) => window.addEventListener(name, () => { if (state.open) render(); else { collect(); if (els.badge) { els.badge.textContent = String(state.items.length); els.badge.hidden = state.items.length === 0; } } }));
  render();
  window.RECONPendingPanel = { state, collect, render, open, close };
})();
