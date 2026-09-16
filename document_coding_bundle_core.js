(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RECONDocumentCodingBundleCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) {
    return text(value)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-").toUpperCase().replace(/\s+/g, " ").trim();
  }

  const PART_ROLE = Object.freeze({
    CV_EVALUATION: "cv-evaluation",
    CV_RESUME: "cv-resume",
    CV_EVIDENCE: "cv-evidence",
    SIGNATURE_LOG: "signature-log",
    GENERAL: "general",
  });

  const ROLE_LABEL = Object.freeze({
    [PART_ROLE.CV_EVALUATION]: "Avaliação de currículo",
    [PART_ROLE.CV_RESUME]: "Curriculum Vitae",
    [PART_ROLE.CV_EVIDENCE]: "Comprovação / anexo do currículo",
    [PART_ROLE.SIGNATURE_LOG]: "Log / assinaturas",
    [PART_ROLE.GENERAL]: "Parte do documento",
  });

  function sourceText(part) {
    return text(part && (part.text || part.parsed && part.parsed.text));
  }

  function classifyPart(part) {
    const raw = sourceText(part);
    const N = norm(raw);
    const filename = norm(part && (part.name || part.file && part.file.name));

    const evaluationSignals = [
      "AVALIACAO DE CURRICULO",
      "REQUISITO/FUNCAO CONTRATUAL",
      "CONTADOR DE EXPERIENCIA",
      "AVALIACAO CONSAG",
    ].filter((token) => N.includes(token)).length;
    if (evaluationSignals >= 2 || (N.includes("AVALIACAO DE CURRICULO") && N.includes("ANEXO X"))) {
      return { id: PART_ROLE.CV_EVALUATION, label: ROLE_LABEL[PART_ROLE.CV_EVALUATION], confidence: "high", signals: evaluationSignals };
    }

    const signatureSignals = ["CLICKSIGN", "ASSINATURAS", "DOCUMENTO ASSINADO", "LOG GERADO", "PONTOS DE AUTENTICACAO"]
      .filter((token) => N.includes(token)).length;
    if (signatureSignals >= 2 && (N.includes("ASSINATUR") || N.includes("LOG"))) {
      return { id: PART_ROLE.SIGNATURE_LOG, label: ROLE_LABEL[PART_ROLE.SIGNATURE_LOG], confidence: "high", signals: signatureSignals };
    }

    const cvSignals = ["CURRICULUM VITAE", "CURRICULO", "EXPERIENCIA PROFISSIONAL", "FORMACAO ACADEMICA", "FORMACAO ESCOLAR"]
      .filter((token) => N.includes(token)).length;
    if (N.includes("CURRICULUM VITAE") || (cvSignals >= 2 && N.includes("EXPERIENCIA"))) {
      return { id: PART_ROLE.CV_RESUME, label: ROLE_LABEL[PART_ROLE.CV_RESUME], confidence: "high", signals: cvSignals };
    }

    const evidenceSignals = [
      "DIPLOMA", "HISTORICO", "CREA", "CONFEA", "CARTEIRA DE TRABALHO", "CTPS",
      "EXTRATO DE OUTROS VINCULOS", "CERTIFICADO", "CONSELHO REGIONAL", "REGISTRO PROFISSIONAL",
    ].filter((token) => N.includes(token)).length;
    if (evidenceSignals || /DIPLOMA|CREA|CTPS|CERTIFIC/i.test(filename)) {
      return { id: PART_ROLE.CV_EVIDENCE, label: ROLE_LABEL[PART_ROLE.CV_EVIDENCE], confidence: evidenceSignals >= 2 ? "high" : "review", signals: evidenceSignals };
    }

    return { id: PART_ROLE.GENERAL, label: ROLE_LABEL[PART_ROLE.GENERAL], confidence: "review", signals: 0 };
  }

  function decorateParts(parts) {
    return (parts || []).map((part, index) => Object.assign({}, part, {
      originalIndex: Number.isInteger(part && part.originalIndex) ? part.originalIndex : index,
      bundleRole: classifyPart(part),
    }));
  }

  function likelyCv(parts) {
    const decorated = decorateParts(parts);
    const roles = new Set(decorated.map((part) => part.bundleRole.id));
    if (roles.has(PART_ROLE.CV_EVALUATION) || roles.has(PART_ROLE.CV_RESUME)) return true;
    const evidenceCount = decorated.filter((part) => part.bundleRole.id === PART_ROLE.CV_EVIDENCE).length;
    const all = norm(decorated.map(sourceText).join("\n"));
    return evidenceCount >= 2 && /CURRICUL|CARGO|EXPERIENCIA PROFISSIONAL/.test(all);
  }

  const CV_ORDER = Object.freeze({
    [PART_ROLE.CV_EVALUATION]: 0,
    [PART_ROLE.CV_RESUME]: 1,
    [PART_ROLE.CV_EVIDENCE]: 2,
    [PART_ROLE.GENERAL]: 2,
    [PART_ROLE.SIGNATURE_LOG]: 3,
  });

  function orderParts(parts, cvMode) {
    const decorated = decorateParts(parts);
    if (!cvMode) return decorated.sort((a, b) => a.originalIndex - b.originalIndex);
    return decorated.sort((a, b) => {
      const rankA = CV_ORDER[a.bundleRole.id] == null ? 2 : CV_ORDER[a.bundleRole.id];
      const rankB = CV_ORDER[b.bundleRole.id] == null ? 2 : CV_ORDER[b.bundleRole.id];
      return rankA - rankB || a.originalIndex - b.originalIndex;
    });
  }

  function buildCombinedText(parts) {
    const list = parts || [];
    return list.map((part, index) => {
      const name = text(part && (part.name || part.file && part.file.name)) || `arquivo-${index + 1}`;
      const role = part && part.bundleRole || classifyPart(part);
      return [
        `===== INICIO ARQUIVO ${index + 1}/${list.length}: ${name} =====`,
        `PAPEL NO DOSSIÊ: ${role.label}`,
        sourceText(part),
        `===== FIM ARQUIVO ${index + 1}/${list.length}: ${name} =====`,
      ].join("\n");
    }).join("\n\n");
  }

  function pageCount(parts) {
    return (parts || []).reduce((sum, part) => sum + Math.max(0, Number(part && (part.pageCount || part.parsed && part.parsed.pageCount)) || 0), 0);
  }

  function hasCvEvaluation(parts) {
    return decorateParts(parts).some((part) => part.bundleRole.id === PART_ROLE.CV_EVALUATION);
  }

  function bundleHash(parts) {
    return (parts || []).map((part) => text(part && (part.hash || part.parsed && part.parsed.hash))).filter(Boolean).join(":");
  }

  function sourceSummary(parts) {
    const decorated = decorateParts(parts);
    return decorated.map((part, index) => ({
      index: index + 1,
      name: text(part && (part.name || part.file && part.file.name)),
      role: part.bundleRole.id,
      roleLabel: part.bundleRole.label,
      pages: Number(part && (part.pageCount || part.parsed && part.parsed.pageCount)) || 0,
    }));
  }

  return Object.freeze({
    PART_ROLE,
    ROLE_LABEL,
    text,
    norm,
    classifyPart,
    decorateParts,
    likelyCv,
    orderParts,
    buildCombinedText,
    pageCount,
    hasCvEvaluation,
    bundleHash,
    sourceSummary,
  });
});
