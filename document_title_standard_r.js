(function (root, factory) {
  const base = root.RECONDocumentTitleStandard ||
    (typeof module === "object" && module.exports ? require("./document_title_standard.js") : null);
  const api = factory(base);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentTitleStandardR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Base) {
  "use strict";
  if (!Base) throw new Error("document_title_standard.js deve ser carregado antes da camada Rev. R.");

  const STANDARD = Object.freeze({
    ...Base.STANDARD,
    document: "ET-5290.00-22000-912-1LV-001",
    revision: "R",
    date: "24/08/2026",
    reportTable: "Tabela 13",
    source: "ET-5290.00-22000-912-1LV-001 Rev. R · 24/08/2026",
  });

  // Diferença confirmada entre o catálogo Rev. P incorporado no RECON e a
  // Tabela 13 da Rev. R fornecida nesta revisão. Os demais 328 registros são
  // preservados do catálogo já testado; estas quatro inclusões completam
  // 332 linhas / 331 códigos únicos da Rev. R (EVSJE possui duas redações).
  const REV_R_ADDITIONS = Object.freeze([
    Object.freeze(["MTAM", "Relatório Montagem de Tampas de Concreto"]),
    Object.freeze(["MTEC", "Relatório de Montagem de Estruturas de Concreto"]),
    Object.freeze(["RCCM", "Relatório de Certificado de Completação Mecânica"]),
    Object.freeze(["RIRFE", "Relatório de Inspeção de Recebimento Ferramentas"]),
  ]);

  const normalize = Base.normalize;
  const REPORT_TITLES = [];
  (Base.REPORT_TITLES || []).forEach((entry) => REPORT_TITLES.push(Object.freeze(entry.slice())));
  REV_R_ADDITIONS.forEach((entry) => {
    const exists = REPORT_TITLES.some(([code, title]) =>
      normalize(code) === normalize(entry[0]) && normalize(title) === normalize(entry[1]));
    if (!exists) REPORT_TITLES.push(entry);
  });
  Object.freeze(REPORT_TITLES);

  const REPORTS_BY_CODE = new Map();
  REPORT_TITLES.forEach(([code, title]) => {
    const clean = normalize(code).replace(/\s+/g, "");
    if (!REPORTS_BY_CODE.has(clean)) REPORTS_BY_CODE.set(clean, []);
    const titles = REPORTS_BY_CODE.get(clean);
    if (!titles.some((candidate) => normalize(candidate) === normalize(title))) titles.push(title);
  });

  function reportTitlesFor(code) {
    return (REPORTS_BY_CODE.get(normalize(code).replace(/\s+/g, "")) || []).slice();
  }

  function chooseReportTitle(candidates, evidenceTitles) {
    if (!candidates.length) return { title: "", ambiguous: false, chosenByHistory: false, score: 0 };
    if (candidates.length === 1) return { title: candidates[0], ambiguous: false, chosenByHistory: false, score: 1 };
    const evidence = (evidenceTitles || []).filter(Boolean);
    const ranked = candidates
      .map((title, order) => ({
        title,
        order,
        score: evidence.reduce((best, item) => Math.max(best, Base.candidateCoverage(title, item)), 0),
      }))
      .sort((left, right) => right.score - left.score || left.order - right.order);
    const chosenByHistory = Boolean(ranked[0].score > ((ranked[1] && ranked[1].score) || 0));
    return { title: ranked[0].title, ambiguous: !chosenByHistory, chosenByHistory, score: ranked[0].score };
  }

  function resolve(document, options) {
    const settings = options || {};
    const code = Base.documentTypeCode(document);
    const reportCandidates = reportTitlesFor(code);
    if (reportCandidates.length) {
      const choice = chooseReportTitle(reportCandidates, [
        ...(settings.previousTitles || []), settings.referenceType, settings.currentTitle,
      ]);
      return {
        code,
        title: choice.title,
        kind: "report-table",
        source: `${STANDARD.document} Rev. ${STANDARD.revision} · ${STANDARD.reportTable} · Grupo 6 ${code}`,
        normative: true,
        candidates: reportCandidates,
        ambiguous: choice.ambiguous,
        chosenByHistory: choice.chosenByHistory,
        historyScore: choice.score,
      };
    }
    const genericTitle = Base.GENERIC_DOCUMENT_TYPES[code] || "";
    if (genericTitle) {
      return {
        code, title: genericTitle, kind: "document-code",
        source: `${STANDARD.document} Rev. ${STANDARD.revision} · tipo documental ${code}`,
        normative: true, candidates: [genericTitle], ambiguous: false,
        chosenByHistory: false, historyScore: 0,
      };
    }
    return {
      code, title: "", kind: "unknown", source: "", normative: false,
      candidates: [], ambiguous: false, chosenByHistory: false, historyScore: 0,
    };
  }

  return Object.freeze({
    ...Base,
    STANDARD,
    REPORT_TITLES,
    REV_R_ADDITIONS,
    reportTitlesFor,
    resolve,
    reportRowCount: REPORT_TITLES.length,
    reportCodeCount: REPORTS_BY_CODE.size,
  });
});
