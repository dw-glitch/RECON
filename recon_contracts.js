(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONContracts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "recon.ld-record.v1";
  const CODES = Object.freeze({
    TITLE_OK: "TITLE_OK",
    TITLE_EMPTY: "TITLE_EMPTY",
    TITLE_MISSING_TAG: "TITLE_MISSING_TAG",
    TITLE_WRONG_TAG: "TITLE_WRONG_TAG",
    TITLE_DESCRIPTION_MISMATCH: "TITLE_DESCRIPTION_MISMATCH",
    TITLE_GENERIC: "TITLE_GENERIC",
    TITLE_FORMAT: "TITLE_FORMAT",
    TITLE_POSSIBLE_IDENTIFIER: "TITLE_POSSIBLE_IDENTIFIER",
    TITLE_UNSAFE: "TITLE_UNSAFE",
    TITLE_LD_CONFLICT: "TITLE_LD_CONFLICT",
    DATABOOK_OK: "DATABOOK_OK",
    DATABOOK_MISSING: "DATABOOK_MISSING",
    DATABOOK_DIVERGENT: "DATABOOK_DIVERGENT",
    DATABOOK_UNCONFIRMED: "DATABOOK_UNCONFIRMED",
    DATABOOK_LD_CONFLICT: "DATABOOK_LD_CONFLICT",
    CHANGE_READY: "CHANGE_READY",
    CHANGE_INVALID: "CHANGE_INVALID",
    CHANGE_DUPLICATE: "CHANGE_DUPLICATE",
  });

  function text(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function norm(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeRecord(record) {
    const item = record || {};
    return {
      ...item,
      schemaVersion: SCHEMA_VERSION,
      document: text(item.document),
      documentKey: text(item.documentKey),
      sheet: text(item.sheet),
      row: Number(item.row) || 0,
      revision: text(item.revision),
      title: text(item.title),
      databook: text(item.databook),
      discipline: text(item.discipline),
      sourceRef: {
        file: text(item.source),
        sheet: text(item.sheet),
        row: Number(item.row) || 0,
      },
    };
  }

  function titleCode(row) {
    const item = row || {};
    if (item.issue === "ok") return CODES.TITLE_OK;
    if (item.issue === "empty") return CODES.TITLE_EMPTY;
    if (item.issue === "missing_tag") return CODES.TITLE_MISSING_TAG;
    if (item.issue === "wrong_tag") return CODES.TITLE_WRONG_TAG;
    if (item.issue === "description_mismatch") return CODES.TITLE_DESCRIPTION_MISMATCH;
    if (item.issue === "generic") return CODES.TITLE_GENERIC;
    if (item.issue === "format") return CODES.TITLE_FORMAT;
    if (item.issue === "possible_identifier") return CODES.TITLE_POSSIBLE_IDENTIFIER;
    if (item.issue === "conflict") return CODES.TITLE_LD_CONFLICT;
    return CODES.TITLE_UNSAFE;
  }

  function databookCode(row) {
    const item = row || {};
    if (item.issue === "ok") return CODES.DATABOOK_OK;
    if (item.issue === "missing") return CODES.DATABOOK_MISSING;
    if (item.issue === "divergent") return CODES.DATABOOK_DIVERGENT;
    if (item.issue === "conflict") return CODES.DATABOOK_LD_CONFLICT;
    return CODES.DATABOOK_UNCONFIRMED;
  }

  function titleMessage(row) {
    const item = row || {};
    const code = item.reasonCode || titleCode(item);
    const hasSuggestion = Boolean(text(item.proposed));
    const messages = {
      [CODES.TITLE_OK]: {
        severity: "success",
        title: "O título pode ser mantido.",
        explanation: "Não foi encontrada uma divergência que exija alteração.",
        nextAction: "Nenhuma ação é necessária.",
      },
      [CODES.TITLE_EMPTY]: {
        severity: "warning",
        title: "Este título precisa de revisão.",
        explanation: "A LD não informa um título válido para o documento.",
        nextAction: hasSuggestion ? "Confira a sugestão antes de aprovar." : "Preencha o título manualmente usando uma fonte confiável.",
      },
      [CODES.TITLE_MISSING_TAG]: {
        severity: "warning",
        title: "Este título precisa de revisão.",
        explanation: "Existe uma TAG comprovada que não aparece no título.",
        nextAction: hasSuggestion ? "Confira a sugestão e a fonte da TAG." : "Inclua a TAG somente depois de confirmar a fonte.",
      },
      [CODES.TITLE_WRONG_TAG]: {
        severity: "warning",
        title: "A TAG do título está incorreta.",
        explanation: "A TAG escrita no título não é exatamente a mesma definida no Grupo 7 do nome do documento.",
        nextAction: hasSuggestion ? "Confira a substituição pela TAG documental exata e aprove a correção." : "Substitua a TAG do título pela grafia exata do nome do documento.",
      },
      [CODES.TITLE_DESCRIPTION_MISMATCH]: {
        severity: "warning",
        title: "Este título precisa de revisão.",
        explanation: "A descrição validada não aparece no título atual.",
        nextAction: hasSuggestion ? "Compare o título atual com a sugestão." : "Consulte a base de referência antes de alterar.",
      },
      [CODES.TITLE_GENERIC]: {
        severity: "warning",
        title: "O título precisa de mais detalhes.",
        explanation: "O texto atual não explica com clareza o que é o documento.",
        nextAction: hasSuggestion ? "Confira se a sugestão descreve exatamente o item." : "Use a LD, o documento ou a norma para completar o título.",
      },
      [CODES.TITLE_FORMAT]: {
        severity: "info",
        title: "O título precisa de padronização.",
        explanation: "Existem espaços, separadores ou a palavra TAG fora do padrão.",
        nextAction: hasSuggestion ? "Confira a versão padronizada antes de aprovar." : "Ajuste somente a formatação, sem mudar o sentido.",
      },
      [CODES.TITLE_POSSIBLE_IDENTIFIER]: {
        severity: "info",
        title: "O identificador ainda não foi confirmado como TAG.",
        explanation: text(item.reason) || "O código do documento possui um identificador possível, mas nenhuma fonte controlada confirmou que seja uma TAG.",
        nextAction: "Confirme em um campo oficial ou referência controlada antes de alterar o título.",
      },
      [CODES.TITLE_UNSAFE]: {
        severity: "warning",
        title: "Não será alterado automaticamente.",
        explanation: "Não há informação suficiente para sugerir um título com segurança.",
        nextAction: "Consulte uma fonte válida e faça a revisão manual.",
      },
      [CODES.TITLE_LD_CONFLICT]: {
        severity: "warning",
        title: "Existem linhas diferentes na LD.",
        explanation: text(item.reason) || "As fontes controladas não informam os mesmos valores para este documento.",
        nextAction: "Confira as abas e linhas indicadas antes de revisar o título.",
      },
    };
    return { code, ...(messages[code] || messages[CODES.TITLE_UNSAFE]) };
  }

  function databookMessage(row) {
    const item = row || {};
    const code = item.reasonCode || databookCode(item);
    const hasSuggestion = Boolean(text(item.proposed));
    if (item.controlledSource && hasSuggestion) {
      return {
        code,
        severity: "success",
        title: "Caminho confirmado pela alocação.",
        explanation: `${text(item.controlledSourceKind) || "Fonte controlada"} localizada para ${text(item.allocation) || "a mesma alocação"}. O caminho será copiado exatamente como está no arquivo de origem.`,
        nextAction: "Gere a cópia da LD e use essa cópia atualizada no GRCON.",
      };
    }
    const messages = {
      [CODES.DATABOOK_OK]: {
        severity: "success",
        title: "O caminho pode ser mantido.",
        explanation: "O caminho atual foi confirmado pela base ou por documentos compatíveis.",
        nextAction: "Nenhuma alteração é necessária.",
      },
      [CODES.DATABOOK_MISSING]: {
        severity: "warning",
        title: "O caminho Databook precisa de revisão.",
        explanation: "A LD não possui um caminho completo para este documento.",
        nextAction: hasSuggestion ? "Confira a sugestão e os documentos usados como referência." : "Defina o caminho manualmente usando uma fonte confiável.",
      },
      [CODES.DATABOOK_DIVERGENT]: {
        severity: "warning",
        title: "O caminho atual foi preservado.",
        explanation: "O caminho está completo, mas outra referência indica uma possibilidade diferente. O RECON não fez substituição automática.",
        nextAction: "Compare as evidências e altere somente depois de confirmar o caminho correto.",
      },
      [CODES.DATABOOK_UNCONFIRMED]: {
        severity: "warning",
        title: "Não foi possível confirmar este caminho.",
        explanation: text(item.reason) || "A base não possui evidência suficiente para uma decisão segura.",
        nextAction: "Faça a conferência manual antes de alterar a LD.",
      },
      [CODES.DATABOOK_LD_CONFLICT]: {
        severity: "warning",
        title: "Existem linhas diferentes na LD.",
        explanation: text(item.reason) || "As fontes controladas não informam o mesmo Caminho Databook.",
        nextAction: "Confira as abas e linhas indicadas antes de alterar o caminho.",
      },
    };
    return { code, ...(messages[code] || messages[CODES.DATABOOK_UNCONFIRMED]) };
  }

  function normalizeChange(change) {
    const item = change || {};
    return {
      sheet: text(item.sheet || item.sheetName),
      row: Number(item.row || item.rowNumber) || 0,
      cell: text(item.cell || item.cellRef).toUpperCase(),
      oldValue: text(item.oldValue || item.current),
      newValue: text(item.newValue || item.value || item.proposed),
      document: text(item.document),
      kind: text(item.kind || "title"),
    };
  }

  function validateChangeSet(changes) {
    const normalized = (changes || []).map(normalizeChange);
    const errors = [];
    const seen = new Set();
    normalized.forEach((change, index) => {
      const label = change.document || `Alteração ${index + 1}`;
      if (!change.sheet) errors.push(`${label}: a aba não foi informada.`);
      if (!change.row) errors.push(`${label}: a linha não foi informada.`);
      if (!change.cell || !/^[A-Z]{1,3}\d+$/.test(change.cell)) errors.push(`${label}: a célula não é válida.`);
      if (!change.newValue) errors.push(`${label}: o novo valor está vazio.`);
      const key = `${norm(change.sheet)}::${change.cell}`;
      if (seen.has(key)) errors.push(`${label}: a mesma célula foi selecionada mais de uma vez.`);
      seen.add(key);
    });
    return { valid: errors.length === 0, errors, changes: normalized };
  }

  function enrichAuditRow(row) {
    const item = { ...(row || {}) };
    if (item.kind === "title") {
      const reasonCode = item.reasonCode || titleCode(item);
      return { ...item, reasonCode, userMessage: titleMessage({ ...item, reasonCode }) };
    }
    const reasonCode = item.reasonCode || databookCode(item);
    return { ...item, reasonCode, userMessage: databookMessage({ ...item, reasonCode }) };
  }

  return {
    SCHEMA_VERSION,
    CODES,
    text,
    norm,
    normalizeRecord,
    titleCode,
    databookCode,
    titleMessage,
    databookMessage,
    normalizeChange,
    validateChangeSet,
    enrichAuditRow,
  };
});
