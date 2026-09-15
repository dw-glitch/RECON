(function (root, factory) {
  const normative = typeof module === "object" && module.exports
    ? require("./document_coding_normative.js")
    : root.RECONDocumentCodingNormative;
  const api = factory(normative);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Normative) {
  "use strict";

  if (!Normative) throw new Error("RECONDocumentCodingNormative não carregado.");

  const CONFIDENCE = Object.freeze({
    CONFIRMED: "confirmed",
    HIGH: "high",
    REVIEW: "review",
    CONFLICT: "conflict",
    IMPOSSIBLE: "impossible",
  });

  const CONFIDENCE_LABEL = Object.freeze({
    confirmed: "Confirmado pelas bases",
    high: "Alta confiança",
    review: "Requer confirmação",
    conflict: "Conflito",
    impossible: "Não foi possível codificar",
  });

  const STATUS = Object.freeze({
    EXISTING: "existing",
    PROPOSED: "proposed",
    REVIEW: "review",
    CONFLICT: "conflict",
    ERROR: "error",
  });

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function norm(value) {
    return Normative.norm(value);
  }

  function compact(value) {
    return norm(value).replace(/[^A-Z0-9]/g, "");
  }

  function normalizedTitle(value) {
    return norm(value)
      .replace(/\bREV(?:ISAO)?\s*[A-Z0-9]+\b/g, " ")
      .replace(/\bREV\.?\s*[A-Z0-9]+\b/g, " ")
      .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    return new Set(normalizedTitle(value).split(/\s+/).filter((item) => item.length >= 3));
  }

  function similarity(a, b) {
    const A = tokenize(a);
    const B = tokenize(b);
    if (!A.size || !B.size) return 0;
    let common = 0;
    A.forEach((item) => { if (B.has(item)) common += 1; });
    const union = new Set([...A, ...B]).size;
    return union ? common / union : 0;
  }

  function hashText(value) {
    let h1 = 0x811c9dc5;
    const input = String(value || "");
    for (let i = 0; i < input.length; i += 1) {
      h1 ^= input.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, "0");
  }

  function cleanFilename(name) {
    return text(name).replace(/\.(?:pdf|docx?)$/i, "").replace(/[_]+/g, " ").trim();
  }

  function extractRevision(value) {
    const raw = text(value);
    const patterns = [
      /\bREV(?:ISAO)?\s*[:._-]?\s*([A-Z]{1,2}|\d{1,3})\b/i,
      /[_ -]R(?:EV)?[._-]?([A-Z]{1,2}|\d{1,3})(?:\b|_)/i,
      /[_ -]([A-Z])(?:\.PDF|\.DOCX|$)/i,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match) return match[1].toUpperCase();
    }
    return "";
  }

  function extractExistingCode(value) {
    const raw = String(value || "");
    const report = raw.match(/\b[A-Z0-9]{2,5}_RNEST_[A-Z0-9-]+_\d+(?:\.\d+){2,5}_[A-Z]{3}_[A-Z0-9.\-]+_[A-Z0-9._~\/-]+/i);
    if (report) return { code: report[0].replace(/[;,.)]+$/, ""), scheme: "et-report" };

    const n1710 = raw.match(/(?:\b[I|A|F|L|E|D]-)?\b[A-Z]{2,3}-\d{4}\.\d{2}-[A-Z0-9]{4,5}-[A-Z0-9]{3}-[A-Z0-9]{3}-\d{3,4}\b/i);
    if (n1710) return { code: n1710[0].replace(/^\|/, ""), scheme: "n1710" };

    const admin = raw.match(/\b\d{4}\.\d{7}\.\d{2}\.\d-[A-Z0-9]{2,4}-(?:C|E|GRD|GRDT|OD|AR|CV)-[A-Z0-9-]+(?:-\d{4}(?:\.\d{1,2})?)?\b/i);
    if (admin) return { code: admin[0], scheme: "et-admin" };
    return null;
  }

  function parseN1710Code(code) {
    let value = text(code).toUpperCase();
    let language = "";
    const langMatch = value.match(/^([IAFLED])-(?=[A-Z]{2,3}-)/);
    if (langMatch) {
      language = langMatch[1];
      value = value.slice(2);
    }
    const match = value.match(/^([A-Z]{2,3})-(\d{4}\.\d{2})-([A-Z0-9]{4,5})-([A-Z0-9]{3})-([A-Z0-9]{3})-(\d{3,4})$/);
    if (!match) return null;
    return {
      scheme: "n1710",
      language,
      category: match[1],
      installation: match[2],
      activityArea: match[3],
      serviceClass: match[4],
      origin: match[5],
      sequence: match[6],
      code: text(code),
    };
  }

  function parseEtReportCode(code) {
    const parts = text(code).split("_");
    if (parts.length < 7 || norm(parts[1]) !== "RNEST") return null;
    const [emitter, enterprise, unit, eap, discipline, reportCode, ...tagParts] = parts;
    const tag = tagParts.join("_");
    if (!emitter || !unit || !eap || !discipline || !reportCode || !tag) return null;
    return {
      scheme: "et-report",
      emitter,
      enterprise,
      unit,
      eap,
      discipline,
      reportCode,
      tag,
      code: text(code),
    };
  }

  function extractTag(value) {
    const raw = text(value);
    const report = extractExistingCode(raw);
    if (report && report.scheme === "et-report") {
      const parsed = parseEtReportCode(report.code);
      if (parsed) return parsed.tag;
    }
    const explicit = raw.match(/\bTAG\s*[:=\-]?\s*([A-Z0-9][A-Z0-9._~\/-]{2,80})\b/i);
    return explicit ? explicit[1] : "";
  }

  function extractContract(value) {
    const match = String(value || "").match(/\b\d{4}\.\d{7}\.\d{2}\.\d\b/);
    return match ? match[0] : "";
  }

  function extractDate(value) {
    const raw = String(value || "");
    const pt = raw.match(/\b([0-3]?\d)\/(0?\d|1[0-2])\/(20\d{2})\b/);
    if (pt) return `${pt[3]}-${pt[2].padStart(2, "0")}-${pt[1].padStart(2, "0")}`;
    const iso = raw.match(/\b(20\d{2})-(0\d|1[0-2])-([0-3]\d)\b/);
    return iso ? iso[0] : "";
  }

  function extractEap(value) {
    const raw = String(value || "");
    const report = extractExistingCode(raw);
    if (report && report.scheme === "et-report") {
      const parsed = parseEtReportCode(report.code);
      if (parsed) return parsed.eap;
    }
    const matches = raw.match(/\b\d{1,2}(?:\.\d{1,3}){2,5}\b/g) || [];
    return matches.find((item) => item.split(".").length >= 4) || matches[0] || "";
  }

  function extractUnit(value) {
    const raw = String(value || "");
    const report = extractExistingCode(raw);
    if (report && report.scheme === "et-report") {
      const parsed = parseEtReportCode(report.code);
      if (parsed) return parsed.unit;
    }
    const match = raw.match(/\bU(?:12|22|27|29S|32|34|36|39S|42|53|54|68)\b/i);
    return match ? match[0].toUpperCase() : "";
  }

  function extractDiscipline(value) {
    const raw = norm(value);
    const report = extractExistingCode(value);
    if (report && report.scheme === "et-report") {
      const parsed = parseEtReportCode(report.code);
      if (parsed) return parsed.discipline.toUpperCase();
    }
    const entries = Object.entries(Normative.ET_DISCIPLINES);
    for (const [code, title] of entries) {
      if (new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`).test(raw) || raw.includes(norm(title))) return code;
    }
    return "";
  }

  function classifyDocument(input) {
    const filename = text(input && input.filename);
    const content = text(input && input.text);
    const combined = `${filename}\n${content}`;
    const existing = extractExistingCode(combined);
    const N = norm(combined);

    if (existing && existing.scheme === "et-report") {
      const parsed = parseEtReportCode(existing.code);
      return { kind: "et-report", label: "Relatório", confidence: 1, evidence: `Código ET encontrado: ${existing.code}`, parsed };
    }
    if (existing && existing.scheme === "n1710") {
      const parsed = parseN1710Code(existing.code);
      const label = parsed && Normative.N1710_CATEGORY_HINTS[parsed.category] || "Documento técnico de engenharia";
      return { kind: "n1710", label, confidence: 1, evidence: `Código N-1710 encontrado: ${existing.code}`, parsed };
    }
    if (/\bCURRICUL[O|A]\b/.test(N)) return { kind: "et-cv", label: "Currículo", confidence: 0.92, evidence: "Termo currículo identificado" };
    if (/\bATA\b/.test(N) && /\bREUNIAO\b/.test(N)) return { kind: "et-minutes", label: "Ata de Reunião", confidence: 0.93, evidence: "Ata de reunião identificada" };
    if (/\bSOLICITACAO DE INFORMACOES TECNICAS\b|\bSIT\b/.test(N)) return { kind: "n1710", label: "Solicitação de Informações Técnicas", category: "SIT", confidence: 0.94, evidence: "SIT: a ET direciona a codificação à N-1710" };
    if (/\bCONSULTA TECNICA\b|\bCT\b/.test(N)) return { kind: "n1710", label: "Consulta Técnica", category: "CT", confidence: 0.88, evidence: "CT: a ET direciona a codificação à N-1710" };

    const reportHit = Normative.reportCodeFromText(combined);
    if (reportHit && (/\bRELATORIO\b/.test(N) || reportHit.score >= 75)) {
      return { kind: "et-report", label: reportHit.title, reportCode: reportHit.code, confidence: Math.min(0.96, reportHit.score / 100), evidence: `Correspondência com Tabela 13: ${reportHit.code}` };
    }

    const adminMap = [
      [/\bE-?MAIL\b/, "E", "E-mail"],
      [/\bGUIA DE REMESSA DE DOCUMENTO TECNICO\b|\bGRDT\b/, "GRDT", "Guia de Remessa de Documento Técnico"],
      [/\bGUIA DE REMESSA DE DOCUMENTO\b|\bGRD\b/, "GRD", "Guia de Remessa de Documento"],
      [/\bON DEMAND\b|\bOD\b/, "OD", "On Demand"],
      [/\bCARTA\b/, "C", "Carta"],
    ];
    for (const [pattern, code, label] of adminMap) {
      if (pattern.test(N)) return { kind: "et-admin", label, documentType: code, confidence: 0.86, evidence: `Tipo administrativo ${code} identificado` };
    }

    const n1710Types = [
      [/\bESPECIFICACAO TECNICA\b/, "ET", "Especificação Técnica"],
      [/\bMEMORIAL DESCRITIVO\b/, "MD", "Memorial Descritivo"],
      [/\bREQUISICAO DE MATERIAL\b/, "RM", "Requisição de Material"],
      [/\bFOLHA DE DADOS\b/, "FD", "Folha de Dados"],
      [/\bDESENHO TECNICO\b|\bDESENHO\b/, "DE", "Desenho Técnico"],
      [/\bMEMORIA DE CALCULO\b/, "MC", "Memória de Cálculo"],
      [/\bPROCEDIMENTO\b/, "PR", "Procedimento"],
      [/\bMANUAL\b/, "MA", "Manual"],
      [/\bCRONOGRAMA\b/, "CR", "Cronograma"],
      [/\bRELATORIO\b/, "RL", "Relatório"],
    ];
    for (const [pattern, category, label] of n1710Types) {
      if (pattern.test(N)) return { kind: "n1710", label, category, confidence: 0.78, evidence: `Categoria documental identificada pelo conteúdo: ${label}` };
    }

    return { kind: "unknown", label: "Tipo não determinado", confidence: 0, evidence: "O conteúdo não contém evidência suficiente para uma classificação normativa segura." };
  }

  function extractTechnicalData(input) {
    const filename = text(input && input.filename);
    const content = text(input && input.text);
    const combined = `${filename}\n${content}`;
    const classification = classifyDocument({ filename, text: content });
    const existing = extractExistingCode(combined);
    const parsed = existing && existing.scheme === "n1710" ? parseN1710Code(existing.code)
      : existing && existing.scheme === "et-report" ? parseEtReportCode(existing.code) : null;

    let title = "";
    const titlePatterns = [
      /(?:^|\n)\s*T[IÍ]TULO\s*[:\-]?\s*([^\n]{4,220})/i,
      /(?:^|\n)\s*TITLE\s*[:\-]?\s*([^\n]{4,220})/i,
    ];
    for (const pattern of titlePatterns) {
      const match = content.match(pattern);
      if (match) { title = text(match[1]); break; }
    }
    if (!title) title = cleanFilename(filename).replace(existing && existing.code || "", "").replace(/^[-–—\s]+|[-–—\s]+$/g, "");

    const reportCode = parsed && parsed.scheme === "et-report" ? parsed.reportCode
      : classification.reportCode || (Normative.reportCodeFromText(combined) || {}).code || "";

    return {
      filename,
      title,
      classification,
      existingCode: existing ? existing.code : "",
      existingScheme: existing ? existing.scheme : "",
      revision: extractRevision(combined),
      contract: extractContract(combined),
      date: extractDate(combined),
      tag: parsed && parsed.scheme === "et-report" ? parsed.tag : extractTag(combined),
      unit: parsed && parsed.scheme === "et-report" ? parsed.unit : extractUnit(combined),
      eap: parsed && parsed.scheme === "et-report" ? parsed.eap : extractEap(combined),
      discipline: parsed && parsed.scheme === "et-report" ? parsed.discipline : extractDiscipline(combined),
      emitter: parsed && parsed.scheme === "et-report" ? parsed.emitter : "",
      enterprise: parsed && parsed.scheme === "et-report" ? parsed.enterprise : (/\bRNEST\b/i.test(combined) ? "RNEST" : ""),
      reportCode,
      category: parsed && parsed.scheme === "n1710" ? parsed.category : classification.category || "",
      installation: parsed && parsed.scheme === "n1710" ? parsed.installation : "",
      activityArea: parsed && parsed.scheme === "n1710" ? parsed.activityArea : "",
      serviceClass: parsed && parsed.scheme === "n1710" ? parsed.serviceClass : "",
      origin: parsed && parsed.scheme === "n1710" ? parsed.origin : "",
      language: parsed && parsed.scheme === "n1710" ? parsed.language : "",
      sourceEvidence: [{ field: "classification", value: classification.label, source: classification.evidence }],
    };
  }

  function headerKey(value) {
    return norm(value).replace(/[^A-Z0-9]+/g, "");
  }

  function findField(row, candidates) {
    const entries = Object.entries(row || {});
    const wanted = candidates.map(headerKey);
    for (const [key, value] of entries) {
      const k = headerKey(key);
      if (wanted.includes(k)) return text(value);
    }
    for (const [key, value] of entries) {
      const k = headerKey(key);
      if (wanted.some((candidate) => candidate && (k.includes(candidate) || candidate.includes(k)))) return text(value);
    }
    return "";
  }

  function normalizeLdRow(row, meta) {
    const code = findField(row, ["DOCUMENTO", "CODIGO", "CÓDIGO", "N DOCUMENTO", "NUMERO DOCUMENTO", "DOCUMENT NUMBER", "COD DOCUMENTO"]);
    if (!code) return null;
    const parsedN = parseN1710Code(code);
    const parsedR = parseEtReportCode(code);
    return {
      code,
      title: findField(row, ["TITULO", "TÍTULO", "DESCRICAO", "DESCRIÇÃO"]),
      revision: findField(row, ["REV", "REVISAO", "REVISÃO"]),
      tag: findField(row, ["TAG", "TAG EQUIPAMENTO"]) || (parsedR && parsedR.tag || ""),
      discipline: findField(row, ["DISCIPLINA", "DISCIPLINE"]) || (parsedR && parsedR.discipline || ""),
      installation: findField(row, ["INSTALACAO", "INSTALAÇÃO"]) || (parsedN && parsedN.installation || ""),
      activityArea: findField(row, ["AREA ATIVIDADE", "ÁREA ATIVIDADE", "AREA", "ÁREA"]) || (parsedN && parsedN.activityArea || ""),
      serviceClass: findField(row, ["CLASSE", "CLASSE SERVICO", "CLASSE DE SERVIÇO"]) || (parsedN && parsedN.serviceClass || ""),
      origin: findField(row, ["ORIGEM", "EMISSOR"]) || (parsedN && parsedN.origin || parsedR && parsedR.emitter || ""),
      category: findField(row, ["CATEGORIA", "TIPO DOCUMENTO", "TIPO"]) || (parsedN && parsedN.category || ""),
      unit: findField(row, ["UNIDADE", "UNIT"]) || (parsedR && parsedR.unit || ""),
      eap: findField(row, ["EAP", "CRITERIO MEDICAO", "CRITÉRIO MEDIÇÃO"]) || (parsedR && parsedR.eap || ""),
      reportCode: findField(row, ["COD RELATORIO", "CÓD RELATÓRIO", "RELATORIO", "RELATÓRIO"]) || (parsedR && parsedR.reportCode || ""),
      ld: text(meta && meta.name),
      sheet: text(meta && meta.sheet),
      rowNumber: Number(meta && meta.rowNumber || 0) || 0,
      raw: row,
      parsedN1710: parsedN,
      parsedEtReport: parsedR,
    };
  }

  function buildLdIndex(rows) {
    const normalizedRows = (rows || []).map((item, index) => {
      if (item && item.code && (item.parsedN1710 !== undefined || item.parsedEtReport !== undefined)) return item;
      if (item && item.row) return normalizeLdRow(item.row, Object.assign({ rowNumber: index + 2 }, item.meta || {}));
      return normalizeLdRow(item, { rowNumber: index + 2 });
    }).filter(Boolean);

    const byCode = new Map();
    const byTag = new Map();
    const byTitle = new Map();
    normalizedRows.forEach((entry) => {
      const codeKey = norm(entry.code);
      if (!byCode.has(codeKey)) byCode.set(codeKey, []);
      byCode.get(codeKey).push(entry);
      const tagKey = compact(entry.tag);
      if (tagKey) {
        if (!byTag.has(tagKey)) byTag.set(tagKey, []);
        byTag.get(tagKey).push(entry);
      }
      const titleKey = normalizedTitle(entry.title);
      if (titleKey) {
        if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
        byTitle.get(titleKey).push(entry);
      }
    });
    return { rows: normalizedRows, byCode, byTag, byTitle, count: normalizedRows.length };
  }

  function sameNonSequenceN1710(a, b) {
    return a && b
      && norm(a.category) === norm(b.category)
      && norm(a.installation) === norm(b.installation)
      && norm(a.activityArea) === norm(b.activityArea)
      && norm(a.serviceClass) === norm(b.serviceClass)
      && norm(a.origin) === norm(b.origin);
  }

  function matchLdDocument(data, index) {
    if (!index || !index.rows) return { match: null, candidates: [], level: "none", reason: "Nenhuma LD disponível." };
    if (data.existingCode) {
      const exact = index.byCode.get(norm(data.existingCode)) || [];
      if (exact.length === 1) return { match: exact[0], candidates: exact, level: "exact-code", reason: "Código já existe na LD." };
      if (exact.length > 1) return { match: null, candidates: exact, level: "conflict", reason: "O mesmo código aparece mais de uma vez na LD." };
    }

    const candidates = new Map();
    function add(entry, points, reason) {
      if (!entry) return;
      const key = `${norm(entry.code)}|${entry.ld}|${entry.sheet}|${entry.rowNumber}`;
      const current = candidates.get(key) || { entry, points: 0, reasons: [] };
      current.points += points;
      current.reasons.push(reason);
      candidates.set(key, current);
    }

    if (data.tag) (index.byTag.get(compact(data.tag)) || []).forEach((entry) => add(entry, 55, "TAG"));
    if (data.title) {
      (index.byTitle.get(normalizedTitle(data.title)) || []).forEach((entry) => add(entry, 55, "título exato normalizado"));
      index.rows.forEach((entry) => {
        const score = similarity(data.title, entry.title);
        if (score >= 0.78) add(entry, Math.round(score * 42), `título semelhante ${Math.round(score * 100)}%`);
      });
    }
    index.rows.forEach((entry) => {
      if (data.discipline && norm(data.discipline) === norm(entry.discipline)) add(entry, 8, "disciplina");
      if (data.category && norm(data.category) === norm(entry.category)) add(entry, 10, "categoria");
      if (data.installation && norm(data.installation) === norm(entry.installation)) add(entry, 9, "instalação");
      if (data.activityArea && norm(data.activityArea) === norm(entry.activityArea)) add(entry, 8, "área");
      if (data.serviceClass && norm(data.serviceClass) === norm(entry.serviceClass)) add(entry, 8, "classe");
      if (data.unit && norm(data.unit) === norm(entry.unit)) add(entry, 8, "unidade");
      if (data.eap && norm(data.eap) === norm(entry.eap)) add(entry, 8, "EAP");
    });

    const ranked = [...candidates.values()].filter((item) => item.points >= 60).sort((a, b) => b.points - a.points);
    if (!ranked.length) return { match: null, candidates: [], level: "none", reason: "Nenhuma correspondência suficientemente forte na LD." };
    const top = ranked[0];
    const second = ranked[1];
    if (second && top.points - second.points < 15) {
      return { match: null, candidates: ranked.slice(0, 5).map((item) => item.entry), level: "ambiguous", reason: "Há mais de um documento plausível na LD; requer confirmação." };
    }
    if (top.points >= 100) return { match: top.entry, candidates: [top.entry], level: "strong", reason: `Correspondência forte por ${top.reasons.join(", ")}.` };
    return { match: null, candidates: ranked.slice(0, 5).map((item) => item.entry), level: "ambiguous", reason: `Correspondência provável (${top.points} pontos), insuficiente para assumir identidade automaticamente.` };
  }

  function n1710FamilyKey(data) {
    return [data.category, data.installation, data.activityArea, data.serviceClass, data.origin].map(norm).join("|");
  }

  function etSequenceFamilyKey(rule, data) {
    return rule.sequenceFamily.map((field) => norm(data[field])).join("|");
  }

  function listN1710FamilySequences(data, ldIndex, reserved) {
    const target = {
      category: data.category,
      installation: data.installation,
      activityArea: data.activityArea,
      serviceClass: data.serviceClass,
      origin: data.origin,
    };
    const values = [];
    (ldIndex && ldIndex.rows || []).forEach((entry) => {
      const parsed = entry.parsedN1710 || parseN1710Code(entry.code);
      if (!parsed || !sameNonSequenceN1710(target, parsed)) return;
      const n = Number(parsed.sequence);
      if (Number.isInteger(n)) values.push({ sequence: n, code: entry.code, source: entry.ld || "LD" });
    });
    (reserved || []).forEach((item) => {
      if (item.familyKey === n1710FamilyKey(data) && Number.isInteger(Number(item.sequence))) {
        values.push({ sequence: Number(item.sequence), code: item.code || "reserva", source: "reserva" });
      }
    });
    return values;
  }

  function nextN1710Sequence(data, ldIndex, reserved) {
    const values = listN1710FamilySequences(data, ldIndex, reserved);
    const used = new Set(values.map((item) => item.sequence));
    const max = values.reduce((acc, item) => Math.max(acc, item.sequence), 0);
    const next = max + 1;
    const digits = next > 999 ? 4 : 3;
    return {
      value: String(next).padStart(digits, "0"),
      numeric: next,
      max,
      used: [...used].sort((a, b) => a - b),
      familyKey: n1710FamilyKey(data),
      source: max ? `LD/reservas — maior sequencial da mesma família = ${String(max).padStart(max > 999 ? 4 : 3, "0")}` : "Nenhum sequencial anterior encontrado na mesma família; iniciar em 001",
    };
  }

  function buildN1710Code(data, ldIndex, options) {
    const opts = options || {};
    const fields = ["category", "installation", "activityArea", "serviceClass", "origin"];
    const missing = fields.filter((field) => !text(data[field]));
    if (missing.length) {
      return {
        code: "",
        complete: false,
        missing,
        confidence: CONFIDENCE.REVIEW,
        status: STATUS.REVIEW,
        message: `Código incompleto — requer confirmação: ${missing.join(", ")}.`,
        groups: fields.map((field) => ({ field, value: text(data[field]), source: Normative.sourceForN1710Group(field), confirmed: Boolean(text(data[field])) })),
      };
    }

    const sequenceInfo = text(data.sequence)
      ? { value: text(data.sequence), familyKey: n1710FamilyKey(data), source: "Sequencial informado manualmente; exige validação de duplicidade" }
      : nextN1710Sequence(data, ldIndex, opts.reserved);
    const core = [data.category, data.installation, data.activityArea, data.serviceClass, data.origin, sequenceInfo.value].join("-");
    const code = data.language ? `${data.language}-${core}` : core;
    const duplicate = ldIndex && ldIndex.byCode && (ldIndex.byCode.get(norm(code)) || []).length > 0;
    return {
      code,
      complete: true,
      sequence: sequenceInfo.value,
      familyKey: sequenceInfo.familyKey,
      confidence: duplicate ? CONFIDENCE.CONFLICT : CONFIDENCE.HIGH,
      status: duplicate ? STATUS.CONFLICT : STATUS.PROPOSED,
      message: duplicate ? "Código proposto já existe na LD." : "Código montado deterministicamente pela estrutura N-1710.",
      groups: [
        { field: "language", label: "Idioma", value: data.language || "Português (Grupo 0 omitido)", source: Normative.SOURCE.N1710_LANGUAGE, confirmed: true },
        { field: "category", label: "Categoria", value: data.category, source: Normative.SOURCE.N1710_CATEGORY, confirmed: true },
        { field: "installation", label: "Instalação", value: data.installation, source: Normative.SOURCE.N1710_INSTALLATION, confirmed: true },
        { field: "activityArea", label: "Área de atividade", value: data.activityArea, source: Normative.SOURCE.N1710_ACTIVITY, confirmed: true },
        { field: "serviceClass", label: "Classe", value: data.serviceClass, source: Normative.SOURCE.N1710_CLASS, confirmed: true },
        { field: "origin", label: "Origem", value: data.origin, source: Normative.SOURCE.N1710_ORIGIN, confirmed: true },
        { field: "sequence", label: "Sequencial", value: sequenceInfo.value, source: sequenceInfo.source, confirmed: !duplicate },
      ],
    };
  }

  function buildEtReportCode(data, ldIndex) {
    const fields = ["emitter", "enterprise", "unit", "eap", "discipline", "reportCode", "tag"];
    const missing = fields.filter((field) => !text(data[field]));
    const tagValidation = Normative.validateReportTag(data.tag);
    const codeKnown = !data.reportCode || Normative.isKnownReportCode(data.reportCode);
    if (missing.length || !tagValidation.valid || !codeKnown) {
      const issues = missing.slice();
      if (data.tag && !tagValidation.valid) issues.push("TAG com caractere proibido");
      if (data.reportCode && !codeKnown) issues.push("código de relatório não confirmado na Tabela 13 carregada");
      return {
        code: "",
        complete: false,
        missing: issues,
        confidence: CONFIDENCE.REVIEW,
        status: STATUS.REVIEW,
        message: `Código incompleto — requer confirmação: ${issues.join(", ")}.`,
        groups: fields.map((field) => ({ field, value: text(data[field]), source: field === "tag" ? Normative.SOURCE.ET_TAG : Normative.SOURCE.ET_REPORT, confirmed: Boolean(text(data[field])) })),
      };
    }
    const tag = /^nt-/i.test(data.tag) ? `nt-${text(data.tag).slice(3)}` : text(data.tag);
    const code = [data.emitter, data.enterprise, data.unit, data.eap, data.discipline, data.reportCode, tag].join("_");
    const duplicate = ldIndex && ldIndex.byCode && (ldIndex.byCode.get(norm(code)) || []).length > 0;
    return {
      code,
      complete: true,
      confidence: duplicate ? CONFIDENCE.CONFLICT : CONFIDENCE.HIGH,
      status: duplicate ? STATUS.CONFLICT : STATUS.PROPOSED,
      message: duplicate ? "Código já existe na LD." : "Relatório codificado conforme a estrutura própria da ET Rev. Q.",
      groups: [
        { field: "emitter", label: "Emissor", value: data.emitter, source: Normative.SOURCE.ET_REPORT, confirmed: true },
        { field: "enterprise", label: "Empreendimento", value: data.enterprise, source: Normative.SOURCE.ET_REPORT, confirmed: true },
        { field: "unit", label: "Unidade", value: data.unit, source: Normative.SOURCE.ET_REPORT, confirmed: true },
        { field: "eap", label: "EAP / critério de medição", value: data.eap, source: Normative.SOURCE.ET_REPORT, confirmed: true },
        { field: "discipline", label: "Disciplina", value: data.discipline, source: Normative.SOURCE.ET_REPORT, confirmed: true },
        { field: "reportCode", label: "Código do relatório", value: data.reportCode, source: "ET Rev. Q — Tabela 13", confirmed: codeKnown },
        { field: "tag", label: "TAG", value: tag, source: Normative.SOURCE.ET_TAG, confirmed: tagValidation.valid },
      ],
    };
  }

  function ruleForEtSequential(data) {
    const kind = data.classification && data.classification.kind || data.kind;
    if (kind === "et-cv") return Normative.RULES.ET_CV;
    if (kind === "et-minutes") return data.contract ? Normative.RULES.ET_MINUTES_CONTRACT : Normative.RULES.ET_MINUTES_INTERNAL;
    if (kind === "et-admin") return data.contract ? Normative.RULES.ET_ADMIN_CONTRACT : Normative.RULES.ET_ADMIN_INTERNAL;
    return null;
  }

  function parseEtSequentialCode(code, rule) {
    const value = text(code);
    if (!rule || !value) return null;
    const parts = value.split("-");
    if (rule.id === "et-admin-contract" && parts.length >= 5) {
      const ym = parts[parts.length - 1];
      const sequence = parts[parts.length - 2];
      const type = parts[parts.length - 3];
      const emitter = parts[parts.length - 4];
      const contract = parts.slice(0, -4).join("-");
      if (/^\d{4}(?:\.\d{1,2})$/.test(ym) && /^\d{4}$/.test(sequence)) return { contract, emitter, documentType: type, sequence, yearMonth: ym, year: ym.slice(0, 4) };
    }
    if (rule.id === "et-cv" && parts.length >= 5) {
      const sequence = parts.pop(); const discipline = parts.pop(); const documentType = parts.pop(); const emitter = parts.pop(); const contract = parts.join("-");
      if (/^\d{3,4}$/.test(sequence)) return { contract, emitter, documentType, discipline, sequence };
    }
    return null;
  }

  function nextEtSequence(rule, data, ldIndex, reserved) {
    const family = etSequenceFamilyKey(rule, data);
    let max = 0;
    (ldIndex && ldIndex.rows || []).forEach((entry) => {
      const parsed = parseEtSequentialCode(entry.code, rule);
      if (!parsed) return;
      const probe = Object.assign({}, data, parsed);
      if (etSequenceFamilyKey(rule, probe) !== family) return;
      max = Math.max(max, Number(parsed.sequence) || 0);
    });
    (reserved || []).forEach((item) => {
      if (item.familyKey === family) max = Math.max(max, Number(item.sequence) || 0);
    });
    const next = max + 1;
    return {
      value: String(next).padStart(rule.sequenceDigits || 4, "0"),
      numeric: next,
      max,
      familyKey: family,
      source: max ? `LD/reservas — maior sequencial da mesma família = ${String(max).padStart(rule.sequenceDigits || 4, "0")}` : `Nenhum sequencial anterior encontrado; iniciar em ${String(1).padStart(rule.sequenceDigits || 4, "0")}`,
    };
  }

  function buildEtSequentialCode(data, ldIndex, options) {
    const rule = ruleForEtSequential(data);
    if (!rule) return { code: "", complete: false, confidence: CONFIDENCE.IMPOSSIBLE, status: STATUS.ERROR, message: "Nenhuma regra ET sequencial foi selecionada.", groups: [] };
    const values = Object.assign({}, data);
    if (!values.year && values.date) values.year = String(values.date).slice(0, 4);
    if (!values.yearMonth && values.date) values.yearMonth = String(values.date).slice(0, 7).replace("-", ".");
    if (rule.id.includes("minutes")) values.documentType = "AR";
    if (rule.id === "et-cv") values.documentType = "CV";
    if (!values.documentType && data.classification) values.documentType = data.classification.documentType || "";

    const missing = rule.groups.filter((field) => field !== "sequence" && !text(values[field]));
    if (missing.length) return { code: "", complete: false, missing, confidence: CONFIDENCE.REVIEW, status: STATUS.REVIEW, message: `Código incompleto — requer confirmação: ${missing.join(", ")}.`, groups: rule.groups.map((field) => ({ field, value: text(values[field]), source: rule.source, confirmed: Boolean(text(values[field])) })) };

    const seq = values.sequence ? { value: values.sequence, familyKey: etSequenceFamilyKey(rule, values), source: "Sequencial informado manualmente" } : nextEtSequence(rule, values, ldIndex, options && options.reserved);
    values.sequence = seq.value;
    const code = rule.groups.map((field) => values[field]).join(rule.separator);
    const duplicate = ldIndex && ldIndex.byCode && (ldIndex.byCode.get(norm(code)) || []).length > 0;
    return {
      code,
      complete: true,
      sequence: seq.value,
      familyKey: seq.familyKey,
      confidence: duplicate ? CONFIDENCE.CONFLICT : CONFIDENCE.HIGH,
      status: duplicate ? STATUS.CONFLICT : STATUS.PROPOSED,
      message: duplicate ? "Código proposto já existe na base." : `Código montado pela regra ${rule.label}.`,
      groups: rule.groups.map((field) => ({ field, value: values[field], source: field === "sequence" ? seq.source : rule.source, confirmed: field !== "sequence" || !duplicate })),
      rule,
    };
  }

  function applyExistingLdMatch(data, matchInfo) {
    if (!matchInfo || !matchInfo.match) return null;
    const entry = matchInfo.match;
    return {
      code: entry.code,
      complete: true,
      existing: true,
      confidence: CONFIDENCE.CONFIRMED,
      status: STATUS.EXISTING,
      message: `Documento já identificado na ${entry.ld || "LD"}; o código existente foi preservado.` ,
      groups: [{ field: "existingCode", label: "Código existente", value: entry.code, source: `${entry.ld || "LD"}${entry.sheet ? ` / ${entry.sheet}` : ""}${entry.rowNumber ? ` / linha ${entry.rowNumber}` : ""}`, confirmed: true }],
      ldMatch: entry,
    };
  }

  function analyzeDocument(input, ldIndex, options) {
    const data = Object.assign({}, extractTechnicalData(input), input && input.overrides || {});
    const matchInfo = matchLdDocument(data, ldIndex);
    const existing = applyExistingLdMatch(data, matchInfo);
    if (existing) return Object.assign({ data, matchInfo, ruleId: "existing-ld" }, existing);

    if (matchInfo.level === "ambiguous" || matchInfo.level === "conflict") {
      return {
        data,
        matchInfo,
        code: "",
        complete: false,
        confidence: CONFIDENCE.CONFLICT,
        status: STATUS.CONFLICT,
        message: matchInfo.reason,
        groups: [],
        ruleId: "match-conflict",
      };
    }

    const kind = data.classification && data.classification.kind;
    let result;
    if (kind === "et-report") result = buildEtReportCode(data, ldIndex, options);
    else if (kind === "n1710") result = buildN1710Code(data, ldIndex, options);
    else if (kind === "et-admin" || kind === "et-minutes" || kind === "et-cv") result = buildEtSequentialCode(data, ldIndex, options);
    else result = { code: "", complete: false, confidence: CONFIDENCE.IMPOSSIBLE, status: STATUS.ERROR, message: "Não foi possível selecionar uma regra normativa com segurança.", groups: [] };

    return Object.assign({ data, matchInfo, ruleId: kind }, result);
  }

  function reserveBatch(analyses) {
    const reserved = [];
    return (analyses || []).map((item) => {
      const result = typeof item === "function" ? item(reserved) : item;
      if (result && result.complete && result.familyKey && result.sequence && !result.existing && result.status !== STATUS.CONFLICT) {
        reserved.push({ familyKey: result.familyKey, sequence: Number(result.sequence), code: result.code });
      }
      return result;
    });
  }

  function auditRecord(analysis, context) {
    const c = context || {};
    const data = analysis && analysis.data || {};
    return {
      id: c.id || `coding-${Date.now()}-${hashText(`${data.filename}|${analysis && analysis.code}|${Math.random()}`)}`,
      createdAt: c.createdAt || new Date().toISOString(),
      user: text(c.user) || "não identificado",
      project: text(c.project) || "RECON",
      originalFile: data.filename || "",
      fileHash: text(c.fileHash),
      code: analysis && analysis.code || "",
      previousCode: data.existingCode || "",
      norm: analysis && analysis.ruleId || "",
      normRevision: analysis && analysis.ruleId === "et-report" ? "Q" : analysis && analysis.ruleId === "n1710" ? "N" : "Q",
      ld: analysis && analysis.ldMatch && analysis.ldMatch.ld || analysis && analysis.matchInfo && analysis.matchInfo.match && analysis.matchInfo.match.ld || "",
      sequence: analysis && analysis.sequence || "",
      confidence: analysis && analysis.confidence || CONFIDENCE.IMPOSSIBLE,
      status: analysis && analysis.status || STATUS.ERROR,
      justification: analysis && analysis.message || "",
      groups: analysis && analysis.groups || [],
      manualChanges: c.manualChanges || [],
      result: c.result || "analyzed",
    };
  }

  function sanitizeFilename(value) {
    return text(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  }

  function finalFilename(code, title) {
    const safeCode = sanitizeFilename(code);
    const safeTitle = sanitizeFilename(title || "DOCUMENTO");
    return `${safeCode}${safeTitle ? ` - ${safeTitle}` : ""}.pdf`;
  }

  return Object.freeze({
    CONFIDENCE,
    CONFIDENCE_LABEL,
    STATUS,
    text,
    norm,
    compact,
    normalizedTitle,
    similarity,
    hashText,
    cleanFilename,
    extractRevision,
    extractExistingCode,
    parseN1710Code,
    parseEtReportCode,
    extractTag,
    extractContract,
    extractDate,
    extractEap,
    extractUnit,
    extractDiscipline,
    classifyDocument,
    extractTechnicalData,
    normalizeLdRow,
    buildLdIndex,
    matchLdDocument,
    n1710FamilyKey,
    etSequenceFamilyKey,
    listN1710FamilySequences,
    nextN1710Sequence,
    buildN1710Code,
    buildEtReportCode,
    buildEtSequentialCode,
    analyzeDocument,
    reserveBatch,
    auditRecord,
    sanitizeFilename,
    finalFilename,
  });
});
