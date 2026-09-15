(function (root, factory) {
  const Core = typeof module === "object" && module.exports ? require("./document_coding_core.js") : root.RECONDocumentCodingCore;
  const api = factory(Core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingLDCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
  "use strict";

  if (!Core) throw new Error("RECONDocumentCodingCore não carregado.");

  function text(value) { return value == null ? "" : String(value).trim(); }
  function norm(value) { return Core.norm ? Core.norm(value) : text(value).toUpperCase(); }
  function headerKey(value) { return norm(value).replace(/[^A-Z0-9]+/g, ""); }
  function numericSequence(value) {
    const match = text(value).match(/(?:^|[-_])(\d{3,4})(?:$|[^0-9])/);
    return match ? Number(match[1]) : NaN;
  }

  const SEMANTICS = Object.freeze({
    code: ["DOCUMENTO", "CODIGO", "CODIGODOCUMENTO", "NUMERODOCUMENTO", "NDOCUMENTO", "DOCUMENTNUMBER", "NODOCUMENTO"],
    title: ["TITULO", "DESCRICAO", "DESCRICAODOCUMENTO", "DOCUMENTTITLE"],
    revision: ["REV", "REVISAO", "REVISION"],
    discipline: ["DISCIPLINA", "DISCIPLINE"],
    tag: ["TAG", "TAGEQUIPAMENTO", "TAGDOEQUIPAMENTO"],
    prazo: ["PRAZO", "PRAZOLD", "VERSAOLD", "VERSAODALD"],
    taxonomy: ["TAXONOMIA", "TAXONOMIALD", "TAXONOMIADALD"],
    unit: ["UNIDADE", "UNIT"],
    eap: ["EAP", "CODIGOEAP", "CRITERIODEMEDICAO", "CRITERIOMEDICAO"],
    category: ["CATEGORIA", "CATEGORIADOCUMENTO"],
    documentType: ["TIPODOCUMENTO", "TIPODOCDOCUMENTO", "TIPO"],
    activityArea: ["AREADEATIVIDADE", "AREAATIVIDADE", "AREA"],
    serviceClass: ["CLASSEDE SERVICO", "CLASSEDE SERVIÇO", "CLASSESERVICO", "CLASSE", "SERVICECLASS"],
    origin: ["ORIGEM", "EMISSOR", "ORIGIN"],
    installation: ["INSTALACAO", "INSTALLATION"],
    classification: ["CLASSIFICACAO", "CLASSIFICATION"],
    date: ["DATA", "DATE"],
  });

  const SEMANTIC_KEYS = Object.freeze(Object.fromEntries(Object.entries(SEMANTICS).map(([field, values]) => [field, new Set(values.map(headerKey))])));

  function semanticForHeader(header) {
    const key = headerKey(header);
    for (const [field, values] of Object.entries(SEMANTIC_KEYS)) {
      if (values.has(key)) return field;
    }
    for (const [field, values] of Object.entries(SEMANTIC_KEYS)) {
      for (const candidate of values) {
        if (candidate.length >= 5 && (key.includes(candidate) || candidate.includes(key))) return field;
      }
    }
    return "";
  }

  function schemeOfEntry(entry) {
    if (entry.parsedN1710) return "n1710";
    if (entry.parsedEtReport) return "et-report";
    const code = text(entry.code);
    if (Core.parseN1710Code(code)) return "n1710";
    if (Core.parseEtReportCode(code)) return "et-report";
    return "other";
  }

  function countMap(rows, getter) {
    const map = new Map();
    rows.forEach((row) => {
      const value = norm(getter(row));
      if (!value) return;
      map.set(value, (map.get(value) || 0) + 1);
    });
    return map;
  }

  function dominant(map) {
    let best = { value: "", count: 0 };
    map.forEach((count, value) => { if (count > best.count) best = { value, count }; });
    return best;
  }

  function buildSchemaIndex(ldFiles, normalizedRows) {
    const rows = normalizedRows || [];
    const grouped = new Map();
    rows.forEach((entry) => {
      const key = `${entry.ld || ""}\u0000${entry.sheet || ""}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });

    const schemas = [];
    (ldFiles || []).forEach((file) => {
      (file.sheetNames || []).forEach((sheet) => {
        const rawRows = (file.rows || []).filter((item) => item.meta && item.meta.sheet === sheet);
        if (!rawRows.length) return;
        const headers = [];
        const seen = new Set();
        rawRows.slice(0, Math.min(rawRows.length, 30)).forEach((item) => {
          Object.keys(item.row || {}).forEach((header) => {
            if (!seen.has(header)) { seen.add(header); headers.push(header); }
          });
        });
        const normalized = grouped.get(`${file.filename}\u0000${sheet}`) || [];
        const fillRatios = {};
        headers.forEach((header) => {
          let filled = 0;
          rawRows.forEach((item) => { if (text(item.row && item.row[header])) filled += 1; });
          fillRatios[header] = rawRows.length ? filled / rawRows.length : 0;
        });
        const dimensions = {
          scheme: countMap(normalized, schemeOfEntry),
          category: countMap(normalized, (r) => r.category),
          discipline: countMap(normalized, (r) => r.discipline),
          unit: countMap(normalized, (r) => r.unit),
          eap: countMap(normalized, (r) => r.eap),
          reportCode: countMap(normalized, (r) => r.reportCode),
          installation: countMap(normalized, (r) => r.installation),
          activityArea: countMap(normalized, (r) => r.activityArea),
          serviceClass: countMap(normalized, (r) => r.serviceClass),
          origin: countMap(normalized, (r) => r.origin),
        };
        schemas.push({
          id: `${file.filename}::${sheet}::${headers.map(headerKey).join("|")}`,
          file: file.filename,
          sheet,
          headers,
          signature: headers.map(headerKey).join("|"),
          rawRows,
          rows: normalized,
          fillRatios,
          dimensions,
          dominantScheme: dominant(dimensions.scheme),
        });
      });
    });
    return { schemas, byId: new Map(schemas.map((s) => [s.id, s])) };
  }

  function dataFromAnalysis(analysis) {
    const data = analysis && analysis.data || {};
    return {
      code: analysis && analysis.code || data.existingCode || "",
      title: data.title || "",
      revision: data.revision || "",
      discipline: data.discipline || "",
      tag: data.tag || "",
      prazo: data.prazo || data.deadline || "",
      taxonomy: data.taxonomy || data.taxonomia || "",
      unit: data.unit || "",
      eap: data.eap || "",
      category: data.category || "",
      documentType: data.classification && data.classification.label || "",
      activityArea: data.activityArea || "",
      serviceClass: data.serviceClass || "",
      origin: data.origin || data.emitter || "",
      installation: data.installation || "",
      classification: data.classification && data.classification.label || "",
      date: data.date || "",
      reportCode: data.reportCode || "",
      emitter: data.emitter || "",
      enterprise: data.enterprise || "",
    };
  }

  function scoreValue(map, value, weight) {
    const key = norm(value);
    if (!key || !map || !map.size) return 0;
    const count = map.get(key) || 0;
    if (!count) return 0;
    const max = dominant(map).count || 1;
    return weight * Math.min(1, count / max);
  }

  function scoreSchema(schema, analysis) {
    const data = dataFromAnalysis(analysis);
    const scheme = analysis && analysis.ruleId === "n1710" ? "n1710" : analysis && analysis.ruleId === "et-report" ? "et-report" : "other";
    let score = 0;
    const reasons = [];
    const schemeScore = scoreValue(schema.dimensions.scheme, scheme, 45);
    if (schemeScore) { score += schemeScore; reasons.push(`estrutura ${scheme}`); }
    const checks = [
      ["reportCode", data.reportCode, 35, "código de relatório"],
      ["category", data.category, 28, "categoria"],
      ["eap", data.eap, 25, "EAP"],
      ["installation", data.installation, 24, "instalação"],
      ["serviceClass", data.serviceClass, 20, "classe"],
      ["activityArea", data.activityArea, 20, "área"],
      ["discipline", data.discipline, 18, "disciplina"],
      ["unit", data.unit, 18, "unidade"],
      ["origin", data.origin || data.emitter, 14, "origem"],
    ];
    checks.forEach(([field, value, weight, label]) => {
      const points = scoreValue(schema.dimensions[field], value, weight);
      if (points) { score += points; reasons.push(label); }
    });
    const fileN = norm(schema.file);
    if (scheme === "n1710" && /N.?1710|LD.?001/.test(fileN)) { score += 18; reasons.push("nome da LD compatível com N-1710"); }
    if (scheme === "et-report" && norm(data.reportCode) === "RIR" && /RIR|LD.?003/.test(fileN)) { score += 18; reasons.push("nome da LD compatível com RIR"); }
    if (scheme === "et-report" && /LD.?004|C.?&.?M|CM/.test(fileN) && norm(data.reportCode) !== "RIR") { score += 8; reasons.push("nome da LD compatível com ET/C&M"); }
    return { schema, score, reasons };
  }

  function chooseDestination(analysis, schemaIndex) {
    const direct = analysis && (analysis.ldMatch || analysis.matchInfo && analysis.matchInfo.match);
    if (direct && direct.ld && direct.sheet) {
      const schema = (schemaIndex.schemas || []).find((s) => s.file === direct.ld && s.sheet === direct.sheet);
      if (schema) return { schema, confidence: "confirmed", score: 999, reasons: ["registro existente na própria LD"], existing: direct };
    }
    const ranked = (schemaIndex.schemas || []).map((schema) => scoreSchema(schema, analysis)).sort((a, b) => b.score - a.score);
    if (!ranked.length) return { schema: null, confidence: "missing", score: 0, reasons: ["nenhuma LD carregada"] };
    if (ranked.length === 1 && ranked[0].score >= 10) return Object.assign({ confidence: "high" }, ranked[0]);
    const first = ranked[0];
    const second = ranked[1];
    if (first.score >= 45 && (!second || first.score - second.score >= 12)) return Object.assign({ confidence: "high" }, first);
    return { schema: null, confidence: "review", score: first.score, reasons: first.reasons, candidates: ranked.slice(0, 4) };
  }

  function sameFamily(entry, analysis) {
    const data = dataFromAnalysis(analysis);
    if (analysis && analysis.ruleId === "n1710") {
      const p = entry.parsedN1710 || Core.parseN1710Code(entry.code);
      if (!p) return false;
      return ["category", "installation", "activityArea", "serviceClass", "origin"].every((field) => norm(p[field]) === norm(data[field]));
    }
    if (analysis && analysis.ruleId === "et-report") {
      const p = entry.parsedEtReport || Core.parseEtReportCode(entry.code);
      if (!p) return false;
      return ["emitter", "enterprise", "unit", "eap", "discipline", "reportCode"].every((field) => !text(data[field]) || norm(p[field]) === norm(data[field]));
    }
    return false;
  }

  function familyRows(schema, analysis) {
    const rows = (schema && schema.rows || []).filter((entry) => sameFamily(entry, analysis));
    return rows.length ? rows : (schema && schema.rows || []);
  }

  function stableValue(header, rows) {
    const values = [];
    (rows || []).slice(-50).forEach((entry) => {
      const value = text(entry.raw && entry.raw[header]);
      if (value) values.push(value);
    });
    if (values.length < 2) return "";
    const first = norm(values[0]);
    return values.every((value) => norm(value) === first) ? values[0] : "";
  }

  function findPosition(schema, analysis) {
    const rows = familyRows(schema, analysis).slice().sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
    if (!rows.length) return { label: "Nenhum registro semelhante encontrado; inserir no grupo/aba após confirmação.", before: null, after: null };
    const targetSeq = analysis && analysis.sequence ? Number(analysis.sequence) : numericSequence(analysis && analysis.code);
    if (Number.isFinite(targetSeq)) {
      let before = null;
      let after = null;
      rows.forEach((entry) => {
        const parsed = entry.parsedN1710 || Core.parseN1710Code(entry.code);
        const seq = parsed ? Number(parsed.sequence) : numericSequence(entry.code);
        if (!Number.isFinite(seq)) return;
        if (seq < targetSeq && (!before || seq > before.seq)) before = { entry, seq };
        if (seq > targetSeq && (!after || seq < after.seq)) after = { entry, seq };
      });
      if (before || after) {
        const parts = [];
        if (before) parts.push(`após ${before.entry.code} (linha ${before.entry.rowNumber})`);
        if (after) parts.push(`antes de ${after.entry.code} (linha ${after.entry.rowNumber})`);
        return { label: parts.join(" e "), before: before && before.entry, after: after && after.entry };
      }
    }
    const last = rows[rows.length - 1];
    return { label: `junto aos documentos da mesma família; referência mais próxima: ${last.code} (linha ${last.rowNumber})`, before: last, after: null };
  }

  function valueForSemantic(field, analysis) {
    return text(dataFromAnalysis(analysis)[field]);
  }

  function generateLine(analysis, schemaIndex, edits) {
    const destination = chooseDestination(analysis, schemaIndex);
    if (!destination.schema) {
      return { status: "review", valid: false, destination, headers: [], values: [], missing: ["LD/aba de destino"], position: null };
    }
    const schema = destination.schema;
    if (destination.existing || analysis && analysis.existing) {
      const existing = destination.existing || analysis.ldMatch || analysis.matchInfo && analysis.matchInfo.match;
      return {
        status: "existing",
        valid: false,
        destination,
        headers: schema.headers.slice(),
        values: schema.headers.map((header) => text(existing && existing.raw && existing.raw[header])),
        missing: [],
        position: existing ? { label: `registro já existente na linha ${existing.rowNumber}`, before: existing, after: null } : null,
        existing,
      };
    }

    const related = familyRows(schema, analysis);
    const lineEdits = edits || {};
    const values = [];
    const sources = [];
    const missing = [];
    schema.headers.forEach((header) => {
      const semantic = semanticForHeader(header);
      let value = Object.prototype.hasOwnProperty.call(lineEdits, header) ? text(lineEdits[header]) : "";
      let source = value ? "edição manual" : "";
      if (!value && semantic) {
        value = valueForSemantic(semantic, analysis);
        if (value) source = "documento/codificação";
      }
      if (!value) {
        const stable = stableValue(header, related);
        if (stable) { value = stable; source = "valor constante observado na mesma família da LD"; }
      }
      if (!value && (schema.fillRatios[header] || 0) >= 0.9) missing.push(header);
      values.push(value);
      sources.push({ header, semantic, value, source, requiredCandidate: (schema.fillRatios[header] || 0) >= 0.9 });
    });
    const position = findPosition(schema, analysis);
    return {
      status: missing.length ? "review" : "ready",
      valid: missing.length === 0,
      destination,
      schema,
      headers: schema.headers.slice(),
      values,
      sources,
      missing,
      position,
      groupKey: `${schema.file}::${schema.sheet}::${schema.signature}`,
    };
  }

  function excelCell(value) {
    let v = text(value).replace(/[\t\r\n]+/g, " ");
    if (/^0\d+$/.test(v)) v = `'${v}`;
    if (/^[=+@]/.test(v)) v = `'${v}`;
    return v;
  }

  function linesToTsv(lines, withHeader) {
    const valid = (lines || []).filter((line) => line && line.headers && line.headers.length);
    if (!valid.length) return "";
    const signature = valid[0].headers.map(headerKey).join("|");
    if (valid.some((line) => line.headers.map(headerKey).join("|") !== signature)) throw new Error("Estruturas de colunas incompatíveis. Copie por LD + aba + estrutura.");
    const rows = [];
    if (withHeader) rows.push(valid[0].headers.map(excelCell).join("\t"));
    valid.forEach((line) => rows.push(line.values.map(excelCell).join("\t")));
    return rows.join("\r\n");
  }

  function groupLines(lines) {
    const groups = new Map();
    (lines || []).forEach((line) => {
      if (!line || !line.schema) return;
      const key = line.groupKey || `${line.schema.file}::${line.schema.sheet}::${line.schema.signature}`;
      if (!groups.has(key)) groups.set(key, { key, file: line.schema.file, sheet: line.schema.sheet, signature: line.schema.signature, headers: line.headers, lines: [] });
      groups.get(key).lines.push(line);
    });
    return [...groups.values()];
  }

  return Object.freeze({
    SEMANTICS,
    semanticForHeader,
    buildSchemaIndex,
    scoreSchema,
    chooseDestination,
    sameFamily,
    familyRows,
    stableValue,
    findPosition,
    generateLine,
    excelCell,
    linesToTsv,
    groupLines,
  });
});