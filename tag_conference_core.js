(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONTagConferenceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS = Object.freeze({
    CONFIRMED: "confirmed",
    REMOVE_NT: "remove_nt",
    ADD_NT: "add_nt",
    NON_TAGGED: "non_tagged",
    REVIEW: "review",
  });

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function norm(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizedTag(value) {
    return norm(value)
      .replace(/^NT[-_]/, "")
      .replace(/[\/_]+/g, "-")
      .replace(/\s+/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function compactTag(value) {
    return normalizedTag(value).replace(/[^A-Z0-9]/g, "");
  }

  function cleanInput(value) {
    let raw = text(value).replace(/^['"]+|['",;]+$/g, "");
    raw = raw.split(/[\\/]/).pop() || raw;
    raw = raw.replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    const token = raw.split(/\s+/).filter((part) => /_RNEST_/i.test(part)).sort((a, b) => b.length - a.length)[0];
    return (token || raw).replace(/^[^A-Z0-9]+|[^A-Z0-9._~\/-]+$/gi, "");
  }

  function parseDocument(value) {
    const original = text(value);
    const document = cleanInput(value);
    const groups = document.split("_");
    const validBase = groups.length >= 7 && norm(groups[1]) === "RNEST";
    if (!validBase) {
      return {
        original, document, valid: false, groups, prefix: "", identifier: "", candidateTag: "",
        isNonTagged: false, exactNt: false,
        error: groups.length < 7
          ? "O código não possui os sete grupos separados por underline."
          : "O código não foi reconhecido como relatório RNEST.",
      };
    }
    const prefix = groups.slice(0, 6).join("_");
    const identifier = groups.slice(6).join("_").trim();
    const isNonTagged = /^nt(?:-|_)/i.test(identifier);
    const exactNt = identifier.startsWith("nt-");
    const candidateTag = isNonTagged ? identifier.replace(/^nt(?:-|_)/i, "") : identifier;
    if (!identifier) {
      return { original, document, valid: false, groups, prefix, identifier, candidateTag, isNonTagged, exactNt, error: "O Campo 7 está vazio." };
    }
    return { original, document, valid: true, groups, prefix, identifier, candidateTag, isNonTagged, exactNt, error: "" };
  }

  function referenceEntry(row) {
    if (!row) return null;
    const tag = text(row.tag || row.TAG || row["TAG (NOTA 1)"] || row["TAG"]);
    if (!tag) return null;
    return {
      unit: text(row.unit || row["UNIDADE DE PROCESSO"]),
      discipline: text(row.discipline || row["DISCIPLINA"]),
      tag,
      description: text(row.description || row["DESCRIÇÃO"] || row["DESCRICAO"]),
      responsible: text(row.responsible || row["RESPONSÁVEL PELO FORNECIMENTO"] || row["RESPONSAVEL PELO FORNECIMENTO"]),
      equipmentArea: text(row.equipmentArea || row["EQUIPAMENTO PRINCIPAL/ÁREA (NOTA 2)"] || row["EQUIPAMENTO PRINCIPAL/AREA (NOTA 2)"] || row["EQUIPAMENTO PRINCIPAL/ÁREA"]),
      criticality: text(row.criticality || row["CRITICIDADE (NOTA 3)"] || row["CRITICIDADE"]),
      originalSupplier: text(row.originalSupplier || row["FORNECEDOR ORIGINAL (NOTA 5)"] || row["FORNECEDOR ORIGINAL"]),
    };
  }

  function buildReferenceIndex(rows, meta) {
    const entries = [];
    const byNormalized = new Map();
    const byCompact = new Map();
    (rows || []).forEach((row) => {
      const entry = referenceEntry(row);
      if (!entry) return;
      entry.normalized = normalizedTag(entry.tag);
      entry.compact = compactTag(entry.tag);
      entry.referenceRow = Number(row.referenceRow || row.__row || 0) || 0;
      entries.push(entry);
      if (entry.normalized) {
        if (!byNormalized.has(entry.normalized)) byNormalized.set(entry.normalized, []);
        byNormalized.get(entry.normalized).push(entry);
      }
      if (entry.compact) {
        if (!byCompact.has(entry.compact)) byCompact.set(entry.compact, []);
        byCompact.get(entry.compact).push(entry);
      }
    });
    return {
      entries,
      byNormalized,
      byCompact,
      meta: Object.assign({ count: entries.length, source: "Base de TAGs", revision: "" }, meta || {}, { count: entries.length }),
    };
  }

  function findReference(index, candidate) {
    const normalized = normalizedTag(candidate);
    const compact = compactTag(candidate);
    const exact = index && index.byNormalized && index.byNormalized.get(normalized) || [];
    if (exact.length === 1) return { entry: exact[0], candidates: exact, matchType: "contract", conflict: false };
    if (exact.length > 1) return { entry: null, candidates: exact, matchType: "contract", conflict: true };
    const loose = index && index.byCompact && index.byCompact.get(compact) || [];
    if (loose.length === 1) return { entry: loose[0], candidates: loose, matchType: "punctuation", conflict: false };
    if (loose.length > 1) return { entry: null, candidates: loose, matchType: "punctuation", conflict: true };
    return { entry: null, candidates: [], matchType: "none", conflict: false };
  }

  function replaceIdentifier(parsed, nextIdentifier) {
    return parsed.prefix ? `${parsed.prefix}_${nextIdentifier}` : parsed.document;
  }

  function analyzeOne(value, index) {
    const parsed = parseDocument(value);
    if (!parsed.valid) {
      return {
        status: STATUS.REVIEW,
        statusLabel: "REVISAR CÓDIGO",
        original: parsed.original,
        document: parsed.document,
        identifier: parsed.identifier,
        candidateTag: parsed.candidateTag,
        correctedCode: parsed.document,
        reason: parsed.error,
        reference: null,
        matchType: "none",
        confidence: "baixa",
      };
    }

    const found = findReference(index, parsed.candidateTag);
    if (found.conflict) {
      return {
        status: STATUS.REVIEW,
        statusLabel: "REVISAR CORRESPONDÊNCIA",
        original: parsed.original,
        document: parsed.document,
        identifier: parsed.identifier,
        candidateTag: parsed.candidateTag,
        correctedCode: parsed.document,
        reason: "Mais de uma TAG da base possui a mesma chave sem pontuação. Nenhuma correção automática foi aplicada.",
        reference: null,
        referenceCandidates: found.candidates,
        matchType: found.matchType,
        confidence: "baixa",
      };
    }

    if (found.entry && parsed.isNonTagged) {
      return {
        status: STATUS.REMOVE_NT,
        statusLabel: "REMOVER nt- — TAG EXISTE",
        original: parsed.original,
        document: parsed.document,
        identifier: parsed.identifier,
        candidateTag: parsed.candidateTag,
        correctedCode: replaceIdentifier(parsed, normalizedTag(found.entry.tag)),
        reason: `A TAG ${found.entry.tag} existe no Anexo I — Apêndice 3. O Campo 7 não deve começar por nt-.`,
        reference: found.entry,
        matchType: found.matchType,
        confidence: "alta",
      };
    }

    if (found.entry) {
      const standardized = normalizedTag(found.entry.tag);
      const current = normalizedTag(parsed.identifier);
      const needsPunctuationCorrection = current !== standardized || parsed.identifier !== standardized;
      return {
        status: STATUS.CONFIRMED,
        statusLabel: needsPunctuationCorrection ? "TAG CONFIRMADA — PADRONIZAR" : "TAG CONFIRMADA",
        original: parsed.original,
        document: parsed.document,
        identifier: parsed.identifier,
        candidateTag: parsed.candidateTag,
        correctedCode: replaceIdentifier(parsed, standardized),
        reason: found.matchType === "punctuation"
          ? `A TAG foi localizada desconsiderando pontuação e foi padronizada como ${standardized}.`
          : "A TAG existe na base oficial de bens tagueados.",
        reference: found.entry,
        matchType: found.matchType,
        confidence: "alta",
      };
    }

    if (parsed.isNonTagged) {
      const correctedIdentifier = parsed.exactNt ? parsed.identifier : `nt-${parsed.candidateTag}`;
      return {
        status: STATUS.NON_TAGGED,
        statusLabel: parsed.exactNt ? "NÃO TAGUEADO CORRETO" : "CORRIGIR MARCADOR PARA nt-",
        original: parsed.original,
        document: parsed.document,
        identifier: parsed.identifier,
        candidateTag: parsed.candidateTag,
        correctedCode: replaceIdentifier(parsed, correctedIdentifier),
        reason: "O identificador não foi localizado na base oficial e o Campo 7 está marcado como item não tagueado.",
        reference: null,
        matchType: "none",
        confidence: "alta",
      };
    }

    return {
      status: STATUS.ADD_NT,
      statusLabel: "ADICIONAR nt- — TAG NÃO EXISTE",
      original: parsed.original,
      document: parsed.document,
      identifier: parsed.identifier,
      candidateTag: parsed.candidateTag,
      correctedCode: replaceIdentifier(parsed, `nt-${parsed.identifier}`),
      reason: "O identificador do Campo 7 não foi encontrado no Anexo I — Apêndice 3. O código deve ser tratado como não tagueado.",
      reference: null,
      matchType: "none",
      confidence: "alta",
    };
  }

  function analyze(values, index) {
    const rows = [];
    const seen = new Set();
    (values || []).forEach((value) => {
      const clean = text(value);
      if (!clean) return;
      const parsed = parseDocument(clean);
      const duplicateKey = norm(parsed.document || clean);
      if (seen.has(duplicateKey)) return;
      seen.add(duplicateKey);
      rows.push(analyzeOne(clean, index));
    });
    const counts = Object.values(STATUS).reduce((acc, key) => Object.assign(acc, { [key]: rows.filter((row) => row.status === key).length }), {});
    return { rows, counts, total: rows.length };
  }

  return Object.freeze({
    STATUS,
    text,
    norm,
    normalizedTag,
    compactTag,
    cleanInput,
    parseDocument,
    buildReferenceIndex,
    findReference,
    analyzeOne,
    analyze,
  });
});
