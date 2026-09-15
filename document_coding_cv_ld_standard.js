(function (root, factory) {
  const LD = typeof module === "object" && module.exports ? require("./document_coding_ld_core.js") : root.RECONDocumentCodingLDCore;
  const Core = typeof module === "object" && module.exports ? require("./document_coding_cv_core_standard.js") : root.RECONDocumentCodingCore;
  const patched = factory(LD, Core);
  if (typeof module === "object" && module.exports) module.exports = patched;
  if (root && LD === root.RECONDocumentCodingLDCore) root.RECONDocumentCodingLDCore = patched;
})(typeof globalThis !== "undefined" ? globalThis : this, function (LD, Core) {
  "use strict";

  if (!LD || !Core) throw new Error("Motores de LD/CV não carregados.");

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) { return Core.norm ? Core.norm(value) : text(value).toUpperCase(); }

  function parseCv(entry) {
    return Core.parseEtCvCode && Core.parseEtCvCode(entry && entry.code);
  }

  function isCvSchema(schema) {
    if (!schema) return false;
    if (norm(schema.sheet) === "CV") return true;
    return (schema.rows || []).some((entry) => Boolean(parseCv(entry)));
  }

  function cvRows(schema, analysis) {
    const data = analysis && analysis.data || {};
    const contract = text(data.contract);
    const emitter = text(data.emitter);
    const discipline = text(data.discipline);
    const rows = (schema && schema.rows || []).filter((entry) => {
      const cv = parseCv(entry);
      if (!cv) return false;
      if (contract && norm(cv.contract) !== norm(contract)) return false;
      if (emitter && norm(cv.emitter) !== norm(emitter)) return false;
      if (discipline && norm(cv.discipline) !== norm(discipline)) return false;
      return true;
    });
    return rows.length ? rows : (schema && schema.rows || []).filter((entry) => Boolean(parseCv(entry)));
  }

  function chooseCvDestination(analysis, schemaIndex) {
    const direct = analysis && (analysis.ldMatch || analysis.matchInfo && analysis.matchInfo.match);
    if (direct && direct.ld && direct.sheet) {
      const schema = (schemaIndex && schemaIndex.schemas || []).find((candidate) => candidate.file === direct.ld && candidate.sheet === direct.sheet);
      if (schema && isCvSchema(schema)) return { schema, confidence: "confirmed", score: 999, reasons: ["currículo existente na própria LD"], existing: direct };
    }

    const data = analysis && analysis.data || {};
    const discipline = text(data.discipline);
    const ranked = (schemaIndex && schemaIndex.schemas || []).filter(isCvSchema).map((schema) => {
      const rows = cvRows(schema, analysis);
      let score = norm(schema.sheet) === "CV" ? 80 : 45;
      const reasons = [norm(schema.sheet) === "CV" ? "aba CV da LD" : "códigos CV encontrados na aba"];
      if (/LD[-_. ]?.*001|C1O-001/i.test(schema.file || "")) { score += 25; reasons.push("LD operacional dos currículos"); }
      if (discipline && rows.some((entry) => {
        const cv = parseCv(entry);
        return cv && norm(cv.discipline) === norm(discipline);
      })) { score += 30; reasons.push(`família da disciplina ${discipline}`); }
      return { schema, score, reasons };
    }).sort((a, b) => b.score - a.score);

    if (!ranked.length) return { schema: null, confidence: "missing", score: 0, reasons: ["aba CV não encontrada nas LDs carregadas"] };
    const first = ranked[0];
    const second = ranked[1];
    if (!second || first.score - second.score >= 15) return Object.assign({ confidence: "high" }, first);
    return { schema: null, confidence: "review", score: first.score, reasons: first.reasons, candidates: ranked.slice(0, 4) };
  }

  function chooseDestination(analysis, schemaIndex) {
    if (analysis && analysis.ruleId === "et-cv") return chooseCvDestination(analysis, schemaIndex);
    return LD.chooseDestination(analysis, schemaIndex);
  }

  function generateLine(analysis, schemaIndex, edits) {
    if (!analysis || analysis.ruleId !== "et-cv") return LD.generateLine(analysis, schemaIndex, edits);
    const destination = chooseCvDestination(analysis, schemaIndex);
    if (!destination.schema) {
      return { status: "review", valid: false, destination, headers: [], values: [], missing: ["LD/aba CV de destino"], position: null };
    }

    // O motor genérico ainda classifica códigos ET sequenciais como "other".
    // Para CV restringimos explicitamente a análise à aba CV e, dentro dela,
    // apenas à mesma família contrato+emissor+disciplina. Assim valores estáveis
    // e a localização lógica não são contaminados por CVs de outra disciplina.
    const family = cvRows(destination.schema, analysis);
    const schema = Object.assign({}, destination.schema, { rows: family.length ? family : destination.schema.rows });
    const restrictedIndex = { schemas: [schema], byId: new Map([[schema.id, schema]]) };
    const result = LD.generateLine(analysis, restrictedIndex, edits);
    if (result) {
      result.destination = destination;
      result.schema = schema;
      result.groupKey = `${schema.file}::${schema.sheet}::${schema.signature}`;
    }
    return result;
  }

  return Object.freeze(Object.assign({}, LD, {
    isCvSchema,
    cvRows,
    chooseCvDestination,
    chooseDestination,
    generateLine,
  }));
});
