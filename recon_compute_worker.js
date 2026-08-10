"use strict";
self.window = self;

// Uma falha aqui é de infraestrutura (arquivo ausente, rede caída): o cliente
// precisa saber disso para repetir o cálculo na thread principal.
let bootError = null;
try {
  importScripts(
    "recon_contracts.js", "core.js", "ld_conflicts.js", "allocation_confirmation_sources.js",
    "allocation_core.js", "databook_allocation_sources.js", "non_tagged_title_rules.js",
    // A TABELA 13 da ET precisa existir dentro do Worker: é lá que auditTitles
    // roda, e sem ela o título normativo não entraria no resultado.
    "et_report_titles.js",
    "audit_core.js", "timeline_core.js", "relations_core.js", "tag_conference_core.js"
  );
} catch (error) {
  bootError = String(error && error.message || error || "Falha ao carregar os módulos de análise");
}

const REQUIRED = {
  "audit-titles": ["RECONAuditCore"],
  "audit-databook": ["RECONAuditCore"],
  "allocation-analyze": ["AllocationCore"],
  "relations-catalog": ["CorporateRelationsCore"],
  "relations-filter": ["CorporateRelationsCore"],
  "relations-resolve": ["CorporateRelationsCore"],
  "tag-analyze": ["RECONTagConferenceCore"],
};

function respond(id, result) { self.postMessage({ id, result }); }

// `infrastructure: true` = o Worker não conseguiu se montar; vale tentar de novo
// fora dele. Sem a marca, o erro é de regra de negócio e repetir não adianta.
function fail(id, error, infrastructure) {
  self.postMessage({
    id,
    error: String(error && error.message || error || "Falha no processamento"),
    infrastructure: Boolean(infrastructure),
  });
}

function missingGlobals(type) {
  return (REQUIRED[type] || []).filter((name) => self[name] == null);
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};

  if (bootError) { fail(id, bootError, true); return; }

  const missing = missingGlobals(type);
  if (missing.length) {
    fail(id, `Componente(s) de análise ausente(s) no Worker: ${missing.join(", ")}.`, true);
    return;
  }

  try {
    if (type === "audit-titles") return respond(id, self.RECONAuditCore.auditTitles(payload.index, payload.references, payload.options || null));
    if (type === "audit-databook") return respond(id, self.RECONAuditCore.auditDatabook(payload.index, payload.catalog || [], payload.sourceIndex || null));
    if (type === "allocation-analyze") return respond(id, self.AllocationCore.analyze(payload.entries || [], payload.records || [], payload.control || null, payload.options || {}));
    if (type === "relations-catalog") return respond(id, self.CorporateRelationsCore.rowsFromIndex(payload.index || null, payload.options || {}));
    if (type === "relations-filter") return respond(id, self.CorporateRelationsCore.filterRows(payload.rows || [], payload.filters || {}));
    if (type === "relations-resolve") return respond(id, self.CorporateRelationsCore.resolveEntries(payload.entries || [], payload.index || null, payload.options || {}));
    if (type === "tag-analyze") return respond(id, self.RECONTagConferenceCore.analyze(payload.values || [], payload.index || null));
    throw new Error(`Operação desconhecida: ${type}`);
  } catch (error) { fail(id, error, false); }
};
