import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Trecho não encontrado: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Trecho duplicado: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

let core = fs.readFileSync("allocation_core.js", "utf8");

core = replaceOnce(
  core,
`  function levelsFromEapBase(entries, eapValue, record) {
    const eap = normalizeEap(eapValue);
    if (!eap) return [];
    const candidates = (entries || []).filter((entry) => eap === entry.code || eap.startsWith(\`${'${entry.code}'}.\`));
    if (!candidates.length) return [];
    const deepest = Math.max(...candidates.map((entry) => entry.code.split(".").length));
    const best = candidates.filter((entry) => entry.code.split(".").length === deepest);
    if (best.length === 1) return best[0].levels.slice();
    const byDiscipline = disambiguateByDiscipline(best, record);
    return byDiscipline ? byDiscipline.levels.slice() : commonLevels(best);
  }`,
`  const PROJECT_LEVEL_INDEX_CACHE = typeof WeakMap === "function" ? new WeakMap() : null;

  function normalizeProjectCode(value) {
    const raw = text(value);
    if (!/^\\d+(?:\\.\\d+){0,6}$/.test(raw)) return "";
    return raw.split(".").map((part) => String(Number(part))).join(".");
  }

  function projectLevelIndex(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    if (PROJECT_LEVEL_INDEX_CACHE && PROJECT_LEVEL_INDEX_CACHE.has(rows)) return PROJECT_LEVEL_INDEX_CACHE.get(rows);
    const byCode = new Map();
    rows.forEach((entry) => {
      const code = normalizeProjectCode(entry && entry.code);
      if (!code) return;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(entry);
    });
    const index = { byCode };
    if (PROJECT_LEVEL_INDEX_CACHE) PROJECT_LEVEL_INDEX_CACHE.set(rows, index);
    return index;
  }

  function projectLevelCandidates(entries, eapValue) {
    const eap = normalizeEap(eapValue);
    if (!eap) return [];
    const index = projectLevelIndex(entries);
    const parts = eap.split(".");
    const candidates = [];
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const code = parts.slice(0, depth).join(".");
      (index.byCode.get(code) || []).forEach((entry) => candidates.push(entry));
    }
    return candidates;
  }

  function disciplineKeysCompatible(left, right) {
    if (!left || !right) return true;
    if (left === right) return true;
    const civilMetal = new Set(["CIVIL", "ESTRUTURA_METALICA"]);
    return civilMetal.has(left) && civilMetal.has(right);
  }

  function projectPathDisciplineKey(levels) {
    const values = Array.isArray(levels) ? levels : [];
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const discipline = databookDisciplineKey({ discipline: values[index] });
      if (discipline) return discipline;
    }
    return "";
  }

  function recordDisciplineEvidence(record) {
    const item = record || {};
    const workflow = text(item.workflow || recordValue(item, ["WORKFLOW", "QUEM?"]));
    const databook = text(recordValue(item, ["CAMINHO DATABOOK", "CAMINHO DATA BOOK"]));
    const evidence = [
      databookDisciplineKey(item),
      databookDisciplineKey({ discipline: workflow }),
      databookDisciplineKey({ discipline: databook }),
    ].filter(Boolean);
    return [...new Set(evidence)];
  }

  function levelsCompatibleWithRecord(levels, record) {
    const pathDiscipline = projectPathDisciplineKey(levels);
    if (!pathDiscipline) return true;
    const evidence = recordDisciplineEvidence(record);
    return !evidence.length || evidence.every((discipline) => disciplineKeysCompatible(discipline, pathDiscipline));
  }

  function levelsFromEapBase(entries, eapValue, record) {
    const eap = normalizeEap(eapValue);
    if (!eap) return [];
    let candidates = projectLevelCandidates(entries, eap).filter((entry) => levelsCompatibleWithRecord(entry.levels, record));
    if (!candidates.length) return [];

    // Disciplina/contexto estrutural vem antes da profundidade. Isso impede um
    // ramo elétrico mais profundo de vencer um ramo de tubulação compatível.
    const wanted = databookDisciplineKey(record);
    if (wanted) {
      const explicit = candidates.filter((entry) => {
        const pathDiscipline = projectPathDisciplineKey(entry.levels);
        return pathDiscipline && disciplineKeysCompatible(wanted, pathDiscipline);
      });
      if (explicit.length) candidates = explicit;
    }

    const deepest = Math.max(...candidates.map((entry) => normalizeProjectCode(entry.code).split(".").length));
    const best = candidates.filter((entry) => normalizeProjectCode(entry.code).split(".").length === deepest);
    const uniquePaths = new Map();
    best.forEach((entry) => {
      const signature = levelKey(entry.levels);
      if (signature && !uniquePaths.has(signature)) uniquePaths.set(signature, entry);
    });
    if (uniquePaths.size !== 1) return [];
    return [...uniquePaths.values()][0].levels.slice();
  }`,
  "seleção do caminho mestre por EAP",
);

