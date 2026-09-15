(function (root, factory) {
  const Core = typeof module === "object" && module.exports ? require("./document_coding_core.js") : root.RECONDocumentCodingCore;
  const Normative = typeof module === "object" && module.exports ? require("./document_coding_cv_standard.js") : root.RECONDocumentCodingNormative;
  const patched = factory(Core, Normative);
  if (typeof module === "object" && module.exports) module.exports = patched;
  if (root && Core === root.RECONDocumentCodingCore) root.RECONDocumentCodingCore = patched;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core, Normative) {
  "use strict";

  if (!Core) throw new Error("Motor de codificação não carregado.");

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) { return Core.norm ? Core.norm(value) : text(value).toUpperCase(); }

  function parseEtCvCode(code) {
    const value = text(code);
    const match = value.match(/^(.+)-([A-Z0-9]{2,4})-CV-([A-Z0-9]{2,8})-(\d{4})$/i);
    if (!match) return null;
    return {
      scheme: "et-cv",
      contract: match[1],
      emitter: match[2].toUpperCase(),
      documentType: "CV",
      discipline: match[3].toUpperCase(),
      sequence: match[4],
      code: value,
    };
  }

  function uniqueValue(rows, field) {
    const values = new Map();
    rows.forEach((row) => {
      const value = text(row && row[field]);
      if (!value) return;
      values.set(norm(value), value);
    });
    return values.size === 1 ? [...values.values()][0] : "";
  }

  const TITLE_STOP = new Set(["CURRICULO", "CURRICULUM", "VITAE", "RNEST", "TREM", "PRODUCAO", "ENGENHARIA"]);
  function titleTokens(value) {
    return new Set(norm(value).replace(/[^A-Z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 4 && !TITLE_STOP.has(token)));
  }
  function titleSimilarity(a, b) {
    const A = titleTokens(a);
    const B = titleTokens(b);
    if (!A.size || !B.size) return 0;
    let common = 0;
    A.forEach((token) => { if (B.has(token)) common += 1; });
    return common / Math.max(1, Math.min(A.size, B.size));
  }

  function inferDisciplineByTitle(parsedRows, title) {
    if (!text(title)) return { discipline: "", score: 0, evidenceTitle: "" };
    const bestByDiscipline = new Map();
    parsedRows.forEach((row) => {
      if (!row.title) return;
      const score = titleSimilarity(title, row.title);
      const current = bestByDiscipline.get(row.discipline);
      if (!current || score > current.score) bestByDiscipline.set(row.discipline, { discipline: row.discipline, score, evidenceTitle: row.title });
    });
    const ranked = [...bestByDiscipline.values()].sort((a, b) => b.score - a.score);
    const first = ranked[0];
    const second = ranked[1];
    if (!first || first.score < 0.55) return { discipline: "", score: first && first.score || 0, evidenceTitle: first && first.evidenceTitle || "" };
    if (second && first.score - second.score < 0.15) return { discipline: "", score: first.score, evidenceTitle: first.evidenceTitle };
    return first;
  }

  function inferCvDefaults(ldIndex, data) {
    const parsed = [];
    (ldIndex && ldIndex.rows || []).forEach((entry) => {
      const cv = parseEtCvCode(entry && entry.code);
      if (cv) parsed.push(Object.assign({}, cv, { title: text(entry.title || entry.raw && (entry.raw.TÍTULO || entry.raw.TITULO)) }));
    });
    if (!parsed.length) return { defaults: {}, evidence: "", candidates: 0 };

    const explicitDiscipline = text(data && data.discipline);
    const inferredDiscipline = explicitDiscipline ? { discipline: explicitDiscipline, score: 1, evidenceTitle: "" } : inferDisciplineByTitle(parsed, data && data.title);
    const discipline = explicitDiscipline || inferredDiscipline.discipline;
    const sameDiscipline = discipline ? parsed.filter((row) => norm(row.discipline) === norm(discipline)) : parsed;
    const sourceRows = sameDiscipline.length ? sameDiscipline : parsed;
    const contract = uniqueValue(sourceRows, "contract") || uniqueValue(parsed, "contract");
    const emitter = uniqueValue(sourceRows, "emitter") || uniqueValue(parsed, "emitter");
    const defaults = { documentType: "CV" };
    if (contract) defaults.contract = contract;
    if (emitter) defaults.emitter = emitter;
    if (!explicitDiscipline && inferredDiscipline.discipline) defaults.discipline = inferredDiscipline.discipline;
    const evidenceParts = [];
    if (contract || emitter) evidenceParts.push(`${sourceRows.length} currículo(s) compatível(is) na LD`);
    if (!explicitDiscipline && inferredDiscipline.discipline) evidenceParts.push(`disciplina ${inferredDiscipline.discipline} inferida por título semelhante “${inferredDiscipline.evidenceTitle}”`);
    else if (discipline) evidenceParts.push(`disciplina ${discipline}`);
    return {
      defaults,
      candidates: sourceRows.length,
      disciplineConfidence: inferredDiscipline.score,
      evidence: evidenceParts.join("; "),
    };
  }

  function analyzeDocument(input, ldIndex, options) {
    const baseInput = input || {};
    const extracted = Core.extractTechnicalData(baseInput);
    if (!extracted.classification || extracted.classification.kind !== "et-cv") {
      return Core.analyzeDocument(baseInput, ldIndex, options);
    }

    const inferred = inferCvDefaults(ldIndex, Object.assign({}, extracted, baseInput.overrides || {}));
    // Dados informados pelo usuário/documento sempre vencem a inferência da LD.
    const overrides = Object.assign({}, inferred.defaults, baseInput.overrides || {});
    const result = Core.analyzeDocument(Object.assign({}, baseInput, { overrides }), ldIndex, options);
    if (result && result.data) {
      result.data.cvOperationalStandard = Normative && Normative.CV_OPERATIONAL_STANDARD || null;
      result.data.cvOperationalEvidence = inferred.evidence;
    }
    if (result && inferred.evidence && !result.existing) {
      result.message = `${result.message || ""} Padrão de CV confirmado pela LD: ${inferred.evidence}.`.trim();
    }
    return result;
  }

  return Object.freeze(Object.assign({}, Core, {
    parseEtCvCode,
    titleSimilarity,
    inferDisciplineByTitle,
    inferCvDefaults,
    analyzeDocument,
  }));
});
