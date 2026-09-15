(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONGlobalTagTitleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function fold(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[‐‑‒–—―−]/g, "-")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // REGRA GLOBAL: nt- é apenas marcador do código documental e NUNCA integra
  // a chave pesquisada. As bases e o documento passam pela mesma normalização.
  function normalizeTag(value) {
    return fold(value)
      .replace(/^NT\s*[-._/:]*\s*/i, "")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s*([./_])\s*/g, "$1")
      .replace(/\s+/g, "");
  }

  function normalizeDescription(value) {
    return fold(value).replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  const STOP_WORDS = new Set([
    "A", "AS", "O", "OS", "DE", "DA", "DAS", "DO", "DOS", "E", "EM", "PARA", "POR", "COM",
    "RELATORIO", "RELATORIOS", "INSPECAO", "RECEBIMENTO", "DOCUMENTO", "TAG",
  ]);

  function tokens(value) {
    return new Set(normalizeDescription(value).split(" ").filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
  }

  function containsDescription(container, part) {
    const a = normalizeDescription(container);
    const b = normalizeDescription(part);
    return Boolean(a && b && (a === b || a.includes(b)));
  }

  function descriptionsCompatible(left, right) {
    const a = normalizeDescription(left);
    const b = normalizeDescription(right);
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const leftTokens = tokens(left);
    const rightTokens = tokens(right);
    if (!leftTokens.size || !rightTokens.size) return false;
    let shared = 0;
    leftTokens.forEach((token) => { if (rightTokens.has(token)) shared += 1; });
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return shared >= 1 && union > 0 && shared / union >= 0.35;
  }

  function isMoreInformative(candidate, baseline) {
    const candidateNorm = normalizeDescription(candidate);
    const baselineNorm = normalizeDescription(baseline);
    if (!candidateNorm) return false;
    if (!baselineNorm) return true;
    if (candidateNorm === baselineNorm) return false;
    if (candidateNorm.includes(baselineNorm)) return true;
    const candidateTokens = tokens(candidate);
    const baselineTokens = tokens(baseline);
    if (!baselineTokens.size || candidateTokens.size <= baselineTokens.size) return false;
    return [...baselineTokens].every((token) => candidateTokens.has(token));
  }

  function combineDescriptions(left, right) {
    const a = text(left);
    const b = text(right);
    if (!a) return b;
    if (!b) return a;
    if (normalizeDescription(a) === normalizeDescription(b)) return a.length >= b.length ? a : b;
    if (containsDescription(a, b)) return a;
    if (containsDescription(b, a)) return b;
    if (!descriptionsCompatible(a, b)) return a;
    const ta = tokens(a);
    const tb = tokens(b);
    const aContainsTokens = [...tb].every((token) => ta.has(token));
    const bContainsTokens = [...ta].every((token) => tb.has(token));
    if (aContainsTokens || bContainsTokens) return a.length >= b.length ? a : b;
    return a.length >= b.length ? a : b;
  }

  function call(spec, name, entry, fallback) {
    try {
      return typeof spec[name] === "function" ? spec[name](entry) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function confidenceRank(value) {
    const key = fold(value);
    if (key === "ALTA" || key === "HIGH") return 3;
    if (key === "MEDIA" || key === "MÉDIA" || key === "MEDIUM") return 2;
    if (key === "BAIXA" || key === "LOW") return 1;
    return 0;
  }

  function buildIndex(sourceSpecs) {
    const byTag = new Map();
    const sources = [];
    (sourceSpecs || []).filter(Boolean).forEach((spec, sourceOrder) => {
      const entries = Array.isArray(spec.entries) ? spec.entries : [];
      const source = {
        id: text(spec.id) || `source-${sourceOrder + 1}`,
        label: text(spec.label) || text(spec.id) || `Fonte ${sourceOrder + 1}`,
        priority: Number(spec.priority) || 50,
        confidence: text(spec.confidence) || "media",
        kind: text(spec.kind) || "generic",
        count: entries.length,
      };
      sources.push(source);
      entries.forEach((entry, entryOrder) => {
        const rawTags = call(spec, "tags", entry, entry && entry.tag ? [entry.tag] : []);
        const tagValues = Array.isArray(rawTags) ? rawTags : [rawTags];
        const uniqueTags = [...new Map(tagValues.filter(Boolean).map((tag) => [normalizeTag(tag), text(tag)])).entries()]
          .filter(([key]) => key);
        if (!uniqueTags.length) return;
        const description = text(call(spec, "description", entry, entry && (entry.description || entry.title || "")));
        const reference = {
          sourceId: source.id,
          sourceLabel: source.label,
          sourceKind: source.kind,
          priority: source.priority,
          confidence: text(call(spec, "confidenceFor", entry, entry && entry.confidence || source.confidence)) || source.confidence,
          description,
          descriptionKey: normalizeDescription(description),
          document: text(call(spec, "document", entry, entry && entry.document || "")),
          documentKey: text(call(spec, "documentKey", entry, entry && entry.documentKey || "")),
          discipline: text(call(spec, "discipline", entry, entry && entry.discipline || "")),
          eap: text(call(spec, "eap", entry, entry && entry.eap || "")),
          row: call(spec, "row", entry, entry && entry.row || entryOrder + 1),
          column: text(call(spec, "column", entry, entry && entry.column || "")),
          entry,
        };
        uniqueTags.forEach(([tagKey, originalTag]) => {
          if (!byTag.has(tagKey)) byTag.set(tagKey, []);
          byTag.get(tagKey).push({ ...reference, tag: originalTag, tagKey });
        });
      });
    });

    byTag.forEach((items, key) => {
      const unique = new Map();
      items.forEach((item) => {
        const dedupeKey = [item.sourceId, item.tagKey, item.documentKey || item.document, item.descriptionKey, item.row].join("|");
        if (!unique.has(dedupeKey)) unique.set(dedupeKey, item);
      });
      byTag.set(key, [...unique.values()]);
    });

    return { byTag, sources, sourceCount: sources.length, tagCount: byTag.size };
  }

  function lookup(index, tag) {
    const key = normalizeTag(tag);
    if (!key || !index || !index.byTag) return [];
    return (index.byTag.get(key) || []).slice();
  }

  // Um Grupo 7 pode carregar a TAG seguida de um complemento humano, como
  // nt-NF-228452-Tubos. Não fazemos fuzzy match: geramos segmentos candidatos
  // e só aceitamos um quando ele existe EXATAMENTE no índice global. O candidato
  // mais longo é testado primeiro, evitando reduzir uma TAG válida maior.
  function candidateTagKeys(value) {
    const clean = fold(value)
      .replace(/^NT\s*[-._/:]*\s*/i, "")
      .replace(/\s+/g, "")
      .trim();
    const exact = normalizeTag(clean);
    const result = [];
    const seen = new Set();
    const push = (candidate) => {
      const key = normalizeTag(candidate);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(key);
    };
    push(exact);
    const parts = clean.split(/[-._/]+/).filter(Boolean);
    const separators = ["-", "/", "_", "."];
    for (let length = parts.length - 1; length >= 2; length -= 1) {
      for (let start = 0; start + length <= parts.length; start += 1) {
        const slice = parts.slice(start, start + length);
        separators.forEach((separator) => push(slice.join(separator)));
      }
    }
    return result;
  }

  function lookupCandidate(index, value) {
    const fallback = normalizeTag(value);
    if (!index || !index.byTag) return { lookupTag: fallback, matches: [] };
    for (const key of candidateTagKeys(value)) {
      const matches = (index.byTag.get(key) || []).slice();
      if (matches.length) return { lookupTag: key, matches };
    }
    return { lookupTag: fallback, matches: [] };
  }

  function contextScore(item, context) {
    const wanted = context || {};
    let score = 0;
    const discipline = fold(wanted.discipline);
    const itemDiscipline = fold(item.discipline);
    if (discipline && itemDiscipline && (discipline === itemDiscipline || discipline.includes(itemDiscipline) || itemDiscipline.includes(discipline))) score += 8;
    const eap = fold(wanted.eap).replace(/\s+/g, "");
    const itemEap = fold(item.eap).replace(/\s+/g, "");
    if (eap && itemEap && eap === itemEap) score += 5;
    if (wanted.documentKey && item.documentKey && wanted.documentKey === item.documentKey) score += 2;
    return score;
  }

  function select(matches, context) {
    const all = Array.isArray(matches) ? matches.slice() : [];
    if (!all.length) {
      return {
        status: "not_found",
        description: "",
        matches: [],
        describedMatches: [],
        sources: [],
        primarySource: "",
        confidence: "nenhuma",
        conflict: false,
        conflicts: [],
      };
    }

    const described = all.filter((item) => item.descriptionKey);
    const sourceLabels = [...new Set(all.map((item) => item.sourceLabel).filter(Boolean))];
    if (!described.length) {
      return {
        status: "found_without_description",
        description: "",
        matches: all,
        describedMatches: [],
        sources: sourceLabels,
        primarySource: all[0] && all[0].sourceLabel || "",
        confidence: "nenhuma",
        conflict: false,
        conflicts: [],
      };
    }

    const ranked = described.slice().sort((left, right) => {
      const leftScore = left.priority * 100 + confidenceRank(left.confidence) * 10 + contextScore(left, context);
      const rightScore = right.priority * 100 + confidenceRank(right.confidence) * 10 + contextScore(right, context);
      return rightScore - leftScore || right.description.length - left.description.length || left.sourceLabel.localeCompare(right.sourceLabel, "pt-BR");
    });

    let selected = ranked[0];
    let description = selected.description;
    const supportingSources = new Set([selected.sourceLabel]);
    const conflicts = [];

    ranked.slice(1).forEach((candidate) => {
      if (candidate.descriptionKey === normalizeDescription(description)) {
        supportingSources.add(candidate.sourceLabel);
        return;
      }
      if (descriptionsCompatible(description, candidate.description)) {
        const combined = combineDescriptions(description, candidate.description);
        if (isMoreInformative(combined, description) && candidate.priority >= selected.priority - 20) {
          description = combined;
          if (candidate.priority > selected.priority) selected = candidate;
        }
        supportingSources.add(candidate.sourceLabel);
        return;
      }
      if (candidate.priority >= 60 && selected.priority >= 60) {
        conflicts.push({
          source: candidate.sourceLabel,
          description: candidate.description,
          priority: candidate.priority,
        });
      }
    });

    let confidence = selected.priority >= 90 || confidenceRank(selected.confidence) >= 3
      ? "alta"
      : selected.priority >= 65 || confidenceRank(selected.confidence) >= 2 ? "media" : "baixa";
    if (conflicts.length && confidence === "alta") confidence = "media";

    return {
      status: "reference_found",
      description,
      matches: all,
      describedMatches: ranked,
      sources: [...new Set([...supportingSources, ...sourceLabels])],
      supportingSources: [...supportingSources],
      primarySource: selected.sourceLabel,
      primarySourceId: selected.sourceId,
      primaryPriority: selected.priority,
      confidence,
      conflict: conflicts.length > 0,
      conflicts,
      trace: ranked.map((item) => ({
        source: item.sourceLabel,
        tag: item.tag,
        description: item.description,
        document: item.document,
        row: item.row,
        column: item.column,
        priority: item.priority,
        confidence: item.confidence,
      })),
    };
  }

  function statusLabel(status) {
    if (status === "reference_found") return "REFERÊNCIA ENCONTRADA";
    if (status === "found_without_description") return "TAG ENCONTRADA, MAS SEM DESCRIÇÃO VÁLIDA";
    if (status === "not_found") return "TAG NÃO ENCONTRADA EM NENHUMA BASE DISPONÍVEL";
    return "TAG NÃO APLICÁVEL";
  }

  return {
    text,
    fold,
    normalizeTag,
    normalizeDescription,
    tokens,
    containsDescription,
    descriptionsCompatible,
    isMoreInformative,
    combineDescriptions,
    buildIndex,
    lookup,
    candidateTagKeys,
    lookupCandidate,
    select,
    statusLabel,
  };
});