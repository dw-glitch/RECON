(function (root, factory) {
  const current = typeof module === "object" && module.exports
    ? require("./document_coding_normative.js")
    : root.RECONDocumentCodingNormative;
  const patched = factory(current);
  if (typeof module === "object" && module.exports) module.exports = patched;
  if (root && current === root.RECONDocumentCodingNormative) root.RECONDocumentCodingNormative = patched;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Normative) {
  "use strict";

  if (!Normative || !Normative.RULES || !Normative.RULES.ET_CV) {
    throw new Error("Base normativa de CV não carregada.");
  }

  // Evidência operacional confirmada na LD-5290.00-22313-91A-C1O-001,
  // aba CV. Os códigos reais seguem:
  // 5900.0130870.25.2-C1O-CV-CRS-0001
  // 5900.0130870.25.2-C1O-CV-CVL-0001
  // 5900.0130870.25.2-C1O-CV-ELE-0001
  // 5900.0130870.25.2-C1O-CV-GER-0001
  // Portanto o sequencial reinicia por disciplina. Sem a disciplina na
  // família, o motor poderia propor CV-GER-0004 após ler CVs de CRS/CVL/ELE.
  const CV_OPERATIONAL_STANDARD = Object.freeze({
    source: "LD-5290.00-22313-91A-C1O-001 — aba CV",
    contract: "5900.0130870.25.2",
    emitter: "C1O",
    documentType: "CV",
    format: "<CONTRATO>-<EMISSOR>-CV-<DISCIPLINA>-<SEQUENCIAL_4_DIGITOS>",
    sequenceResetsBy: Object.freeze(["contract", "emitter", "documentType", "discipline"]),
    examples: Object.freeze([
      "5900.0130870.25.2-C1O-CV-CRS-0001",
      "5900.0130870.25.2-C1O-CV-CVL-0001",
      "5900.0130870.25.2-C1O-CV-ELE-0001",
      "5900.0130870.25.2-C1O-CV-ETF-0001",
      "5900.0130870.25.2-C1O-CV-GER-0001",
    ]),
  });

  const etCv = Object.freeze(Object.assign({}, Normative.RULES.ET_CV, {
    sequenceFamily: CV_OPERATIONAL_STANDARD.sequenceResetsBy,
    operationalEvidence: CV_OPERATIONAL_STANDARD.source,
    operationalPattern: CV_OPERATIONAL_STANDARD.format,
  }));
  const rules = Object.freeze(Object.assign({}, Normative.RULES, { ET_CV: etCv }));

  return Object.freeze(Object.assign({}, Normative, {
    RULES: rules,
    CV_OPERATIONAL_STANDARD,
  }));
});
