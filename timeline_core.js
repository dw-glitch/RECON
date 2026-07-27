(function (root, factory) {
  const core = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimelineCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function itemTimestamp(item) {
    return Math.max(
      C.parseDate(item && item.modified)?.getTime() || 0,
      C.parseDate(item && item.included)?.getTime() || 0,
      C.parseDate(item && item.effectiveDate)?.getTime() || 0,
      Number(item && item.sourceTimestamp) || 0,
    );
  }

  function latestValue(items, field) {
    const ordered = [...(items || [])].sort((left, right) => itemTimestamp(right) - itemTimestamp(left) || (Number(right.row) || 0) - (Number(left.row) || 0));
    return text((ordered.find((item) => text(item && item[field])) || {})[field]);
  }

  function uniqueValues(items, field) {
    return [...new Map((items || []).map((item) => text(item && item[field])).filter(Boolean).map((value) => [C.norm(value), value])).values()];
  }

  function statusClass(status, decision, predicted) {
    if (predicted || decision === C.READY) return "ready";
    const normalized = C.norm(status);
    if (normalized.includes("CONFLITO") || normalized.includes("VAZIO")) return "review";
    const kind = C.statusKind(status);
    if (kind === "analysis") return "analysis";
    if (kind === "advance") return "feedback";
    if (kind === "issued") return "issued";
    if (kind === "pending") return "pending";
    if (kind === "closed") return "closed";
    if (kind === "not_posted") return "ready";
    return "neutral";
  }

  function statusForGroup(historyItems, technicalItems, triage, revision, predicted) {
    const rawHistory = (historyItems || []).map((item) => text(item.sigemStatus || item.status));
    const historyStatuses = [...new Map(rawHistory.filter(Boolean).map((value) => [C.norm(value), value])).values()];
    if (rawHistory.some((value) => !value)) return { value: "Status vazio na Colar SIGEM", source: "Colar SIGEM" };
    if (historyStatuses.length > 1) return { value: "Conflito na Colar SIGEM", source: "Colar SIGEM" };
    if (historyStatuses.length === 1) return { value: historyStatuses[0], source: "Colar SIGEM" };
    if (predicted) return { value: text(triage.status) || "Não Postado", source: "Calculado" };
    const technicalStatus = latestValue(technicalItems, "sigemStatus") || latestValue(technicalItems, "status");
    if (technicalStatus) return { value: technicalStatus, source: "LD" };
    if (C.normalizeRevision(triage.revision) === revision) return { value: text(triage.status) || "Não Postado", source: "Calculado" };
    return { value: "Não Postado", source: "Calculado" };
  }

  function decisionLabel(result) {
    if (result && result.hardBlock) return "Não incluir";
    if (!result) return "Revisar";
    if (result.decision === C.READY) return "Pronto";
    if (result.decision === C.DISCARD) return "Em análise";
    return "Revisar";
  }

  function decisionClass(result) {
    if (result && result.hardBlock) return "blocked";
    if (result && result.decision === C.READY) return "ready";
    if (result && result.decision === C.DISCARD) return "analysis";
    return "review";
  }

  function latestRecord(records) {
    return [...(records || [])].sort((left, right) => {
      const revision = C.revisionRank(right.revision) - C.revisionRank(left.revision);
      return revision || itemTimestamp(right) - itemTimestamp(left) || (Number(right.row) || 0) - (Number(left.row) || 0);
    })[0] || null;
  }

  function buildTimeline(match, index, options) {
    if (!match || !match.group) return null;
    const group = match.group;
    const representative = latestRecord(group.records) || latestRecord(group.history) || { document: match.document };
    const hintedSheet = C.inferSheetFromName(`${representative.document || match.document}.pdf`);
    const triage = C.triageOne({
      id: 0,
      name: `${representative.document || match.document}.pdf`,
      document: representative.document || match.document,
      hintedSheet,
      documentSource: "Linha do tempo",
    }, index, {
      recentDays: Math.max(1, Number(options && options.recentDays) || 30),
      now: options && options.now || new Date(),
    });

    const grouped = new Map();
    const add = (item, source) => {
      const revision = C.normalizeRevision(item && item.revision);
      if (!C.revisionInfo(revision).valid) return;
      if (!grouped.has(revision)) grouped.set(revision, { revision, records: [], history: [] });
      grouped.get(revision)[source].push(item);
    };
    (group.records || []).forEach((item) => add(item, "records"));
    (group.history || []).forEach((item) => add(item, "history"));

    const targetRevision = C.revisionInfo(triage.revision).valid ? C.normalizeRevision(triage.revision) : "";
    const targetPredicted = Boolean(targetRevision && !grouped.has(targetRevision));
    if (targetPredicted) grouped.set(targetRevision, { revision: targetRevision, records: [], history: [], predicted: true });

    const actualRevisions = [...grouped.values()].filter((entry) => !entry.predicted).map((entry) => entry.revision);
    const latestActualRevision = actualRevisions.sort((left, right) => C.revisionRank(right) - C.revisionRank(left))[0] || "";
    const revisions = [...grouped.values()].sort((left, right) => C.revisionRank(left.revision) - C.revisionRank(right.revision)).map((entry) => {
      const all = [...entry.records, ...entry.history];
      const status = statusForGroup(entry.history, entry.records, triage, entry.revision, Boolean(entry.predicted));
      const eventItems = [...entry.history].sort((left, right) => itemTimestamp(left) - itemTimestamp(right) || (Number(left.row) || 0) - (Number(right.row) || 0));
      return {
        revision: entry.revision,
        status: status.value,
        statusSource: status.source,
        statusClass: statusClass(status.value, targetRevision === entry.revision ? triage.decision : "", Boolean(entry.predicted)),
        title: latestValue(all, "title") || latestValue(group.records, "title"),
        purpose: latestValue(all, "purpose"),
        grdt: latestValue(all, "grdt"),
        effectiveDate: latestValue(all, "effectiveDate"),
        included: latestValue(all, "included"),
        modified: latestValue(all, "modified"),
        fiscalComment: latestValue(all, "fiscalComment"),
        allocation: latestValue(all, "allocation"),
        sources: uniqueValues(all, "sheet"),
        rows: all.map((item) => item.row).filter(Boolean),
        events: eventItems.map((item) => ({
          status: text(item.sigemStatus || item.status) || "Status vazio",
          included: text(item.included),
          modified: text(item.modified),
          purpose: text(item.purpose),
          row: item.row,
          sheet: item.sheet,
        })),
        predicted: Boolean(entry.predicted),
        target: targetRevision === entry.revision,
        latest: latestActualRevision === entry.revision,
      };
    });

    const allItems = [...(group.records || []), ...(group.history || [])];
    const datedItems = allItems.filter((item) => itemTimestamp(item));
    const lastItem = [...datedItems].sort((left, right) => itemTimestamp(right) - itemTimestamp(left))[0] || null;
    const invalidRevisionCount = allItems.filter((item) => text(item.revision) && !C.revisionInfo(item.revision).valid).length;
    const blankRevisionCount = allItems.filter((item) => !text(item.revision)).length;
    const technical = triage.record || latestRecord(group.records) || {};

    return {
      document: triage.document || representative.document || match.document,
      documentKey: match.documentKey,
      sheet: triage.sheet || technical.sheet || hintedSheet,
      ldVersion: technical.ldVersion || representative.ldVersion || "",
      title: technical.title || latestValue(group.records, "title") || latestValue(group.history, "title"),
      discipline: technical.discipline || latestValue(group.records, "discipline"),
      allocationStatus: technical.allocationStatus || latestValue(group.records, "allocationStatus"),
      fiscalComment: technical.fiscalComment || latestValue(group.records, "fiscalComment"),
      targetRevision,
      latestRevision: latestActualRevision,
      targetStatus: triage.status,
      decision: triage.decision,
      decisionLabel: decisionLabel(triage),
      decisionClass: decisionClass(triage),
      nextAction: C.simpleReason(triage),
      finalName: triage.finalName || "",
      grdt: triage.grdt || "",
      effectiveDate: triage.effectiveDate || "",
      lastActivity: lastItem ? text(lastItem.modified || lastItem.included || lastItem.effectiveDate) : "",
      lastActivityTimestamp: lastItem ? itemTimestamp(lastItem) : 0,
      revisions,
      actualRevisionCount: actualRevisions.length,
      invalidRevisionCount,
      blankRevisionCount,
      triage,
    };
  }

  function resolve(query, index, options) {
    const matches = C.matchDocuments(query, index);
    if (!matches.length) return { timeline: null, matches: [], error: "Documento não encontrado na LD." };
    if (matches.length > 1) return { timeline: null, matches, error: "Mais de um documento foi identificado. Selecione o código exato." };
    return { timeline: buildTimeline(matches[0], index, options), matches, error: "" };
  }

  function searchDocuments(index, query, limit) {
    const wanted = C.norm(query);
    if (!wanted || wanted.length < 2 || !index) return [];
    const results = [];
    for (const item of index.documents || []) {
      const record = latestRecord(item.group.records) || latestRecord(item.group.history) || {};
      const document = item.document;
      const title = record.title || "";
      const documentNorm = C.norm(document);
      const titleNorm = C.norm(title);
      let score = 0;
      if (documentNorm === wanted) score = 1000;
      else if (documentNorm.startsWith(wanted)) score = 800;
      else if (documentNorm.includes(wanted)) score = 650;
      else if (titleNorm.startsWith(wanted)) score = 450;
      else if (titleNorm.includes(wanted)) score = 350;
      if (!score) continue;
      results.push({ document, title, sheet: record.sheet || C.inferSheetFromName(`${document}.pdf`), revision: record.revision || "", score });
    }
    return results.sort((left, right) => right.score - left.score || left.document.localeCompare(right.document, "pt-BR")).slice(0, Math.max(1, Number(limit) || 8));
  }

  function exportRows(timeline) {
    const headers = [
      "Documento", "Aba LD", "Versão da LD", "Revisão", "Status", "Origem do Status",
      "Finalidade da Revisão", "GRDT", "Data Efetiva de Emissão", "Incluído em",
      "Modificado em", "Comentário da Fiscal", "Alocação", "Título", "Revisão alvo",
    ];
    const rows = (timeline && timeline.revisions || []).map((item) => [
      timeline.document, timeline.sheet, timeline.ldVersion, item.revision, item.status,
      item.statusSource, item.purpose, item.grdt, item.effectiveDate, item.included,
      item.modified, item.fiscalComment, item.allocation, item.title, item.target ? "SIM" : "",
    ]);
    return [headers, ...rows];
  }

  return {
    buildTimeline,
    resolve,
    searchDocuments,
    exportRows,
    statusClass,
  };
});