core = replaceOnce(
  core,
`  function levelsForEap(control, record) {
    const eap = recordEap(record);
    if (!eap || !control) return [];
    const exact = control.levelsByEap && control.levelsByEap.get(eap);
    if (exact && exact.some(Boolean)) return exact.slice();
    const fromBase = levelsFromEapBase(control.projectLevelBase || [], eap, record);
    if (fromBase.some(Boolean)) return fromBase;
    return levelsFromSiblingEaps(control.levelsByEap, eap);
  }`,
`  function levelResolutionForEap(control, record) {
    const eap = recordEap(record);
    const empty = { levels: [], source: "", sourceType: "none", confidence: "nenhuma", reason: "", blockFallback: false, candidateCount: 0 };
    if (!eap || !control) return empty;

    // A árvore mestre sempre tem precedência sobre histórico. Histórico antigo
    // pode conter exatamente o erro que estamos tentando corrigir (TUB -> ELÉTRICA).
    const baseEntries = control.projectLevelBase || [];
    const baseCandidates = projectLevelCandidates(baseEntries, eap);
    const fromBase = levelsFromEapBase(baseEntries, eap, record);
    if (fromBase.some(Boolean)) {
      return {
        levels: fromBase,
        source: "Base - Caminho das Pastas",
        sourceType: "project-base",
        confidence: "alta",
        reason: "Caminho mestre compatível com EAP " + eap + " e disciplina/contexto do documento.",
        blockFallback: false,
        candidateCount: baseCandidates.length,
      };
    }

    const discipline = recordDisciplineEvidence(record).join("/") || "não identificada";
    if (baseCandidates.length) {
      return {
        levels: [],
        source: "Base - Caminho das Pastas",
        sourceType: "project-base-ambiguous",
        confidence: "revisar",
        reason: "REVISAR CAMINHO DE ALOCAÇÃO — não existe um único ramo mestre compatível para EAP " + eap + " / disciplina " + discipline + ".",
        blockFallback: true,
        candidateCount: baseCandidates.length,
      };
    }

    // Somente quando a Base não cobre o EAP é permitido consultar o histórico,
    // e ainda assim o caminho histórico precisa ser estruturalmente compatível.
    const exact = control.levelsByEap && control.levelsByEap.get(eap);
    if (exact && exact.some(Boolean)) {
      if (levelsCompatibleWithRecord(exact, record)) {
        return {
          levels: exact.slice(),
          source: "Histórico EAP (Base sem cobertura)",
          sourceType: "history-eap",
          confidence: "média",
          reason: "EAP " + eap + " não existe na Base - Caminho das Pastas; usado histórico compatível.",
          blockFallback: false,
          candidateCount: 0,
        };
      }
      return {
        levels: [],
        source: "Histórico EAP incompatível",
        sourceType: "history-eap-conflict",
        confidence: "revisar",
        reason: "REVISAR CAMINHO DE ALOCAÇÃO — histórico de EAP " + eap + " conflita com a disciplina " + discipline + ".",
        blockFallback: true,
        candidateCount: 0,
      };
    }

    return {
      ...empty,
      reason: "REVISAR CAMINHO DE ALOCAÇÃO — EAP " + eap + " sem caminho seguro na Base - Caminho das Pastas.",
      blockFallback: true,
    };
  }

  function levelsForEap(control, record) {
    return levelResolutionForEap(control, record).levels.slice();
  }`,
  "prioridade da Base - Caminho das Pastas",
);

