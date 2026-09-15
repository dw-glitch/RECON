(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONN1710Profile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Perfil normativo construído a partir do conjunto fornecido para o módulo.
  // A N-1710 possui revisões independentes por parte/anexo; portanto não é
  // correto rotular todos os anexos simplesmente como "Rev. N".
  const PARTS = Object.freeze({
    text: Object.freeze({ id: "N-1710", label: "Texto", revision: "N", date: "2020-04", file: "N-1710(8).pdf", status: "active" }),
    A: Object.freeze({ id: "N-1710-A", label: "Anexo A — Categoria dos Documentos", revision: "W", date: "2023-10", file: "ANEXO A(9).pdf", status: "active" }),
    B: Object.freeze({ id: "N-1710-B", label: "Anexo B — Identificação das Instalações", revision: "CJ", date: "2025-04", file: "ANEXO B(9).pdf", status: "active" }),
    C: Object.freeze({ id: "N-1710-C", label: "Anexo C — Área de Atividade", revision: "BF", date: "2024-12", file: "ANEXO C(9).pdf", status: "active" }),
    D: Object.freeze({ id: "N-1710-D", label: "Anexo D — Classes de Serviço", revision: "BG", date: "2025-04", file: "ANEXO D(8).pdf", status: "active" }),
    E: Object.freeze({ id: "N-1710-E", label: "Anexo E — Área de Atividade (frota TRANSPETRO)", revision: "D", date: "2010-03", file: "ANEXO E(9).pdf", status: "active" }),
    F: Object.freeze({ id: "N-1710-F", label: "Anexo F — Classes de Serviço (frota TRANSPETRO)", revision: "G", date: "2014-10", file: "ANEXO F(9).pdf", status: "active" }),
    G: Object.freeze({ id: "N-1710-G", label: "Anexo G — Índice de Revisões", revision: "CN", date: "2025-04", file: "ANEXO G(9).pdf", status: "active" }),
  });

  const STRUCTURE = Object.freeze({
    language: { part: "text", section: "6.1", label: "Grupo 0 — Idioma" },
    category: { part: "A", section: "6.2", label: "Grupo 1 — Categoria" },
    installation: { part: "B", section: "6.3", label: "Grupo 2 — Instalação" },
    activityArea: { part: "C", alternatePart: "E", section: "6.4", label: "Grupo 3 — Área de atividade" },
    serviceClass: { part: "D", alternatePart: "F", section: "6.5", label: "Grupo 4 — Classe de serviço" },
    origin: { part: "text", section: "6.6", label: "Grupo 5 — Origem" },
    sequence: { part: "text", section: "6.7", label: "Grupo 6 — Sequencial" },
  });

  function sourceForPart(part, section) {
    const info = PARTS[part];
    if (!info) return "PETROBRAS N-1710 — fonte não identificada";
    return `PETROBRAS N-1710 ${info.label}, Rev. ${info.revision} (${info.date})${section ? `, item ${section}` : ""}`;
  }

  function sourceForGroup(group, options) {
    const spec = STRUCTURE[group];
    if (!spec) return sourceForPart("text");
    const opts = options || {};
    const part = opts.transpetroFleet && spec.alternatePart ? spec.alternatePart : spec.part;
    return sourceForPart(part, spec.section);
  }

  function isTranspetroFleetInstallation(installation) {
    return /^48/i.test(String(installation || "").trim());
  }

  function qualifyGroupSources(analysis) {
    if (!analysis || !Array.isArray(analysis.groups)) return analysis;
    const installation = analysis.data && analysis.data.installation || "";
    const fleet = isTranspetroFleetInstallation(installation);
    analysis.groups.forEach((group) => {
      if (!group || !group.field) return;
      if (STRUCTURE[group.field]) group.source = sourceForGroup(group.field, { transpetroFleet: fleet });
    });
    return analysis;
  }

  function activeParts() {
    return Object.values(PARTS).map((item) => Object.assign({}, item));
  }

  function summary() {
    return activeParts().map((item) => `${item.label}: Rev. ${item.revision} (${item.date})`).join(" · ");
  }

  return Object.freeze({
    PARTS,
    STRUCTURE,
    sourceForPart,
    sourceForGroup,
    isTranspetroFleetInstallation,
    qualifyGroupSources,
    activeParts,
    summary,
  });
});