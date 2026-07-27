(function (root, factory) {
  const C = root.TriagemCore || (typeof module === "object" && module.exports ? require("./core.js") : null);
  const A = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const R = root.RECONContracts || (typeof module === "object" && module.exports ? require("./recon_contracts.js") : null);
  const F = root.LDConflictCore || (typeof module === "object" && module.exports ? require("./ld_conflicts.js") : null);
  const S = root.RECONDatabookAllocationSources || (typeof module === "object" && module.exports ? require("./databook_allocation_sources.js") : null);
  const N = root.RECONNonTaggedTitles || (typeof module === "object" && module.exports ? require("./non_tagged_title_rules.js") : null);
  const api = factory(C, A, R, F, S, N);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, A, R, F, S, N) {
  "use strict";

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function norm(value) {
    return C.norm(text(value));
  }

  function cleanSpaces(value) {
    return text(value).replace(/\s+/g, " ").trim();
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
    const valueNorm = norm(value);
    return !valueNorm || ["0", "-", "N/A", "NA", "NAO INFORMADO", "A DEFINIR", "PENDENTE"].includes(valueNorm);
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
    const clean = cleanSpaces(value);
    const n = norm(clean);
    if (!clean || ["0", "-", "N/A", "NA", "A DEFINIR", "SEM DESCRICAO"].includes(n)) return "";
    return clean;
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

  function reportGroup7Info(document) {
    const raw = text(document).replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    const groups = raw.split("_");
    const isReport = groups.length >= 7 && norm(groups[1]) === "RNEST";
    const identifier = isReport ? groups.slice(6).join("_").trim() : "";
    const exactNonTagged = identifier.startsWith("nt-");
    const isNonTagged = /^nt(?:-|_)/i.test(identifier);
    const formatValid = Boolean(identifier && !/[_ç?|!@#$%¨&*(),\s]/i.test(identifier) && /^[A-Z0-9][A-Z0-9./-]*$/i.test(identifier));
    const validTag = Boolean(identifier && !isNonTagged);
    return { raw, groups, isReport, identifier, isNonTagged, exactNonTagged, nonTagCaseMismatch: isNonTagged && !exactNonTagged, tag: validTag ? identifier : "", validTag, formatValid };
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

  function stableTitlePrefix(currentTitle, inferredType) {
    const current = unwrapTitle(currentTitle);
    if (!current) return cleanTitlePart(inferredType);
    const split = current.split(/\s+[-–—]\s+/);
    if (split.length > 1) {
      const first = cleanTitlePart(split[0]);
      if (first && !looksLikeTechnicalTag(first)) return first;
    }
    if (looksLikeDocumentPrefix(current)) return cleanTitlePart(current);
    return cleanTitlePart(inferredType);
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
      result = result.replace(new RegExp(`\\s*[-–—:]?\\s*${escapedTag}\\s*$`, "i"), "");
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

  function buildSconReferenceIndex(entries, metadata) {
    const cleanEntries = (entries || []).map((entry) => ({
      ...entry,
      document: text(entry.document),
      documentKey: entry.documentKey || C.key(entry.document),
      looseDocumentKey: entry.looseDocumentKey || C.looseKey(entry.document),
      titleComplement: usableDescription(entry.titleComplement),
      fullDescription: cleanSpaces(entry.fullDescription),
      verifiedCatalog: true,
      confidence: entry.confidence || "alta",
      sourceFile: entry.sourceFile || metadata && metadata.sourceFile || "SCON - TAG SGP",
      sourceSheet: entry.sourceSheet || metadata && metadata.sheet || "",
    })).filter((entry) => entry.document && entry.titleComplement);

    const byDocument = new Map();
    const byLooseDocument = new Map();
    cleanEntries.forEach((entry) => {
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
          existing.ambiguousDescription = true;
          existing.manualReview = true;
        }
      }
      const looseKey = entry.looseDocumentKey;
      if (looseKey) {
        if (!byLooseDocument.has(looseKey)) byLooseDocument.set(looseKey, []);
        byLooseDocument.get(looseKey).push(entry);
      }
    });
    return {
      kind: "scon",
      entries: cleanEntries,
      byDocument,
      byLooseDocument,
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
      sconTag: at(row, "sconTag"),
      discipline: at(row, "discipline"),
      itemType: at(row, "itemType"),
      drawingReference: at(row, "drawingReference"),
      row: Number(at(row, "row")) || 0,
      sourceFile: catalog && catalog.sourceFile || "SCON - TAG SGP",
      sourceSheet: catalog && catalog.sheet || "",
    }));
    return buildSconReferenceIndex(entries, catalog || {});
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
            sconTag: sconColumns.tag >= 0 ? text(row[sconColumns.tag]) : "",
            discipline: sconColumns.discipline >= 0 ? text(row[sconColumns.discipline]) : "",
            itemType: sconColumns.itemType >= 0 ? text(row[sconColumns.itemType]) : "",
            drawingReference: sconColumns.drawingReference >= 0 ? text(row[sconColumns.drawingReference]) : "",
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
    if (!n || ["0", "-", "N/A", "A DEFINIR"].includes(n)) return true;
    const residual = stripKnownParts(title, type, "");
    const words = norm(residual).split(/[^A-Z0-9]+/).filter((item) => item.length >= 3);
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
    return cleanSpaces(value)
      .replace(/^TAG\s*[:\-]?\s*/i, "")
      .replace(/\bIDENTIFICA[CÇ][AÃ]O\b/gi, "")
      .replace(/\s+[-–—]\s+/g, " - ")
      .replace(/(?:\s+-\s+){2,}/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/^\s*-\s*|\s*-\s*$/g, "");
  }

  function buildTitle(type, description, tag) {
    const parts = [];
    [type, description, tag].map(cleanTitlePart).filter(Boolean).forEach((part) => {
      if (!parts.some((current) => norm(current) === norm(part) || norm(current).includes(norm(part)))) parts.push(part);
    });
    return parts.join(" - ").replace(/\bTAG\s*[:\-]?\s*/gi, "").replace(/\s+/g, " ").trim();
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
    if (!candidates.length) return null;
    const descriptions = [...new Map(candidates.filter((item) => item.titleComplement).map((item) => [norm(item.titleComplement), item.titleComplement])).values()];
    if (descriptions.length !== 1) {
      return {
        ambiguousDescription: true,
        manualReview: true,
        matchMode: "Código normalizado sem pontuação",
        candidates: candidates.length,
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

  function auditTitles(index, references, options) {
    const documentKeys = options && options.documentKeys instanceof Set ? options.documentKeys : null;
    const sourceRecords = documentKeys ? currentTitleRecords(index).filter((record) => documentKeys.has(record.documentKey)) : currentTitleRecords(index);
    return sourceRecords.map((record) => {
      if (record._ldConflict) return conflictAuditResult(record, "title");
      const reference = referenceFor(record, references);
      const sconReference = sconReferenceFor(record, references);
      const current = unwrapTitle(record.title);
      const sourceColumn = recordColumn(record, ["TÍTULO", "TITULO", "TÍTULO DO DOCUMENTO", "TITULO DO DOCUMENTO", "NOME DO DOCUMENTO"]);
      const inferredType = inferType(record) || reference && reference.documentType || "";
      const prefix = stableTitlePrefix(current, inferredType);
      const drawing = isDrawingRecord(record, prefix, inferredType);
      const type = prefix || inferredType;
      const tagEvidence = resolveTagEvidence(record, reference);
      const tag = tagEvidence.tag;
      const possibleIdentifier = tagEvidence.possibleTag;
      const nonTaggedRule = N && N.resolve ? N.resolve(record.document) : null;
      const explicitTitle = extractTagFromTitle(record.title);
      const explicitDescription = usableDescription(recordValue(record, DESCRIPTION_HEADERS));
      const explicitComplementary = usableDescription(recordValue(record, COMPLEMENTARY_HEADERS));
      const explicitScon = referenceDescriptionCandidate(recordValue(record, SCON_HEADERS));
      const referenceDescription = reference && (referenceDescriptionCandidate(reference.description) || referenceDescriptionCandidate(reference.title));
      const sconTitleComplement = sconReference && sconReference.trusted ? usableDescription(sconReference.titleComplement) : "";
      const trustedScon = Boolean(sconTitleComplement && sconReference && sconReference.trusted);
      const trustedDescription = Boolean(referenceDescription && reference && !reference.manualReview && !reference.ambiguousDescription);
      const trustedNonTagged = Boolean(nonTaggedRule && nonTaggedRule.description && (nonTaggedRule.exact || nonTaggedRule.confidence === "alta"));
      const currentDescription = stripKnownParts(current, type, tag);
      const description = nonTaggedRule && nonTaggedRule.description
        || sconTitleComplement
        || explicitComplementary
        || referenceDescription
        || explicitDescription
        || explicitScon
        || currentDescription;
      const descriptionIdentifiers = technicalIdentifiers(description);
      const titleTag = nonTaggedRule ? "" : (descriptionIdentifiers.length ? "" : tag);
      const isCv = norm(record.sheet) === "CV" || /-C1O-CV-/.test(norm(record.document));
      const empty = !current || ["0", "-", "N/A"].includes(norm(current));
      const literalTag = /\bTAG\b\s*[:\-]?\s*[A-Z0-9]/i.test(current);
      const formatting = /\s{2,}|--|[-–—]\s*[-–—]|^\s*[-–—]|[-–—]\s*$/.test(current) || literalTag;
      const generic = titleLooksGeneric(current, type);
      const needsTag = tagRequired(record, drawing ? "DESENHO" : type, titleTag) && tagEvidence.confirmed && Boolean(titleTag) && !norm(current).includes(norm(titleTag));
      const descriptionMismatch = Boolean(
        description
        && (trustedNonTagged || trustedScon || trustedDescription)
        && !norm(current).includes(norm(description))
      );
      let issue = "ok";
      let classification = "ok";
      let reason = "Título claro e sem divergência identificada";
      if (empty) { issue = "empty"; classification = trustedScon || trustedDescription || tagEvidence.confirmed ? "confirmed_error" : "insufficient"; reason = "Título vazio"; }
      else if (needsTag) { issue = "missing_tag"; classification = "confirmed_error"; reason = `A TAG comprovada por ${tagEvidence.source.toLowerCase()} não aparece no título`; }
      else if (descriptionMismatch) {
        issue = "description_mismatch";
        classification = trustedNonTagged && nonTaggedRule.exact
          ? "confirmed_error"
          : trustedScon || reference && reference.verifiedCatalog ? "confirmed_error" : "suggestion";
        reason = nonTaggedRule
          ? "O título não representa completamente O QUÊ e ONDE/QUANDO do Campo 7 nt-"
          : trustedScon
            ? "O terceiro campo da DESCRIÇÃO do SCON não aparece no título"
            : "A descrição validada não aparece no título";
      }
      else if (possibleIdentifier && !norm(current).includes(norm(possibleIdentifier))) { issue = "possible_identifier"; classification = "insufficient"; reason = `O código contém “${possibleIdentifier}”, mas não existe fonte suficiente para confirmar que seja uma TAG`; }
      else if (generic) { issue = "generic"; classification = "suggestion"; reason = "Título pouco específico"; }
      else if (formatting) { issue = "format"; classification = "suggestion"; reason = literalTag ? "Remover a palavra TAG e manter somente o código" : "Padronizar espaços e separadores"; }
      let proposed = "";
      let confidence = "nenhuma";
      if (issue !== "ok" && reference && reference.manualReview && !trustedScon) {
        classification = "insufficient";
        reason = "A base marcou esta descrição para revisão humana; nenhuma sugestão foi aplicada";
      } else if (issue !== "ok" && issue !== "possible_identifier") {
        if (isCv) {
          if (referenceDescription) {
            proposed = buildTitle("CURRÍCULO", referenceDescription, "");
            confidence = reference && !reference.inferred ? "alta" : "media";
          }
        } else if ((description || tag) && (type || description || tag)) {
          proposed = buildTitle(type, description, titleTag);
          const hasExternal = Boolean(sconTitleComplement || explicitComplementary || explicitDescription || explicitScon || referenceDescription || nonTaggedRule && nonTaggedRule.description);
          confidence = trustedScon
            ? "alta"
            : nonTaggedRule && nonTaggedRule.exact
            ? "alta"
            : nonTaggedRule && nonTaggedRule.description
              ? nonTaggedRule.confidence || "media"
              : reference && reference.verifiedCatalog && trustedDescription
                ? (reference.confidence === "alta" ? "alta" : "media")
                : hasExternal && tagEvidence.confirmed ? "alta" : hasExternal || (tagEvidence.confirmed && type) ? "media" : "baixa";
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
      const evidence = [
        tagEvidence.source,
        nonTaggedRule && nonTaggedRule.source,
        sconEvidence,
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
        descriptionIdentifiers,
        possibleIdentifier,
        tagEvidence,
        description,
        descriptionSource: trustedScon ? "SCON · 3º campo da DESCRIÇÃO" : nonTaggedRule ? "Catálogo controlado nt-" : referenceDescription ? "Base controlada de títulos" : explicitComplementary ? "Complementar da LD" : explicitDescription ? "Descrição da LD" : explicitScon ? "SCON da LD" : "Título atual",
        sconMatch: sconReference && !sconReference.ambiguousDescription ? "SIM" : sconReference ? "AMBÍGUO" : "NÃO",
        sconMatchMode: sconReference && sconReference.matchMode || "",
        sconTitleComplement,
        sconFullDescription: sconReference && sconReference.fullDescription || "",
        sconTag: sconReference && sconReference.sconTag || "",
        sconItemType: sconReference && sconReference.itemType || "",
        sconDrawingReference: sconReference && sconReference.drawingReference || "",
        sconSourceFile: sconReference && sconReference.sourceFile || "",
        sconSourceSheet: sconReference && sconReference.sourceSheet || "",
        sconSourceRows: sconReference && (sconReference.sourceRows || [sconReference.row]).filter(Boolean) || [],
        nonTaggedRule,
        nonTaggedIdentifier: nonTaggedRule && nonTaggedRule.identifier || "",
        nonTaggedWhat: nonTaggedRule && nonTaggedRule.what || "",
        nonTaggedWhereWhen: nonTaggedRule && nonTaggedRule.whereWhen || "",
        nonTaggedSource: nonTaggedRule && nonTaggedRule.source || "",
        titlePrefix: type,
        drawingRule: drawing
          ? "DESENHO — manter tratamento específico e TAG comprovada"
          : nonTaggedRule
            ? "CAMPO 7 nt- — construir O QUÊ + ONDE/QUANDO"
            : "PREFIXO PRESERVADO — completar somente descrição e TAG",
        proposed,
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
    referenceDescriptionCandidate,
    parseSconDescription,
    buildSconReferenceIndex,
    parseSconTitleCatalog,
    sconReferenceFor,
    technicalIdentifiers,
    parseTitleReferenceWorkbook,
    titleLooksGeneric,
    buildTitle,
    auditTitles,
    summarize,
  };
});
