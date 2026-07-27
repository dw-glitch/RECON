(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const T = root.TimelineCore || (typeof module === "object" && module.exports ? require("./timeline_core.js") : null);
  const F = root.LDConflictCore || (typeof module === "object" && module.exports ? require("./ld_conflicts.js") : null);
  const api = factory(C, T, F);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CorporateRelationsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, T, F) {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function timestamp(item) {
    return Math.max(
      C.parseDate(item && item.modified)?.getTime() || 0,
      C.parseDate(item && item.included)?.getTime() || 0,
      C.parseDate(item && item.effectiveDate)?.getTime() || 0,
      Number(item && item.sourceTimestamp) || 0,
      Number(item && item.row) || 0,
    );
  }

  function ordered(items) {
    return [...(items || [])].sort((left, right) => {
      const revision = C.revisionRank(right.revision) - C.revisionRank(left.revision);
      return revision || timestamp(right) - timestamp(left) || (Number(right.row) || 0) - (Number(left.row) || 0);
    });
  }

  function latest(items) {
    return ordered(items)[0] || null;
  }

  function uniqueValues(items, field) {
    const values = [];
    const seen = new Set();
    ordered(items).forEach((item) => {
      const value = text(item && item[field]);
      const key = C.norm(value);
      if (!value || seen.has(key)) return;
      seen.add(key);
      values.push(value);
    });
    return values;
  }

  function firstValue(items, field) {
    return uniqueValues(items, field)[0] || "";
  }

  function buildLdValues(items) {
    const values = new Map();
    ordered(items).forEach((item) => {
      (item && item.ldColumns || []).forEach((column) => {
        const header = text(column.header).replace(/\s+/g, " ");
        const value = text(column.value);
        const key = C.norm(header);
        if (header && value && !values.has(key)) values.set(key, { header, value });
      });
    });
    return values;
  }

  function allocationState(record, allocation) {
    const explicit = text(record && record.allocationStatus);
    if (explicit) return explicit;
    return text(allocation) ? "Alocado" : "Não informado";
  }

  function buildConsensusLdValues(items) {
    const grouped = new Map();
    (items || []).forEach((item) => (item && item.ldColumns || []).forEach((column) => {
      const header = text(column.header).replace(/\s+/g, " ");
      const value = text(column.value);
      const key = C.norm(header);
      if (!header || !value) return;
      if (!grouped.has(key)) grouped.set(key, { header, values: new Map() });
      grouped.get(key).values.set(C.norm(value), value);
    }));
    const result = new Map();
    grouped.forEach((entry, key) => {
      if (entry.values.size === 1) result.set(key, { header: entry.header, value: [...entry.values.values()][0] });
    });
    return result;
  }

  function conflictRow(match, options, conflict) {
    const group = match.group || { records: [], history: [] };
    const all = [...(group.records || []), ...(group.history || [])];
    const sheetValues = [...new Set(conflict.candidates.map((candidate) => candidate.sheet).filter(Boolean))];
    const title = F.consensusValue(group, "title");
    const databook = F.consensusValue(group, "databook");
    const allocation = F.consensusValue(group, "allocation");
    return {
      found: true,
      requested: text(options && options.requested) || match.document,
      document: match.document,
      documentKey: match.documentKey,
      sheet: sheetValues.length === 1 ? sheetValues[0] : "Várias abas",
      title,
      currentRevision: F.consensusValue(group, "revision"),
      nextRevision: "",
      sigemStatus: F.consensusValue(group, "status") || "Conflito na LD",
      nextStatus: "",
      technicalStatus: "",
      grdt: F.consensusValue(group, "grdt"),
      effectiveDate: F.consensusValue(group, "effectiveDate"),
      allocationStatus: F.consensusValue(group, "allocationStatus"),
      allocation,
      allocationStage: "",
      databook,
      fiscalComment: "",
      purpose: "",
      discipline: "",
      documentType: "",
      format: "",
      ldVersion: firstValue(all, "ldVersion"),
      source: conflict.candidates.map((candidate) => candidate.label).join(" · "),
      reason: `Conflito na LD. ${conflict.summary} Nenhuma linha foi escolhida automaticamente.`,
      conflictLd: `SIM — ${conflict.fields.join(", ")}`,
      ldConflict: conflict,
      timeline: null,
      ldValues: buildConsensusLdValues(all),
      databookLevels: text(databook).split("|").map((item) => item.trim()).filter(Boolean),
    };
  }

  function matchToRow(match, index, options) {
    const group = match.group || { records: [], history: [] };
    const conflict = F && F.analyzeGroup ? F.analyzeGroup(group, options) : null;
    if (conflict && conflict.hasConflict) return conflictRow(match, options, conflict);
    const records = group.records || [];
    const history = group.history || [];
    const all = [...records, ...history];
    const technical = latest(records) || latest(history) || {};
    const timeline = T && T.buildTimeline ? T.buildTimeline(match, index, {
      recentDays: Math.max(1, Number(options && options.recentDays) || 30),
      now: options && options.now || new Date(),
    }) : null;
    const currentStep = timeline && (timeline.revisions || []).find((item) => item.latest)
      || timeline && (timeline.revisions || []).filter((item) => !item.predicted).at(-1)
      || null;
    const targetStep = timeline && (timeline.revisions || []).find((item) => item.target) || null;
    const allocation = uniqueValues(all, "allocation").join(" · ");
    const databook = firstValue(records, "databook") || firstValue(all, "databook");
    return {
      found: true,
      requested: text(options && options.requested) || match.document,
      document: technical.document || match.document,
      documentKey: match.documentKey,
      sheet: technical.sheet || timeline && timeline.sheet || C.inferSheetFromName(`${match.document}.pdf`),
      title: technical.title || timeline && timeline.title || firstValue(all, "title"),
      currentRevision: timeline && timeline.latestRevision || C.normalizeRevision(technical.revision),
      nextRevision: timeline && timeline.targetRevision || C.normalizeRevision(technical.revision),
      sigemStatus: currentStep && currentStep.status || technical.sigemStatus || technical.status || "Não informado",
      nextStatus: targetStep && targetStep.status || timeline && timeline.targetStatus || "Não informado",
      technicalStatus: technical.status || "",
      grdt: uniqueValues(all, "grdt").join(" · "),
      effectiveDate: firstValue(all, "effectiveDate"),
      allocationStatus: allocationState(technical, allocation),
      allocation,
      allocationStage: firstValue(records, "allocationStage") || firstValue(all, "allocationStage"),
      databook,
      fiscalComment: uniqueValues(all, "fiscalComment").join(" · "),
      purpose: firstValue(records, "purpose") || firstValue(all, "purpose"),
      discipline: firstValue(records, "discipline"),
      documentType: firstValue(records, "documentType"),
      format: firstValue(records, "format"),
      ldVersion: technical.ldVersion || firstValue(all, "ldVersion"),
      source: `${technical.sheet || "LD"}${technical.row ? ` · linha ${technical.row}` : ""}`,
      reason: "",
      conflictLd: "NÃO",
      ldConflict: null,
      timeline,
      ldValues: buildLdValues(all),
      databookLevels: text(databook).split("|").map((item) => item.trim()).filter(Boolean),
    };
  }

  function statusAtRevision(items, revision, fallback) {
    const sameRevision = (items || []).filter((item) => C.normalizeRevision(item && item.revision) === revision);
    if (!sameRevision.length) return text(fallback) || "Não informado";
    const raw = sameRevision.map((item) => text(item && (item.sigemStatus || item.status)));
    if (raw.some((value) => !value)) return "Status vazio na Colar SIGEM";
    const values = [...new Map(raw.map((value) => [C.norm(value), value])).values()];
    if (values.length > 1) return "Conflito na Colar SIGEM";
    return values[0] || text(fallback) || "Não informado";
  }

  function matchToRowFast(match, options) {
    const group = match.group || { records: [], history: [] };
    const conflict = F && F.analyzeGroup ? F.analyzeGroup(group, options) : null;
    if (conflict && conflict.hasConflict) return conflictRow(match, options, conflict);
    const records = group.records || [];
    const history = group.history || [];
    const all = [...records, ...history];
    const technical = latest(records) || latest(history) || {};
    const latestItem = latest(all) || technical;
    const currentRevision = C.normalizeRevision(latestItem.revision || technical.revision);
    const sigemStatus = statusAtRevision(history, currentRevision, latestItem.sigemStatus || latestItem.status || technical.sigemStatus || technical.status);
    const kind = C.statusKind(sigemStatus);
    const nextRevision = kind === "advance" ? C.nextRevision(currentRevision) || currentRevision : currentRevision;
    const nextStatus = nextRevision !== currentRevision ? statusAtRevision(history, nextRevision, "Não Postado") : sigemStatus;
    const allocation = uniqueValues(all, "allocation").join(" · ");
    const databook = firstValue(records, "databook") || firstValue(all, "databook");
    return {
      found: true,
      requested: text(options && options.requested) || match.document,
      document: technical.document || match.document,
      documentKey: match.documentKey,
      sheet: technical.sheet || C.inferSheetFromName(`${match.document}.pdf`),
      title: technical.title || firstValue(all, "title"),
      currentRevision,
      nextRevision,
      sigemStatus,
      nextStatus,
      technicalStatus: technical.status || "",
      grdt: uniqueValues(all, "grdt").join(" · "),
      effectiveDate: firstValue(all, "effectiveDate"),
      allocationStatus: allocationState(technical, allocation),
      allocation,
      allocationStage: firstValue(records, "allocationStage") || firstValue(all, "allocationStage"),
      databook,
      fiscalComment: uniqueValues(all, "fiscalComment").join(" · "),
      purpose: firstValue(records, "purpose") || firstValue(all, "purpose"),
      discipline: firstValue(records, "discipline"),
      documentType: firstValue(records, "documentType"),
      format: firstValue(records, "format"),
      ldVersion: technical.ldVersion || firstValue(all, "ldVersion"),
      source: `${technical.sheet || "LD"}${technical.row ? ` · linha ${technical.row}` : ""}`,
      reason: "",
      conflictLd: "NÃO",
      ldConflict: null,
      timeline: null,
      ldValues: buildLdValues(all),
      databookLevels: text(databook).split("|").map((item) => item.trim()).filter(Boolean),
    };
  }

  function missingRow(requested, reason, source) {
    return {
      found: false,
      requested: text(requested),
      document: "",
      documentKey: "",
      sheet: "",
      title: "",
      currentRevision: "",
      nextRevision: "",
      sigemStatus: "",
      nextStatus: "",
      technicalStatus: "",
      grdt: "",
      effectiveDate: "",
      allocationStatus: "",
      allocation: "",
      allocationStage: "",
      databook: "",
      fiscalComment: "",
      purpose: "",
      discipline: "",
      documentType: "",
      format: "",
      ldVersion: "",
      source: text(source),
      reason: reason || "Não encontrado na LD",
      conflictLd: "NÃO",
      ldConflict: null,
      timeline: null,
      ldValues: new Map(),
      databookLevels: [],
    };
  }

  function resolveEntries(entries, index, options) {
    const rows = [];
    const seen = new Set();
    (entries || []).forEach((entry) => {
      const requested = text(entry && (entry.raw || entry.document || entry.fileName));
      if (!requested) return;
      const matches = C.matchDocuments(requested, index, entry && entry.hintedSheet);
      if (matches.length !== 1) {
        const missingKey = `missing::${C.norm(requested)}`;
        if (seen.has(missingKey)) return;
        seen.add(missingKey);
        rows.push(missingRow(requested, matches.length > 1 ? "Mais de um documento identificado" : "Não encontrado na LD", entry && entry.sheetName));
        return;
      }
      const key = matches[0].documentKey;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(matchToRow(matches[0], index, { ...options, requested }));
    });
    return rows;
  }

  function rowsForAllocation(index, allocation, options) {
    const wanted = C.norm(allocation);
    if (!wanted) return [];
    return (index.documents || []).filter((match) => {
      const items = [...(match.group.records || []), ...(match.group.history || [])];
      return items.some((item) => C.norm(item.allocation).includes(wanted));
    }).map((match) => matchToRow(match, index, options));
  }

  function rowsFromIndex(index, options) {
    const includeHistoryOnly = Boolean(options && options.includeHistoryOnly);
    return (index && index.documents || []).filter((match) => includeHistoryOnly || match.group && match.group.records && match.group.records.length)
      .map((match) => matchToRowFast(match, options));
  }

  function filterRows(rows, filters) {
    const wanted = filters || {};
    const exact = (actual, expected) => !text(expected) || C.norm(actual) === C.norm(expected);
    const contains = (actual, expected) => !text(expected) || C.norm(actual).includes(C.norm(expected));
    return (rows || []).filter((row) => {
      if (row.ldConflict && row.ldConflict.hasConflict) {
        return !text(wanted.query) || contains(`${row.document} ${row.title} ${row.reason}`, wanted.query);
      }
      if (!exact(row.sigemStatus, wanted.status)) return false;
      if (!exact(row.sheet, wanted.sheet)) return false;
      if (!exact(row.allocationStatus, wanted.allocationStatus)) return false;
      if (!exact(row.documentType, wanted.documentType)) return false;
      if (!exact(row.currentRevision, wanted.revision)) return false;
      if (!contains(row.allocation, wanted.allocation)) return false;
      if (wanted.comments === "yes" && !text(row.fiscalComment)) return false;
      if (wanted.comments === "no" && text(row.fiscalComment)) return false;
      if (text(wanted.query) && !contains(`${row.document} ${row.title}`, wanted.query)) return false;
      return true;
    });
  }

  function filterOptions(rows) {
    const unique = (field) => [...new Map((rows || []).map((row) => text(row && row[field])).filter(Boolean).map((value) => [C.norm(value), value])).values()]
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
    const allocations = [];
    const seenAllocations = new Set();
    (rows || []).forEach((row) => text(row && row.allocation).split(/\s*·\s*/).filter(Boolean).forEach((value) => {
      const normalized = C.norm(value);
      if (!normalized || seenAllocations.has(normalized)) return;
      seenAllocations.add(normalized);
      allocations.push(value);
    }));
    allocations.sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
    return {
      statuses: unique("sigemStatus"),
      sheets: unique("sheet"),
      allocationStatuses: unique("allocationStatus"),
      documentTypes: unique("documentType"),
      revisions: unique("currentRevision").sort((left, right) => C.revisionRank(left) - C.revisionRank(right)),
      allocations,
    };
  }

  const FIELD_LIBRARY = [
    ["requested", "ITEM INFORMADO"],
    ["document", "DOCUMENTO"],
    ["sheet", "ABA LD"],
    ["title", "TÍTULO"],
    ["currentRevision", "REVISÃO ATUAL"],
    ["nextRevision", "PRÓXIMA REVISÃO DISPONÍVEL"],
    ["sigemStatus", "STATUS SIGEM ATUAL"],
    ["nextStatus", "STATUS DA PRÓXIMA REVISÃO"],
    ["technicalStatus", "STATUS"],
    ["grdt", "GRDTS RELACIONADAS"],
    ["effectiveDate", "DATA EFETIVA DE EMISSÃO"],
    ["allocationStatus", "SITUAÇÃO DE ALOCAÇÃO"],
    ["allocation", "ALOCAÇÃO"],
    ["allocationStage", "ETAPA DA ALOCAÇÃO"],
    ["databook", "CAMINHO DATABOOK"],
    ["fiscalComment", "COMENTÁRIO DA FISCAL"],
    ["purpose", "PROPÓSITO"],
    ["discipline", "DISCIPLINA"],
    ["documentType", "TIPO DE DOCUMENTO"],
    ["format", "FORMATO"],
    ["ldVersion", "VERSÃO DA LD"],
    ["source", "ORIGEM NA LD"],
    ["reason", "MOTIVO"],
    ["conflictLd", "CONFLITO NA LD"],
  ].map(([key, label]) => ({ key, label, source: "semantic" }));

  function staticColumn(key) {
    const field = FIELD_LIBRARY.find((item) => item.key === key);
    return {
      key,
      label: field ? field.label : key,
      value: (row) => key === "document" ? text(row && (row.document || row.requested)) : text(row && row[key]),
    };
  }

  function levelColumn(number) {
    return {
      key: `databookLevel${number}`,
      label: `N${number}`,
      value: (row) => {
        const values = row && row.ldValues;
        const exact = values && (values.get(`NIVEL ${number}`) || values.get(`N${number}`));
        return text(exact && exact.value);
      },
    };
  }

  const TYPE_COLUMNS = {
    sigem: ["document", "sheet", "title", "currentRevision", "sigemStatus", "nextRevision", "nextStatus", "grdt", "effectiveDate", "conflictLd", "reason"],
    allocation_status: ["document", "sheet", "title", "currentRevision", "allocationStatus", "allocation", "allocationStage", "conflictLd", "reason"],
    allocation: ["document", "sheet", "title", "currentRevision", "allocation", "databook", "purpose", "conflictLd", "reason"],
    comments: ["document", "sheet", "title", "currentRevision", "sigemStatus", "fiscalComment", "conflictLd", "reason"],
    revisions: ["document", "sheet", "title", "currentRevision", "sigemStatus", "nextRevision", "nextStatus", "grdt", "conflictLd", "reason"],
    grdt: ["document", "sheet", "title", "currentRevision", "sigemStatus", "grdt", "effectiveDate", "conflictLd", "reason"],
    missing: ["requested", "source", "conflictLd", "reason"],
  };

  function ldHeaders(parsed) {
    const result = new Map();
    [...(parsed && parsed.records || []), ...(parsed && parsed.history || [])].forEach((item) => {
      (item.ldColumns || []).forEach((column) => {
        const header = text(column.header).replace(/\s+/g, " ");
        const key = C.norm(header);
        if (header && !result.has(key)) result.set(key, header);
      });
    });
    return [...result.entries()].map(([key, label]) => ({ key: `ld:${key}`, ldKey: key, label, source: "ld" }));
  }

  function fieldOptions(parsed) {
    const semanticLabels = new Set(FIELD_LIBRARY.map((item) => C.norm(item.label)));
    return [...FIELD_LIBRARY, ...ldHeaders(parsed).filter((item) => !semanticLabels.has(item.ldKey))];
  }

  function customColumn(field) {
    if (!field) return null;
    if (field.source === "ld" || String(field.key).startsWith("ld:")) {
      const ldKey = field.ldKey || String(field.key).slice(3);
      return { key: field.key, label: field.label, value: (row) => text(row && row.ldValues && row.ldValues.get(ldKey) && row.ldValues.get(ldKey).value) };
    }
    return staticColumn(field.key);
  }

  function columnsFor(type, customFields) {
    if (type === "custom") {
      const selected = (customFields || []).map(customColumn).filter(Boolean);
      return selected.length ? selected : ["document", "sheet", "title", "currentRevision", "sigemStatus"].map(staticColumn);
    }
    if (type === "databook") {
      return ["document", "sheet", "title", "discipline", "databook"].map(staticColumn)
        .concat(Array.from({ length: 8 }, (_, index) => levelColumn(index + 1)))
        .concat(staticColumn("conflictLd"), staticColumn("reason"));
    }
    return (TYPE_COLUMNS[type] || TYPE_COLUMNS.sigem).map(staticColumn);
  }

  function rowsForType(rows, type) {
    if (type === "missing") return (rows || []).filter((row) => !row.found);
    return rows || [];
  }

  return {
    FIELD_LIBRARY,
    text,
    latest,
    buildLdValues,
    matchToRow,
    matchToRowFast,
    missingRow,
    resolveEntries,
    rowsForAllocation,
    rowsFromIndex,
    filterRows,
    filterOptions,
    rowsForType,
    ldHeaders,
    fieldOptions,
    columnsFor,
  };
});
