(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const A = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const R = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const F = root.LDConflictCore || (typeof module === "object" && module.exports ? require("./ld_conflicts.js") : null);
  const S = root.RECONDatabookAllocationSources || (typeof module === "object" && module.exports ? require("./databook_allocation_sources.js") : null);
  const N = root.RECONNonTaggedTitles || (typeof module === "object" && module.exports ? require("./non_tagged_title_rules.js") : null);
  const T = root.RECONDocumentTitleStandard || (typeof module === "object" && module.exports ? require("./document_title_standard.js") : null);
  const api = factory(C, A, R, F, S, N, T);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, A, R, F, S, N, T) {
  "use strict";

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function norm(value) {
    return C.norm(text(value));
  }

  const SPREADSHEET_ERROR_TOKEN = /#(?:N\/A|N\/D|VALUE!|VALOR!|REF!|NAME\?|NOME\?|DIV\/0!|NUM!|NÚM!|NULL!|NULO!|SPILL!|DESPEJAR!|CALC!|FIELD!|CAMPO!|BLOCKED!|BLOQUEADO!|BUSY!|OCUPADO!|CONNECT!|CONECTAR!|GETTING_DATA)/giu;
  const UNAVAILABLE_VALUES = new Set([
    "", "0", "-", "N/A", "N/D", "NA", "ND", "#N/A", "#N/D",
    "NAO INFORMADO", "NÃO INFORMADO", "A DEFINIR", "PENDENTE",
    "SEM DESCRICAO", "SEM DESCRIÇÃO", "NAO DISPONIVEL", "NÃO DISPONÍVEL",
  ].map((value) => C.norm(value)));

  function cleanSpaces(value) {
    return text(value).replace(/\s+/g, " ").trim();
  }

  function stripSpreadsheetErrors(value) {
    return cleanSpaces(text(value)
      .replace(SPREADSHEET_ERROR_TOKEN, " ")
      .replace(/\s*\|\s*/g, " | ")
      .replace(/(?:^\s*\|\s*|\s*\|\s*$)/g, "")
      .replace(/\|\s*\|/g, "|")
      .replace(/\s+([,;:])/g, "$1")
      .replace(/(?:\s+[-–—]\s+){2,}/g, " - "));
  }

  function isUnavailableValue(value) {
    const raw = cleanSpaces(value);
    if (!raw) return true;
    if (SPREADSHEET_ERROR_TOKEN.test(raw)) {
      SPREADSHEET_ERROR_TOKEN.lastIndex = 0;
      return !stripSpreadsheetErrors(raw);
    }
    SPREADSHEET_ERROR_TOKEN.lastIndex = 0;
    return UNAVAILABLE_VALUES.has(norm(raw));
  }

  function latest(items) {
    return [...(items || [])].sort((left, right) => {
      const rev = C.revisionRank(right && right.revision) - C.revisionRank(left && left.revision);
      if (rev) return rev;
      const date = (C.parseDate(right && (right.modified || right.included || right.effectiveDate))?.getTime() || 0)
        - (C.parseDate(left && (left.modified || left.included || left.effectiveDate))?.getTime() || 0);
      return date || (Number(right && right.row) || 0) - (Number(left && left.row) || 0);
    })[0] || null;
  }

  function currentDatabookRecords(index) {
    const relevantLabels = new Set(["Situação de alocação", "Alocação", "Caminho Databook"]);
    return (index && index.documents || []).map((match) => {
      const group = match.group || { records: [], history: [] };
      const selected = latest(group.records || []);
      if (!selected) return null;
      const selectedRevision = C.normalizeRevision(selected.revision);
      const comparable = selectedRevision
        ? (group.records || []).filter((record) => C.normalizeRevision(record.revision) === selectedRevision)
        : [selected];
      const analysis = F && F.analyzeGroup ? F.analyzeGroup({ records: comparable, history: [] }) : null;
      if (!analysis || !analysis.hasConflict) return selected;
      const differences = (analysis.differences || []).filter((difference) => relevantLabels.has(difference.label));
      if (!differences.length) return selected;
      const fields = [...new Set(differences.map((difference) => difference.label))];
      const conflictingIds = new Set();
      differences.forEach((difference) => difference.values.forEach((value) => value.records.forEach((id) => conflictingIds.add(id))));
      const candidates = (analysis.candidates || []).filter((candidate) => conflictingIds.has(candidate.id));
      return {
        ...selected,
        _ldConflict: {
          ...analysis,
          hasConflict: true,
          blocked: true,
          differences,
          fields,
          candidates,
          summary: `Valores diferentes em: ${fields.join(", ")}.`,
        },
      };
    }).filter(Boolean);
  }

  function currentRecords(index) {
    return (index && index.documents || []).map((match) => {
      const group = match.group || { records: [], history: [] };
      const conflict = F && F.analyzeGroup ? F.analyzeGroup(group) : null;
      if (!conflict || !conflict.hasConflict) return latest(group.records || []);
      const first = (group.records || [])[0] || (group.history || [])[0] || {};
      const sheetValues = [...new Set(conflict.candidates.map((candidate) => candidate.sheet).filter(Boolean))];
      return {
        ...first,
        document: first.document || match.document,
        documentKey: match.documentKey,
        sheet: sheetValues.length === 1 ? sheetValues[0] : "Várias abas",
        row: 0,
        revision: F.consensusValue(group, "revision"),
        title: F.consensusValue(group, "title"),
        grdt: F.consensusValue(group, "grdt"),
        effectiveDate: F.consensusValue(group, "effectiveDate"),
        allocationStatus: F.consensusValue(group, "allocationStatus"),
        allocation: F.consensusValue(group, "allocation"),
        databook: F.consensusValue(group, "databook"),
        ldColumns: [],
        _ldConflict: conflict,
      };
    })
      .filter(Boolean);
  }

  function currentTitleRecords(index) {
    return (index && index.documents || []).map((match) => {
      const group = match.group || { records: [], history: [] };
      // Título é justamente o campo que será corrigido. Diferenças entre títulos
      // históricos não podem impedir a auditoria nem transformar a linha em conflito.
      // A linha técnica mais recente é a fonte operacional para a proposta.
      return latest(group.records || []);
    }).filter(Boolean);
  }

  function conflictAuditResult(record, kind) {
    const conflict = record && record._ldConflict;
    const current = kind === "databook" ? text(record.databook) : cleanSpaces(record.title);
    const result = {
      id: `${kind}::${record.documentKey}`,
      kind,
      document: record.document,
      documentKey: record.documentKey,
      sheet: record.sheet,
      row: "",
      discipline: record.discipline || "",
      title: text(record.title),
      current,
      proposed: "",
      issue: "conflict",
      classification: "insufficient",
      confidence: "nenhuma",
      reason: `Conflito na LD. ${conflict.summary} Nenhuma linha foi usada para concluir a auditoria.`,
      evidence: F.evidenceText(conflict),
      conflictLd: `SIM — ${conflict.fields.join(", ")}`,
      ldConflict: conflict,
      decision: "pending",
    };
    return R ? R.enrichAuditRow(result) : result;
  }

  function recordValue(record, aliases) {
    const wanted = (aliases || []).map(norm);
    const columns = record && record.ldColumns || [];
    for (const alias of wanted) {
      const exact = columns.find((column) => norm(column.header) === alias && text(column.value));
      if (exact) return text(exact.value);
    }
    for (const alias of wanted) {
      const partial = columns.find((column) => {
        const header = norm(column.header);
        return text(column.value) && alias.length >= 5 && header.includes(alias);
      });
      if (partial) return text(partial.value);
    }
    return "";
  }

  function recordColumn(record, aliases) {
    const wanted = (aliases || []).map(norm);
    const columns = record && record.ldColumns || [];
    let entry = columns.find((column) => wanted.includes(norm(column.header)));
    if (!entry) entry = columns.find((column) => wanted.some((alias) => alias.length >= 5 && norm(column.header).includes(alias)));
    return entry || null;
  }

  function disciplineKey(value) {
    const clean = norm(value).replace(/\bRNEST\b|\bUHDTD?\b|\bU[- ]?32\b|\bC\s*&\s*M\b/g, " ").replace(/\s+/g, " ").trim();
    const parts = clean.split(/[\/|]+/).map((item) => item.trim()).filter(Boolean);
    return parts.at(-1) || clean;
  }

  function pathKey(value) {
    return A.pathKey(value);
  }

  function isPlaceholder(value) {
    return isUnavailableValue(value);
  }

  function completePath(value) {
    return !isPlaceholder(value) && A.completeDatabook(value);
  }

  function tagSet(record) {
    return A.subjectTags(record.document, record.title, record.databook);
  }

  function tagSignature(record) {
    return [...tagSet(record)].sort().join("+");
  }

  function contextKeys(record) {
    const family = A.documentFamily(record.document);
    const discipline = disciplineKey(record.discipline);
    const kind = A.titleKind(record.title);
    const subjects = tagSignature(record);
    const keys = [];
    if (family.key && discipline && kind && subjects) keys.push(`A|${family.key}|${discipline}|${kind}|${subjects}`);
    if (family.key && discipline && kind) keys.push(`B|${family.key}|${discipline}|${kind}`);
    if (family.key && kind && subjects) keys.push(`C|${family.key}|${kind}|${subjects}`);
    if (family.key && discipline && norm(record.title)) keys.push(`D|${family.key}|${discipline}|${norm(record.title)}`);
    if (family.key && discipline) keys.push(`E|${family.key}|${discipline}`);
    return keys;
  }

  function addEvidence(map, key, record) {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Map());
    const paths = map.get(key);
    const normalized = pathKey(record.databook);
    if (!paths.has(normalized)) paths.set(normalized, { databook: text(record.databook), count: 0, documents: [], titles: [] });
    const group = paths.get(normalized);
    group.count += 1;
    if (group.documents.length < 8) group.documents.push(record.document);
    if (group.titles.length < 6 && !group.titles.some((item) => norm(item) === norm(record.title))) group.titles.push(record.title);
  }

  function buildPathEvidence(records) {
    const byContext = new Map();
    (records || []).filter((record) => completePath(record.databook)).forEach((record) => {
      contextKeys(record).forEach((key) => addEvidence(byContext, key, record));
    });
    return byContext;
  }

  function choosePeerEvidence(record, evidence) {
    const keys = contextKeys(record);
    for (const key of keys) {
      const paths = evidence.get(key);
      if (!paths || !paths.size) continue;
      const ranked = [...paths.values()].sort((left, right) => right.count - left.count || left.databook.localeCompare(right.databook, "pt-BR"));
      const total = ranked.reduce((sum, item) => sum + item.count, 0);
      const top = ranked[0];
      const runner = ranked[1];
      const share = total ? top.count / total : 0;
      const exactContext = /^A\||^D\|/.test(key);
      const specific = exactContext || /^B\||^C\|/.test(key);
      const minimum = specific ? 2 : 3;
      const threshold = specific ? .70 : .82;
      if (top.count < minimum || share < threshold || (runner && top.count - runner.count < 2 && share < .86)) continue;
      return {
        databook: top.databook,
        confidence: exactContext && top.count >= 3 && share >= .82 ? "alta" : specific ? "media" : "baixa",
        source: "Histórico da própria LD",
        support: top.count,
        share,
        contextKey: key,
        specificity: exactContext ? "exata" : specific ? "especifica" : "ampla",
        documents: top.documents,
        detail: `${top.count} documento(s) compatível(is) usam este caminho${specific ? "" : " em uma família ampla"}`,
      };
    }
    return null;
  }

  function tokenSet(value) {
    return new Set(norm(value).split(/[^A-Z0-9]+/).filter((item) => item.length >= 3));
  }

  function buildCatalogIndex(catalog) {
    const byKind = new Map();
    (catalog || []).filter((entry) => completePath(entry.databook)).forEach((entry) => {
      const searchable = `${entry.description || ""} ${entry.notes || ""}`;
      const indexed = { entry, searchable, searchableNorm: norm(`${searchable} ${entry.databook}`), tokens: tokenSet(searchable) };
      const kind = A.titleKind(searchable);
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(indexed);
    });
    return { byKind };
  }

  function catalogEvidence(record, catalogIndex) {
    const kind = A.titleKind(record.title);
    if (!kind) return null;
    const candidates = catalogIndex && catalogIndex.byKind && catalogIndex.byKind.get(kind) || [];
    if (!candidates.length) return null;
    const discipline = disciplineKey(record.discipline);
    const tokens = tokenSet(record.title);
    const ranked = candidates.map((candidate) => {
      let overlap = 0;
      tokens.forEach((token) => { if (candidate.tokens.has(token)) overlap += 1; });
      const disciplineMatch = discipline && candidate.searchableNorm.includes(discipline);
      const score = 65 + (disciplineMatch ? 24 : 0) + Math.min(28, overlap * 4) + Math.round(A.titleSimilarity(record.title, candidate.searchable) * 28);
      return { candidate, score };
    }).sort((left, right) => right.score - left.score);
    const top = ranked[0];
    const runner = ranked.find((item) => pathKey(item.candidate.entry.databook) !== pathKey(top.candidate.entry.databook));
    if (top.score < 76) return null;
    if (runner && top.score - runner.score < 10) return { conflict: true, detail: "A base contém mais de um caminho possível" };
    const found = { databook: top.candidate.entry.databook, confidence: top.score >= 100 ? "alta" : "media", support: 1 };
    if (!completePath(found.databook)) return null;
    return {
      databook: found.databook,
      confidence: found.confidence === "alta" ? "alta" : "media",
      source: "Base Databook",
      support: Number(found.support) || 1,
      documents: found.relatedDocuments || [],
      detail: "Correspondência pelo tipo, disciplina e assunto do documento",
    };
  }

  function choosePathSuggestion(record, evidence, catalogIndex) {
    const peer = choosePeerEvidence(record, evidence);
    const mapped = catalogEvidence(record, catalogIndex);
    if (peer && mapped && pathKey(peer.databook) !== pathKey(mapped.databook)) {
      return { conflict: true, detail: "O histórico e a base Databook indicam caminhos diferentes", peer, mapped };
    }
    return mapped || peer || null;
  }

  function auditDatabook(index, catalogEntries, allocationSourceIndex) {
    const records = currentDatabookRecords(index);
    const evidence = buildPathEvidence(records);
    const catalogIndex = buildCatalogIndex(catalogEntries || []);
    const catalogKeys = new Set((catalogEntries || []).filter((entry) => completePath(entry.databook)).map((entry) => pathKey(entry.databook)));
    return records.map((record) => {
      if (record._ldConflict) return conflictAuditResult(record, "databook");
      const current = text(record.databook) || recordValue(record, ["CAMINHO DATA BOOK", "CAMINHO DATABOOK"]);
      const sourceColumn = recordColumn(record, ["CAMINHO DATA BOOK", "CAMINHO DATABOOK"]);
      const currentComplete = completePath(current);
      const controlledResolution = !currentComplete && S && allocationSourceIndex
        ? S.resolve(record, allocationSourceIndex)
        : null;
      const controlledFound = controlledResolution && controlledResolution.status === "found";
      const controlledBlocked = controlledResolution && ["conflict", "wrong_year_only", "allocation_missing"].includes(controlledResolution.status);
      const inferredSuggestion = choosePathSuggestion({ ...record, databook: current }, evidence, catalogIndex);
      const suggestion = controlledFound
        ? {
          databook: controlledResolution.chosen.databook,
          confidence: "alta",
          source: controlledResolution.kind === "confirmation" ? "Confirmação de alocação" : "Arquivo de alocação",
          support: controlledResolution.candidates.length,
          documents: [record.document],
          detail: S.sourceLabel(controlledResolution.chosen),
          controlled: true,
          controlledResolution,
        }
        : allocationSourceIndex && allocationSourceIndex.rows && allocationSourceIndex.rows.length
          ? (controlledBlocked ? { conflict: true, detail: controlledResolution.reason, controlledResolution } : null)
          : inferredSuggestion;
      const currentInCatalog = currentComplete && catalogKeys.has(pathKey(current));
      const sameSuggestion = currentComplete && suggestion && !suggestion.conflict && pathKey(current) === pathKey(suggestion.databook);
      let issue = "ok";
      let classification = "ok";
      let reason = "Caminho confirmado pela base ou por documentos compatíveis";
      let proposed = "";
      let confidence = suggestion && !suggestion.conflict ? suggestion.confidence : "nenhuma";
      if (!currentComplete) {
        issue = "missing";
        if (suggestion && !suggestion.conflict) {
          proposed = suggestion.databook;
          classification = suggestion.controlled ? "confirmed_error" : "suggestion";
          reason = suggestion.controlled
            ? `${suggestion.source} localizada para a mesma alocação e para o mesmo ano; o texto será copiado sem alteração`
            : (isPlaceholder(current) ? "Caminho vazio; existe uma referência compatível" : "Caminho incompleto; existe uma referência compatível");
        } else {
          classification = "insufficient";
          confidence = "nenhuma";
          reason = suggestion && suggestion.conflict ? suggestion.detail : "Caminho vazio e sem referência segura";
        }
      } else if (currentInCatalog) {
        issue = "ok";
        classification = "ok";
        proposed = "";
        confidence = "alta";
        reason = suggestion && !suggestion.conflict && !sameSuggestion
          ? "O caminho atual consta na base Databook e foi preservado; outra referência compatível foi apenas registrada para conferência"
          : "Caminho completo confirmado na base Databook";
      } else if (suggestion && !suggestion.conflict && !sameSuggestion) {
        issue = "divergent";
        classification = "insufficient";
        proposed = "";
        confidence = "nenhuma";
        reason = `O caminho atual está completo e foi preservado; a referência “${suggestion.databook}” é diferente e precisa de conferência manual`;
      } else if (suggestion && suggestion.conflict) {
        issue = "unconfirmed";
        classification = "insufficient";
        confidence = "nenhuma";
        reason = `${suggestion.detail}. O caminho atual está completo e não foi substituído`;
      } else if (!sameSuggestion) {
        issue = "unconfirmed";
        classification = "insufficient";
        confidence = "nenhuma";
        reason = "Caminho completo preservado, mas sem referência suficiente para confirmação automática";
      }
      const result = {
        id: `databook::${record.documentKey}`,
        kind: "databook",
        document: record.document,
        documentKey: record.documentKey,
        sheet: record.sheet,
        row: record.row,
        column: sourceColumn && sourceColumn.column || "",
        columnHeader: sourceColumn && sourceColumn.header || "CAMINHO DATABOOK",
        discipline: record.discipline,
        title: record.title,
        current,
        proposed,
        issue,
        classification,
        confidence,
        reason,
        evidence: currentInCatalog
          ? `Base Databook · o caminho atual está cadastrado${suggestion && !suggestion.conflict && !sameSuggestion ? ` · referência alternativa: ${suggestion.databook}` : ""}`
          : suggestion && !suggestion.conflict ? `${suggestion.source} · ${suggestion.detail}${suggestion.note ? ` · ${suggestion.note}` : ""}` : reason,
        support: suggestion && !suggestion.conflict ? suggestion.support : 0,
        relatedDocuments: suggestion && !suggestion.conflict ? suggestion.documents || [] : [],
        allocation: controlledResolution && controlledResolution.allocation ? controlledResolution.allocation.code : text(record.allocation),
        controlledSource: Boolean(suggestion && suggestion.controlled),
        controlledSourceKind: suggestion && suggestion.controlled ? suggestion.source : "",
        controlledSourceFile: suggestion && suggestion.controlled ? suggestion.controlledResolution.chosen.source : "",
        controlledSourceSheet: suggestion && suggestion.controlled ? suggestion.controlledResolution.chosen.sourceSheet : "",
        controlledSourceRow: suggestion && suggestion.controlled ? suggestion.controlledResolution.chosen.sourceRow : "",
        controlledSourceDate: suggestion && suggestion.controlled ? suggestion.controlledResolution.chosen.sourceDate : "",
        controlledSourceStatus: controlledResolution ? controlledResolution.status : "not_loaded",
        decision: suggestion && suggestion.controlled ? "approved" : "pending",
        conflictLd: "NÃO",
        ldConflict: null,
      };
      return R ? R.enrichAuditRow(result) : result;
    });
  }

  const DOC_HEADERS = ["DOCUMENTO", "NOME DOCUMENTO", "NOMEDOCUMENTO", "CODIGO DO DOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO", "CÓDIGO"];
  const TAG_HEADERS = ["TAG", "TAG DO EQUIPAMENTO", "TAG EQUIPAMENTO", "EQUIPAMENTO", "IDENTIFICACAO DO EQUIPAMENTO"];
  const DESCRIPTION_HEADERS = ["DESCRICAO", "DESCRIÇÃO", "DESCRICAO DO DOCUMENTO", "DESCRIÇÃO DO DOCUMENTO", "DENOMINACAO", "DENOMINAÇÃO", "ASSUNTO"];
  const DISCIPLINE_HEADERS = ["DISCIPLINA", "AREA", "ÁREA", "ESPECIALIDADE"];
  const TITLE_HEADERS = ["TITULO", "TÍTULO", "TITULO DO DOCUMENTO", "TÍTULO DO DOCUMENTO"];
  const SCON_HEADERS = ["SCON"];
  const COMPLEMENTARY_HEADERS = ["COMPLEMENTAR", "DESCRIÇÃO COMPLEMENTAR", "DESCRICAO COMPLEMENTAR"];

  function headerIndex(row, aliases) {
    const wanted = new Set(aliases.map(norm));
    return (row || []).findIndex((value) => wanted.has(norm(value)));
  }

  function usableDescription(value) {
    if (isUnavailableValue(value)) return "";
    const clean = stripSpreadsheetErrors(value);
    return isUnavailableValue(clean) ? "" : clean;
  }

  function looksLikeTechnicalTag(value) {
    const clean = cleanSpaces(value).replace(/^TAG\s*[:\-]?\s*/i, "");
    if (!clean || /^NT(?:[-/_.]|$)/i.test(clean)) return false;
    return clean.length <= 48 && /[A-Z]/i.test(clean) && /\d/.test(clean) && /[-/_.]/.test(clean) && /^[A-Z0-9][A-Z0-9._/-]+$/i.test(clean);
  }

  function validatedTag(value) {
    const clean = cleanSpaces(value).replace(/^TAG\s*[:\-]?\s*/i, "");
    return looksLikeTechnicalTag(clean) ? clean : "";
  }

  function looksLikeDocumentTag(value) {
    const clean = validatedTag(value);
    if (!clean) return false;
    return /^[A-Z0-9]{1,10}(?:-[A-Z0-9./]+)+$/i.test(clean);
  }

  function stripRedundantUnitTagPrefix(value, expectedUnit) {
    const candidate = cleanSpaces(value);
    const match = candidate.match(/^(U[-_.\/\s]?32)[-_.\/\s]+(.+)$/i);
    if (!match) return { value: candidate, removed: false, prefix: "" };
    const expected = norm(expectedUnit).replace(/[^A-Z0-9]/g, "");
    const prefix = norm(match[1]).replace(/[^A-Z0-9]/g, "");
    const remainder = cleanSpaces(match[2]);
    if (expected && prefix !== expected) return { value: candidate, removed: false, prefix: "" };
    if (!looksLikeTechnicalTag(remainder)) return { value: candidate, removed: false, prefix: "" };
    return { value: remainder, removed: true, prefix };
  }

  function reportGroup7Info(document) {
    const raw = text(document).replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    const groups = raw.split("_");
    const isReport = groups.length >= 7 && norm(groups[1]) === "RNEST";
    const identifier = isReport ? groups.slice(6).join("_").trim() : "";
    const multipleDocuments = (raw.match(/C1O_RNEST_/gi) || []).length > 1;
    const exactNonTagged = identifier.startsWith("nt-");
    const isNonTagged = /^nt(?:-|_)/i.test(identifier);
    const withoutNt = identifier.replace(/^nt(?:-|_)/i, "");
    const lookup = stripRedundantUnitTagPrefix(withoutNt, groups[2]);
    const lookupIdentifier = lookup.value;
    const formatValid = Boolean(identifier && !/[_ç?|!@#$%¨&*(),\s]/i.test(identifier) && /^[A-Z0-9][A-Z0-9./-]*$/i.test(identifier));
    const validTag = Boolean(lookupIdentifier && !isNonTagged && !multipleDocuments);
    return {
      raw,
      groups,
      isReport,
      identifier,
      lookupIdentifier,
      unitPrefixRemoved: lookup.removed,
      removedUnitPrefix: lookup.prefix,
      isNonTagged,
      exactNonTagged,
      nonTagCaseMismatch: isNonTagged && !exactNonTagged,
      multipleDocuments,
      tag: validTag ? lookupIdentifier : "",
      validTag,
      formatValid,
    };
  }

  function documentDeclaresNonTag(document) {
    const group7 = reportGroup7Info(document);
    return group7.isNonTagged || /_RIR_NT(?:[-/_.]|$)/i.test(text(document));
  }

  function extractTagFromDocument(document) {
    const raw = text(document).replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    if (/-C1O-CV-/i.test(raw)) return "";
    const group7 = reportGroup7Info(raw);
    if (group7.validTag) return group7.tag;
    const match = raw.match(/_RIR_([^_]+(?:_[^_]+)*)$/i);
    const candidate = match ? match[1].replace(/^TAG[- :]+/i, "").trim() : "";
    return looksLikeDocumentTag(candidate) ? candidate : "";
  }

  function extractTagFromTitle(title) {
    const raw = cleanSpaces(title);
    let match = raw.match(/\bTAG\b\s*[:\-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})\b/i);
    if (match) return validatedTag(match[1]);
    match = raw.match(/(?:^|\s[-–—:]\s)((?:[A-Z]{1,4}|\d{1,2}[A-Z])-[A-Z0-9][A-Z0-9._/-]{2,})\s*$/i);
    const inferred = match ? match[1] : "";
    return looksLikeDocumentTag(inferred) ? inferred : "";
  }

  function extractTag(record, reference) {
    return resolveTagEvidence(record, reference).tag;
  }

  function resolveTagEvidence(record, reference) {
    const group7 = reportGroup7Info(record && record.document);
    if (group7.multipleDocuments) {
      return {
        tag: "",
        possibleTag: "",
        state: "absent",
        source: "Célula da LD contém mais de um código documental; separar os documentos antes de confirmar a TAG",
        confidence: "nenhuma",
        confirmed: false,
        group7,
      };
    }
    if (group7.isNonTagged || documentDeclaresNonTag(record && record.document)) {
      const source = group7.exactNonTagged
        ? "Grupo 7 iniciado por nt- — item não tagueado"
        : "Marcador de item não tagueado fora do padrão; corrigir o Grupo 7 para nt-";
      return { tag: "", possibleTag: "", state: "not_tagged", source, confidence: "alta", confirmed: false, group7 };
    }
    if (group7.validTag) {
      return { tag: group7.tag, possibleTag: "", state: "confirmed", source: "Grupo 7 do código (após o 6º underline)", confidence: "alta", confirmed: true, group7 };
    }
    const fieldTag = validatedTag(recordValue(record, TAG_HEADERS));
    if (fieldTag) return { tag: fieldTag, possibleTag: "", state: "confirmed", source: "Campo TAG da LD", confidence: "alta", confirmed: true };

    const titleTag = validatedTag(extractTagFromTitle(record && record.title));
    if (titleTag) return { tag: titleTag, possibleTag: "", state: "confirmed", source: "TAG já presente no título", confidence: "alta", confirmed: true };

    const referenceTag = validatedTag(reference && reference.tag);
    const trustedReference = Boolean(referenceTag && reference && !reference.manualReview && !reference.ambiguousTag);
    if (trustedReference) {
      const exact = !reference.inferred;
      return {
        tag: referenceTag,
        possibleTag: "",
        state: "confirmed",
        source: exact ? "Referência controlada do documento" : "Referência controlada da mesma TAG e disciplina",
        confidence: exact && reference.verifiedCatalog ? "alta" : "media",
        confirmed: true,
      };
    }

    const documentTag = validatedTag(extractTagFromDocument(record && record.document));
    if (documentTag) {
      return {
        tag: "",
        possibleTag: documentTag,
        state: "possible",
        source: "Possível identificador em código sem Grupo 7 controlado",
        confidence: "baixa",
        confirmed: false,
      };
    }
    return { tag: "", possibleTag: "", state: "absent", source: "Nenhuma TAG comprovada", confidence: "nenhuma", confirmed: false };
  }

  function inferType(record) {
    const document = norm(record.document);
    if (/_RIR_/.test(document)) return "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO";
    const prefix = document.split(/[-_]/)[0];
    const map = {
      CR: "CRONOGRAMA", PR: "PROCEDIMENTO", DE: "DESENHO", RT: "RELATÓRIO TÉCNICO",
      MD: "MEMORIAL DESCRITIVO", MC: "MEMÓRIA DE CÁLCULO", LM: "LISTA DE MATERIAIS",
      ET: "ESPECIFICAÇÃO TÉCNICA", FD: "FOLHA DE DADOS", IE: "INSTRUÇÃO DE EXECUÇÃO",
      PL: "PLANO", RL: "RELATÓRIO", CE: "CERTIFICADO", CV: "CURRÍCULO",
    };
    if (/-C1O-CV-/.test(document) || norm(record.sheet) === "CV") return "CURRÍCULO";
    return map[prefix] || A.titleKind(record.title) || "";
  }

  function unwrapTitle(value) {
    return cleanSpaces(value).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  }

  function looksLikeDocumentPrefix(value) {
    return /^(?:RIR|RNC|IEIS|EPS|RQPS|RQS|RSQ|RELATORIO|DESENHO|PROCEDIMENTO|PLANO|CERTIFICADO|CERTIFICACAO|MEMORIAL|MEMORIA|ESPECIFICACAO|FOLHA DE DADOS|LISTA|CRONOGRAMA|INSTRUCAO|CURRICULO)\b/.test(norm(value));
  }

  function referenceDescriptionCandidate(value) {
    const clean = unwrapTitle(value);
    if (!clean) return "";
    const parts = clean.split(/\s+[-–—]\s+/);
    if (parts.length > 1 && looksLikeDocumentPrefix(parts[0])) return usableDescription(parts.slice(1).join(" - "));
    return usableDescription(clean);
  }

  function titlePrefixBeforeDescription(current) {
    const protectedCompoundWords = new Set(["PRE", "POS", "NAO", "SUB", "AUTO"]);
    for (let index = 1; index < current.length - 1; index += 1) {
      if (!/[-–—]/.test(current[index])) continue;
      const before = cleanSpaces(current.slice(0, index));
      const after = cleanSpaces(current.slice(index + 1));
      if (!before || !after || !looksLikeDocumentPrefix(before)) continue;
      const previousWord = (norm(before).match(/([A-Z0-9]+)$/) || [])[1] || "";
      if (protectedCompoundWords.has(previousWord)) continue;
      return cleanTitlePart(before);
    }
    return "";
  }

  function stableTitlePrefix(currentTitle, inferredType) {
    const current = unwrapTitle(currentTitle);
    if (!current) return cleanTitlePart(inferredType);
    const prefix = titlePrefixBeforeDescription(current);
    if (prefix) return prefix;
    if (looksLikeDocumentPrefix(current)) return cleanTitlePart(current);
    return cleanTitlePart(inferredType);
  }

  function titleHistoryTypeKey(record) {
    const code = T && T.documentTypeCode ? T.documentTypeCode(record && record.document) : "";
    if (code) return `CODE:${code}`;
    const kind = A && A.titleKind ? A.titleKind(record && record.title) : "";
    return kind ? `KIND:${kind}` : "";
  }

  function buildPreviousTitleIndex(index) {
    const byDocument = new Map();
    const byType = new Map();
    const byTypeDiscipline = new Map();
    const add = (map, key, item, limit) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, { samples: [], prefixCounts: new Map() });
      const bucket = map.get(key);
      const prefix = titlePrefixBeforeDescription(item.title);
      if (prefix) {
        const prefixKey = norm(prefix);
        const pattern = bucket.prefixCounts.get(prefixKey) || { title: prefix, support: 0 };
        pattern.support += 1;
        bucket.prefixCounts.set(prefixKey, pattern);
      }
      if (bucket.samples.length >= limit || bucket.samples.some((entry) => norm(entry.title) === norm(item.title))) return;
      bucket.samples.push(item);
    };
    (index && index.documents || []).forEach((match) => {
      const group = match.group || { records: [], history: [] };
      [...(group.records || []), ...(group.history || [])].forEach((record) => {
        const title = unwrapTitle(record && record.title);
        if (!title) return;
        const item = { record, title, documentKey: record.documentKey || C.key(record.document || match.document) };
        const documentKey = item.documentKey;
        add(byDocument, documentKey, item, 8);
        const typeKey = titleHistoryTypeKey(record);
        if (!typeKey) return;
        add(byType, typeKey, item, 8);
        const discipline = disciplineKey(record && record.discipline);
        if (discipline) {
          const disciplineKeyValue = `${typeKey}|${discipline}`;
          add(byTypeDiscipline, disciplineKeyValue, item, 8);
        }
      });
    });
    return { byDocument, byType, byTypeDiscipline };
  }

  function previousTitlesFor(record, historyIndex) {
    if (!historyIndex) return [];
    const documentKey = record.documentKey || C.key(record.document);
    const typeKey = titleHistoryTypeKey(record);
    const discipline = disciplineKey(record.discipline);
    const samples = (bucket) => bucket && bucket.samples || [];
    const items = [
      ...samples(historyIndex.byDocument.get(documentKey)),
      ...samples(typeKey && discipline ? historyIndex.byTypeDiscipline.get(`${typeKey}|${discipline}`) : null),
      ...samples(typeKey ? historyIndex.byType.get(typeKey) : null),
    ];
    const seen = new Set();
    const titles = [];
    items.forEach((item) => {
      if (!item || item.record === record) return;
      const key = norm(item.title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      titles.push(item.title);
    });
    return titles.slice(0, 24);
  }

  function previousTitlePatternFor(record, historyIndex) {
    if (!historyIndex) return { title: "", support: 0 };
    const documentKey = record.documentKey || C.key(record.document);
    const typeKey = titleHistoryTypeKey(record);
    const discipline = disciplineKey(record.discipline);
    const currentPrefixKey = norm(titlePrefixBeforeDescription(unwrapTitle(record.title)));
    const fromBucket = (bucket) => {
      if (!bucket || !bucket.prefixCounts) return null;
      return [...bucket.prefixCounts.entries()].map(([key, pattern]) => ({
        title: pattern.title,
        support: pattern.support - Number(Boolean(currentPrefixKey && key === currentPrefixKey)),
      })).filter((pattern) => pattern.support > 0)
        .sort((left, right) => right.support - left.support || right.title.length - left.title.length)[0] || null;
    };
    return fromBucket(historyIndex.byDocument.get(documentKey))
      || fromBucket(typeKey && discipline ? historyIndex.byTypeDiscipline.get(`${typeKey}|${discipline}`) : null)
      || fromBucket(typeKey ? historyIndex.byType.get(typeKey) : null)
      || { title: "", support: 0 };
  }

  function historicalTitlePrefix(previousTitles, inferredType) {
    const groups = new Map();
    (previousTitles || []).forEach((title) => {
      const prefix = titlePrefixBeforeDescription(unwrapTitle(title));
      if (!prefix) return;
      const key = norm(prefix);
      if (!groups.has(key)) groups.set(key, { title: prefix, support: 0 });
      groups.get(key).support += 1;
    });
    const ranked = [...groups.values()].sort((left, right) => {
      const inferredMatch = Number(norm(right.title) === norm(inferredType)) - Number(norm(left.title) === norm(inferredType));
      return right.support - left.support || inferredMatch || right.title.length - left.title.length;
    });
    return ranked[0] || { title: "", support: 0 };
  }

  function titleStartsWithType(title, type) {
    const current = norm(unwrapTitle(title));
    const prefix = norm(cleanTitlePart(type));
    if (!current || !prefix) return false;
    return current === prefix || current.startsWith(`${prefix} -`) || current.startsWith(`${prefix}:`) || current.startsWith(`${prefix} `);
  }

  function isDrawingRecord(record, prefix, inferredType) {
    const document = norm(record && record.document);
    return document.startsWith("DE-") || /(?:^|_)DE(?:_|$)/.test(document) || /DESENHO/.test(norm(`${prefix} ${inferredType}`));
  }

  function stripKnownParts(title, type, tag) {
    let result = cleanSpaces(title);
    if (type) {
      const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`^${escaped}\\s*[-–—:]?\\s*`, "i"), "");
    }
    result = result.replace(/^TAG\s*[-–—:]?\s*/i, "");
    if (tag) {
      const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\s*[-–—:]?\\s*(?:TAG\\s*[:\\-]?\\s*)?${escapedTag}\\s*$`, "i"), "");
    }
    return usableDescription(result.replace(/^[-–—:\s]+|[-–—:\s]+$/g, ""));
  }


  function parseSconDescription(value) {
    const full = cleanSpaces(value);
    const parts = full.split(/\s*\|\s*/).map(cleanSpaces).filter(Boolean);
    return {
      full,
      area: parts[0] || "",
      discipline: parts[1] || "",
      titleComplement: usableDescription(parts[2] || ""),
      parts,
    };
  }

  function normalizedTagKey(value) {
    return norm(value).replace(/[^A-Z0-9]/g, "");
  }

  function canonicalTagKey(value) {
    return (norm(value).match(/[A-Z]+|\d+/g) || [])
      .map((token) => /^\d+$/.test(token) ? String(Number(token)) : token)
      .join("");
  }

  function expandedCompactTagAliases(value) {
    const clean = cleanSpaces(value);
    const aliases = [clean];
    const compact = clean.match(/^(.*?)(\d+)([A-Z])((?:[-/][A-Z])+)$/i);
    if (compact) {
      const prefix = `${compact[1]}${compact[2]}`;
      const suffixes = [compact[3], ...compact[4].split(/[-/]/).filter(Boolean)];
      suffixes.forEach((suffix) => aliases.push(`${prefix}${suffix}`));
    }
    return [...new Map(aliases.filter(Boolean).map((alias) => [normalizedTagKey(alias), alias])).values()];
  }

  function leadingTechnicalIdentifier(value) {
    const clean = usableDescription(value);
    const match = clean.match(/^(.+?)\s+[-–—]\s+/);
    return match ? validatedTag(match[1]) : "";
  }

  function sconEntryTagAliases(entry) {
    const aliases = [];
    const group7 = reportGroup7Info(entry && entry.document);
    if (group7.tag && looksLikeTechnicalTag(group7.tag)) aliases.push({ value: group7.tag, source: "Grupo 7 do código SGP" });
    const descriptionTag = leadingTechnicalIdentifier(entry && entry.titleComplement);
    if (descriptionTag) aliases.push({ value: descriptionTag, source: "início da descrição SCON" });
    const sconCode = usableDescription(entry && entry.sconTag);
    technicalIdentifiers(sconCode).forEach((value) => aliases.push({ value, source: "CÓDIGO SGP do SCON" }));
    sconCode.split(/[_\s]+/).filter(looksLikeTechnicalTag)
      .forEach((value) => aliases.push({ value, source: "CÓDIGO SGP do SCON" }));
    return [...new Map(aliases.map((item) => [normalizedTagKey(item.value), item])).values()];
  }

  function addNormalizedTagCandidate(index, alias, entry, source) {
    const key = normalizedTagKey(alias);
    if (!key || key.length < 4) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ entry, alias, aliasKey: key, aliasSource: source || "" });
  }

  function containedTagKeys(value) {
    const tokens = norm(value).split(/[^A-Z0-9]+/).filter(Boolean);
    const fullKey = normalizedTagKey(value);
    const keys = new Set();
    for (let start = 0; start < tokens.length; start += 1) {
      let candidate = "";
      for (let end = start; end < tokens.length; end += 1) {
        candidate += tokens[end];
        if (candidate === fullKey || candidate.length < 6 || !/\d/.test(candidate)) continue;
        keys.add(candidate);
      }
    }
    return [...keys].sort((left, right) => right.length - left.length);
  }

  function normalizedTagMatches(index, tag, discipline, allowContained) {
    if (!index || !tag) return null;
    const wantedDiscipline = sconEscopoDisciplineKey(discipline);
    const exactKey = normalizedTagKey(tag);
    const sameDiscipline = (items) => {
      const filtered = (items || []).filter((item) => sconEscopoDisciplineKey(item.entry && item.entry.discipline) === wantedDiscipline);
      return wantedDiscipline ? filtered : items || [];
    };
    const exact = sameDiscipline(index.get(exactKey) || []);
    if (exact.length) return { candidates: exact, exactNormalized: true, contained: false, matchedKeys: [exactKey] };
    if (!allowContained) return null;

    const hits = [];
    containedTagKeys(tag).forEach((key) => {
      sameDiscipline(index.get(key) || []).forEach((item) => hits.push(item));
    });
    if (!hits.length) return null;
    const uniqueKeys = [...new Set(hits.map((item) => item.aliasKey))];
    const maximalKeys = uniqueKeys.filter((key) => !uniqueKeys.some((other) => other !== key && other.includes(key)));
    const candidates = hits.filter((item) => maximalKeys.includes(item.aliasKey));
    return candidates.length
      ? { candidates, exactNormalized: false, contained: true, matchedKeys: maximalKeys }
      : null;
  }

  function progressiveTagFragmentMatches(index, tag, discipline) {
    if (!index || !tag) return null;
    const lookupKey = normalizedTagKey(tag);
    if (lookupKey.length < 8) return null;
    const wantedDiscipline = sconEscopoDisciplineKey(discipline);
    const hits = [];
    index.forEach((items, aliasKey) => {
      if (
        aliasKey.length < 4
        || aliasKey === lookupKey
        || !lookupKey.includes(aliasKey)
      ) return;
      (items || []).forEach((item) => hits.push(item));
    });
    if (!hits.length) return null;
    const sameDiscipline = wantedDiscipline
      ? hits.filter((item) => sconEscopoDisciplineKey(item.entry && item.entry.discipline) === wantedDiscipline)
      : [];
    const scopedHits = sameDiscipline.length ? sameDiscipline : hits;
    const uniqueKeys = [...new Set(scopedHits.map((item) => item.aliasKey))];
    return scopedHits.length
      ? { candidates: scopedHits, exactNormalized: false, contained: true, fragment: true, matchedKeys: uniqueKeys }
      : null;
  }

  function mergeContainedTagMatches(primary, progressive) {
    const matches = [primary, progressive].filter(Boolean);
    const hits = [...new Map(matches
      .flatMap((match) => match.candidates || [])
      .map((item) => [
        `${item.aliasKey}|${strictTagKey(item.entry && item.entry.tag)}|${item.entry && item.entry.row || 0}`,
        item,
      ])).values()];
    if (!hits.length) return null;
    const uniqueKeys = [...new Set(hits.map((item) => item.aliasKey))];
    const progressiveKeys = new Set(progressive && progressive.matchedKeys || []);
    return hits.length
      ? {
        candidates: hits,
        exactNormalized: false,
        contained: true,
        fragment: uniqueKeys.some((key) => progressiveKeys.has(key)),
        matchedKeys: uniqueKeys,
      }
      : null;
  }

  function containedTagMatchLabel(count) {
    return count === 1 ? "1 TAG principal localizada dentro do Grupo 7" : `${count} TAGs principais localizadas dentro do Grupo 7`;
  }

  function buildSconReferenceIndex(entries, metadata) {
    const cleanEntries = (entries || []).map((entry) => ({
      ...entry,
      document: text(entry.document),
      documentKey: entry.documentKey || C.key(entry.document),
      looseDocumentKey: entry.looseDocumentKey || C.looseKey(entry.document),
      titleComplement: usableDescription(entry.titleComplement),
      fullDescription: stripSpreadsheetErrors(entry.fullDescription),
      verifiedCatalog: true,
      confidence: entry.confidence || "alta",
      sourceFile: entry.sourceFile || metadata && metadata.sourceFile || "SCON - TAG SGP",
      sourceSheet: entry.sourceSheet || metadata && metadata.sheet || "",
    })).filter((entry) => entry.document && entry.titleComplement);

    const byDocument = new Map();
    const byLooseDocument = new Map();
    const byNormalizedTag = new Map();
    cleanEntries.forEach((entry) => {
      entry.tagAliases = sconEntryTagAliases(entry);
      const existing = byDocument.get(entry.documentKey);
      if (!existing) byDocument.set(entry.documentKey, { ...entry, sourceRows: [entry.row].filter(Boolean) });
      else {
        const descriptions = new Map([
          [norm(existing.titleComplement), existing.titleComplement],
          [norm(entry.titleComplement), entry.titleComplement],
        ].filter(([key]) => key));
        existing.sourceRows = [...new Set([...(existing.sourceRows || []), entry.row].filter(Boolean))];
        if (descriptions.size > 1) {
          existing.titleComplement = "";
          existing.candidateTitles = [...descriptions.values()];
          existing.candidateCount = descriptions.size;
          existing.ambiguousDescription = true;
          existing.manualReview = true;
        }
      }
      const looseKey = entry.looseDocumentKey;
      if (looseKey) {
        if (!byLooseDocument.has(looseKey)) byLooseDocument.set(looseKey, []);
        byLooseDocument.get(looseKey).push(entry);
      }
      entry.tagAliases.forEach((item) => addNormalizedTagCandidate(byNormalizedTag, item.value, entry, item.source));
    });
    return {
      kind: "scon",
      entries: cleanEntries,
      byDocument,
      byLooseDocument,
      byNormalizedTag,
      metadata: metadata || {},
    };
  }

  function parseSconTitleCatalog(catalog) {
    const columns = catalog && catalog.columns || [];
    const position = new Map(columns.map((name, index) => [name, index]));
    const at = (row, name) => position.has(name) ? row[position.get(name)] : "";
    const entries = (catalog && catalog.rows || []).map((row) => ({
      document: at(row, "document"),
      titleComplement: at(row, "titleComplement"),
      fullDescription: at(row, "fullDescription"),
      sconTag: usableDescription(at(row, "sconTag")),
      discipline: usableDescription(at(row, "discipline")),
      itemType: usableDescription(at(row, "itemType")),
      drawingReference: usableDescription(at(row, "drawingReference")),
      row: Number(at(row, "row")) || 0,
      sourceFile: catalog && catalog.sourceFile || "SCON - TAG SGP",
      sourceSheet: catalog && catalog.sheet || "",
    }));
    return buildSconReferenceIndex(entries, catalog || {});
  }

  function strictTagKey(value) {
    return text(value).toUpperCase();
  }

  function normalizeSconEap(value) {
    return norm(value)
      .replace(/^EAP\s*[:\-]?\s*/i, "")
      .replace(/\s+/g, "")
      .replace(/,/g, ".");
  }

  function sconEapLookupVariants(value) {
    const exact = normalizeSconEap(value);
    if (!exact) return [];
    const variants = [{ key: exact, removedTrailingOne: false, removedTrailingSegment: false }];
    const segments = exact.split(".").filter(Boolean);
    if (segments.length >= 4 && /^\d+$/.test(segments[segments.length - 1])) {
      const parent = segments.slice(0, -1).join(".");
      if (parent) variants.push({
        key: parent,
        removedTrailingOne: segments[segments.length - 1] === "1",
        removedTrailingSegment: true,
      });
    }
    return variants;
  }

  function documentEapFromGroup4(document) {
    const group7 = reportGroup7Info(document);
    return group7.isReport ? cleanSpaces(group7.groups[3]) : "";
  }

  function sconEscopoLookupTag(record, tagEvidence) {
    const group7 = reportGroup7Info(record && record.document);
    const confirmedTag = tagEvidence && tagEvidence.confirmed ? cleanSpaces(tagEvidence.tag) : "";
    if (confirmedTag) {
      return {
        tag: confirmedTag,
        source: group7.unitPrefixRemoved
          ? `TAG confirmada no Grupo 7 após retirar o prefixo redundante ${group7.removedUnitPrefix}`
          : "TAG confirmada no Grupo 7",
        strippedNt: false,
        strippedUnit: group7.unitPrefixRemoved,
      };
    }
    const identifier = cleanSpaces(group7.identifier);
    const withoutNt = group7.lookupIdentifier || identifier.replace(/^NT[-./_]+/i, "").trim();
    if (group7.isNonTagged && withoutNt && withoutNt !== identifier) {
      return {
        tag: withoutNt,
        source: group7.unitPrefixRemoved
          ? `Grupo 7 consultado no SCON ESCOPO sem os prefixos nt- e ${group7.removedUnitPrefix}`
          : "Grupo 7 consultado no SCON ESCOPO sem o prefixo nt-",
        strippedNt: true,
        strippedUnit: group7.unitPrefixRemoved,
      };
    }
    return { tag: "", source: "", strippedNt: false, strippedUnit: false };
  }

  function sconEscopoDisciplineKey(value) {
    const clean = disciplineKey(value);
    const aliases = {
      CVL: "CIVIL",
      CIV: "CIVIL",
      CIVIL: "CIVIL",
      ELE: "ELETRICA",
      ELETRICA: "ELETRICA",
      EST: "EST METALICA",
      "EST MET": "EST METALICA",
      "EST METALICA": "EST METALICA",
      TUB: "TUBULACAO",
      TUBULACAO: "TUBULACAO",
      HVAC: "HVAC",
      DIN: "EQP DINAMICO",
      DINAMICOS: "EQP DINAMICO",
      "EQP DINAMICO": "EQP DINAMICO",
      MEC: "EQP ESTATICO",
      ESTATICO: "EQP ESTATICO",
      ESTATICOS: "EQP ESTATICO",
      "EQP ESTATICO": "EQP ESTATICO",
    };
    return aliases[clean] || clean;
  }

  function cleanSconEscopoTitle(value) {
    return cleanTitlePart(
      removeParentheticalContent(usableDescription(value))
        .replace(/^\s*\d+(?:\.\d+)+\s*[-–—]\s*/, ""),
    );
  }

  function sconEscopoSubjectTitle(entry) {
    const itemType = cleanTitlePart(usableDescription(entry && entry.itemType).replace(/\(each\)/gi, ""));
    const area = cleanTitlePart(usableDescription(entry && entry.area));
    if (itemType && area) return `${itemType} - ÁREA: ${area}`;
    if (itemType) return itemType;
    const clean = cleanSconEscopoTitle(entry && (entry.cleanTitle || entry.title));
    const stage = cleanTitlePart(usableDescription(entry && entry.stage));
    if (stage && clean) {
      const pattern = stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const withoutStage = clean.replace(new RegExp(`^${pattern}\\s+(?:DE|DA|DO|DAS|DOS)?\\s*`, "i"), "");
      if (withoutStage && norm(withoutStage) !== norm(clean)) return cleanTitlePart(withoutStage);
    }
    return clean;
  }

  function sconEscopoActivityEap(value) {
    const title = cleanSpaces(value);
    const match = title.match(/^(\d+(?:\.\d+)+)\s*[-–—]\s*/);
    return match ? normalizeSconEap(match[1]) : "";
  }

  function combineSconEscopoTitles(values) {
    const titles = [...new Map((values || []).map(cleanSconEscopoTitle).filter(Boolean).map((value) => [norm(value), value])).values()];
    if (titles.length < 2) return titles[0] || "";
    const structured = titles.map((title) => {
      const match = title.match(/^(.*?)\s+[-–—]\s+((?:DISCIPLINA|[ÁA]REA)\s*:.*)$/iu);
      return match
        ? { activity: cleanTitlePart(match[1]), metadata: cleanTitlePart(match[2]) }
        : null;
    });
    if (structured.every(Boolean)) {
      const groups = new Map();
      structured.forEach((item) => {
        const key = norm(item.metadata);
        if (!groups.has(key)) groups.set(key, { metadata: item.metadata, activities: [] });
        const group = groups.get(key);
        if (!group.activities.some((activity) => norm(activity) === norm(item.activity))) group.activities.push(item.activity);
      });
      return [...groups.values()]
        .map((group) => `${group.activities.join(" · ")} - ${group.metadata}`)
        .join(" · ");
    }
    const split = titles.map((title) => {
      const match = title.match(/^(.*)\s+[-–—]\s+(.+)$/u);
      return match ? { activity: cleanTitlePart(match[1]), location: cleanTitlePart(match[2]) } : null;
    });
    const commonLocation = split.every(Boolean) && split.every((item) => norm(item.location) === norm(split[0].location))
      ? split[0].location
      : "";
    if (!commonLocation) return titles.join(" · ");
    return `${split.map((item) => item.activity).join(" · ")} - ${commonLocation}`;
  }


  function titleSearchWords(value) {
    const stop = new Set(["RELATORIO", "RELATÓRIO", "DE", "DA", "DO", "DAS", "DOS", "E", "PARA", "EM", "NA", "NO", "DISCIPLINA", "AREA", "ÁREA", "UNIDADE", "U32", "EACH"]);
    return [...new Set(norm(value).split(/[^A-Z0-9]+/).filter((word) => word.length >= 3 && !stop.has(word)))];
  }

  function documentActivityWords(record) {
    const group7 = reportGroup7Info(record && record.document);
    const group6 = cleanSpaces(group7.isReport ? group7.groups[5] : "");
    const aliases = {
      GRACIM: ["GRAUTE", "GRAUTEAMENTO", "CIMENTICIO", "CIMENTÍCIO"],
      LARM: ["LIBERACAO", "LIBERAÇÃO", "ARMADURA"],
      REP: ["REPARO"],
      RIR: ["RECEBIMENTO", "INSPECAO", "INSPEÇÃO"],
      CONTROLTUB: ["CONTROLE", "TUBULACAO", "TUBULAÇÃO", "MONTAGEM", "PREMONTAGEM"],
      INSMOB: ["INSTALACAO", "INSTALAÇÃO", "MOBILIARIO", "MOBILIÁRIO"],
      DESMONT: ["DESMONTAGEM"],
      MONT: ["MONTAGEM"],
      TESTE: ["TESTE"],
    };
    return titleSearchWords([
      record && record.title,
      group6,
      ...(aliases[norm(group6)] || []),
    ].filter(Boolean).join(" "));
  }

  function commonEapPrefixLength(left, right) {
    const a = normalizeSconEap(left).split(".").filter(Boolean);
    const b = normalizeSconEap(right).split(".").filter(Boolean);
    let count = 0;
    while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
    return count;
  }

  function tagStemTokens(value) {
    const ignored = new Set(["NT", "RNEST", "U", "U32", "SE", "AREA"]);
    return (norm(value).match(/[A-Z]{3,}|\d{2,}/g) || [])
      .filter((token) => !ignored.has(token));
  }

  function commonTokenPrefixLength(left, right) {
    const size = Math.min(left.length, right.length);
    let count = 0;
    while (count < size && left[count] === right[count]) count += 1;
    return count;
  }

  function tagStemSimilarity(lookupTag, candidateTag) {
    const lookupTokens = tagStemTokens(lookupTag);
    const candidateTokens = tagStemTokens(candidateTag);
    let score = 0;
    lookupTokens.forEach((left) => {
      candidateTokens.forEach((right) => {
        if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
          if (String(Number(left)) === String(Number(right))) score = Math.max(score, 10);
          return;
        }
        if (/^\d+$/.test(left) || /^\d+$/.test(right)) return;
        const prefix = commonTokenPrefixLength(left, right);
        if (prefix >= 5) score = Math.max(score, 20 + prefix);
      });
    });
    return score;
  }

  function activityOverlapScore(record, entry) {
    const wanted = documentActivityWords(record);
    if (!wanted.length) return 0;
    const candidate = new Set(titleSearchWords(`${entry && entry.stage || ""} ${entry && entry.cleanTitle || ""}`));
    return wanted.reduce((score, word) => score + (candidate.has(word) ? (word.length >= 6 ? 12 : 7) : 0), 0);
  }

  function subjectCompatibilityScore(record, entry) {
    const currentTokens = titleSearchWords(record && record.title);
    const subject = usableDescription(entry && entry.itemType)
      || cleanSpaces(entry && (entry.subjectTitle || sconEscopoSubjectTitle(entry))).split(/\s+[-–—]\s+(?:[ÁA]REA|DISCIPLINA)\s*:/i)[0];
    const subjectTokens = titleSearchWords(subject);
    let score = 0;
    currentTokens.forEach((left) => {
      subjectTokens.forEach((right) => {
        const prefix = commonTokenPrefixLength(left, right);
        if (prefix >= 5) score = Math.max(score, prefix);
      });
    });
    return score;
  }

  function resolveSconEscopoByEapAndContext(record, catalog, lookupTag, eapLookups) {
    if (!catalog || !catalog.byEap || !lookupTag || !eapLookups || !eapLookups.length) return null;
    const wantedDiscipline = sconEscopoDisciplineKey(record && record.discipline);
    const entries = [...new Map(eapLookups.flatMap((lookup) => catalog.byEap.get(lookup.key) || []).map((entry) => [
      `${entry.row}|${norm(entry.tag)}|${norm(entry.cleanTitle)}`,
      entry,
    ])).values()].filter((entry) => !wantedDiscipline || sconEscopoDisciplineKey(entry.discipline) === wantedDiscipline);
    if (!entries.length) return null;

    const stemRanked = entries
      .map((entry) => ({ entry, score: tagStemSimilarity(lookupTag, entry.tag) }))
      .filter((item) => item.score >= 25)
      .sort((left, right) => right.score - left.score || left.entry.row - right.entry.row);
    if (stemRanked.length) {
      const topScore = stemRanked[0].score;
      const selected = stemRanked.filter((item) => item.score === topScore).map((item) => item.entry);
      const titleSelection = chooseSconEscopoTitle(record, selected, eapLookups[0].key);
      if (titleSelection.title) {
        return {
          entries: selected,
          items: selected.map((entry) => ({ entry, alias: entry.tag, aliasKey: normalizedTagKey(entry.tag) })),
          strictExact: false,
          normalizedMatch: false,
          canonicalMatch: false,
          containedMatch: true,
          fragmentMatch: true,
          eapStemFallback: true,
          eapActivityFallback: false,
          contextTitle: titleSelection.title,
        };
      }
    }

    // O fallback sem TAG exata é restrito a relatórios de reparo (REP).
    // Em outros tipos documentais, como RUFF, o título atual pode já estar específico;
    // sugerir apenas por EAP + atividade criaria uma alteração desnecessária.
    const group7 = reportGroup7Info(record && record.document);
    const documentTypeGroup = norm(group7 && group7.isReport ? group7.groups[5] : "");
    if (documentTypeGroup !== "REP") return null;

    const activityRanked = entries
      .map((entry) => ({
        entry,
        score: activityOverlapScore(record, entry),
        subjectScore: subjectCompatibilityScore(record, entry),
      }))
      .filter((item) => item.score > 0 && item.subjectScore >= 5)
      .sort((left, right) => right.score - left.score || left.entry.row - right.entry.row);
    if (!activityRanked.length) return null;
    const topScore = activityRanked[0].score;
    const topEntries = activityRanked.filter((item) => item.score === topScore).map((item) => item.entry);
    const titleSelection = chooseSconEscopoTitle(record, topEntries, eapLookups[0].key);
    if (!titleSelection.title) return null;
    const distinctSubjects = [...new Set(topEntries.map((entry) => norm(entry.subjectTitle || sconEscopoSubjectTitle(entry))).filter(Boolean))];
    if (distinctSubjects.length !== 1) return null;
    return {
      entries: topEntries,
      items: topEntries.map((entry) => ({ entry, alias: entry.tag, aliasKey: normalizedTagKey(entry.tag) })),
      strictExact: false,
      normalizedMatch: false,
      canonicalMatch: false,
      containedMatch: false,
      fragmentMatch: false,
      eapStemFallback: false,
      eapActivityFallback: true,
      contextTitle: titleSelection.title,
    };
  }

  function scoreSconEscopoEntry(record, entry, wantedEap) {
    const activityWords = documentActivityWords(record);
    const candidateWords = new Set(titleSearchWords(`${entry && entry.stage || ""} ${entry && entry.itemType || ""} ${entry && entry.cleanTitle || ""}`));
    let score = 0;
    if (wantedEap && entry && entry.activityEapKey === wantedEap) score += 100;
    if (wantedEap && entry && entry.eapKey === wantedEap) score += 60;
    if (wantedEap && entry && entry.eapKey) score += commonEapPrefixLength(wantedEap, entry.eapKey) * 12;
    activityWords.forEach((word) => { if (candidateWords.has(word)) score += word.length >= 6 ? 8 : 4; });
    return score;
  }

  function chooseSconEscopoTitle(record, candidates, wantedEap) {
    const groups = new Map();
    (candidates || []).forEach((entry) => {
      const recommendationTitle = entry && (entry.subjectTitle || sconEscopoSubjectTitle(entry));
      const key = norm(recommendationTitle);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { title: recommendationTitle, entries: [], score: -Infinity });
      const group = groups.get(key);
      group.entries.push(entry);
      group.score = Math.max(group.score, scoreSconEscopoEntry(record, entry, wantedEap));
    });
    const ranked = [...groups.values()].sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "pt-BR"));
    if (!ranked.length) return { title: "", entries: [], alternatives: [], combined: false, score: 0 };
    if (ranked.length === 1) return { title: ranked[0].title, entries: ranked[0].entries, alternatives: [ranked[0].title], combined: false, score: ranked[0].score };
    const top = ranked[0];
    const second = ranked[1];
    if (top.score > second.score && top.score > 0) {
      return { title: top.title, entries: top.entries, alternatives: ranked.map((item) => item.title), combined: false, score: top.score };
    }
    return {
      title: combineSconEscopoTitles(ranked.map((item) => item.title)),
      entries: ranked.flatMap((item) => item.entries),
      alternatives: ranked.map((item) => item.title),
      combined: true,
      score: top.score,
    };
  }

  function resolveCatalogTagCandidates(catalog, lookupTag, discipline) {
    if (!catalog || !lookupTag || !catalog.byExactTag) return null;
    const variants = expandedCompactTagAliases(lookupTag);
    const wantedDiscipline = sconEscopoDisciplineKey(discipline);
    const scopeEntries = (entries) => {
      const clean = entries || [];
      if (!wantedDiscipline) return clean;
      const matched = clean.filter((entry) => sconEscopoDisciplineKey(entry && entry.discipline) === wantedDiscipline);
      return matched.length ? matched : clean;
    };
    const itemsFromEntries = (entries) => scopeEntries(entries).map((entry) => ({
      entry,
      alias: entry.tag,
      aliasKey: normalizedTagKey(entry.tag),
    }));
    const uniqueItems = (items) => [...new Map((items || []).map((item) => [
      `${canonicalTagKey(item.alias)}|${item.entry && item.entry.row || 0}|${norm(item.entry && (item.entry.cleanTitle || item.entry.description))}`,
      item,
    ])).values()];

    const strictItems = uniqueItems(variants.flatMap((variant) => itemsFromEntries(catalog.byExactTag.get(strictTagKey(variant)) || [])));
    if (strictItems.length) {
      return {
        entries: strictItems.map((item) => item.entry),
        items: strictItems,
        strictExact: variants.length === 1,
        normalizedMatch: false,
        canonicalMatch: false,
        containedMatch: variants.length > 1,
        fragmentMatch: false,
        expandedCompactTag: variants.length > 1,
      };
    }

    const canonicalItems = catalog.byCanonicalTag
      ? uniqueItems(variants.flatMap((variant) => itemsFromEntries(catalog.byCanonicalTag.get(canonicalTagKey(variant)) || [])))
      : [];
    if (canonicalItems.length) {
      return {
        entries: canonicalItems.map((item) => item.entry),
        items: canonicalItems,
        strictExact: false,
        normalizedMatch: false,
        canonicalMatch: true,
        containedMatch: variants.length > 1,
        fragmentMatch: false,
        expandedCompactTag: variants.length > 1,
      };
    }

    const tryResolve = (variant, wanted) => {
      const normalized = normalizedTagMatches(catalog.byNormalizedTag, variant, wanted, true);
      const progressive = !normalized || !normalized.exactNormalized
        ? progressiveTagFragmentMatches(catalog.byNormalizedTag, variant, wanted)
        : null;
      return normalized && normalized.exactNormalized ? normalized : mergeContainedTagMatches(normalized, progressive);
    };
    let resolvedMatches = variants.map((variant) => tryResolve(variant, discipline)).filter(Boolean);
    if (!resolvedMatches.length) resolvedMatches = variants.map((variant) => tryResolve(variant, "")).filter(Boolean);
    if (!resolvedMatches.length) return null;
    const unique = uniqueItems(resolvedMatches.flatMap((resolved) => resolved.candidates || []));
    const keys = [...new Set(unique.map((item) => item.aliasKey).filter(Boolean))];
    const maximalKeys = keys.filter((key) => !keys.some((other) => other !== key && other.includes(key)));
    const items = unique.filter((item) => maximalKeys.includes(item.aliasKey));
    return items.length ? {
      entries: items.map((item) => item.entry),
      items,
      strictExact: false,
      normalizedMatch: resolvedMatches.some((resolved) => Boolean(resolved.exactNormalized)),
      canonicalMatch: false,
      containedMatch: variants.length > 1 || resolvedMatches.some((resolved) => Boolean(resolved.contained)),
      fragmentMatch: resolvedMatches.some((resolved) => Boolean(resolved.fragment)),
      expandedCompactTag: variants.length > 1,
    } : null;
  }

  function parseTagReferenceCatalog(catalog) {
    const meta = catalog && catalog.meta || {};
    const entries = (catalog && catalog.entries || []).map((entry, index) => ({
      tag: cleanSpaces(entry && entry.tag),
      description: cleanTitlePart(usableDescription(entry && entry.description)),
      discipline: cleanSpaces(entry && entry.discipline),
      unit: cleanSpaces(entry && entry.unit),
      equipmentArea: cleanSpaces(entry && entry.equipmentArea),
      row: Number(entry && entry.row) || index + 1,
      sourceFile: meta.source || "Apêndice 3 - Fornecimento de Bens Tagueados Rev.B",
      sourceSheet: meta.sheet || "Apêndice",
    })).filter((entry) => entry.tag && entry.description && /\d/.test(entry.tag) && normalizedTagKey(entry.tag).length >= 5);
    const byExactTag = new Map();
    const byNormalizedTag = new Map();
    const byCanonicalTag = new Map();
    entries.forEach((entry) => {
      const key = strictTagKey(entry.tag);
      if (!byExactTag.has(key)) byExactTag.set(key, []);
      byExactTag.get(key).push(entry);
      const canonicalKey = canonicalTagKey(entry.tag);
      if (canonicalKey) {
        if (!byCanonicalTag.has(canonicalKey)) byCanonicalTag.set(canonicalKey, []);
        byCanonicalTag.get(canonicalKey).push(entry);
      }
      addNormalizedTagCandidate(byNormalizedTag, entry.tag, entry, "TAG do Apêndice 3 Rev.B");
    });
    return {
      kind: "tag-reference-catalog",
      entries,
      byExactTag,
      byNormalizedTag,
      byCanonicalTag,
      uniqueTagCount: byExactTag.size,
      sourceFile: meta.source || "Apêndice 3 - Fornecimento de Bens Tagueados Rev.B",
      sourceSheet: meta.sheet || "Apêndice",
    };
  }

  function tagReferenceFor(record, references, tagEvidence) {
    const catalog = references && references.tagReference;
    const lookup = sconEscopoLookupTag(record, tagEvidence);
    if (!catalog || !lookup.tag) return null;
    const resolved = resolveCatalogTagCandidates(catalog, lookup.tag, record && record.discipline);
    if (!resolved || !resolved.items.length) return null;
    const grouped = new Map();
    resolved.items.forEach((item) => {
      if (!grouped.has(item.aliasKey)) grouped.set(item.aliasKey, []);
      grouped.get(item.aliasKey).push(item.entry);
    });
    const chosen = [];
    grouped.forEach((entries) => {
      const descriptions = [...new Map(entries.map((entry) => [norm(entry.description), entry.description]).filter(([key]) => key)).values()];
      if (!descriptions.length) return;
      chosen.push({
        tag: entries[0].tag,
        description: combineTitleDescriptions(...descriptions),
        entries,
      });
    });
    const descriptions = [...new Map(chosen.map((item) => [norm(item.description), item.description])).values()];
    if (!descriptions.length) return null;
    const matchedAliases = chosen.map((item) => item.tag);
    const sourceRows = [...new Set(chosen.flatMap((item) => item.entries.map((entry) => entry.row)).filter(Boolean))];
    const tagMode = resolved.strictExact
      ? "TAG exata"
      : resolved.canonicalMatch
        ? "TAG equivalente após normalizar zeros e pontuação"
        : resolved.expandedCompactTag
          ? `${matchedAliases.length} TAGs expandidas do código compacto no Grupo 7`
          : resolved.fragmentMatch
            ? "TAG localizada por busca progressiva em partes do Grupo 7"
            : resolved.containedMatch
              ? containedTagMatchLabel(matchedAliases.length)
              : "TAG equivalente após normalizar pontuação";
    return {
      ...chosen[0].entries[0],
      tag: matchedAliases.length === 1 ? matchedAliases[0] : "",
      description: combineTitleDescriptions(...descriptions),
      title: combineTitleDescriptions(...descriptions),
      trusted: true,
      exactTag: resolved.strictExact,
      normalizedTag: resolved.normalizedMatch,
      containedTag: resolved.containedMatch,
      fragmentTag: resolved.fragmentMatch,
      matchedAliases,
      lookupTag: lookup.tag,
      lookupTagSource: lookup.source,
      lookupTagFromNt: lookup.strippedNt,
      candidateCount: descriptions.length,
      candidateTitles: descriptions,
      sourceRows,
      ambiguousDescription: false,
      matchMode: `${tagMode}; descrição de equipamento localizada no Apêndice 3 Rev.B`,
    };
  }

  function parseSconEscopoTitleCatalog(catalog) {
    const columns = catalog && catalog.columns || [];
    const position = new Map(columns.map((name, index) => [name, index]));
    const at = (row, name) => position.has(name) ? row[position.get(name)] : "";
    const entries = (catalog && catalog.rows || []).map((row) => {
      const sourceTitle = usableDescription(at(row, "title"));
      return {
        tag: cleanSpaces(at(row, "tag")),
        title: sourceTitle,
        cleanTitle: cleanSconEscopoTitle(sourceTitle),
        discipline: cleanSpaces(at(row, "discipline")),
        row: Number(at(row, "row")) || 0,
        area: cleanSpaces(at(row, "area")),
        itemType: cleanSpaces(at(row, "type")),
        stage: cleanSpaces(at(row, "stage")),
        eap: cleanSpaces(at(row, "eap")),
        eapKey: normalizeSconEap(at(row, "eap")),
        activityEapKey: sconEscopoActivityEap(sourceTitle),
        subjectTitle: sconEscopoSubjectTitle({
          itemType: at(row, "type"),
          area: at(row, "area"),
          stage: at(row, "stage"),
          title: sourceTitle,
        }),
        sourceFile: catalog && catalog.sourceFile || "SCON ESCOPO",
        sourceSheet: catalog && catalog.sheet || "MAPA",
      };
    }).filter((entry) => entry.tag && entry.cleanTitle);

    const byExactTag = new Map();
    const byNormalizedTag = new Map();
    const byCanonicalTag = new Map();
    const byEap = new Map();
    entries.forEach((entry) => {
      const key = strictTagKey(entry.tag);
      if (!byExactTag.has(key)) byExactTag.set(key, []);
      byExactTag.get(key).push(entry);
      const canonicalKey = canonicalTagKey(entry.tag);
      if (canonicalKey) {
        if (!byCanonicalTag.has(canonicalKey)) byCanonicalTag.set(canonicalKey, []);
        byCanonicalTag.get(canonicalKey).push(entry);
      }
      addNormalizedTagCandidate(byNormalizedTag, entry.tag, entry, "TAG da SCON ESCOPO");
      if (entry.eapKey) {
        if (!byEap.has(entry.eapKey)) byEap.set(entry.eapKey, []);
        byEap.get(entry.eapKey).push(entry);
      }
    });
    return {
      kind: "scon-escopo-title-catalog",
      entries,
      byExactTag,
      byNormalizedTag,
      byCanonicalTag,
      byEap,
      uniqueTagCount: byExactTag.size,
      uniqueEapCount: new Set(entries.map((entry) => entry.eapKey).filter(Boolean)).size,
      sourceFile: catalog && catalog.sourceFile || "SCON ESCOPO",
      sourceSheet: catalog && catalog.sheet || "MAPA",
      matchPolicy: catalog && catalog.matchPolicy || "TAG exata",
    };
  }

  function sconEscopoReferenceFor(record, references, tagEvidence, options) {
    const catalog = references && references.sconEscopo;
    const lookup = sconEscopoLookupTag(record, tagEvidence);
    const lookupTag = lookup.tag;
    if (!catalog || !lookupTag) return null;
    const documentEap = documentEapFromGroup4(record && record.document);
    const eapLookups = sconEapLookupVariants(documentEap);
    let resolved = resolveCatalogTagCandidates(catalog, lookupTag, record && record.discipline);
    if ((!resolved || !resolved.items.length) && catalog.entries && eapLookups.length) {
      const lookupCanonical = canonicalTagKey(lookupTag);
      const wantedEaps = new Set(eapLookups.map((item) => item.key));
      const wantedDiscipline = sconEscopoDisciplineKey(record && record.discipline);
      const extended = catalog.entries.filter((entry) => {
        const entryCanonical = canonicalTagKey(entry && entry.tag);
        if (!lookupCanonical || !entryCanonical.startsWith(lookupCanonical)) return false;
        const suffix = entryCanonical.slice(lookupCanonical.length);
        if (!/^(?:EL|L)?\d{1,2}$/.test(suffix)) return false;
        if (!wantedEaps.has(entry.eapKey)) return false;
        return !wantedDiscipline || sconEscopoDisciplineKey(entry.discipline) === wantedDiscipline;
      });
      if (extended.length) {
        resolved = {
          entries: extended,
          items: extended.map((entry) => ({ entry, alias: entry.tag, aliasKey: normalizedTagKey(entry.tag) })),
          strictExact: false,
          normalizedMatch: false,
          canonicalMatch: false,
          containedMatch: true,
          fragmentMatch: true,
          prefixExtensionMatch: true,
          expandedCompactTag: false,
        };
      }
    }
    if ((!resolved || !resolved.items.length) && (!options || options.allowContextFallback !== false)) {
      resolved = resolveSconEscopoByEapAndContext(record, catalog, lookupTag, eapLookups);
    }
    if (!resolved || !resolved.items.length) return null;

    const wantedEap = eapLookups[0] && eapLookups[0].key || "";
    const allCandidates = [...new Map(resolved.items.map((item) => [
      `${item.aliasKey}|${item.entry.row}|${norm(item.entry.cleanTitle)}`,
      item,
    ])).values()];
    const candidateEaps = [...new Set(allCandidates.map((item) => cleanSpaces(item.entry.eap)).filter(Boolean))];
    let matchedEapLookup = null;
    let eapItems = [];
    for (const eapLookup of eapLookups) {
      const matches = allCandidates.filter((item) => item.entry.eapKey === eapLookup.key);
      if (!matches.length) continue;
      matchedEapLookup = eapLookup;
      eapItems = matches;
      break;
    }
    const eapMatched = Boolean(matchedEapLookup && eapItems.length);
    const matchedEap = matchedEapLookup && matchedEapLookup.key || "";
    const eapMatchedWithoutTrailingOne = Boolean(matchedEapLookup && matchedEapLookup.removedTrailingOne);
    const eapMatchedByParent = Boolean(matchedEapLookup && matchedEapLookup.removedTrailingSegment);
    let scopedItems = eapMatched ? eapItems : allCandidates;
    let activityEapMatched = false;
    if (eapMatchedByParent && wantedEap) {
      const activityMatches = scopedItems.filter((item) => item.entry.activityEapKey === wantedEap);
      if (activityMatches.length) {
        scopedItems = activityMatches;
        activityEapMatched = true;
      }
    }

    const wantedDiscipline = sconEscopoDisciplineKey(record && record.discipline);
    const sameDiscipline = wantedDiscipline
      ? scopedItems.filter((item) => sconEscopoDisciplineKey(item.entry.discipline) === wantedDiscipline)
      : [];
    if (sameDiscipline.length) scopedItems = sameDiscipline;

    const groupedByTag = new Map();
    scopedItems.forEach((item) => {
      if (!groupedByTag.has(item.aliasKey)) groupedByTag.set(item.aliasKey, []);
      groupedByTag.get(item.aliasKey).push(item.entry);
    });
    const selectedGroups = [];
    groupedByTag.forEach((entries, key) => {
      const selection = chooseSconEscopoTitle(record, entries, wantedEap);
      if (!selection.title) return;
      selectedGroups.push({ key, tag: entries[0].tag, selection });
    });
    if (!selectedGroups.length) return null;

    const distinctTitles = [...new Map(selectedGroups.map((group) => [norm(group.selection.title), group.selection.title])).values()];
    let combinedTitle = combineSconEscopoTitles(distinctTitles);
    if (!combinedTitle) return null;
    // No fallback EAP + atividade, o prefixo do título já informa o objeto
    // (por exemplo, "REPARO DE VÁLVULAS"). Retira o item repetido da base
    // para evitar resultados como "... VÁLVULAS - VALVULA - ÁREA ...".
    if (resolved.eapActivityFallback) {
      const firstFallbackEntry = selectedGroups[0] && selectedGroups[0].selection && selectedGroups[0].selection.entries
        ? selectedGroups[0].selection.entries[0]
        : null;
      const itemType = cleanTitlePart(usableDescription(firstFallbackEntry && firstFallbackEntry.itemType).replace(/\(each\)/gi, ""));
      if (itemType) {
        const escapedItemType = itemType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const withoutRepeatedSubject = cleanTitlePart(combinedTitle.replace(new RegExp(`^${escapedItemType}\\s*[-–—]\\s*`, "i"), ""));
        if (withoutRepeatedSubject) combinedTitle = withoutRepeatedSubject;
      }
    }
    const catalogAliases = selectedGroups.map((group) => group.tag);
    const matchedAliases = resolved.eapActivityFallback ? [] : catalogAliases;
    const chosenEntries = selectedGroups.flatMap((group) => group.selection.entries);
    const sourceRows = [...new Set(chosenEntries.map((entry) => entry.row).filter(Boolean))];
    const first = chosenEntries[0] || scopedItems[0].entry;
    const tagMode = resolved.eapActivityFallback
      ? "fallback seguro por EAP + atividade documental, sem equivaler o critério de medição à TAG"
      : resolved.eapStemFallback
        ? "parte textual da TAG localizada no mesmo EAP"
        : resolved.strictExact
      ? "TAG exata"
      : resolved.prefixExtensionMatch
        ? "TAG principal localizada em códigos derivados com o mesmo EAP"
        : resolved.canonicalMatch
          ? "TAG equivalente após normalizar zeros e pontuação"
          : resolved.expandedCompactTag
            ? `${matchedAliases.length} TAGs expandidas do código compacto no Grupo 7`
            : resolved.fragmentMatch
              ? "TAG localizada por busca progressiva em partes do Grupo 7"
              : resolved.containedMatch
                ? containedTagMatchLabel(matchedAliases.length)
                : "TAG equivalente após normalizar pontuação";
    const eapMode = activityEapMatched
      ? ` + EAP-base ${matchedEap} e atividade exata ${documentEap}`
      : eapMatchedWithoutTrailingOne
        ? ` + EAP ${matchedEap} após retirar o .1 final de ${documentEap}`
        : eapMatchedByParent
          ? ` + EAP-base ${matchedEap}`
          : eapMatched
            ? ` + EAP ${documentEap} do 4º grupo`
            : wantedEap
              ? ` + fallback pela mesma TAG em outro EAP (o EAP ${documentEap} representa outro critério de medição)`
              : "";
    const normalization = [lookup.strippedNt ? "nt-" : "", lookup.strippedUnit ? "U32" : ""].filter(Boolean);
    const baseMode = `${normalization.length ? `${tagMode} após retirar ${normalization.join(" e ")} do Grupo 7` : tagMode}${eapMode}`;
    return {
      ...first,
      tag: matchedAliases.length === 1 ? matchedAliases[0] : "",
      description: combinedTitle,
      title: combinedTitle,
      trusted: true,
      exactTag: resolved.strictExact,
      normalizedTag: resolved.normalizedMatch,
      containedTag: resolved.containedMatch,
      fragmentTag: resolved.fragmentMatch,
      matchedAliases,
      catalogAliases,
      tagFallback: Boolean(resolved.eapActivityFallback),
      tagStemFallback: Boolean(resolved.eapStemFallback),
      lookupTag,
      lookupTagSource: lookup.source,
      lookupTagFromNt: lookup.strippedNt,
      documentEap,
      eapMatched,
      eapFallback: Boolean(wantedEap && !eapMatched),
      matchedEap,
      eapMatchedWithoutTrailingOne,
      eapMatchedByParent,
      activityEapMatched,
      candidateEaps,
      disciplineMatched: Boolean(sameDiscipline.length),
      ambiguousDescription: false,
      candidateCount: distinctTitles.length,
      candidateTitles: distinctTitles,
      combinedActivities: distinctTitles.length > 1 || selectedGroups.some((group) => group.selection.combined),
      sourceRows,
      matchMode: `${baseMode}${sameDiscipline.length ? " + disciplina" : ""}${distinctTitles.length > 1 ? `; ${distinctTitles.length} títulos compatíveis combinados` : ""}`,
    };
  }

  function parseTitleReferenceWorkbook(workbook, XLSX) {
    const entries = [];
    const sconEntries = [];
    (workbook && workbook.SheetNames || []).forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet["!ref"]) return;
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const sheetNorm = norm(sheetName);
      if (sheetNorm === "ANALISE COMPLETA" && rows.length) {
        const headers = new Map((rows[0] || []).map((value, index) => [norm(value), index]));
        const at = (name) => headers.has(norm(name)) ? headers.get(norm(name)) : -1;
        const columns = {
          document: at("Documento Planilha1"), tag: at("Tag"), discipline: at("Disciplina"),
          type: at("Tipo de documento"), description: at("Descrição sugerida"),
          confidence: at("Confiança"), manual: at("Revisão manual"), origin: at("Origem da conclusão"),
          referenceDocument: at("Documento ET de referência"), referenceDescription: at("Descrição ET de referência"),
          scon: at("SCON Planilha1"), complementary: at("Complementar Planilha1"),
          similarity: at("Similaridade %"), observation: at("Observação"),
        };
        if (columns.document >= 0 && columns.description >= 0) {
          for (let index = 1; index < rows.length; index += 1) {
            const row = rows[index] || [];
            const document = text(row[columns.document]);
            if (!document) continue;
            const manualReview = columns.manual >= 0 && norm(row[columns.manual]) === "SIM";
            entries.push({
              document,
              documentKey: C.key(document),
              tag: columns.tag >= 0 ? text(row[columns.tag]) : "",
              discipline: columns.discipline >= 0 ? text(row[columns.discipline]) : "",
              documentType: columns.type >= 0 ? text(row[columns.type]) : "",
              description: referenceDescriptionCandidate(columns.scon >= 0 ? row[columns.scon] : "")
                || referenceDescriptionCandidate(columns.complementary >= 0 ? row[columns.complementary] : "")
                || referenceDescriptionCandidate(row[columns.description]),
              title: "",
              confidence: columns.confidence >= 0 ? norm(row[columns.confidence]).toLowerCase() : "nenhuma",
              manualReview,
              origin: columns.origin >= 0 ? text(row[columns.origin]) : "",
              referenceDocument: columns.referenceDocument >= 0 ? text(row[columns.referenceDocument]) : "",
              referenceDescription: columns.referenceDescription >= 0 ? usableDescription(row[columns.referenceDescription]) : "",
              similarity: columns.similarity >= 0 ? text(row[columns.similarity]) : "",
              observation: columns.observation >= 0 ? text(row[columns.observation]) : "",
              sourceSheet: sheetName,
              row: index + 1,
              verifiedCatalog: true,
            });
          }
          return;
        }
      }
      let sconHeaderRow = -1;
      let sconColumns = null;
      for (let index = 0; index < Math.min(rows.length, 45); index += 1) {
        const row = rows[index] || [];
        const headers = new Map(row.map((value, columnIndex) => [norm(value), columnIndex]));
        const document = headers.has("CODIGO SGP") ? headers.get("CODIGO SGP") : headers.has("CÓDIGO SGP") ? headers.get("CÓDIGO SGP") : -1;
        const description = headers.has("DESCRICAO") ? headers.get("DESCRICAO") : headers.has("DESCRIÇÃO") ? headers.get("DESCRIÇÃO") : -1;
        if (document >= 0 && description >= 0) {
          sconHeaderRow = index;
          sconColumns = {
            document,
            description,
            tag: headers.has("TAG") ? headers.get("TAG") : -1,
            discipline: headers.has("DISCIPLINA") ? headers.get("DISCIPLINA") : -1,
            itemType: headers.has("TIPO DE ITEM") ? headers.get("TIPO DE ITEM") : -1,
            drawingReference: headers.has("DESENHO DE REFERENCIA") ? headers.get("DESENHO DE REFERENCIA") : headers.has("DESENHO DE REFERÊNCIA") ? headers.get("DESENHO DE REFERÊNCIA") : -1,
          };
          break;
        }
      }
      if (sconColumns) {
        for (let index = sconHeaderRow + 1; index < rows.length; index += 1) {
          const row = rows[index] || [];
          const document = text(row[sconColumns.document]);
          const parsedDescription = parseSconDescription(row[sconColumns.description]);
          if (!document || !parsedDescription.titleComplement) continue;
          sconEntries.push({
            document,
            documentKey: C.key(document),
            looseDocumentKey: C.looseKey(document),
            titleComplement: parsedDescription.titleComplement,
            fullDescription: parsedDescription.full,
            descriptionArea: parsedDescription.area,
            descriptionDiscipline: parsedDescription.discipline,
            sconTag: sconColumns.tag >= 0 ? usableDescription(row[sconColumns.tag]) : "",
            discipline: sconColumns.discipline >= 0 ? usableDescription(row[sconColumns.discipline]) : "",
            itemType: sconColumns.itemType >= 0 ? usableDescription(row[sconColumns.itemType]) : "",
            drawingReference: sconColumns.drawingReference >= 0 ? usableDescription(row[sconColumns.drawingReference]) : "",
            sourceFile: "SCON - TAG SGP",
            sourceSheet: sheetName,
            row: index + 1,
            verifiedCatalog: true,
            confidence: "alta",
          });
        }
        return;
      }

      let headerRow = -1;
      let columns = null;
      for (let index = 0; index < Math.min(rows.length, 45); index += 1) {
        const row = rows[index] || [];
        const document = headerIndex(row, DOC_HEADERS);
        const tag = headerIndex(row, TAG_HEADERS);
        const description = headerIndex(row, DESCRIPTION_HEADERS);
        const title = headerIndex(row, TITLE_HEADERS);
        const discipline = headerIndex(row, DISCIPLINE_HEADERS);
        if (document >= 0 && (tag >= 0 || description >= 0 || title >= 0)) {
          headerRow = index;
          columns = { document, tag, description, title, discipline };
          break;
        }
      }
      if (columns) {
        for (let index = headerRow + 1; index < rows.length; index += 1) {
          const row = rows[index] || [];
          const document = text(row[columns.document]);
          const tag = columns.tag >= 0 ? text(row[columns.tag]) : "";
          const description = columns.description >= 0 ? usableDescription(row[columns.description]) : "";
          const title = columns.title >= 0 ? text(row[columns.title]) : "";
          const discipline = columns.discipline >= 0 ? text(row[columns.discipline]) : "";
          if (document && (tag || description || title)) entries.push({ document, documentKey: C.key(document), tag, description, title, discipline, sourceSheet: sheetName, row: index + 1 });
        }
        return;
      }
      if (sheetNorm === "PLANILHA1") {
        rows.forEach((row, index) => {
          const document = text(row && row[1]);
          const tag = text(row && row[8]);
          if (document && tag && index > 0) entries.push({ document, documentKey: C.key(document), tag, description: "", title: "", discipline: "", sourceSheet: sheetName, row: index + 1 });
        });
      } else if (sheetNorm === "ET") {
        rows.forEach((row, index) => {
          const document = text(row && row[1]);
          const description = usableDescription(row && row[4]);
          if (document && description && index > 0) entries.push({ document, documentKey: C.key(document), tag: extractTagFromDocument(document), description, title: "", discipline: "", sourceSheet: sheetName, row: index + 1 });
        });
      }
    });
    entries.forEach((entry) => {
      const originalTag = cleanSpaces(entry.tag);
      const tag = documentDeclaresNonTag(entry.document) ? "" : validatedTag(originalTag);
      entry.tag = tag;
      if (originalTag && !tag) entry.ignoredTag = originalTag;
    });
    const byDocument = new Map();
    const byTagDiscipline = new Map();
    entries.forEach((entry) => {
      if (!entry.documentKey) return;
      if (!byDocument.has(entry.documentKey)) byDocument.set(entry.documentKey, { ...entry });
      else {
        const current = byDocument.get(entry.documentKey);
        if (entry.tag && current.tag && norm(entry.tag) !== norm(current.tag)) { current.tag = ""; current.ambiguousTag = true; }
        else if (!current.tag) current.tag = entry.tag;
        if (entry.description && current.description && norm(entry.description) !== norm(current.description)) { current.description = ""; current.ambiguousDescription = true; }
        else if (!current.description) current.description = entry.description;
        if (!current.title) current.title = entry.title;
        if (!current.discipline) current.discipline = entry.discipline;
        current.manualReview = Boolean(current.manualReview || entry.manualReview || current.ambiguousDescription || current.ambiguousTag);
        if (entry.confidence === "baixa" || current.confidence === "baixa") current.confidence = "baixa";
        else if (entry.confidence === "media" || current.confidence === "media") current.confidence = "media";
        current.verifiedCatalog = Boolean(current.verifiedCatalog || entry.verifiedCatalog);
        current.sourceSheet = [...new Set(`${current.sourceSheet || ""}|${entry.sourceSheet || ""}`.split("|").filter(Boolean))].join(" · ");
      }
    });
    [...byDocument.values()].forEach((entry) => {
      const tag = norm(validatedTag(entry.tag) || extractTagFromDocument(entry.document));
      const discipline = disciplineKey(entry.discipline);
      if (tag && entry.description) {
        const key = `${tag}|${discipline}`;
        if (!byTagDiscipline.has(key)) byTagDiscipline.set(key, []);
        byTagDiscipline.get(key).push(entry);
      }
    });
    const scon = buildSconReferenceIndex(sconEntries, {
      sourceFile: "SCON - TAG SGP",
      sheet: sconEntries[0] && sconEntries[0].sourceSheet || "",
    });
    return {
      entries,
      byDocument,
      byTagDiscipline,
      scon,
      kind: scon.entries.length && !entries.length ? "scon" : scon.entries.length ? "mixed" : "reference",
    };
  }

  function titleLooksGeneric(title, type) {
    const n = norm(title);
    if (n === "RESERVADO") return false;
    if (isUnavailableValue(title)) return true;
    const residual = stripKnownParts(title, type, "");
    const words = norm(residual).split(/[^A-Z0-9]+/).filter((item) => item.length >= 3);
    const typeWords = norm(type).split(/[^A-Z0-9]+/).filter((item) => item.length >= 4 && !["RELATORIO", "INSPECAO", "LIBERACAO"].includes(item));
    // Um título operacional já é específico quando informa claramente a atividade/objeto
    // e termina com um identificador técnico (por exemplo VM-327724 ou NF-112973).
    // Nesses casos não existe ganho em inventar uma descrição que não está nas bases.
    if (technicalIdentifiers(residual).length && typeWords.length >= 2) return false;
    return words.length < 2 || norm(residual) === norm(type);
  }

  function tagRequired(record, type, tag) {
    if (norm(record.sheet) === "CV" || /-C1O-CV-/.test(norm(record.document))) return false;
    if (documentDeclaresNonTag(record && record.document)) return false;
    return Boolean(tag);
  }

  function technicalIdentifiers(value) {
    const matches = unwrapTitle(value).match(/\b[A-Z0-9]{1,4}(?:-[A-Z])?-[A-Z0-9][A-Z0-9._/-]{2,}\b/gi) || [];
    return [...new Map(matches.map((candidate) => [norm(candidate), validatedTag(candidate)]).filter(([, candidate]) => candidate)).values()];
  }

  function cleanTitlePart(value) {
    if (isUnavailableValue(value)) return "";
    let result = stripSpreadsheetErrors(value)
      .replace(/^TAG\s*[:\-]?\s*/i, "")
      .replace(/\bDE\s+IDENTIFICA[CÇ][AÃ]O\s+DE\b/gi, "DE")
      .replace(/\bDE\s+IDENTIFICA[CÇ][AÃ]O\s+D([OA]S?)\b/gi, "D$1")
      .replace(/\bIDENTIFICA[CÇ][AÃ]O\s+DE\b/gi, "")
      .replace(/\bIDENTIFICA[CÇ][AÃ]O\b/gi, "")
      .replace(/\bDE\s+DE\b/gi, "DE")
      .replace(/\s+[-–—]\s+/g, " - ")
      .replace(/(?:\s+-\s+){2,}/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/^\s*-\s*|\s*-\s*$/g, "");
    if ((result.match(/"/g) || []).length % 2) result = result.replace(/"/g, "");
    return result;
  }

  function removeParentheticalContent(value) {
    let result = text(value);
    let previous = "";
    while (result !== previous) {
      previous = result;
      result = result.replace(/\([^()]*\)/g, " ");
    }
    return cleanSpaces(result)
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/([,.;:])(?:\s*[,.;:])+/g, "$1");
  }

  function combineTitleDescriptions(...values) {
    const parts = [];
    values
      .flatMap((value) => text(value).split(/\s*·\s*/))
      .map(cleanTitlePart)
      .filter(Boolean)
      .forEach((part) => {
        const partNorm = norm(part);
        if (parts.some((current) => norm(current) === partNorm || norm(current).includes(partNorm))) return;
        const genericIndex = parts.findIndex((current) => partNorm.includes(norm(current)));
        if (genericIndex >= 0) parts.splice(genericIndex, 1, part);
        else parts.push(part);
      });
    return parts.join(" · ");
  }

  // Alguns complementos da SCON repetem apenas a família genérica do
  // equipamento. Quando o próprio tipo documental já traz essa informação,
  // a repetição pode ser retirada. Qualificadores reais nunca são descartados:
  // "VALVULA MANUAL", por exemplo, identifica o equipamento da TAG e precisa
  // permanecer antes da localização acrescentada pela SCON ESCOPO.
  function pruneRedundantTitleDescription(type, description) {
    const typeNorm = norm(type);
    const parts = text(description)
      .split(/\s*·\s*/)
      .map(cleanTitlePart)
      .filter(Boolean);
    const filtered = parts.filter((part) => {
      const partNorm = norm(part);
      if (
        /\bREPARO DE VALVULAS\b/.test(typeNorm)
        && /^(?:VALVULA|VALVULAS)$/.test(partNorm)
      ) return false;
      return true;
    });
    return combineTitleDescriptions(...filtered);
  }

  function flexibleTagPattern(value) {
    const tokens = norm(value).split(/[^A-Z0-9]+/).filter(Boolean);
    return tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s,._/\\-]*");
  }

  function stripLeadingTitleTags(value, tags) {
    let result = cleanTitlePart(value);
    const candidates = [...new Map((tags || [])
      .filter(Boolean)
      .map((tag) => [normalizedTagKey(tag), tag])).values()]
      .sort((left, right) => normalizedTagKey(right).length - normalizedTagKey(left).length);
    candidates.forEach((tag) => {
      const pattern = flexibleTagPattern(tag);
      if (pattern) result = result.replace(new RegExp(`^${pattern}\\s*[-–—:]\\s*`, "i"), "");
    });
    return cleanTitlePart(result);
  }

  function trimTypeDescriptionOverlap(type, description) {
    const cleanType = cleanTitlePart(type);
    const cleanDescription = cleanTitlePart(description);
    if (!cleanType || !cleanDescription) return cleanType;
    const tokens = (value) => [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
      key: norm(match[0]),
      index: match.index,
    }));
    const typeTokens = tokens(cleanType);
    const descriptionTokens = tokens(cleanDescription);
    if (descriptionTokens.length < 2) return cleanType;
    for (let start = 0; start < typeTokens.length; start += 1) {
      let matched = 0;
      while (
        start + matched < typeTokens.length
        && matched < descriptionTokens.length
        && typeTokens[start + matched].key === descriptionTokens[matched].key
      ) matched += 1;
      if (matched < 2) continue;
      const prefix = cleanType
        .slice(0, typeTokens[start].index)
        .replace(/\b(?:DE|DO|DA|DOS|DAS|PARA|E)\s*$/i, "")
        .replace(/\s*[-–—:]\s*$/, "");
      return cleanTitlePart(prefix) || cleanType;
    }
    return cleanType;
  }

  // O título recomendado sai sempre em caixa alta, qualquer que seja a caixa
  // usada na base de origem — SCON TAG SGP, SCON ESCOPO e Apêndice 3 gravam a
  // descrição de formas diferentes, e a LD precisa de um padrão único.
  // toLocaleUpperCase("pt-BR") preserva os acentos: "ção" vira "ÇÃO".
  function upperCaseTitle(value) {
    return String(value == null ? "" : value).toLocaleUpperCase("pt-BR");
  }

  function buildTitle(type, description, tag, options) {
    const settings = options || {};
    const cleanTag = cleanTitlePart(tag);
    let cleanDescription = stripLeadingTitleTags(removeParentheticalContent(description), [cleanTag]);
    if (cleanTag) {
      const trailingPattern = flexibleTagPattern(cleanTag);
      cleanDescription = cleanDescription.replace(new RegExp(`\\s*[-–—:]?\\s*${trailingPattern}\\s*$`, "i"), "");
    }
    // O texto definido pela norma deve permanecer literal na frente do título.
    // Para os demais fallbacks, conserva-se a limpeza anterior de parênteses e
    // sobreposição com a descrição vinda das bases.
    const cleanType = settings.preserveType
      ? cleanTitlePart(type)
      : trimTypeDescriptionOverlap(removeParentheticalContent(type), cleanDescription);
    const parts = [];
    [cleanType, cleanDescription].map(cleanTitlePart).filter(Boolean).forEach((part) => {
      if (!parts.some((current) => norm(current) === norm(part) || norm(current).includes(norm(part)))) parts.push(part);
    });
    // Tipo e descrição seguem o padrão visual em caixa alta. A TAG, porém,
    // é um identificador controlado: deve ser copiada literalmente do Grupo 7
    // do nome do documento, inclusive quanto a maiúsculas, minúsculas e
    // separadores. Colocá-la antes de upperCaseTitle alterava essa evidência.
    const titleBody = upperCaseTitle(parts.join(" - ").replace(/\s+/g, " ").trim());
    return [titleBody, cleanTag].filter(Boolean).join(" - ");
  }

  function referenceFor(record, references) {
    if (!references) return null;
    const exact = references.byDocument && references.byDocument.get(record.documentKey);
    if (exact) return exact;
    const tag = norm(extractTagFromDocument(record.document));
    if (!tag) return null;
    const key = `${tag}|${disciplineKey(record.discipline)}`;
    const sameDiscipline = (references.byTagDiscipline && references.byTagDiscipline.get(key) || [])
      .filter((item) => !item.manualReview && item.confidence !== "baixa");
    const descriptions = [...new Map(sameDiscipline.filter((item) => item.description).map((item) => [norm(item.description), item.description])).values()];
    if (descriptions.length === 1) return { ...sameDiscipline[0], description: descriptions[0], inferred: true };
    return null;
  }

  function sconDescriptionPreference(item, targetTag) {
    const entry = item && item.entry || item;
    const discipline = sconEscopoDisciplineKey(entry && entry.discipline);
    const preferredDisciplines = new Set([
      "EQP ESTATICO", "EQP DINAMICO", "INSTRUMENTACAO", "TUBULACAO",
      "ELETRICA", "HVAC", "SEGURANCA",
    ]);
    const genericDisciplines = new Set(["ANDAIME", "APOIO", "CANTEIRO", "LOA", "RECURSOS ETF"]);
    const description = usableDescription(entry && entry.titleComplement);
    const body = stripLeadingTitleTags(description, [targetTag]);
    const leadingTag = leadingTechnicalIdentifier(description);
    const targetKey = normalizedTagKey(targetTag);
    const leadingKey = normalizedTagKey(leadingTag);
    let score = body.length;
    if (leadingKey && leadingKey === targetKey) score += 1000;
    else if (leadingKey && (targetKey.includes(leadingKey) || leadingKey.includes(targetKey))) score += 600;
    if (item && item.aliasSource === "início da descrição SCON") score += 300;
    if (item && item.aliasSource === "CÓDIGO SGP do SCON" && !leadingKey) score -= 150;
    if (preferredDisciplines.has(discipline)) score += 200;
    if (genericDisciplines.has(discipline)) score -= 200;
    if (/BASE DE EQUIPAMENTO|SUPORTE|FUNDA[CÇ][AÃ]O|ANDAIME/.test(norm(entry && entry.itemType))) score -= 40;
    return { entry, description, body, score };
  }

  function sconReferenceFromTagMatch(match, targetTag) {
    if (!match || !match.candidates || !match.candidates.length) return null;
    const groups = new Map();
    match.candidates.forEach((item) => {
      if (!groups.has(item.aliasKey)) groups.set(item.aliasKey, []);
      groups.get(item.aliasKey).push(item);
    });
    const descriptions = [];
    groups.forEach((items) => {
      const distinct = [...new Map(items
        .map((item) => item.entry)
        .filter((entry) => entry.titleComplement)
        .map((entry) => [norm(entry.titleComplement), entry.titleComplement])).values()];
      descriptions.push(...distinct);
    });
    const entries = match.candidates.map((item) => item.entry);
    const ranked = match.candidates
      .map((item) => sconDescriptionPreference(item, targetTag))
      .filter((item) => item.description)
      .sort((left, right) => right.score - left.score || right.body.length - left.body.length || left.description.localeCompare(right.description, "pt-BR"));
    const first = ranked[0] && ranked[0].entry || entries[0];
    const selectedDescription = ranked[0] && ranked[0].description || "";
    const matchedAliases = [...new Set(match.candidates.map((item) => item.alias))];
    const matchSources = [...new Set(match.candidates.map((item) => item.aliasSource).filter(Boolean))];
    const sourceRows = [...new Set(entries.map((entry) => entry.row).filter(Boolean))];
    const containedLabel = containedTagMatchLabel(matchedAliases.length);
    const onlySconCode = matchSources.length === 1 && matchSources[0] === "CÓDIGO SGP do SCON";
    const baseMode = onlySconCode
      ? match.contained
        ? `${containedLabel} no CÓDIGO SGP do SCON`
        : "TAG equivalente localizada no CÓDIGO SGP do SCON"
      : match.contained
        ? containedLabel
        : "TAG equivalente após normalizar pontuação";
    if (!selectedDescription) {
      return {
        ...first,
        titleComplement: "",
        ambiguousDescription: true,
        manualReview: true,
        matchMode: `${baseMode}; descrição ausente na base`,
        candidates: entries.length,
        candidateTitles: [...new Set(entries.map((entry) => entry.titleComplement).filter(Boolean))].slice(0, 12),
        matchedAliases,
        sourceRows,
        trusted: false,
        tagMatch: true,
      };
    }
    return {
      ...first,
      titleComplement: selectedDescription,
      sourceRows,
      matchedAliases,
      matchedTag: targetTag,
      matchMode: `${baseMode}; descrição escolhida pela TAG independentemente da disciplina`,
      trusted: true,
      normalizedMatch: true,
      containedTag: match.contained,
      tagMatch: true,
      candidateCount: new Set(descriptions.map(norm)).size,
      candidateTitles: [...new Map(descriptions.map((description) => [norm(description), description])).values()].slice(0, 12),
      disciplineIndependent: true,
    };
  }

  function sconReferenceFor(record, references) {
    const scon = references && references.scon;
    if (!scon) return null;
    const exact = scon.byDocument && scon.byDocument.get(record.documentKey);
    if (exact) {
      return {
        ...exact,
        matchMode: "Código SGP exato",
        trusted: !exact.manualReview && !exact.ambiguousDescription && Boolean(exact.titleComplement),
      };
    }
    const looseKey = C.looseKey(record && record.document);
    const candidates = looseKey && scon.byLooseDocument && scon.byLooseDocument.get(looseKey) || [];
    if (candidates.length) {
      const descriptions = [...new Map(candidates.filter((item) => item.titleComplement).map((item) => [norm(item.titleComplement), item.titleComplement])).values()];
      if (descriptions.length !== 1) {
        return {
          ambiguousDescription: true,
          manualReview: true,
          matchMode: "Código normalizado sem pontuação",
          candidates: candidates.length,
          candidateCount: descriptions.length,
          candidateTitles: descriptions,
          sourceFile: candidates[0] && candidates[0].sourceFile || "SCON - TAG SGP",
          sourceSheet: candidates[0] && candidates[0].sourceSheet || "",
          sourceRows: candidates.map((item) => item.row).filter(Boolean),
          trusted: false,
        };
      }
      return {
        ...candidates[0],
        titleComplement: descriptions[0],
        sourceRows: [...new Set(candidates.map((item) => item.row).filter(Boolean))],
        matchMode: "Código normalizado sem pontuação",
        trusted: true,
        normalizedMatch: true,
      };
    }

    const groupTag = extractTagFromDocument(record && record.document);
    if (!groupTag || !scon.byNormalizedTag) return null;
    const tagMatch = normalizedTagMatches(scon.byNormalizedTag, groupTag, "", true);
    return tagMatch ? sconReferenceFromTagMatch(tagMatch, groupTag) : null;
  }

  function auditTitles(index, references, options) {
    const documentKeys = options && options.documentKeys instanceof Set ? options.documentKeys : null;
    const sourceRecords = documentKeys ? currentTitleRecords(index).filter((record) => documentKeys.has(record.documentKey)) : currentTitleRecords(index);
    const previousTitleIndex = buildPreviousTitleIndex(index);
    return sourceRecords.map((record) => {
      if (record._ldConflict) return conflictAuditResult(record, "title");
      const reference = referenceFor(record, references);
      const current = unwrapTitle(record.title);
      const sourceColumn = recordColumn(record, ["TÍTULO", "TITULO", "TÍTULO DO DOCUMENTO", "TITULO DO DOCUMENTO", "NOME DO DOCUMENTO"]);
      const previousTitles = previousTitlesFor(record, previousTitleIndex);
      const titleStandard = T && T.resolve ? T.resolve(record.document, {
        previousTitles,
        referenceType: reference && reference.documentType || "",
        currentTitle: current,
      }) : null;
      const inferredType = titleStandard && titleStandard.title || reference && reference.documentType || inferType(record) || "";
      const previousPattern = previousTitlePatternFor(record, previousTitleIndex);
      const prefix = titleStandard && titleStandard.title || previousPattern.title || stableTitlePrefix(current, inferredType);
      const drawing = isDrawingRecord(record, prefix, inferredType);
      const type = prefix || inferredType;
      const tagEvidence = resolveTagEvidence(record, reference);
      const possibleIdentifier = tagEvidence.possibleTag;
      const sconReference = sconReferenceFor(record, references);
      const sconEscopoReference = sconEscopoReferenceFor(record, references, tagEvidence, {
        // A SCON atualizada descreve muito bem o equipamento pela TAG, mas não
        // substitui a SCON ESCOPO: é esta segunda base que acrescenta área,
        // unidade e contexto de montagem. O fallback permanece conservador
        // (hoje restrito a REP + EAP/atividade/objeto compatíveis), portanto
        // deve continuar habilitado mesmo quando a TAG já foi achada na SCON.
        allowContextFallback: true,
      });
      const tagReference = tagReferenceFor(record, references, tagEvidence);
      const sconEscopoConfirmsLookupTag = Boolean(
        sconEscopoReference
        && sconEscopoReference.trusted
        && sconEscopoReference.lookupTagFromNt
        && sconEscopoReference.lookupTag
      );
      const appendixConfirmsLookupTag = Boolean(
        tagReference
        && tagReference.trusted
        && tagReference.lookupTagFromNt
        && tagReference.lookupTag
      );
      const matchedExternalTags = [...new Map([
        ...((sconEscopoReference && sconEscopoReference.matchedAliases) || []),
        ...((tagReference && tagReference.matchedAliases) || []),
      ].filter(Boolean).map((value) => [normalizedTagKey(value), value])).values()];
      const singleExternalTag = matchedExternalTags.length === 1 ? matchedExternalTags[0] : "";
      const tag = tagEvidence.tag || singleExternalTag;
      const resolvedNonTaggedRule = N && N.resolve ? N.resolve(record.document) : null;
      const externalTagDescriptionFound = Boolean(sconEscopoReference && sconEscopoReference.trusted || tagReference && tagReference.trusted);
      const nonTaggedRule = externalTagDescriptionFound ? null : resolvedNonTaggedRule;
      const titleTagConfirmed = Boolean(tagEvidence.confirmed || singleExternalTag);
      const explicitTitle = extractTagFromTitle(record.title);
      // Quando o Grupo 7 é válido, o nome do documento é a fonte soberana da
      // TAG usada no título. As bases externas servem para descrever o item,
      // mas não podem substituir a grafia documental por uma TAG parecida,
      // antiga ou pertencente a outro equipamento.
      const documentNameTag = tagEvidence.group7 && tagEvidence.group7.validTag
        ? tagEvidence.group7.tag
        : "";
      const explicitDescription = usableDescription(recordValue(record, DESCRIPTION_HEADERS));
      const explicitComplementary = usableDescription(recordValue(record, COMPLEMENTARY_HEADERS));
      const explicitScon = referenceDescriptionCandidate(recordValue(record, SCON_HEADERS));
      const referenceDescription = reference && (referenceDescriptionCandidate(reference.description) || referenceDescriptionCandidate(reference.title));
      const sconTitleComplement = sconReference && sconReference.trusted
        ? stripLeadingTitleTags(
          usableDescription(sconReference.titleComplement),
          [tag, ...(sconReference.matchedAliases || []), ...((sconReference.tagAliases || []).map((item) => item.value))],
        )
        : "";
      const trustedScon = Boolean(sconTitleComplement && sconReference && sconReference.trusted);
      const sconEscopoTitle = sconEscopoReference && sconEscopoReference.trusted ? usableDescription(sconEscopoReference.description || sconEscopoReference.title) : "";
      const trustedSconEscopo = Boolean(sconEscopoTitle && sconEscopoReference && sconEscopoReference.trusted);
      const appendixTitle = tagReference && tagReference.trusted ? usableDescription(tagReference.description || tagReference.title) : "";
      const trustedAppendix = Boolean(appendixTitle && tagReference && tagReference.trusted);
      // Filtro global de fonte (options.titleSourceMode): restringe qual base pode
      // efetivamente entrar na descrição recomendada. As três bases continuam
      // sendo pesquisadas e mostradas como evidência — a restrição vale só para
      // o texto usado no título, nunca para a confirmação da TAG.
      const titleSourceMode = (options && options.titleSourceMode) || "auto";
      const sconDescriptionAllowed = titleSourceMode !== "appendix_only";
      const appendixDescriptionAllowed = titleSourceMode !== "scon_only";
      const sconEscopoDescriptionAllowed = titleSourceMode === "auto";
      const sconEscopoInDescription = Boolean(trustedSconEscopo && sconEscopoDescriptionAllowed);
      const appendixInDescription = Boolean(trustedAppendix && appendixDescriptionAllowed);
      const externalTagDescription = combineTitleDescriptions(appendixInDescription ? appendixTitle : "", sconEscopoInDescription ? sconEscopoTitle : "");
      const trustedDescription = Boolean(referenceDescription && reference && !reference.manualReview && !reference.ambiguousDescription);
      const trustedNonTagged = Boolean(nonTaggedRule && nonTaggedRule.description && (nonTaggedRule.exact || nonTaggedRule.confidence === "alta"));
      // O SCON TAG SGP descreve o documento específico e sempre entra primeiro na
      // descrição recomendada. Quando a mesma TAG também é confirmada pelo SCON
      // ESCOPO e/ou pelo Apêndice 3 Rev.B, o texto de cada base é somado ao do
      // SCON TAG SGP: combineTitleDescriptions descarta qualquer parte já contida
      // na anterior, então a mesma informação não se repete no título, apenas o
      // que cada base acrescenta de fato.
      const sconCombinesWithSconEscopo = Boolean(trustedScon && sconEscopoInDescription);
      const sconCombinesWithAppendix = Boolean(trustedScon && appendixInDescription);
      const sconCombinedDescription = trustedScon && sconDescriptionAllowed
        ? combineTitleDescriptions(
          sconTitleComplement,
          sconCombinesWithSconEscopo ? sconEscopoTitle : "",
          sconCombinesWithAppendix ? appendixTitle : "",
        )
        : "";
      const externalTagDrivesDescription = Boolean(
        externalTagDescription
        && !trustedNonTagged
        && !(trustedScon && sconDescriptionAllowed)
        && !trustedDescription
      );
      const sconEscopoDrivesDescription = Boolean(externalTagDrivesDescription && sconEscopoInDescription);
      const currentDetectedPrefix = stableTitlePrefix(current, inferType(record));
      const currentDescriptionType = titleStandard && titleStandard.normative
        && currentDetectedPrefix && !titleStartsWithType(current, type)
        ? currentDetectedPrefix
        : type;
      // Retira primeiro a TAG realmente escrita no título. Se ela estiver
      // errada e só a TAG correta for retirada, a recomendação acabará com as
      // duas formas. A segunda passagem cobre títulos em que a TAG correta
      // aparece com outro separador ou repetida.
      const descriptionWithoutObservedTag = stripKnownParts(current, currentDescriptionType, explicitTitle);
      const currentDescription = stripKnownParts(descriptionWithoutObservedTag, "", documentNameTag || tag);
      const rawDescription = nonTaggedRule && nonTaggedRule.description
        || sconCombinedDescription
        || trustedDescription && referenceDescription
        || externalTagDrivesDescription && externalTagDescription
        || explicitComplementary
        || explicitDescription
        || explicitScon
        || currentDescription;
      const description = pruneRedundantTitleDescription(type, rawDescription);
      const descriptionIdentifiers = technicalIdentifiers(description);
      const titleTag = nonTaggedRule ? "" : documentNameTag || tag;
      const isCv = norm(record.sheet) === "CV" || /-C1O-CV-/.test(norm(record.document));
      const empty = isUnavailableValue(current);
      const literalTag = /\bTAG\b\s*[:\-]?\s*[A-Z0-9]/i.test(current);
      const formatting = /\s{2,}|--|[-–—]\s*[-–—]|^\s*[-–—]|[-–—]\s*$/.test(current) || literalTag;
      const generic = titleLooksGeneric(current, type);
      const standardPrefixMismatch = Boolean(
        !empty
        && titleStandard
        && titleStandard.normative
        && titleStandard.title
        && !titleStartsWithType(current, titleStandard.title)
      );
      const wrongTitleTag = Boolean(
        documentNameTag
        && explicitTitle
        && cleanSpaces(explicitTitle) !== cleanSpaces(documentNameTag)
      );
      const needsTag = tagRequired(record, drawing ? "DESENHO" : type, titleTag) && titleTagConfirmed && Boolean(titleTag) && !norm(current).includes(norm(titleTag));
      const controlledDescriptionMismatch = Boolean(
        description
        && (trustedNonTagged || trustedScon || trustedDescription)
        && !norm(current).includes(norm(description))
      );
      const sconEscopoDescriptionMismatch = Boolean(
        externalTagDescription
        && externalTagDrivesDescription
        && !norm(current).includes(norm(externalTagDescription))
      );
      const descriptionMismatch = controlledDescriptionMismatch || sconEscopoDescriptionMismatch;
      let issue = "ok";
      let classification = "ok";
      let reason = "Título claro e sem divergência identificada";
      if (empty) { issue = "empty"; classification = titleStandard && titleStandard.normative || trustedScon || trustedSconEscopo || trustedAppendix || trustedDescription || titleTagConfirmed ? "confirmed_error" : "insufficient"; reason = "Título vazio"; }
      else if (wrongTitleTag) {
        issue = "wrong_tag";
        classification = "confirmed_error";
        reason = `O título contém a TAG “${explicitTitle}”, mas o Grupo 7 do nome do documento define exatamente “${documentNameTag}”`;
      }
      else if (standardPrefixMismatch) {
        issue = "document_type";
        classification = titleStandard.ambiguous ? "suggestion" : "confirmed_error";
        reason = titleStandard.ambiguous
          ? titleStandard.chosenByHistory
            ? `A norma traz mais de uma redação para o Grupo 6 ${titleStandard.code}; foi usada a variante mais compatível com os títulos anteriores`
            : `A norma traz mais de uma redação para o Grupo 6 ${titleStandard.code}; foi mantida a primeira redação da Tabela 13 para revisão`
          : `O título deve iniciar com o tipo documental definido para o código ${titleStandard.code}: ${titleStandard.title}`;
      }
      else if (needsTag) {
        issue = "missing_tag";
        classification = "confirmed_error";
        const confirmationSource = sconEscopoConfirmsLookupTag ? "cruzamento da TAG com o SCON ESCOPO" : appendixConfirmsLookupTag ? "cruzamento da TAG com o Apêndice 3 Rev.B" : tagEvidence.source.toLowerCase();
        reason = `A TAG comprovada pelo ${confirmationSource} não aparece no título`;
      }
      else if (descriptionMismatch) {
        issue = "description_mismatch";
        classification = trustedNonTagged && nonTaggedRule.exact
          ? "confirmed_error"
          : trustedScon || reference && reference.verifiedCatalog ? "confirmed_error" : "suggestion";
        reason = nonTaggedRule
          ? "O título não representa completamente O QUÊ e ONDE/QUANDO do Campo 7 nt-"
          : trustedScon && sconDescriptionAllowed
            ? sconCombinesWithSconEscopo && sconCombinesWithAppendix
              ? "A descrição combinada do SCON TAG SGP, do SCON ESCOPO e do Apêndice 3 Rev.B não aparece completa no título"
              : sconCombinesWithSconEscopo
                ? "A descrição combinada do SCON TAG SGP e do SCON ESCOPO não aparece completa no título"
                : sconCombinesWithAppendix
                  ? "A descrição combinada do SCON TAG SGP e do Apêndice 3 Rev.B não aparece completa no título"
                  : "O terceiro campo da DESCRIÇÃO do SCON TAG SGP não aparece no título"
            : externalTagDrivesDescription
              ? sconEscopoInDescription && appendixInDescription
                ? "As descrições localizadas no SCON ESCOPO e no Apêndice 3 Rev.B não aparecem no título atual"
                : sconEscopoInDescription
                  ? "A descrição localizada no SCON ESCOPO não aparece no título atual"
                  : "A descrição localizada no Apêndice 3 Rev.B não aparece no título atual"
            : "A descrição validada não aparece no título";
      }
      else if (possibleIdentifier && !norm(current).includes(norm(possibleIdentifier))) { issue = "possible_identifier"; classification = "insufficient"; reason = `O código contém “${possibleIdentifier}”, mas não existe fonte suficiente para confirmar que seja uma TAG`; }
      else if (generic) { issue = "generic"; classification = "suggestion"; reason = "Título pouco específico"; }
      else if (formatting) { issue = "format"; classification = "suggestion"; reason = literalTag ? "Remover a palavra TAG e manter somente o código" : "Padronizar espaços e separadores"; }
      let proposed = "";
      let confidence = "nenhuma";
      if (issue !== "ok" && reference && reference.manualReview && !trustedScon && !externalTagDrivesDescription) {
        classification = "insufficient";
        reason = "A base marcou esta descrição para revisão humana; nenhuma sugestão foi aplicada";
      } else if (issue !== "ok" && issue !== "possible_identifier") {
        if (isCv) {
          const cvDescription = referenceDescription || description;
          if (cvDescription) {
            proposed = buildTitle("CURRÍCULO", cvDescription, "", { preserveType: true });
            confidence = reference && !reference.inferred ? "alta" : "media";
          }
        } else if ((description || tag || titleStandard && titleStandard.normative) && (type || description || tag)) {
          proposed = buildTitle(type, description, titleTag, { preserveType: Boolean(titleStandard && titleStandard.normative && titleStandard.title) });
          const hasExternal = Boolean(sconTitleComplement || externalTagDescription || explicitComplementary || explicitDescription || explicitScon || referenceDescription || nonTaggedRule && nonTaggedRule.description);
          confidence = titleStandard && titleStandard.normative && !titleStandard.ambiguous
            ? (hasExternal || titleTagConfirmed ? "alta" : "media")
            : trustedScon
            ? "alta"
            : nonTaggedRule && nonTaggedRule.exact
            ? "alta"
            : nonTaggedRule && nonTaggedRule.description
              ? nonTaggedRule.confidence || "media"
              : reference && reference.verifiedCatalog && trustedDescription
                ? (reference.confidence === "alta" ? "alta" : "media")
                : externalTagDrivesDescription
                  ? sconEscopoReference && sconEscopoReference.eapMatched && !sconEscopoReference.eapFallback && !sconEscopoReference.tagFallback ? "alta" : "media"
                : hasExternal && titleTagConfirmed ? "alta" : hasExternal || (titleTagConfirmed && type) ? "media" : "baixa";
          if (!proposed || norm(proposed) === norm(current)) { proposed = ""; confidence = "nenhuma"; }
        }
      }
      if (issue !== "ok" && !proposed) reason += "; sem informação suficiente para sugerir com segurança";
      const referenceEvidence = reference
        ? `${reference.origin || reference.sourceSheet || "Base de referência"}${reference.referenceDocument ? ` · referência ${reference.referenceDocument}` : ""}${reference.row ? ` · linha ${reference.row}` : ""}${reference.observation ? ` · ${reference.observation}` : ""}`
        : "";
      const sconEvidence = sconReference
        ? sconReference.ambiguousDescription
          ? `${sconReference.sourceFile || "SCON - TAG SGP"} · correspondência ambígua após normalização · linhas ${(sconReference.sourceRows || []).join(", ") || "não identificadas"}`
          : `${sconReference.sourceFile || "SCON - TAG SGP"} · aba ${sconReference.sourceSheet || "não identificada"} · linha(s) ${(sconReference.sourceRows || [sconReference.row]).filter(Boolean).join(", ") || "não identificada"} · ${sconReference.matchMode || "código exato"} · 3º campo da DESCRIÇÃO`
        : "";
      const sconEscopoEvidence = sconEscopoReference
        ? sconEscopoReference.ambiguousDescription
          ? `${sconEscopoReference.sourceFile || "SCON ESCOPO"} · aba ${sconEscopoReference.sourceSheet || "MAPA"} · ${sconEscopoReference.matchMode} · ${sconEscopoReference.candidateCount || 0} títulos diferentes; nenhuma sugestão aplicada pelo SCON ESCOPO`
          : `${sconEscopoReference.sourceFile || "SCON ESCOPO"} · aba ${sconEscopoReference.sourceSheet || "MAPA"} · linha(s) ${(sconEscopoReference.sourceRows || [sconEscopoReference.row]).filter(Boolean).join(", ") || "não identificada"} · ${sconEscopoReference.matchMode || "TAG exata"}`
        : "";
      const appendixEvidence = tagReference
        ? `${tagReference.sourceFile || "Apêndice 3 Rev.B"} · aba ${tagReference.sourceSheet || "Apêndice"} · registro(s) ${(tagReference.sourceRows || [tagReference.row]).filter(Boolean).join(", ") || "não identificado"} · ${tagReference.matchMode || "TAG exata"}`
        : "";
      const evidence = [
        titleStandard && titleStandard.source,
        previousPattern.title && `${previousPattern.support} título(s) anterior(es) confirmam o padrão “${previousPattern.title}”`,
        tagEvidence.source,
        sconEscopoReference && sconEscopoReference.lookupTagSource,
        nonTaggedRule && nonTaggedRule.source,
        sconEvidence,
        sconEscopoEvidence,
        appendixEvidence,
        referenceEvidence || (explicitComplementary ? "Complementar da própria LD" : explicitDescription ? "Descrição da própria LD" : explicitScon ? "SCON da própria LD" : explicitTitle ? "TAG escrita no título" : ""),
      ].filter(Boolean).join(" · ");
      const result = {
        id: `title::${record.documentKey}`,
        kind: "title",
        document: record.document,
        documentKey: record.documentKey,
        sheet: record.sheet,
        row: record.row,
        column: sourceColumn && sourceColumn.column || "",
        columnHeader: sourceColumn && sourceColumn.header || "TÍTULO",
        discipline: record.discipline,
        current,
        tag,
        titleTag,
        documentNameTag,
        titleTagFound: explicitTitle,
        wrongTitleTag,
        descriptionIdentifiers,
        possibleIdentifier,
        tagEvidence,
        titleSourceMode,
        description,
        descriptionSource: nonTaggedRule
          ? "Catálogo controlado nt-"
          : trustedScon && sconDescriptionAllowed
            ? sconCombinesWithSconEscopo && sconCombinesWithAppendix
              ? "SCON TAG SGP + SCON ESCOPO + Apêndice 3 Rev.B · 3º campo da DESCRIÇÃO"
              : sconCombinesWithAppendix
                ? "SCON TAG SGP + Apêndice 3 Rev.B · 3º campo da DESCRIÇÃO"
                : sconCombinesWithSconEscopo
                  ? "SCON TAG SGP + SCON ESCOPO"
                  : "SCON TAG SGP · 3º campo da DESCRIÇÃO"
            : explicitComplementary
              ? "Complementar da LD"
              : trustedDescription
                ? "Base controlada de títulos"
                : externalTagDrivesDescription
                  ? sconEscopoInDescription && appendixInDescription
                    ? "SCON ESCOPO + Apêndice 3 Rev.B"
                    : sconEscopoInDescription
                      ? sconEscopoReference && sconEscopoReference.tagFallback
                        ? "SCON ESCOPO · EAP + atividade documental"
                        : sconEscopoReference && sconEscopoReference.eapFallback
                          ? "SCON ESCOPO · mesma TAG em outro EAP"
                          : sconEscopoReference && sconEscopoReference.exactTag
                            ? "SCON ESCOPO · TAG + EAP"
                            : "SCON ESCOPO · busca progressiva"
                      : "Apêndice 3 Rev.B · TAG do equipamento"
                  : explicitDescription ? "Descrição da LD" : explicitScon ? "SCON da LD" : "Título atual",
        sconMatch: sconReference && !sconReference.ambiguousDescription ? "SIM" : sconReference ? "AMBÍGUO" : "NÃO",
        sconMatchMode: sconReference && sconReference.matchMode || "",
        sconMatchedTags: sconReference && sconReference.matchedAliases || [],
        sconCandidateCount: sconReference && (sconReference.candidateCount || sconReference.candidates) || 0,
        sconCandidateTitles: sconReference && sconReference.candidateTitles || [],
        sconTitleComplement,
        sconFullDescription: sconReference && sconReference.fullDescription || "",
        sconTag: sconReference && sconReference.sconTag || "",
        sconItemType: sconReference && sconReference.itemType || "",
        sconDrawingReference: sconReference && sconReference.drawingReference || "",
        sconSourceFile: sconReference && sconReference.sourceFile || "",
        sconSourceSheet: sconReference && sconReference.sourceSheet || "",
        sconSourceRows: sconReference && (sconReference.sourceRows || [sconReference.row]).filter(Boolean) || [],
        sconEscopoMatch: sconEscopoReference && (sconEscopoReference.ambiguousDescription ? "AMBÍGUO" : "SIM") || "NÃO",
        sconEscopoMatchMode: sconEscopoReference && sconEscopoReference.matchMode || "",
        sconEscopoMatchedTags: sconEscopoReference && sconEscopoReference.matchedAliases || [],
        sconEscopoLookupTag: sconEscopoReference && sconEscopoReference.lookupTag || "",
        sconEscopoLookupTagSource: sconEscopoReference && sconEscopoReference.lookupTagSource || "",
        sconEscopoLookupTagFromNt: Boolean(sconEscopoReference && sconEscopoReference.lookupTagFromNt),
        sconEscopoDocumentEap: sconEscopoReference && sconEscopoReference.documentEap || documentEapFromGroup4(record.document),
        sconEscopoEapMatched: Boolean(sconEscopoReference && sconEscopoReference.eapMatched),
        sconEscopoEapFallback: Boolean(sconEscopoReference && sconEscopoReference.eapFallback),
        sconEscopoMatchedEap: sconEscopoReference && sconEscopoReference.matchedEap || "",
        sconEscopoEapMatchedWithoutTrailingOne: Boolean(sconEscopoReference && sconEscopoReference.eapMatchedWithoutTrailingOne),
        sconEscopoFragmentTagMatched: Boolean(sconEscopoReference && sconEscopoReference.fragmentTag),
        sconEscopoTagFallback: Boolean(sconEscopoReference && sconEscopoReference.tagFallback),
        sconEscopoTagStemFallback: Boolean(sconEscopoReference && sconEscopoReference.tagStemFallback),
        sconEscopoCatalogTags: sconEscopoReference && sconEscopoReference.catalogAliases || [],
        sconEscopoCandidateEaps: sconEscopoReference && sconEscopoReference.candidateEaps || [],
        sconEscopoTitle,
        sconEscopoCandidateCount: sconEscopoReference && sconEscopoReference.candidateCount || 0,
        sconEscopoCandidateTitles: sconEscopoReference && sconEscopoReference.candidateTitles || [],
        sconEscopoSourceFile: sconEscopoReference && sconEscopoReference.sourceFile || "",
        sconEscopoSourceSheet: sconEscopoReference && sconEscopoReference.sourceSheet || "",
        sconEscopoSourceRows: sconEscopoReference && (sconEscopoReference.sourceRows || [sconEscopoReference.row]).filter(Boolean) || [],
        appendixMatch: tagReference && tagReference.trusted ? "SIM" : "NÃO",
        appendixMatchMode: tagReference && tagReference.matchMode || "",
        appendixMatchedTags: tagReference && tagReference.matchedAliases || [],
        appendixTitle,
        appendixCandidateCount: tagReference && tagReference.candidateCount || 0,
        appendixCandidateTitles: tagReference && tagReference.candidateTitles || [],
        appendixSourceFile: tagReference && tagReference.sourceFile || "",
        appendixSourceSheet: tagReference && tagReference.sourceSheet || "",
        appendixSourceRows: tagReference && (tagReference.sourceRows || [tagReference.row]).filter(Boolean) || [],
        nonTaggedRule,
        nonTaggedIdentifier: nonTaggedRule && nonTaggedRule.identifier || "",
        nonTaggedWhat: nonTaggedRule && nonTaggedRule.what || "",
        nonTaggedWhereWhen: nonTaggedRule && nonTaggedRule.whereWhen || "",
        nonTaggedSource: nonTaggedRule && nonTaggedRule.source || "",
        titlePrefix: type,
        titleStandardCode: titleStandard && titleStandard.code || "",
        titleStandard: titleStandard && titleStandard.title || "",
        titleStandardSource: titleStandard && titleStandard.source || "",
        titleStandardAmbiguous: Boolean(titleStandard && titleStandard.ambiguous),
        titleStandardChosenByHistory: Boolean(titleStandard && titleStandard.chosenByHistory),
        previousTitlePattern: previousPattern.title,
        previousTitleSupport: previousPattern.support,
        previousTitleExamples: previousTitles.slice(0, 5),
        drawingRule: drawing
          ? "DESENHO — manter tratamento específico e TAG comprovada"
          : nonTaggedRule
            ? "CAMPO 7 nt- — construir O QUÊ + ONDE/QUANDO"
            : "PREFIXO PRESERVADO — completar somente descrição e TAG",
        proposed,
        // Cópia imutável da sugestão calculada pelo RECON. "proposed" pode ser
        // reescrito na revisão em tela antes da aprovação; "autoProposed" guarda
        // o que a análise automática realmente encontrou, para comparação.
        autoProposed: proposed,
        issue,
        classification,
        confidence,
        reason,
        evidence,
        decision: "pending",
        conflictLd: "NÃO",
        ldConflict: null,
      };
      return R ? R.enrichAuditRow(result) : result;
    });
  }

  function summarize(rows) {
    const all = (rows || []).length;
    const ok = (rows || []).filter((row) => row.issue === "ok").length;
    const review = (rows || []).filter((row) => row.issue !== "ok" && row.proposed).length;
    const unsafe = (rows || []).filter((row) => row.issue !== "ok" && !row.proposed).length;
    const approved = (rows || []).filter((row) => row.decision === "approved").length;
    return { all, ok, review, unsafe, approved };
  }

  return {
    text,
    norm,
    latest,
    currentRecords,
    currentTitleRecords,
    recordValue,
    recordColumn,
    disciplineKey,
    completePath,
    contextKeys,
    buildPathEvidence,
    buildCatalogIndex,
    choosePeerEvidence,
    auditDatabook,
    usableDescription,
    stripSpreadsheetErrors,
    isUnavailableValue,
    looksLikeTechnicalTag,
    validatedTag,
    looksLikeDocumentTag,
    reportGroup7Info,
    documentDeclaresNonTag,
    extractTagFromDocument,
    extractTagFromTitle,
    extractTag,
    resolveTagEvidence,
    inferType,
    stableTitlePrefix,
    buildPreviousTitleIndex,
    previousTitlesFor,
    previousTitlePatternFor,
    historicalTitlePrefix,
    titleStartsWithType,
    referenceDescriptionCandidate,
    parseSconDescription,
    normalizedTagKey,
    leadingTechnicalIdentifier,
    sconEntryTagAliases,
    containedTagKeys,
    normalizedTagMatches,
    progressiveTagFragmentMatches,
    buildSconReferenceIndex,
    parseSconTitleCatalog,
    sconReferenceFor,
    strictTagKey,
    normalizeSconEap,
    sconEapLookupVariants,
    documentEapFromGroup4,
    sconEscopoLookupTag,
    sconEscopoDisciplineKey,
    cleanSconEscopoTitle,
    sconEscopoSubjectTitle,
    sconEscopoActivityEap,
    combineSconEscopoTitles,
    parseSconEscopoTitleCatalog,
    parseTagReferenceCatalog,
    tagReferenceFor,
    sconEscopoReferenceFor,
    technicalIdentifiers,
    parseTitleReferenceWorkbook,
    titleLooksGeneric,
    combineTitleDescriptions,
    pruneRedundantTitleDescription,
    stripLeadingTitleTags,
    trimTypeDescriptionOverlap,
    buildTitle,
    upperCaseTitle,
    auditTitles,
    summarize,
  };
});