core = replaceOnce(
  core,
`    const family = documentFamily(record.document);
    const eapLevels = family.type === "ET" ? levelsForEap(control, record) : [];
    let levels = [];`,
`    const family = documentFamily(record.document);
    const eapResolution = family.type === "ET" ? levelResolutionForEap(control, record) : null;
    const eapLevels = eapResolution ? eapResolution.levels : [];
    let levels = [];`,
  "resolução EAP no output",
);

core = replaceOnce(
  core,
`      levels = eapLevels.slice();
      levelsSource = \`Base EAP ${'${recordEap(record)}'}\`;
    } else if (base && base.levels && base.levels.some(Boolean)) {`,
`      levels = eapLevels.slice();
      levelsSource = eapResolution && eapResolution.source || ("Base EAP " + recordEap(record));
    } else if (family.type === "ET" && eapResolution && eapResolution.blockFallback) {
      levels = [];
      levelsSource = eapResolution.reason || "REVISAR CAMINHO DE ALOCAÇÃO";
    } else if (base && base.levels && base.levels.some(Boolean)) {`,
  "bloqueio de fallback inconsistente no output",
);

core = replaceOnce(
  core,
`    if (!levels.length) {
      levels = levelsForDatabook(control && control.levelsByDatabook, databook);
      if (levels.some(Boolean)) levelsSource = "Histórico do caminho";
    }
    while (levels.length < 10) levels.push("");`,
`    if (!levels.length && !(family.type === "ET" && eapResolution && eapResolution.blockFallback)) {
      levels = levelsForDatabook(control && control.levelsByDatabook, databook);
      if (levels.some(Boolean)) levelsSource = "Histórico do caminho";
    }
    if (family.type === "ET" && levels.some(Boolean) && !levelsCompatibleWithRecord(levels, record)) {
      levels = [];
      levelsSource = "REVISAR CAMINHO DE ALOCAÇÃO — os níveis encontrados conflitam com a disciplina/contexto do documento.";
    }
    while (levels.length < 10) levels.push("");`,
  "validação final da hierarquia do output",
);

core = replaceOnce(
  core,
`      const eapLevels = levelsForEap(control, record);
      const exactLevels = eapLevels.some(Boolean) ? eapLevels : base && base.levels && base.levels.some(Boolean) ? base.levels : history && history.levels && history.levels.some(Boolean) ? history.levels : levelsForDatabook(control.levelsByDatabook, exactDatabook);`,
`      const eapResolution = levelResolutionForEap(control, record);
      const eapLevels = eapResolution.levels;
      const exactLevels = eapLevels.some(Boolean) ? eapLevels
        : eapResolution.blockFallback ? []
          : base && base.levels && base.levels.some(Boolean) ? base.levels
            : history && history.levels && history.levels.some(Boolean) ? history.levels
              : levelsForDatabook(control.levelsByDatabook, exactDatabook);`,
  "níveis exatos na geração",
);

core = replaceOnce(
  core,
`      if (!output.levels.slice(0, 6).some(Boolean)) warnings.push("Níveis N1 a N6 vazios");`,
`      if (!output.levels.slice(0, 6).some(Boolean)) warnings.push("Níveis N1 a N6 vazios");
      if (/^REVISAR CAMINHO DE ALOCAÇÃO/.test(norm(output.levelsSource))) warnings.push(output.levelsSource);`,
  "aviso de revisão de caminho",
);

core = replaceOnce(
  core,
`    recordEap,
    levelsFromEapBase,
    parseProjectLevelBase,
    levelsForEap,
    titleKind,`,
`    recordEap,
    levelsFromEapBase,
    parseProjectLevelBase,
    levelResolutionForEap,
    levelsForEap,
    projectPathDisciplineKey,
    levelsCompatibleWithRecord,
    titleKind,`,
  "exports de diagnóstico de hierarquia",
);

fs.writeFileSync("allocation_core.js", core);
console.log("Correção estrutural da hierarquia de alocação aplicada.");
