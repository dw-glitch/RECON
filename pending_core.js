(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONPendingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return String(value === null || value === undefined ? "" : value).trim(); }
  function normalized(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase(); }
  function columnLetter(value) {
    let number = Number(value) || 0;
    let result = "";
    while (number > 0) { number -= 1; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
    return result;
  }

  function riskFor(row) {
    const classification = text(row && row.classification);
    if (row && (row.risk === "error" || row.risk === "warning" || row.risk === "suggestion")) return row.risk;
    if (classification === "confirmed_error" || row && (row.ldConflict || row.issue === "conflict" || row.status === "blocked")) return "error";
    if (classification === "suggestion" && row && row.proposed) return "suggestion";
    return "warning";
  }

  function originFor(kind, row) {
    const evidence = normalized(row && row.evidence);
    if (kind === "databook") {
      if (evidence.includes("BASE DATABOOK")) return "Comparação com a base de caminhos Databook.";
      if (row && row.relatedDocuments && row.relatedDocuments.length) return "Histórico de documentos compatíveis localizado na LD.";
      if (row && row.proposed) return "Referência compatível encontrada no histórico documental.";
      return "Conferência do caminho atual com a LD e as referências disponíveis.";
    }
    if (kind === "title") {
      if (row && row.tagEvidence && row.tagEvidence.confirmed) return `TAG confirmada em: ${text(row.tagEvidence.source) || "LD"}.`;
      if (evidence.includes("BASE") || evidence.includes("REFERENCIA")) return "Comparação com a base de títulos e descrições.";
      return "Conferência do título, descrição e identificadores presentes na LD.";
    }
    return text(row && row.origin) || "Resultado produzido pelos dados informados no módulo.";
  }

  function evidenceSignature(item) {
    const source = item || {};
    return JSON.stringify([
      normalized(source.module), normalized(source.kind), normalized(source.current), normalized(source.proposed),
      normalized(source.origin), normalized(source.evidence), normalized(source.reason), normalized(source.confidence),
    ]);
  }

  function fromAuditRow(kind, row) {
    const module = kind === "databook" ? "databook" : "titles";
    const item = {
      id: `${module}:${text(row && row.id)}`,
      sourceId: text(row && row.id),
      module,
      moduleLabel: kind === "databook" ? "Caminho Databook" : "Revisão de títulos",
      kind,
      document: text(row && row.document),
      title: text(row && row.userMessage && row.userMessage.title) || text(row && row.reason) || "Conferir sugestão",
      reason: text(row && row.userMessage && row.userMessage.explanation) || text(row && row.reason),
      current: text(row && row.current),
      proposed: text(row && row.proposed),
      confidence: text(row && row.confidence),
      origin: originFor(kind, row),
      evidence: text(row && row.evidence) || text(row && row.reason),
      sheet: text(row && row.sheet) || "—",
      row: text(row && row.row) || "—",
      column: text(row && row.columnLetter) || columnLetter(row && row.column) || "—",
      columnHeader: text(row && row.columnHeader),
      risk: riskFor(row),
      canApprove: Boolean(row && row.proposed && !(row.ldConflict && row.ldConflict.hasConflict)),
    };
    item.signature = evidenceSignature(item);
    return item;
  }

  function groupItems(items) {
    const groups = [];
    const bySignature = new Map();
    (items || []).forEach((item) => {
      if (!item.canApprove) { groups.push({ id: `single:${item.id}`, signature: "", items: [item], canGroupApprove: false }); return; }
      const signature = item.signature || evidenceSignature(item);
      if (!bySignature.has(signature)) {
        const group = { id: `evidence:${bySignature.size + 1}`, signature, items: [], canGroupApprove: false };
        bySignature.set(signature, group); groups.push(group);
      }
      bySignature.get(signature).items.push(item);
    });
    groups.forEach((group) => { group.canGroupApprove = Boolean(group.signature && group.items.length > 1 && group.items.every((item) => item.canApprove && (item.signature || evidenceSignature(item)) === group.signature)); });
    return groups;
  }

  function verifyIdentical(items, signature) {
    return Boolean(signature && Array.isArray(items) && items.length > 1 && items.every((item) => item.canApprove && evidenceSignature(item) === signature));
  }

  return { text, normalized, columnLetter, riskFor, originFor, evidenceSignature, fromAuditRow, groupItems, verifyIdentical };
});
