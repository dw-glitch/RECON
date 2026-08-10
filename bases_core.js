(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONBasesCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "recon.base-override.v1";

  // Quantas linhas do topo são inspecionadas à procura do cabeçalho. Planilhas
  // exportadas de sistema costumam trazer título, filtro e linha em branco
  // antes dos nomes de coluna; fixar o cabeçalho na linha 1 recusaria arquivos
  // legítimos.
  const HEADER_SCAN_DEPTH = 12;

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
      .replace(/\s+/g, " ");
  }

  // O casamento de cabeçalho ignora acento, caixa, espaço e pontuação: na
  // prática "Descrição Completa", "DESCRICAO_COMPLETA" e "descricao completa"
  // são o mesmo nome de coluna para quem preenche a planilha.
  function headerKey(value) {
    return norm(value).replace(/[^A-Z0-9]/g, "");
  }

  function column(key, label, aliases, required) {
    return Object.freeze({
      key,
      label,
      required: Boolean(required),
      aliases: Object.freeze([key, label].concat(aliases || []).map(headerKey).filter(Boolean)),
    });
  }

  // ===================== REGISTRO DAS BASES =====================
  // Cada descritor declara de onde vem a base incorporada, qual módulo a
  // consome e quais colunas um arquivo substituto precisa ter. Os números de
  // `bundled` são os mesmos que audit_app.js confere ao carregar as bases
  // incorporadas — é o que permite avisar quando a substituição muda o volume.

  const DESCRIPTORS = [
    {
      id: "titles-control",
      label: "Títulos controlados",
      summary: "Conclusões já aprovadas que servem de referência para corrigir títulos da LD.",
      consumer: "Corrigir títulos",
      kind: "workbook",
      offlineName: "Analise_descricoes_Planilha1.xlsx",
      bundled: { source: "Analise_descricoes_Planilha1.xlsx", sheet: "Análise Completa", count: 782, unit: "conclusões" },
      minRows: 1,
      columns: [],
    },
    {
      id: "databook-rev-a",
      label: "Caminho Databook Rev.A",
      summary: "Referências de caminho do Databook usadas na revisão dos caminhos sugeridos.",
      consumer: "Revisar Databook",
      kind: "workbook",
      offlineName: "Caminho data book_Rev.A VINI.xlsx",
      bundled: { source: "Caminho data book_Rev.A VINI.xlsx", sheet: "—", count: 158, unit: "referências" },
      minRows: 1,
      columns: [],
    },
    {
      id: "databook-rev-b",
      label: "Caminho Databook Rev.B",
      summary: "Revisão B do caminho de Databook, usada na alocação documental.",
      consumer: "Gerar alocação",
      kind: "workbook",
      offlineName: "Caminho data book_Rev.B_VINI.xlsx",
      bundled: { source: "Caminho data book_Rev.B_VINI.xlsx", sheet: "—", count: 0, unit: "referências" },
      minRows: 1,
      columns: [],
    },
    {
      id: "scon-tag-sgp",
      label: "SCON TAG SGP",
      summary: "Extrato do SGP que liga código documental, TAG e descrição por disciplina.",
      consumer: "Corrigir títulos",
      kind: "rows-catalog",
      schema: "recon.scon-tag-sgp.v1",
      bundled: { source: "SCON - TAG SGP 3.xlsm", sheet: "WRHDT_VW_EXTRATO_SGP", version: "2026-07-24", count: 19884, unit: "linhas" },
      minRows: 1,
      columns: [
        column("document", "Documento", ["codigo documental", "documento planilha1", "codigo"], true),
        column("fullDescription", "Descrição completa", ["descricao", "descricao completa", "titulo"], true),
        column("sconTag", "TAG SCON", ["tag"], false),
        column("titleComplement", "Complemento do título", ["complemento"], false),
        column("discipline", "Disciplina", [], false),
        column("itemType", "Tipo de item", ["tipo"], false),
        column("drawingReference", "Referência de desenho", ["desenho"], false),
        column("row", "Linha", [], false),
      ],
    },
    {
      id: "scon-escopo",
      label: "SCON ESCOPO",
      summary: "Mapa de escopo que casa TAG e EAP com o título de projeto.",
      consumer: "Corrigir títulos",
      kind: "rows-catalog",
      schema: "recon.scon-escopo-title-catalog.v2",
      bundled: { source: "SCON ESCOPO", sheet: "MAPA", count: 7798, unit: "linhas", tags: 3027, eaps: 71 },
      minRows: 1,
      columns: [
        column("tag", "TAG", [], true),
        column("title", "Título", ["descricao", "titulo do projeto"], true),
        column("discipline", "Disciplina", [], false),
        column("area", "Área", [], false),
        column("type", "Tipo", [], false),
        column("stage", "Etapa", ["fase"], false),
        column("eap", "EAP", ["wbs"], false),
        column("row", "Linha", [], false),
      ],
    },
    {
      id: "tag-appendix",
      label: "Apêndice 3 — bens tagueados",
      summary: "Anexo I do contrato com a denominação oficial de cada TAG fornecida.",
      consumer: "Conferir TAGs e Corrigir títulos",
      kind: "entries-catalog",
      schema: "recon.tag-reference-catalog.v1",
      bundled: {
        source: "01.03 UHDT-D_ANEXO I - Apêndice 3 - Fornecimento de Bens Tagueados Rev.B 2 1.xlsx",
        sheet: "Apêndice", revision: "B", count: 5682, unit: "TAGs",
      },
      minRows: 1,
      columns: [
        column("tag", "TAG", [], true),
        column("description", "Descrição", ["denominacao", "descricao do bem"], true),
        column("unit", "Unidade", [], false),
        column("discipline", "Disciplina", [], false),
        column("equipmentArea", "Área do equipamento", ["sistema"], false),
        column("responsible", "Responsável", [], false),
        column("criticality", "Criticidade", [], false),
        column("originalSupplier", "Fornecedor original", ["fornecedor"], false),
      ],
    },
    {
      // Única base sem versão incorporada: a ET é o documento contratual que
      // define o título normativo de cada código, e o RECON não pode embutir
      // uma cópia dela. Enquanto não for carregada, a análise segue como antes.
      id: "et-titles",
      label: "ET — títulos normativos",
      summary: "Especificação Técnica com o título oficial de cada código documental. É a fonte de maior prioridade do título recomendado.",
      consumer: "Corrigir títulos",
      kind: "rows-catalog",
      schema: "recon.et-title-catalog.v1",
      embedded: false,
      bundled: { source: "Nenhuma — carregue a sua ET", sheet: "—", count: 0, unit: "títulos" },
      minRows: 1,
      columns: [
        column("document", "Código documental", ["documento", "codigo", "documento planilha1", "codigo do documento"], true),
        column("title", "Título", ["descricao", "titulo do documento", "descricao do documento", "denominacao"], true),
        column("discipline", "Disciplina", [], false),
        column("documentType", "Tipo de documento", ["tipo"], false),
        column("row", "Linha", [], false),
      ],
    },
    {
      id: "allocation-template",
      label: "Modelo de alocação",
      summary: "Planilha modelo usada para montar o arquivo de alocação documental.",
      consumer: "Gerar alocação",
      kind: "workbook",
      bundled: { source: "C1O-ALOC-CM-0151-2026.xlsx", sheet: "GERAL", version: "2.1.0", count: 0, unit: "modelo" },
      minRows: 0,
      columns: [],
    },
  ].map((item) => Object.freeze({ ...item, columns: Object.freeze(item.columns) }));

  const BY_ID = new Map(DESCRIPTORS.map((item) => [item.id, item]));

  function descriptors() {
    return DESCRIPTORS.slice();
  }

  function descriptor(id) {
    return BY_ID.get(text(id)) || null;
  }

  // ===================== LEITURA DE UM ARQUIVO SUBSTITUTO =====================

  function requiredColumns(item) {
    return (item.columns || []).filter((entry) => entry.required);
  }

  function matchHeaderRow(item, row) {
    const keys = (row || []).map(headerKey);
    const found = new Map();
    (item.columns || []).forEach((entry) => {
      const index = keys.findIndex((key) => key && entry.aliases.includes(key));
      if (index >= 0 && !found.has(entry.key)) found.set(entry.key, index);
    });
    return found;
  }

  // Devolve a primeira linha que reconhece TODAS as colunas obrigatórias. Uma
  // linha que reconhece só parte delas não serve: seria um cabeçalho parcial e
  // o restante dos dados sairia deslocado sem ninguém perceber.
  function locateHeader(item, rows) {
    const limit = Math.min(rows.length, HEADER_SCAN_DEPTH);
    const needed = requiredColumns(item).map((entry) => entry.key);
    let best = null;
    for (let index = 0; index < limit; index += 1) {
      const found = matchHeaderRow(item, rows[index]);
      const complete = needed.every((key) => found.has(key));
      if (complete) return { index, found };
      if (!best || found.size > best.found.size) best = { index, found };
    }
    return best ? { ...best, incomplete: true } : null;
  }

  function missingColumns(item, found) {
    return requiredColumns(item)
      .filter((entry) => !found || !found.has(entry.key))
      .map((entry) => entry.label);
  }

  function availableHeaders(rows, headerIndex) {
    return (rows[headerIndex] || []).map(text).filter(Boolean);
  }

  function readCell(row, index) {
    if (index === undefined || index < 0) return "";
    return text(row[index]);
  }

  /**
   * Converte as linhas cruas de uma planilha no formato que os leitores do
   * audit_core já esperam, para que uma base substituída percorra exatamente o
   * mesmo caminho de código da base incorporada.
   *
   * @param {object} item descritor devolvido por descriptor(id)
   * @param {Array<Array<*>>} rows linhas da planilha (XLSX.utils.sheet_to_json com header: 1)
   * @param {object} [meta] origem informada pelo usuário (nome do arquivo e aba)
   */
  function buildCatalog(item, rows, meta) {
    if (!item) throw new Error("Base desconhecida.");
    if (item.kind === "workbook") throw new Error(`A base "${item.label}" é usada como planilha inteira e não passa por conversão de colunas.`);
    const source = Array.isArray(rows) ? rows : [];
    const located = locateHeader(item, source);
    const missing = missingColumns(item, located && located.found);
    if (!located || missing.length) {
      const headers = located ? availableHeaders(source, located.index) : [];
      const error = new Error(`Não encontrei a(s) coluna(s) ${missing.join(", ") || "obrigatória(s)"} na planilha.`);
      error.name = "RECONBaseColumnError";
      error.missing = missing;
      error.headers = headers;
      throw error;
    }

    const found = located.found;
    const body = source.slice(located.index + 1).filter((row) => Array.isArray(row) && row.some((cell) => text(cell)));
    const info = meta || {};
    const keys = (item.columns || []).map((entry) => entry.key);

    if (item.kind === "entries-catalog") {
      const entries = body.map((row, index) => {
        const entry = { row: index + located.index + 2 };
        keys.forEach((key) => { entry[key] = readCell(row, found.get(key)); });
        return entry;
      }).filter((entry) => entry.tag && entry.description);
      return {
        meta: {
          source: text(info.source) || item.bundled.source,
          sheet: text(info.sheet) || item.bundled.sheet,
          revision: item.bundled.revision || "",
          count: entries.length,
          title: item.label,
        },
        entries,
      };
    }

    const rowKeyIndex = keys.indexOf("row");
    const catalogRows = body.map((row, index) => keys.map((key) => (
      key === "row" && !found.has("row") ? index + located.index + 2 : readCell(row, found.get(key))
    )));
    const tagIndex = keys.indexOf("tag");
    const eapIndex = keys.indexOf("eap");
    const unique = (columnIndex) => (columnIndex < 0
      ? 0
      : new Set(catalogRows.map((row) => norm(row[columnIndex])).filter(Boolean)).size);

    return {
      schemaVersion: item.schema || SCHEMA_VERSION,
      sourceFile: text(info.source) || item.bundled.source,
      sheet: text(info.sheet) || item.bundled.sheet,
      version: text(info.version) || "",
      columns: keys,
      rows: catalogRows,
      rowCount: catalogRows.length,
      uniqueTagCount: unique(tagIndex),
      uniqueEapCount: unique(eapIndex),
      // Mantido para leitura humana no relatório: diz de qual linha da planilha
      // veio o primeiro registro, quando o cabeçalho não estava na linha 1.
      headerRow: located.index + 1,
      rowKeyDerived: rowKeyIndex >= 0 && !found.has("row"),
    };
  }

  /**
   * Compara o que foi lido com a base incorporada e classifica o resultado.
   * Divergência de volume nunca bloqueia: a base substituída é do usuário e
   * pode legitimamente ter outro tamanho. Ela vira aviso visível, porque uma
   * queda brusca de registros costuma ser aba errada, não escopo menor.
   */
  function review(item, built) {
    if (!item) throw new Error("Base desconhecida.");
    const count = built && (built.rowCount || (built.entries ? built.entries.length : 0)) || 0;
    const expected = Number(item.bundled && item.bundled.count) || 0;
    const errors = [];
    const warnings = [];

    if (count < (item.minRows || 1)) {
      errors.push(`A planilha não trouxe nenhum registro aproveitável para "${item.label}".`);
    }
    if (!errors.length && expected) {
      const ratio = count / expected;
      if (ratio < 0.5) warnings.push(`A base substituída tem ${count.toLocaleString("pt-BR")} registros contra ${expected.toLocaleString("pt-BR")} da incorporada. Confira se a aba escolhida é a certa.`);
      else if (ratio > 2) warnings.push(`A base substituída tem ${count.toLocaleString("pt-BR")} registros, mais que o dobro da incorporada (${expected.toLocaleString("pt-BR")}). Confira se não há linhas repetidas.`);
    }
    if (built && built.rowKeyDerived) {
      warnings.push("A planilha não tinha coluna de linha; o número foi derivado da posição de cada registro.");
    }

    return { valid: errors.length === 0, errors, warnings, count, expected };
  }

  // ===================== METADADOS GUARDADOS =====================

  function overrideRecord(item, details) {
    const info = details || {};
    return {
      schemaVersion: SCHEMA_VERSION,
      id: item.id,
      fileName: text(info.fileName),
      sheet: text(info.sheet),
      size: Number(info.size) || 0,
      count: Number(info.count) || 0,
      pinnedAt: Number(info.pinnedAt) || Date.now(),
      note: text(info.note),
    };
  }

  /**
   * Estado de uma base para exibição: junta o descritor com o registro
   * guardado, sem depender de DOM nem de IndexedDB, para poder ser testado.
   */
  function status(item, record) {
    if (!item) return null;
    const pinned = Boolean(record && record.id === item.id);
    // Uma base sem versão incorporada não pode ser descrita como "incorporada"
    // nem oferecer "restaurar": enquanto não for carregada, ela simplesmente
    // não existe para a análise.
    const embedded = item.embedded !== false;
    return {
      id: item.id,
      label: item.label,
      summary: item.summary,
      consumer: item.consumer,
      kind: item.kind,
      embedded,
      origin: pinned ? "substituida" : embedded ? "incorporada" : "ausente",
      originLabel: pinned
        ? (embedded ? "Substituída e fixada" : "Carregada e fixada")
        : embedded ? "Incorporada ao RECON" : "Não carregada",
      source: pinned ? record.fileName : item.bundled.source,
      sheet: pinned ? (record.sheet || "—") : (item.bundled.sheet || "—"),
      count: pinned ? Number(record.count) || 0 : Number(item.bundled.count) || 0,
      unit: item.bundled.unit || "registros",
      bundledCount: Number(item.bundled.count) || 0,
      pinnedAt: pinned ? Number(record.pinnedAt) || 0 : 0,
      replaceable: true,
    };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    HEADER_SCAN_DEPTH,
    descriptors,
    descriptor,
    headerKey,
    norm,
    locateHeader,
    missingColumns,
    buildCatalog,
    review,
    overrideRecord,
    status,
  });
});
