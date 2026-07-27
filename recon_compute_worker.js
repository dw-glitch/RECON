"use strict";
self.window = self;
importScripts(
  "recon_contracts.js", "core.js", "ld_conflicts.js", "allocation_confirmation_sources.js",
  "allocation_core.js", "databook_allocation_sources.js", "non_tagged_title_rules.js",
  "audit_core.js", "timeline_core.js", "relations_core.js", "tag_conference_core.js"
);

function respond(id, result) { self.postMessage({ id, result }); }
function fail(id, error) { self.postMessage({ id, error: String(error && error.message || error || "Falha no processamento") }); }

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "audit-titles") return respond(id, self.RECONAuditCore.auditTitles(payload.index, payload.references, payload.options || null));
    if (type === "audit-databook") return respond(id, self.RECONAuditCore.auditDatabook(payload.index, payload.catalog || [], payload.sourceIndex || null));
    if (type === "allocation-analyze") return respond(id, self.AllocationCore.analyze(payload.entries || [], payload.records || [], payload.control || null, payload.options || {}));
    if (type === "relations-catalog") return respond(id, self.CorporateRelationsCore.rowsFromIndex(payload.index || null, payload.options || {}));
    if (type === "relations-filter") return respond(id, self.CorporateRelationsCore.filterRows(payload.rows || [], payload.filters || {}));
    if (type === "relations-resolve") return respond(id, self.CorporateRelationsCore.resolveEntries(payload.entries || [], payload.index || null, payload.options || {}));
    if (type === "tag-analyze") return respond(id, self.RECONTagConferenceCore.analyze(payload.values || [], payload.index || null));
    throw new Error(`Operação desconhecida: ${type}`);
  } catch (error) { fail(id, error); }
};
