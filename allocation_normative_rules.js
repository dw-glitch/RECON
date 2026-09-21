(function (root, factory) {
  const standard = root.RECONDocumentTitleStandardR ||
    (typeof module === "object" && module.exports ? require("./document_title_standard_r.js") : null);
  const catalogs = root.RECONAllocationNormCatalogs ||
    (typeof module === "object" && module.exports ? require("./allocation_normative_catalogs.js") : null);
  const api = factory(standard, catalogs);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationNorms = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (TitleStandard, Catalogs) {
  "use strict";

  const STANDARDS = Object.freeze({
    reportCoding: Object.freeze({ code: "ET-5290.00-22000-912-1LV-001", revision: "R", date: "24/08/2026", purpose: "Codificação de documentos e relatórios RNEST" }),
    n1710: Object.freeze({
      code: "N-1710", revision: "N", date: "04/2020",
      annexes: Object.freeze({ A: "W 10/2023", B: "CJ 04/2025", C: "BF 12/2024", D: "BG 04/2025", E: "D 03/2010", F: "G 10/2014", G: "CN 04/2025" }),
      purpose: "Codificação de documentos técnicos de engenharia",
    }),
    n381: Object.freeze({ code: "N-381", revision: "M", date: "05/2022", errata: "1ª Errata 06/2022", purpose: "Formulários para emissão e campos de documentos técnicos" }),
  });

  const RULES = Object.freeze([
    Object.freeze({ id: "ET-R-7.1", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1/Tabela 10", kind: "identity", requirement: "Relatórios RNEST usam sete grupos separados por underscore." }),
    Object.freeze({ id: "ET-R-7.1.3", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.3/Tabela 12", kind: "unit", requirement: "O Grupo 3 deve ser uma unidade prevista na Tabela 12." }),
    Object.freeze({ id: "ET-R-7.1.5", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.5/Tabela 6", kind: "discipline", requirement: "O Grupo 5 usa exclusivamente a sigla de disciplina da Tabela 6." }),
    Object.freeze({ id: "ET-R-7.1.6", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.6/Tabela 13", kind: "report", requirement: "O Grupo 6 deve usar código de relatório existente na Tabela 13." }),
    Object.freeze({ id: "ET-R-7.1.7", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.7", kind: "tag", requirement: "A TAG existente não pode ser alterada e o Grupo 7 não pode usar os caracteres proibidos." }),
    Object.freeze({ id: "ET-R-7.1.7.3", source: "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.7.3", kind: "non-tagged", requirement: "Item não tagueado deve iniciar o Grupo 7 com nt- em letras minúsculas." }),
    Object.freeze({ id: "N1710-5", source: "N-1710 Rev. N §5.1–§5.3", kind: "identity", requirement: "O número codificado é formado pelos grupos básicos na ordem normativa." }),
    Object.freeze({ id: "N1710-A", source: "N-1710 Rev. N §6.2 + Anexo A Rev. W", kind: "category", requirement: "A categoria documental deve existir no Anexo A." }),
    Object.freeze({ id: "N1710-B", source: "N-1710 Rev. N §6.3 + Anexo B Rev. CJ", kind: "installation", requirement: "A identificação da instalação deve existir no Anexo B." }),
    Object.freeze({ id: "N1710-C", source: "N-1710 Rev. N §6.4 + Anexo C Rev. BF", kind: "activity", requirement: "A área de atividade deve existir no Anexo C para instalações não pertencentes à frota TRANSPETRO." }),
    Object.freeze({ id: "N1710-D", source: "N-1710 Rev. N §6.5 + Anexo D Rev. BG", kind: "service", requirement: "A classe de serviço deve existir no Anexo D." }),
    Object.freeze({ id: "N381-NUM", source: "N-381 Rev. M · campos de numeração/revisão", kind: "form", requirement: "A numeração do documento técnico segue a N-1710; revisão e emissão seguem as referências normativas da N-381." }),
  ]);

  const SOURCE_PRECEDENCE = Object.freeze([
    { rank: 1, id: "normative-constraint", label: "Regra normativa objetiva", role: "Define o que é válido; não fornece sozinho o caminho Databook." },
    { rank: 2, id: "ld", label: "LD vigente / confirmação formal", role: "Identidade documental, estado e caminho explícito quando presente." },
    { rank: 3, id: "history", label: "Histórico validado do próprio documento/família", role: "Reutiliza decisão já confirmada sem transformar histórico em norma." },
    { rank: 4, id: "structured-reference", label: "Referências estruturadas específicas", role: "TAG, LI de válvulas, SCON, Apêndice e outras bases conforme o tipo documental." },
    { rank: 5, id: "catalog", label: "Mapa Databook / catálogo de caminho", role: "Resolve caminho específico por evidência combinada." },
    { rank: 6, id: "discipline-catalog", label: "Pasta da disciplina no catálogo", role: "Fallback controlado quando não existe caminho mais específico." },
    { rank: 7, id: "discipline-fallback", label: "Caminho geral da disciplina", role: "Último fallback; deve ficar registrado e exige revisão quando a evidência for insuficiente." },
    { rank: 8, id: "fuzzy", label: "Similaridade textual", role: "Somente descoberta de candidatos; nunca fonte única da decisão final." },
  ].map(Object.freeze));

  const { REPORT_DISCIPLINES, RNEST_UNITS, N1710_CATEGORIES, N1710_ACTIVITY_CODES, N1710_SERVICE_CODES, PROJECT_INSTALLATIONS } = Catalogs;

  function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
  function norm(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(); }
  function basename(value) { return text(value).replace(/^.*[\\/]/, "").replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, ""); }
  function issue(level, code, message, source, field) { return Object.freeze({ level, code, message, source: source || "", field: field || "" }); }
  function ruleSource(id) { const found = RULES.find((rule) => rule.id === id); return found ? found.source : ""; }

  function parseRnReportIdentity(document) {
    const raw = basename(document);
    const groups = raw.split("_");
    if (groups.length < 2 || norm(groups[1]) !== "RNEST") return null;
    return {
      kind: "rn-report", raw, groups, issuer: groups[0] || "", project: groups[1] || "",
      unit: groups[2] || "", eap: groups[3] || "", discipline: groups[4] || "",
      reportCode: groups[5] || "", tag: groups.slice(6).join("_"),
    };
  }

  function validateRnReport(document) {
    const parsed = parseRnReportIdentity(document);
    if (!parsed) return { kind: "not-rn-report", parsed: null, errors: [], warnings: [], rules: [] };
    const errors = [];
    const warnings = [];
    const rules = ["ET-R-7.1", "ET-R-7.1.3", "ET-R-7.1.5", "ET-R-7.1.6", "ET-R-7.1.7"];

    if (parsed.groups.length !== 7) errors.push(issue("error", "ET_GROUP_COUNT", "Relatório RNEST deve possuir exatamente sete grupos separados por underscore; underscore dentro do Grupo 7 cria ambiguidade.", ruleSource("ET-R-7.1"), "document"));
    if (!RNEST_UNITS.has(norm(parsed.unit))) errors.push(issue("error", "ET_UNIT_UNKNOWN", `Unidade ${parsed.unit || "(vazia)"} não consta da Tabela 12 incorporada.`, ruleSource("ET-R-7.1.3"), "unit"));
    if (!/^\d+(?:\.\d+){1,6}$/.test(parsed.eap)) errors.push(issue("error", "ET_EAP_INVALID", `Grupo 4/EAP inválido: ${parsed.eap || "(vazio)"}.`, "ET-5290.00-22000-912-1LV-001 Rev. R §7.1.4", "eap"));
    if (!REPORT_DISCIPLINES.has(norm(parsed.discipline))) errors.push(issue("error", "ET_DISCIPLINE_UNKNOWN", `Disciplina ${parsed.discipline || "(vazia)"} não consta da Tabela 6 incorporada.`, ruleSource("ET-R-7.1.5"), "discipline"));

    const code = norm(parsed.reportCode);
    const titles = TitleStandard && TitleStandard.reportTitlesFor ? TitleStandard.reportTitlesFor(code) : [];
    if (!code || !titles.length) errors.push(issue("error", "ET_REPORT_UNKNOWN", `Código de relatório ${parsed.reportCode || "(vazio)"} não consta da Tabela 13 Rev. R.`, ruleSource("ET-R-7.1.6"), "reportCode"));

    const tag = text(parsed.tag);
    if (!tag) errors.push(issue("error", "ET_TAG_EMPTY", "Grupo 7/TAG está vazio.", ruleSource("ET-R-7.1.7"), "tag"));
    else {
      const lower = tag.toLowerCase();
      const nonTagged = lower === "nt" || lower.startsWith("nt-") || lower.startsWith("nt_") || /_nt_/i.test(parsed.raw);
      if (nonTagged) {
        rules.push("ET-R-7.1.7.3");
        if (!tag.startsWith("nt-") || /_nt_/i.test(parsed.raw)) errors.push(issue("error", "ET_NT_PREFIX", "Item não tagueado deve iniciar o Grupo 7 exatamente com nt- em letras minúsculas.", ruleSource("ET-R-7.1.7.3"), "tag"));
      }
      if (/[çÇ?\|!@#$%¨&*(),\s]/.test(tag)) errors.push(issue("error", "ET_TAG_CHAR", "Grupo 7 contém caractere proibido pela regra de TAG.", ruleSource("ET-R-7.1.7"), "tag"));
    }

    return { kind: "rn-report", parsed, errors, warnings, rules: [...new Set(rules)] };
  }

  function parseN1710(document) {
    const raw = basename(document);
    if (raw.includes("_RNEST_")) return null;
    const match = raw.match(/^(?:([A-Z])-)?([A-Z]{2})-(\d{4}\.\d{2})-([0-9A-Z]{4,5})-([0-9A-Z]{3})-([A-Z0-9]{3})-([A-Z0-9]{3})$/i);
    if (!match) return null;
    return {
      kind: "n1710", raw, language: match[1] || "", category: match[2], installation: match[3],
      activity: match[4], service: match[5], origin: match[6], sequence: match[7],
    };
  }

  function validateN1710(document) {
    const parsed = parseN1710(document);
    if (!parsed) return { kind: "not-n1710", parsed: null, errors: [], warnings: [], rules: [] };
    const errors = [];
    const warnings = [];
    const rules = ["N1710-5", "N1710-A", "N1710-B", "N1710-C", "N1710-D", "N381-NUM"];

    if (!N1710_CATEGORIES.has(norm(parsed.category))) errors.push(issue("error", "N1710_CATEGORY_UNKNOWN", `Categoria ${parsed.category} não consta do Anexo A incorporado.`, ruleSource("N1710-A"), "category"));
    if (!PROJECT_INSTALLATIONS.has(parsed.installation)) {
      if (parsed.installation.startsWith("5290.")) errors.push(issue("error", "N1710_INSTALLATION_UNKNOWN", `Instalação ${parsed.installation} não consta do recorte RNEST incorporado do Anexo B.`, ruleSource("N1710-B"), "installation"));
      else warnings.push(issue("warning", "N1710_INSTALLATION_OUTSIDE_PROJECT", `Instalação ${parsed.installation} está fora do recorte RNEST validado pelo RECON; requer base de instalação correspondente.`, ruleSource("N1710-B"), "installation"));
    }

    let activityBase = norm(parsed.activity);
    if (activityBase.length === 5) {
      if (!/^\d/.test(activityBase)) errors.push(issue("error", "N1710_ACTIVITY_DIFFERENTIATOR", "O diferenciador opcional da área de atividade deve ser algarismo.", ruleSource("N1710-C"), "activity"));
      activityBase = activityBase.slice(1);
    }
    if (!N1710_ACTIVITY_CODES.has(activityBase)) errors.push(issue("error", "N1710_ACTIVITY_UNKNOWN", `Área de atividade ${parsed.activity} (base ${activityBase}) não consta do Anexo C incorporado.`, ruleSource("N1710-C"), "activity"));
    if (!N1710_SERVICE_CODES.has(norm(parsed.service))) errors.push(issue("error", "N1710_SERVICE_UNKNOWN", `Classe de serviço ${parsed.service} não consta do Anexo D incorporado.`, ruleSource("N1710-D"), "service"));

    return { kind: "n1710", parsed: { ...parsed, activityBase }, errors, warnings, rules };
  }

  function validateDocument(document) {
    const report = validateRnReport(document);
    if (report.kind === "rn-report") return report;
    const n1710 = validateN1710(document);
    if (n1710.kind === "n1710") return n1710;
    return {
      kind: "unknown", parsed: null, errors: [],
      warnings: [issue("warning", "DOCUMENT_PATTERN_UNKNOWN", "Documento não corresponde aos padrões RNEST/Tabela 10 nem à estrutura N-1710 reconhecida; a decisão automática exige validação humana.", "", "document")],
      rules: [],
    };
  }

  function completeDatabook(value) { return text(value).split("|").map((part) => part.trim()).filter(Boolean).length >= 3; }
  function databookEvidence(result) {
    const output = (result && result.output) || {};
    const evidence = output.databookEvidence || (result && result.databookInference) || {};
    return { path: text(output.databook), sourceType: text(evidence.sourceType), source: text(evidence.source), confidence: text(evidence.confidence), conflict: Boolean(evidence.conflict) };
  }
  function hasConflict(result) {
    const haystack = [result && result.reason, result && result.allocationReason, ...((result && result.warnings) || [])].map(text).join(" ");
    return /conflit|diverg[eê]ncia|amb[ií]gu/i.test(haystack);
  }

  function evaluateAllocation(result) {
    const document = text(result && result.document);
    const validation = validateDocument(document);
    const evidence = databookEvidence(result);
    const conflicts = hasConflict(result) || evidence.conflict;
    const fallbackUsed = evidence.sourceType === "discipline-fallback";
    const manual = evidence.sourceType === "manual";
    const errors = validation.errors.slice();
    const warnings = validation.warnings.slice();

    if (!completeDatabook(evidence.path)) errors.push(issue("error", "DATABOOK_MISSING", "Caminho Databook não foi determinado com evidência suficiente.", "Regra operacional de segurança do RECON", "databook"));
    if (conflicts) warnings.push(issue("warning", "SOURCE_CONFLICT", "Há conflito ou ambiguidade entre fontes; a decisão automática deve ser revisada.", "Política de precedência do RECON", "sources"));
    if (fallbackUsed) warnings.push(issue("warning", "DATABOOK_FALLBACK", "Foi utilizado o caminho geral da disciplina; o fallback fica registrado para revisão.", "Política de fallback do RECON", "databook"));
    if (manual) warnings.push(issue("warning", "MANUAL_ALLOCATION", "A decisão contém intervenção manual e deve permanecer identificada como tal.", "Rastreabilidade operacional do RECON", "databook"));

    let confidence = "alta";
    if (errors.length) confidence = "baixa";
    else if (conflicts || fallbackUsed || manual || validation.kind === "unknown") confidence = "media";
    else if (!["ld", "ld-exact", "history", "history-exact", "catalog", "discipline-catalog"].includes(evidence.sourceType) && !text(result && result.previousAllocation)) confidence = "media";

    const label = confidence === "alta" ? "Alta confiança" : confidence === "media" ? "Alocação provável — revisar." : "Alocação não determinada com segurança.";
    return {
      document, validationKind: validation.kind, parsed: validation.parsed, confidence, label,
      errors, warnings, ruleRefs: validation.rules.map(ruleSource).filter(Boolean),
      sourceType: evidence.sourceType, source: evidence.source, databook: evidence.path,
      fallbackUsed, conflicts, manual, automaticAllowed: confidence === "alta",
    };
  }

  return Object.freeze({
    STANDARDS, RULES, SOURCE_PRECEDENCE,
    REPORT_DISCIPLINES, RNEST_UNITS, N1710_CATEGORIES, N1710_ACTIVITY_CODES, N1710_SERVICE_CODES, PROJECT_INSTALLATIONS,
    parseRnReportIdentity, validateRnReport, parseN1710, validateN1710, validateDocument,
    completeDatabook, evaluateAllocation, ruleSource,
  });
});
