(function (root, factory) {
  const Profile = typeof module === "object" && module.exports ? require("./document_coding_cv_profile.js") : root.RECONDocumentCodingCVProfile;
  const api = factory(Profile);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingCV = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Profile) {
  "use strict";

  if (!Profile) throw new Error("RECONDocumentCodingCVProfile não carregado.");

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) {
    return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }
  function compact(value) { return norm(value).replace(/[^A-Z0-9]+/g, ""); }

  const COUNCIL_TOKENS = ["CREA", "CAU", "CRQ", "COREN", "CRM", "CFT", "CRT", "CONSELHO DE CLASSE", "CONSELHO REGIONAL", "REGISTRO PROFISSIONAL"];

  function containsAny(haystack, values) {
    const source = norm(haystack);
    return (values || []).some((value) => source.includes(norm(value)));
  }

  function evidenceSnippet(raw, needle, radius) {
    const source = text(raw);
    if (!source || !needle) return "";
    const upper = norm(source);
    const wanted = norm(needle);
    const index = upper.indexOf(wanted);
    if (index < 0) return "";
    const size = Number(radius || 90);
    return source.slice(Math.max(0, index - size), Math.min(source.length, index + wanted.length + size)).replace(/\s+/g, " ").trim();
  }

  function yearsFromExplicitClaims(raw) {
    const values = [];
    const source = norm(raw);
    const regex = /(?:EXPERIENCIA[^.\n]{0,90}?|HA\s+|CERCA\s+DE\s+|MAIS\s+DE\s+|MINIMO\s+DE\s+)?(\d{1,2})(?:\s*\(\s*\w+\s*\))?\s+ANOS?\b/g;
    let match;
    while ((match = regex.exec(source))) {
      const value = Number(match[1]);
      if (value >= 0 && value <= 60) values.push(value);
    }
    return values.length ? Math.max(...values) : 0;
  }

  function yearIntervals(raw) {
    const source = norm(raw);
    const currentYear = new Date().getFullYear();
    const intervals = [];
    const regex = /\b((?:19|20)\d{2})\s*(?:-|–|—|A|ATE)\s*((?:19|20)\d{2}|ATUAL|PRESENTE|HOJE)\b/g;
    let match;
    while ((match = regex.exec(source))) {
      const start = Number(match[1]);
      const end = /ATUAL|PRESENTE|HOJE/.test(match[2]) ? currentYear : Number(match[2]);
      if (start >= 1960 && end >= start && end - start <= 60) intervals.push([start, end]);
    }
    if (!intervals.length) return { years: 0, intervals: [] };
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    intervals.forEach(([start, end]) => {
      const last = merged[merged.length - 1];
      if (!last || start > last[1] + 1) merged.push([start, end]);
      else last[1] = Math.max(last[1], end);
    });
    const years = merged.reduce((sum, pair) => sum + Math.max(0, pair[1] - pair[0]), 0);
    return { years, intervals: merged };
  }

  function claimedExperienceYears(raw) {
    return Math.max(yearsFromExplicitClaims(raw), yearIntervals(raw).years);
  }

  function inferRole(raw) {
    const source = norm(raw);
    const ranked = [];
    Profile.ROLES.forEach((role) => {
      let score = 0;
      const hits = [];
      (role.aliases || []).forEach((alias) => {
        const wanted = norm(alias);
        if (!wanted || !source.includes(wanted)) return;
        const weight = Math.min(50, 12 + wanted.length / 2);
        score += weight;
        hits.push(alias);
      });
      const title = norm(role.title);
      if (title && source.includes(title)) { score += 65; hits.push(role.title); }
      if (score > 0) ranked.push({ role, score, hits });
    });
    ranked.sort((a, b) => b.score - a.score || b.hits.length - a.hits.length);
    if (!ranked.length) return { role: null, confidence: "missing", candidates: [] };
    const first = ranked[0];
    const second = ranked[1];
    const gap = second ? first.score - second.score : first.score;
    const confidence = first.score >= 60 && gap >= 18 ? "high" : "review";
    return { role: confidence === "high" ? first.role : null, confidence, candidates: ranked.slice(0, 5) };
  }

  function findRole(roleId) { return roleId && Profile.ROLE_BY_ID[roleId] || null; }

  function criterion(id, label, status, detail, sourceItem, evidence) {
    return { id, label, status, detail, sourceItem, evidence: evidence || "" };
  }

  function evaluateGeneral(raw, context) {
    const source = `${text(raw)}\n${text(context && context.evidenceText)}`;
    const N = norm(source);
    return [
      criterion("proof-cv", "Curriculum vitae", "met", "O documento analisado é o próprio CV.", "2.2.1", "CV analisado pelo módulo"),
      criterion("proof-ctps", "Carteira de trabalho", /CARTEIRA DE TRABALHO|\bCTPS\b/.test(N) ? "evidence" : "missing-evidence", "A experiência também deve ser comprovada por carteira de trabalho; uma afirmação no CV não substitui a evidência documental.", "2.2.1", evidenceSnippet(source, N.includes("CTPS") ? "CTPS" : "CARTEIRA DE TRABALHO")),
      criterion("proof-council", "Registro no conselho de classe", containsAny(source, COUNCIL_TOKENS) ? "evidence" : "missing-evidence", "Quando a função exigir registro profissional, o dossiê deve apresentar o registro do conselho pertinente.", "2.2.1", COUNCIL_TOKENS.map((token) => evidenceSnippet(source, token)).find(Boolean) || ""),
      criterion("petrobras-approval", "Aprovação da Fiscalização PETROBRAS", "external", "O RECON não pode aprovar flexibilização de qualificação/experiência; isso é atribuição exclusiva da Fiscalização PETROBRAS.", "2.2.2"),
      criterion("exclusive", "Mobilização exclusiva / não acúmulo", "declaration", "Deve ser confirmado operacionalmente: exclusividade no Contrato e ausência de acúmulo de funções, salvo autorização expressa.", "2.2.3"),
      criterion("advance-30", "Documentação 30 dias antes", "process", "Prazo de apresentação do dossiê: 30 dias corridos antes da mobilização.", "2.2.5"),
    ];
  }

  function evaluateRole(raw, role) {
    if (!role) return [];
    const source = text(raw);
    const criteria = [];
    if (role.degreeRequired || (role.degreeAny || []).length) {
      const hit = (role.degreeAny || []).find((entry) => containsAny(source, [entry]));
      criteria.push(criterion("degree", "Formação", hit ? "evidence" : "missing", (role.degreeAny || []).join(" ou ") || "Formação exigida pela função", role.item, hit ? evidenceSnippet(source, hit) : ""));
    }
    if (role.council) {
      const hit = COUNCIL_TOKENS.find((entry) => containsAny(source, [entry]));
      criteria.push(criterion("council", "Registro profissional", hit ? "evidence" : "missing-evidence", "Registro no conselho de classe pertinente à função.", role.item, hit ? evidenceSnippet(source, hit) : ""));
    }
    if (Number.isFinite(role.minYears) && role.minYears !== null) {
      const claimed = claimedExperienceYears(source);
      criteria.push(criterion("experience-total", "Experiência mínima", claimed >= role.minYears ? "declared" : "missing", `Mínimo contratual: ${role.minYears} ano(s). O cálculo automático usa apenas períodos/declarações identificáveis no CV e deve ser confrontado com a carteira de trabalho.`, role.item, claimed ? `${claimed} ano(s) identificados/declarados` : ""));
    }
    (role.specificExperience || []).forEach((req, index) => {
      const contextWords = norm(req.context).split(/\s+/).filter((word) => word.length >= 5).slice(0, 8);
      const hits = contextWords.filter((word) => norm(source).includes(word));
      const declaredYears = claimedExperienceYears(source);
      const status = hits.length >= Math.min(2, contextWords.length || 1) && declaredYears >= Number(req.years || 0) ? "review" : "missing";
      criteria.push(criterion(`specific-${index}`, "Experiência específica", status, `${req.years} ano(s): ${req.context}. A aderência temporal/contextual exige conferência dos vínculos e projetos, não apenas palavra-chave.`, role.item, hits.length ? `Termos encontrados: ${hits.join(", ")}` : ""));
    });
    (role.credentials || []).forEach((value, index) => {
      const tokens = norm(value).split(/\s+OU\s+|\//).map((part) => part.trim()).filter((part) => part.length >= 3);
      const hit = tokens.find((entry) => norm(source).includes(entry)) || (norm(source).includes(norm(value)) ? value : "");
      criteria.push(criterion(`credential-${index}`, "Qualificação / certificação", hit ? "evidence" : "missing-evidence", value, role.item, hit ? evidenceSnippet(source, hit) : ""));
    });
    (role.courses || []).forEach((value, index) => {
      const normalized = norm(value).replace(/\s+[–-].*$/, "");
      const hit = normalized && norm(source).includes(normalized);
      criteria.push(criterion(`course-${index}`, "Curso / treinamento", hit ? "evidence" : "missing-evidence", value, role.item, hit ? evidenceSnippet(source, normalized) : ""));
    });
    (role.projectEvidence || []).forEach((value, index) => {
      criteria.push(criterion(`project-${index}`, "Experiência por contexto/projeto", "manual-review", value, role.item, "Conferir projetos, período, função exercida e documentos comprobatórios."));
    });
    (role.notes || []).forEach((value, index) => {
      criteria.push(criterion(`note-${index}`, "Condição adicional", "manual-review", value, role.item));
    });
    return criteria;
  }

  function statusOf(criteria, roleResolution) {
    if (!roleResolution || !roleResolution.role) return { id: "role-review", label: "FUNÇÃO REQUER CONFIRMAÇÃO", severity: "review" };
    const missing = (criteria || []).filter((item) => item.status === "missing");
    const missingEvidence = (criteria || []).filter((item) => item.status === "missing-evidence");
    if (missing.length) return { id: "nonconforming-draft", label: "CV COM LACUNAS CONTRATUAIS", severity: "error" };
    if (missingEvidence.length) return { id: "evidence-pending", label: "CV ESTRUTURALMENTE ADERENTE — COMPROVAÇÃO PENDENTE", severity: "review" };
    return { id: "documentary-review", label: "PRONTO PARA REVISÃO DOCUMENTAL", severity: "ok" };
  }

  function evaluate(raw, options) {
    const opts = options || {};
    const selected = findRole(opts.roleId);
    const inferred = selected ? { role: selected, confidence: "confirmed", candidates: [{ role: selected, score: 999, hits: ["seleção manual"] }] } : inferRole(raw);
    const roleCriteria = evaluateRole(raw, inferred.role);
    const generalCriteria = evaluateGeneral(raw, opts);
    const criteria = [...generalCriteria, ...roleCriteria];
    return {
      profile: Profile.SOURCE,
      role: inferred.role,
      roleConfidence: inferred.confidence,
      roleCandidates: inferred.candidates,
      criteria,
      claimedExperienceYears: claimedExperienceYears(raw),
      status: statusOf(criteria, inferred),
      supplementalSources: Profile.supplementalFor(inferred.role),
      disclaimer: "O RECON valida aderência documental e destaca evidências/lacunas. Ele não substitui a carteira de trabalho, certificados, registros profissionais nem a aprovação da Fiscalização PETROBRAS.",
    };
  }

  function decorateAnalysis(analysis, raw, options) {
    if (!analysis || analysis.ruleId !== "et-cv") return analysis;
    const evaluation = evaluate(raw, options);
    analysis.cvCompliance = evaluation;
    analysis.cvProfile = Profile.SOURCE.id;
    if (evaluation.status.severity === "error") {
      analysis.message = `${analysis.message || ""} CV: ${evaluation.status.label}.`.trim();
    } else if (evaluation.status.severity === "review") {
      analysis.message = `${analysis.message || ""} CV: ${evaluation.status.label}.`.trim();
    }
    return analysis;
  }

  function draft(raw, evaluation) {
    const result = evaluation || evaluate(raw, {});
    const role = result.role;
    const lines = [
      "CURRICULUM VITAE — RNEST / TREM 2",
      `Perfil contratual: ${Profile.SOURCE.id} Rev. ${Profile.SOURCE.revision} — ${Profile.SOURCE.title}`,
      "",
      "1. IDENTIFICAÇÃO DO PROFISSIONAL",
      "Nome completo: [PREENCHER / CONFIRMAR]",
      `Função proposta: ${role ? role.title : "[SELECIONAR FUNÇÃO CONTRATUAL]"}`,
      "Empresa: [PREENCHER / CONFIRMAR]",
      "",
      "2. FORMAÇÃO ACADÊMICA / TÉCNICA",
      role && role.degreeAny.length ? `Requisito mínimo: ${role.degreeAny.join(" ou ")}` : "Requisito: conforme função selecionada e documentos contratuais.",
      "Formação comprovada: [PREENCHER SOMENTE COM EVIDÊNCIA]",
      "",
      "3. REGISTRO PROFISSIONAL",
      role && role.council ? "Conselho de classe: obrigatório para esta função." : "Conselho de classe: verificar aplicabilidade à função.",
      "Conselho / número / situação: [PREENCHER SOMENTE COM EVIDÊNCIA]",
      "",
      "4. CERTIFICAÇÕES, CURSOS E TREINAMENTOS",
    ];
    const quals = role ? [...role.credentials, ...role.courses] : [];
    if (quals.length) quals.forEach((value) => lines.push(`- ${value}: [COMPROVAR]`));
    else lines.push("- [Não há requisito específico mapeado além do conjunto contratual / confirmar função]");
    lines.push("", "5. EXPERIÊNCIA PROFISSIONAL", "Para cada vínculo/projeto informar, sem inventar dados:", "- Empresa / contratante", "- Projeto / empreendimento / unidade", "- Período (mês/ano inicial e final)", "- Cargo/função efetivamente exercida", "- Principais atividades", "- Evidência comprobatória correspondente");
    if (role && Number.isFinite(role.minYears) && role.minYears !== null) lines.push(`Experiência total mínima exigida para a função: ${role.minYears} ano(s).`);
    if (role) role.specificExperience.forEach((req) => lines.push(`Experiência específica: ${req.years} ano(s) — ${req.context}.`));
    lines.push("", "6. EXPERIÊNCIA EM PROJETOS / CONTEXTOS EXIGIDOS");
    if (role && role.projectEvidence.length) role.projectEvidence.forEach((value) => lines.push(`- ${value}: [DEMONSTRAR COM PROJETO/PERÍODO/FUNÇÃO]`));
    else lines.push("- [Confirmar conforme função selecionada]");
    lines.push("", "7. CHECKLIST DE COMPROVAÇÃO — APÊNDICE C", "- Curriculum vitae", "- Carteira de trabalho / CTPS", "- Registro no conselho de classe, quando aplicável", "- Certificados, cursos e treinamentos exigidos", "- Documentos que comprovem projetos/atividades específicas", "- Apresentação do dossiê 30 dias corridos antes da mobilização", "- Confirmação de mobilização exclusiva e não acúmulo de funções, salvo autorização PETROBRAS", "", "8. MATRIZ DE ADERÊNCIA AUTOMÁTICA");
    (result.criteria || []).forEach((item) => lines.push(`- [${item.status.toUpperCase()}] ${item.label}: ${item.detail} (fonte: item ${item.sourceItem})`));
    lines.push("", "OBSERVAÇÃO", result.disclaimer);
    return lines.join("\n");
  }

  function roleOptions() { return Profile.ROLES.map((role) => ({ id: role.id, title: role.title, item: role.item, group: role.group })); }

  return Object.freeze({ norm, claimedExperienceYears, inferRole, evaluate, decorateAnalysis, draft, roleOptions, findRole });
});
