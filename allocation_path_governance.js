(function (root, factory) {
  const core = root.AllocationCore || (typeof module === "object" && module.exports ? require("./allocation_core.js") : null);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAllocationPathGovernance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (A) {
  "use strict";

  if (!A) throw new Error("AllocationCore precisa ser carregado antes de allocation_path_governance.js.");

  const REVIEW_LABEL = "REVISAR CAMINHO DE ALOCAÇÃO";
  const indexCache = typeof WeakMap === "function" ? new WeakMap() : null;

  const original = Object.freeze({
    analyze: A.analyze,
    levelsForEap: A.levelsForEap,
    outputFromRecord: A.outputFromRecord,
    canSelectForAllocation: A.canSelectForAllocation,
    defaultSelectedForAllocation: A.defaultSelectedForAllocation,
    selectedReady: A.selectedReady,
    allocationRow: A.allocationRow,
    controlRow: A.controlRow,
  });

  function text(value) {
    return A.text ? A.text(value) : String(value == null ? "" : value).trim();
  }

  function norm(value) {
    return A.norm ? A.norm(value) : text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function fullLevels(levels) {
    return Array.from({ length: 10 }, (_, index) => text((levels || [])[index]));
  }

  function levelSignature(levels) {
    return fullLevels(levels).map(norm).join("|");
  }

  function codeDepth(code) {
    return text(code).split(".").filter(Boolean).length;
  }

  function canonicalDiscipline(value) {
    if (!value || !A.databookDisciplineKey) return "";
    return A.databookDisciplineKey({ discipline: text(value) });
  }

  function candidateDiscipline(entry) {
    const levels = fullLevels(entry && entry.levels);
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      const found = canonicalDiscipline(levels[index]);
      if (found) return found;
    }
    return canonicalDiscipline(levels.join(" "));
  }

  function compatibleDiscipline(expected, actual, options) {
    if (!expected || !actual) return true;
    if (expected === actual) return true;
    // Estrutura metálica é um sub-ramo de CIVIL no próprio modelo do RECON.
    // O Workflow pode dizer CIVIL enquanto o documento EMT exige o ramo mais
    // específico de ESTRUTURA METÁLICA. Isso é especialização, não conflito.
    if (options && options.allowCivilParent
      && expected === "ESTRUTURA_METALICA" && actual === "CIVIL") return true;
    return false;
  }

  function recordEvidence(record, output) {
    let primary = A.databookDisciplineKey ? A.databookDisciplineKey(record || {}) : "";
    const databook = canonicalDiscipline(output && output.databook);
    const workflow = canonicalDiscipline(output && output.workflow);
    const document = norm(record && record.document);
    // Há documentos CVL cujo Grupo 7 chega como nt-EMT-...; o classificador
    // legado só reconhece EMT quando ele é o primeiro token. Se o próprio
    // documento contém EMT e o Caminho Data Book confirma ESTRUTURA METÁLICA,
    // promovemos CIVIL para o sub-ramo específico, sem transformar disciplinas
    // diferentes em equivalentes.
    if (primary === "CIVIL" && databook === "ESTRUTURA_METALICA" && /(?:^|[-_])EMT(?:[-_]|$)/.test(document)) {
      primary = "ESTRUTURA_METALICA";
    }
    return { primary, databook, workflow };
  }

  function buildIndex(entries) {
    const source = Array.isArray(entries) ? entries : [];
    if (indexCache && indexCache.has(source)) return indexCache.get(source);

    const byCode = new Map();
    const bySignature = new Map();
    source.forEach((entry, offset) => {
      const code = A.normalizeEap ? A.normalizeEap(entry && entry.code) : text(entry && entry.code);
      const levels = fullLevels(entry && entry.levels);
      if (!code || !levels.some(Boolean)) return;
      const normalized = {
        code,
        levels,
        rowNumber: Number(entry && entry.rowNumber) || offset + 1,
        signature: levelSignature(levels),
      };
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(normalized);
      if (!bySignature.has(normalized.signature)) bySignature.set(normalized.signature, normalized);
    });

    const built = { source, byCode, bySignature, size: source.length };
    if (indexCache) indexCache.set(source, built);
    return built;
  }

  function eapCandidates(index, eap) {
    const parts = text(eap).split(".").filter(Boolean);
    const rows = [];
    for (let depth = parts.length; depth >= 2; depth -= 1) {
      const code = parts.slice(0, depth).join(".");
      const bucket = index.byCode.get(code);
      if (bucket && bucket.length) {
        rows.push(...bucket);
        break;
      }
    }
    return rows;
  }

  function uniqueCandidates(entries) {
    const unique = new Map();
    (entries || []).forEach((entry) => {
      if (!unique.has(entry.signature)) unique.set(entry.signature, entry);
    });
    return [...unique.values()];
  }

  function evidenceConflict(evidence) {
    if (!evidence.primary) return "";
    if (evidence.databook && !compatibleDiscipline(evidence.primary, evidence.databook, { allowCivilParent: true })) {
      return `disciplina ${evidence.primary} diverge do Caminho Data Book (${evidence.databook})`;
    }
    if (evidence.workflow && !compatibleDiscipline(evidence.primary, evidence.workflow, { allowCivilParent: true })) {
      return `disciplina ${evidence.primary} diverge do Workflow (${evidence.workflow})`;
    }
    return "";
  }

  function scoreCandidate(entry, eap, evidence) {
    const discipline = candidateDiscipline(entry);
    const reasons = [];
    const conflicts = [];
    let score = 0;

    const depth = codeDepth(entry.code);
    const exact = entry.code === eap;
    score += exact ? 140 : 100 + depth * 8;
    reasons.push(exact ? "EAP exato na Base" : `ramo estrutural mais profundo da EAP (${entry.code})`);

    if (evidence.primary && discipline) {
      if (!compatibleDiscipline(evidence.primary, discipline)) {
        conflicts.push(`disciplina do documento ${evidence.primary} incompatível com ${discipline}`);
      } else {
        score += 90;
        reasons.push(`disciplina compatível (${discipline})`);
      }
    } else if (evidence.primary && !discipline) {
      score += 5;
      reasons.push("ramo sem disciplina explícita; exige desempate por contexto");
    }

    if (evidence.databook && discipline) {
      if (compatibleDiscipline(evidence.databook, discipline)) {
        score += 30;
        reasons.push("Caminho Data Book confirma a disciplina");
      } else {
        conflicts.push(`Caminho Data Book ${evidence.databook} incompatível com ${discipline}`);
      }
    }

    if (evidence.workflow && discipline) {
      if (compatibleDiscipline(evidence.workflow, discipline, { allowCivilParent: true })) {
        score += 20;
        reasons.push("Workflow confirma o ramo");
      } else {
        conflicts.push(`Workflow ${evidence.workflow} incompatível com ${discipline}`);
      }
    }

    return { entry, discipline, score, reasons, conflicts, valid: conflicts.length === 0 };
  }

  function resolveProjectPath(control, record, output) {
    const family = A.documentFamily ? A.documentFamily(record && record.document) : { type: "" };
    if (family.type !== "ET") {
      return { status: "not_applicable", confidence: "n/a", blocking: false, reason: "Classe fora da árvore EAP de ET." };
    }

    const eap = A.recordEap ? A.recordEap(record || {}) : "";
    const entries = control && control.projectLevelBase;
    const index = buildIndex(entries);
    const evidence = recordEvidence(record, output);
    const contextConflict = evidenceConflict(evidence);

    if (!eap) {
      return {
        status: "review", confidence: "baixa", blocking: true, eap: "", discipline: evidence.primary,
        reason: "EAP não identificada no documento/linha da LD.", candidateCount: 0,
      };
    }
    if (!index.size) {
      return {
        status: "review", confidence: "baixa", blocking: true, eap, discipline: evidence.primary,
        reason: "A Base - Caminho das Pastas não está disponível ou não possui caminhos válidos.", candidateCount: 0,
      };
    }
    if (contextConflict) {
      return {
        status: "review", confidence: "baixa", blocking: true, eap, discipline: evidence.primary,
        reason: `Evidências documentais conflitantes: ${contextConflict}.`, candidateCount: 0, evidence,
      };
    }

    const structural = uniqueCandidates(eapCandidates(index, eap));
    if (!structural.length) {
      return {
        status: "review", confidence: "baixa", blocking: true, eap, discipline: evidence.primary,
        reason: `Nenhum ramo da Base - Caminho das Pastas corresponde com segurança à EAP ${eap}.`, candidateCount: 0, evidence,
      };
    }

    const ranked = structural.map((entry) => scoreCandidate(entry, eap, evidence));
    const valid = ranked.filter((candidate) => candidate.valid)
      .sort((left, right) => right.score - left.score || left.entry.rowNumber - right.entry.rowNumber);

    if (!valid.length) {
      const conflicts = [...new Set(ranked.flatMap((candidate) => candidate.conflicts))];
      return {
        status: "review", confidence: "baixa", blocking: true, eap, discipline: evidence.primary,
        reason: conflicts.length
          ? `Os ramos encontrados foram rejeitados por incompatibilidade estrutural: ${conflicts.join("; ")}.`
          : `Nenhum ramo seguro foi encontrado para EAP ${eap}.`,
        candidateCount: structural.length, evidence,
      };
    }

    const top = valid[0];
    const runner = valid[1] || null;
    if (runner && runner.score === top.score && runner.entry.signature !== top.entry.signature) {
      return {
        status: "review", confidence: "média", blocking: true, eap, discipline: evidence.primary,
        reason: `Mais de um ramo da Base - Caminho das Pastas obteve a mesma confiança para EAP ${eap}; nenhuma pasta foi escolhida por aproximação.`,
        candidateCount: valid.length, evidence,
        alternatives: valid.slice(0, 5).map((item) => ({ rowNumber: item.entry.rowNumber, score: item.score, levels: item.entry.levels.slice() })),
      };
    }

    const currentSignature = levelSignature(output && output.levels);
    const corrected = Boolean(currentSignature.replace(/\|/g, "") && currentSignature !== top.entry.signature);
    return {
      status: "resolved",
      confidence: evidence.primary && top.discipline === evidence.primary ? "alta" : "média",
      blocking: false,
      eap,
      discipline: evidence.primary,
      candidateDiscipline: top.discipline,
      rowNumber: top.entry.rowNumber,
      code: top.entry.code,
      levels: top.entry.levels.slice(),
      signature: top.entry.signature,
      score: top.score,
      corrected,
      candidateCount: valid.length,
      reasons: top.reasons.slice(),
      evidence,
    };
  }

  function reviewMessage(resolution) {
    const eap = text(resolution && resolution.eap);
    const discipline = text(resolution && resolution.discipline);
    const context = [eap ? `EAP ${eap}` : "", discipline ? `disciplina ${discipline}` : ""].filter(Boolean).join(" / ");
    return `${REVIEW_LABEL}${context ? ` — ${context}` : ""}: ${text(resolution && resolution.reason) || "não foi encontrada correspondência segura na Base - Caminho das Pastas."}`;
  }

  function governOutput(output, control, record) {
    if (!output || !record) return { output, resolution: { status: "not_applicable", blocking: false } };
    const resolution = resolveProjectPath(control, record, output);
    output.allocationPathResolution = resolution;

    if (resolution.status === "resolved") {
      output.levels = fullLevels(resolution.levels);
      output.levelsSource = `Base - Caminho das Pastas · linha ${resolution.rowNumber}`;
      output.allocationPathReview = false;
    } else if (resolution.blocking) {
      // Não reutiliza a maioria histórica, não monta níveis de ramos diferentes
      // e não inventa uma pasta genérica quando a árvore mestra não decide.
      output.levels = Array.from({ length: 10 }, () => "");
      output.levelsSource = REVIEW_LABEL;
      output.allocationPathReview = true;
    }
    return { output, resolution };
  }

  function governResult(result, control) {
    if (!result || !result.record || !result.output) return result;
    const governed = governOutput(result.output, control, result.record);
    const resolution = governed.resolution;
    result.allocationPathResolution = resolution;
    result.pathReviewRequired = Boolean(resolution.blocking);

    if (resolution.status === "resolved" && resolution.corrected) {
      const note = `Níveis corrigidos pela Base - Caminho das Pastas (linha ${resolution.rowNumber}); histórico por EAP não foi usado como fonte de verdade.`;
      result.warnings = [...(result.warnings || []), note];
    }

    if (resolution.blocking) {
      const message = reviewMessage(resolution);
      result.decision = A.REVIEW || "revisar";
      result.selected = false;
      result.userSelected = false;
      result.reason = message;
      result.allocationReason = message;
      result.allocationDiagnosis = REVIEW_LABEL;
      result.allocationDiagnosisKind = "allocation_path_review";
      result.allocationDiagnosisDetail = text(resolution.reason);
    }
    return result;
  }

  function governAnalysis(analysis, control) {
    if (!analysis || !Array.isArray(analysis.results)) return analysis;
    analysis.results.forEach((result) => governResult(result, control));
    analysis.pathGovernance = {
      source: "Base - Caminho das Pastas",
      resolved: analysis.results.filter((item) => item && item.allocationPathResolution && item.allocationPathResolution.status === "resolved").length,
      review: analysis.results.filter((item) => item && item.pathReviewRequired).length,
      corrected: analysis.results.filter((item) => item && item.allocationPathResolution && item.allocationPathResolution.corrected).length,
    };
    return analysis;
  }

  function validateExportableResult(result) {
    const resolution = result && result.allocationPathResolution || result && result.output && result.output.allocationPathResolution;
    if (!resolution || resolution.status === "not_applicable") return true;
    if (resolution.status !== "resolved" || resolution.blocking) {
      throw new Error(`${REVIEW_LABEL}: ${text(resolution.reason) || "caminho hierárquico não validado."}`);
    }
    const current = levelSignature(result && result.output && result.output.levels);
    if (current !== resolution.signature) {
      throw new Error(`${REVIEW_LABEL}: N1→N10 foram alterados após a validação e não correspondem mais ao mesmo ramo da Base.`);
    }
    return true;
  }

  A.levelsForEap = function governedLevelsForEap(control, record) {
    const resolution = resolveProjectPath(control, record, null);
    if (resolution.status === "resolved") return resolution.levels.slice();
    return [];
  };

  A.outputFromRecord = function governedOutputFromRecord(record, history, base, control, allocationDate, inference) {
    const output = original.outputFromRecord(record, history, base, control, allocationDate, inference);
    return governOutput(output, control, record).output;
  };

  A.analyze = function governedAnalyze(entries, records, control, options) {
    return governAnalysis(original.analyze(entries, records, control, options), control);
  };

  A.canSelectForAllocation = function governedCanSelectForAllocation(result) {
    if (result && result.pathReviewRequired) return false;
    return original.canSelectForAllocation ? original.canSelectForAllocation(result) : Boolean(result && result.document && result.record && result.output);
  };

  A.defaultSelectedForAllocation = function governedDefaultSelectedForAllocation(result) {
    if (!A.canSelectForAllocation(result)) return false;
    return original.defaultSelectedForAllocation ? original.defaultSelectedForAllocation(result) : Boolean(result && result.decision === A.READY);
  };

  A.selectedReady = function governedSelectedReady(results, selectedDocuments) {
    const selected = original.selectedReady ? original.selectedReady(results, selectedDocuments) : (results || []);
    return selected.filter((result) => A.canSelectForAllocation(result));
  };

  A.allocationRow = function governedAllocationRow(result, allocationDate) {
    validateExportableResult(result);
    return original.allocationRow(result, allocationDate);
  };

  A.controlRow = function governedControlRow(result, meta) {
    validateExportableResult(result);
    return original.controlRow(result, meta);
  };

  const api = {
    REVIEW_LABEL,
    buildIndex,
    resolveProjectPath,
    governOutput,
    governResult,
    governAnalysis,
    validateExportableResult,
    levelSignature,
    candidateDiscipline,
    original,
  };

  return Object.freeze(api);
});
