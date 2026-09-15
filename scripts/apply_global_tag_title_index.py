from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, value):
    Path(path).write_text(value, encoding="utf-8")


def replace_once(path, old, new, label):
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: esperado 1 trecho em {path}, encontrado {count}")
    write(path, source.replace(old, new, 1))


replace_once(
    "audit_core.js",
    '''  const T = root.RECONDocumentTitleStandard || (typeof module === "object" && module.exports ? require("./document_title_standard.js") : null);
  const api = factory(C, A, R, F, S, N, T);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, A, R, F, S, N, T) {''',
    '''  const T = root.RECONDocumentTitleStandard || (typeof module === "object" && module.exports ? require("./document_title_standard.js") : null);
  const G = root.RECONGlobalTagTitleCore || (typeof module === "object" && module.exports ? require("./global_tag_title_core.js") : null);
  const api = factory(C, A, R, F, S, N, T, G);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONAuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C, A, R, F, S, N, T, G) {''',
    "adicionar núcleo global",
)

helpers = r'''
  const GLOBAL_TAG_FIELD_ALIASES = new Set([
    "TAG", "TAG EQUIPAMENTO", "TAG DO EQUIPAMENTO", "IDENTIFICACAO", "IDENTIFICADOR",
    "NUMERO DO EQUIPAMENTO", "TAG SCON", "SCON TAG",
  ].map(norm));
  const GLOBAL_DESCRIPTION_FIELD_ALIASES = new Set([
    "COMPLEMENTO DO TITULO", "TITULO", "TITULO DO DOCUMENTO", "DESCRICAO", "DESCRICAO COMPLETA",
    "NOME DO EQUIPAMENTO", "EQUIPAMENTO", "DENOMINACAO", "SERVICO", "ESCOPO",
  ].map(norm));

  function globalSemanticValues(entry, wanted) {
    if (!entry || typeof entry !== "object") return [];
    return Object.entries(entry)
      .filter(([field, value]) => wanted.has(norm(field)) && text(value))
      .map(([, value]) => text(value));
  }

  function globalGenericTags(entry) {
    const documentTag = extractTagFromDocument(entry && entry.document);
    const values = [entry && entry.tag, entry && entry.sconTag, entry && entry.equipmentTag, entry && entry.identifier, ...globalSemanticValues(entry, GLOBAL_TAG_FIELD_ALIASES), documentTag].filter(Boolean);
    return [...new Map(values.map((value) => [G ? G.normalizeTag(value) : norm(value), value]).filter(([key]) => key)).values()];
  }

  function globalGenericDescription(entry) {
    if (!entry) return "";
    const direct = [entry.titleComplement, entry.description, entry.title, entry.referenceDescription, entry.equipmentName, entry.equipment, entry.service, entry.scope];
    for (const value of [...direct, ...globalSemanticValues(entry, GLOBAL_DESCRIPTION_FIELD_ALIASES)]) {
      const candidate = referenceDescriptionCandidate(value) || usableDescription(value);
      if (candidate) return candidate;
    }
    return "";
  }

  function globalCatalogEntries(source) {
    if (!source) return [];
    if (Array.isArray(source.entries)) return source.entries;
    const catalog = source.catalog || source;
    if (Array.isArray(catalog.entries)) return catalog.entries;
    if (!Array.isArray(catalog.rows) || !Array.isArray(catalog.columns)) return [];
    return catalog.rows.map((row) => Object.fromEntries(catalog.columns.map((column, index) => [column, row && row[index]])));
  }

  function globalTagSourceSpecs(index, references) {
    if (!G) return [];
    const refs = references || {};
    const specs = [];
    const add = (spec) => { if (spec && Array.isArray(spec.entries) && spec.entries.length) specs.push(spec); };

    add({
      id: "scon", label: "SCON TAG SGP", kind: "official-catalog", priority: 100, confidence: "alta", entries: refs.scon && refs.scon.entries || [],
      tags: (entry) => [entry.sconTag, extractTagFromDocument(entry.document), ...((entry.tagAliases || []).map((item) => item.value))].filter(Boolean),
      description: (entry) => usableDescription(entry.titleComplement), document: (entry) => entry.document,
      documentKey: (entry) => entry.documentKey, discipline: (entry) => entry.discipline,
      eap: (entry) => documentEapFromGroup4(entry.document), row: (entry) => entry.row,
    });
    add({
      id: "appendix", label: "Apêndice 3 Rev.B", kind: "official-catalog", priority: 92, confidence: "alta", entries: refs.tagReference && refs.tagReference.entries || [],
      tags: (entry) => [entry.tag], description: (entry) => usableDescription(entry.description || entry.title),
      document: (entry) => entry.document, discipline: (entry) => entry.discipline, row: (entry) => entry.row,
    });
    add({
      id: "scon-scope", label: "SCON ESCOPO", kind: "official-scope", priority: 86, confidence: "alta", entries: refs.sconEscopo && refs.sconEscopo.entries || [],
      tags: (entry) => [entry.tag], description: (entry) => usableDescription(entry.subjectTitle || entry.cleanTitle || entry.title || entry.description),
      document: (entry) => entry.document, discipline: (entry) => entry.discipline, eap: (entry) => entry.eap, row: (entry) => entry.row,
    });
    add({
      id: "valve-list", label: "LI de válvulas", kind: "specialized-catalog", priority: 82, confidence: "alta", entries: refs.valveList && (refs.valveList.activeEntries || refs.valveList.entries) || [],
      tags: (entry) => [entry.tag], description: (entry) => usableDescription(entry.description),
      document: (entry) => entry.document, discipline: (entry) => entry.discipline, row: (entry) => entry.page || entry.row,
    });
    add({
      id: "valve-repair", label: "Mapa de VMs Reparo/Medição", kind: "specialized-map", priority: 78, confidence: "media", entries: refs.valveReparo && refs.valveReparo.entries || [],
      tags: (entry) => [entry.tag], description: (entry) => usableDescription(entry.description),
      document: (entry) => entry.document, discipline: (entry) => entry.discipline, row: (entry) => entry.row,
    });
    add({
      id: "controlled-titles", label: "Bases controladas de títulos", kind: "controlled-reference", priority: 74, confidence: "media", entries: refs.entries || [],
      tags: globalGenericTags, description: globalGenericDescription, document: (entry) => entry.document,
      documentKey: (entry) => entry.documentKey, discipline: (entry) => entry.discipline,
      eap: (entry) => entry.eap || documentEapFromGroup4(entry.document), row: (entry) => entry.row,
      confidenceFor: (entry) => entry.confidence || (entry.verifiedCatalog ? "alta" : "media"),
    });

    const historyEntries = [];
    (index && index.documents || []).forEach((match) => {
      const group = match.group || {};
      (group.history || []).forEach((entry) => historyEntries.push(entry));
    });
    add({
      id: "ld-history", label: "Histórico da LD", kind: "history", priority: 45, confidence: "baixa", entries: historyEntries,
      tags: globalGenericTags, description: (entry) => usableDescription(entry && entry.title), document: (entry) => entry.document,
      documentKey: (entry) => entry.documentKey, discipline: (entry) => entry.discipline,
      eap: (entry) => entry.eap || documentEapFromGroup4(entry.document), row: (entry) => entry.row,
    });

    (refs.globalSources || []).forEach((source, position) => add({
      id: source.id || `dynamic-${position + 1}`,
      label: source.label || source.name || source.id || `Base compatível ${position + 1}`,
      kind: source.kind || "dynamic-compatible", priority: Number(source.priority) || 65,
      confidence: source.confidence || "media", entries: globalCatalogEntries(source),
      tags: globalGenericTags, description: globalGenericDescription, document: (entry) => entry.document,
      documentKey: (entry) => entry.documentKey, discipline: (entry) => entry.discipline,
      eap: (entry) => entry.eap || documentEapFromGroup4(entry.document), row: (entry) => entry.row,
      column: (entry) => entry.column || entry.sourceColumn,
      confidenceFor: (entry) => entry.confidence || source.confidence || "media",
    }));
    return specs;
  }

  function buildGlobalTagIndex(index, references) {
    return G ? G.buildIndex(globalTagSourceSpecs(index, references)) : null;
  }

  function globalTagReferenceFor(record, globalIndex, tagEvidence) {
    if (!G || !globalIndex) return null;
    const group7 = tagEvidence && tagEvidence.group7 || reportGroup7Info(record && record.document);
    // REGRA ABSOLUTA: nt- é apenas marcador documental. Nunca participa da
    // chave de pesquisa. G.normalizeTag remove nt- de documento e de bases.
    const lookupTag = tagEvidence && tagEvidence.tag
      || group7 && group7.validTag && group7.tag
      || extractTagFromDocument(record && record.document)
      || tagEvidence && tagEvidence.possibleTag
      || "";
    if (!lookupTag) return { status: "not_applicable", statusLabel: G.statusLabel("not_applicable"), lookupTag: "", matches: [], matchedTags: [], sources: [], description: "", trusted: false };
    const matches = G.lookup(globalIndex, lookupTag);
    const selected = G.select(matches, {
      discipline: record && record.discipline || "",
      eap: documentEapFromGroup4(record && record.document),
      documentKey: record && record.documentKey || "",
    });
    const matchedTags = [...new Map(matches.map((item) => [G.normalizeTag(item.tag), item.tag]).filter(([key]) => key)).values()];
    const supporting = selected.supportingSources && selected.supportingSources.length ? selected.supportingSources : selected.sources || [];
    return {
      ...selected,
      lookupTag: G.normalizeTag(lookupTag),
      matchedTags,
      sourceLabel: supporting.join(" + ") || selected.primarySource || "",
      statusLabel: G.statusLabel(selected.status),
      trusted: selected.status === "reference_found" && Boolean(selected.description),
    };
  }

'''
replace_once("audit_core.js", "  function auditTitles(index, references, options) {", helpers + "  function auditTitles(index, references, options) {", "helpers globais")
replace_once("audit_core.js", '''    const previousTitleIndex = buildPreviousTitleIndex(index);
    return sourceRecords.map((record) => {''', '''    const previousTitleIndex = buildPreviousTitleIndex(index);
    const globalTagIndex = buildGlobalTagIndex(index, references);
    return sourceRecords.map((record) => {''', "índice único por análise")
replace_once("audit_core.js", '''      const tagEvidence = resolveTagEvidence(record, reference);
      const possibleIdentifier = tagEvidence.possibleTag;''', '''      const tagEvidence = resolveTagEvidence(record, reference);
      const globalTagReference = globalTagReferenceFor(record, globalTagIndex, tagEvidence);
      const possibleIdentifier = tagEvidence.possibleTag;''', "consulta global")
replace_once("audit_core.js", '''        ...((sconEscopoReference && sconEscopoReference.matchedAliases) || []),
        ...((tagReference && tagReference.matchedAliases) || []),''', '''        ...((sconEscopoReference && sconEscopoReference.matchedAliases) || []),
        ...((tagReference && tagReference.matchedAliases) || []),
        ...((globalTagReference && globalTagReference.matchedTags) || []),''', "TAGs globais")
replace_once("audit_core.js", '''        || tagReference && tagReference.trusted
      );''', '''        || tagReference && tagReference.trusted
        || globalTagReference && globalTagReference.trusted
      );''', "evidência externa global")
replace_once("audit_core.js", '      const titleTagConfirmed = Boolean(tagEvidence.confirmed || singleExternalTag);', '      const titleTagConfirmed = Boolean(tagEvidence.confirmed || singleExternalTag || globalTagReference && globalTagReference.matches && globalTagReference.matches.length);', "TAG confirmada globalmente")
replace_once("audit_core.js", '''      const appendixTitle = tagReference && tagReference.trusted ? usableDescription(tagReference.description || tagReference.title) : "";
      const trustedAppendix = Boolean(appendixTitle && tagReference && tagReference.trusted);''', '''      const appendixTitle = tagReference && tagReference.trusted ? usableDescription(tagReference.description || tagReference.title) : "";
      const trustedAppendix = Boolean(appendixTitle && tagReference && tagReference.trusted);
      const globalTagTitle = globalTagReference && globalTagReference.trusted ? usableDescription(globalTagReference.description) : "";
      const trustedGlobalTag = Boolean(globalTagTitle && globalTagReference && globalTagReference.trusted);''', "título global")
replace_once("audit_core.js", '''      const strongTagDescription = valveInDescription
        ? valveTitle
        : sconInDescription
          ? combineTitleDescriptions(sconTitleForDescription, sconCombinesWithAppendix ? appendixTitle : "")
          : appendixInDescription ? appendixTitle : "";''', '''      const specializedTagDescription = valveInDescription
        ? valveTitle
        : sconInDescription
          ? combineTitleDescriptions(sconTitleForDescription, sconCombinesWithAppendix ? appendixTitle : "")
          : appendixInDescription ? appendixTitle : "";
      const globalTagInDescription = Boolean(trustedGlobalTag && titleSourceMode === "auto");
      const strongTagDescription = globalTagInDescription
        ? (specializedTagDescription ? G.combineDescriptions(specializedTagDescription, globalTagTitle) : globalTagTitle)
        : specializedTagDescription;''', "composição global")
replace_once("audit_core.js", '      const externalTagDescription = strongTagDescription || (sconEscopoInDescription ? sconEscopoTitle : "");', '''      const externalTagDescription = strongTagDescription || (sconEscopoInDescription ? sconEscopoTitle : "");
      const globalTagUsed = Boolean(globalTagInDescription && globalTagTitle && (!specializedTagDescription || G.normalizeDescription(externalTagDescription) === G.normalizeDescription(globalTagTitle) || G.normalizeDescription(externalTagDescription).includes(G.normalizeDescription(globalTagTitle))));''', "marcar uso global")
replace_once("audit_core.js", '      if (issue !== "ok" && !proposed) reason += "; sem informação suficiente para sugerir com segurança";', '''      if (globalTagReference && globalTagReference.conflict && issue !== "ok") {
        classification = classification === "confirmed_error" ? "suggestion" : classification;
        if (!/conflito/i.test(reason)) reason += "; a mesma TAG possui descrições conflitantes entre bases e a fonte mais confiável foi priorizada";
      }
      if (issue !== "ok" && !proposed) reason += "; sem informação suficiente para sugerir com segurança";''', "alerta de conflito global")
replace_once("audit_core.js", '''        appendixSourceRows: tagReference && (tagReference.sourceRows || [tagReference.row]).filter(Boolean) || [],
        nonTaggedRule,''', '''        appendixSourceRows: tagReference && (tagReference.sourceRows || [tagReference.row]).filter(Boolean) || [],
        globalTagStatus: globalTagReference && globalTagReference.status || "not_applicable",
        globalTagStatusLabel: globalTagReference && globalTagReference.statusLabel || "TAG NÃO APLICÁVEL",
        globalTagLookup: globalTagReference && globalTagReference.lookupTag || "",
        globalTagFound: Boolean(globalTagReference && globalTagReference.matches && globalTagReference.matches.length),
        globalTagUsed,
        globalTagTitle,
        globalTagSource: globalTagReference && globalTagReference.sourceLabel || "",
        globalTagSources: globalTagReference && globalTagReference.sources || [],
        globalTagPrimarySource: globalTagReference && globalTagReference.primarySource || "",
        globalTagConflict: Boolean(globalTagReference && globalTagReference.conflict),
        globalTagConflicts: globalTagReference && globalTagReference.conflicts || [],
        globalTagTrace: globalTagReference && globalTagReference.trace || [],
        globalTagIndexSourceCount: globalTagIndex && globalTagIndex.sourceCount || 0,
        nonTaggedRule,''', "rastreabilidade global")
replace_once("audit_core.js", '''    upperCaseTitle,
    auditTitles,''', '''    upperCaseTitle,
    buildGlobalTagIndex,
    globalTagReferenceFor,
    auditTitles,''', "exportar helpers globais")

replace_once("audit_app.js", '''  function mergedTitleReferences() {
    const merged = mergeIndexedReferences(state.titleReferences, state.titleSupplementalReferences);
    merged.scon = state.sconTitleReferences || null;
    merged.sconEscopo = state.sconEscopoTitleReferences || null;
    merged.tagReference = state.tagReferenceTitleReferences || null;
    merged.valveList = state.valveListTitleReferences || null;
    merged.valveReparo = state.valveReparoTitleReferences || null;
    return merged;
  }''', '''  function compatibleGlobalSourcesFromBases() {
    const bases = window.RECONBases;
    if (!bases || typeof bases.list !== "function" || typeof bases.catalog !== "function") return [];
    const handled = new Set(["scon-tag-sgp", "scon-escopo", "tag-appendix"]);
    return (bases.list() || []).filter((item) => item && !handled.has(item.id)).map((item) => {
      const catalog = bases.catalog(item.id);
      if (!catalog) return null;
      return { id: `base:${item.id}`, label: item.label || item.id, kind: "recon-base", priority: 65, confidence: "media", catalog };
    }).filter(Boolean);
  }

  function mergedTitleReferences() {
    const merged = mergeIndexedReferences(state.titleReferences, state.titleSupplementalReferences);
    merged.scon = state.sconTitleReferences || null;
    merged.sconEscopo = state.sconEscopoTitleReferences || null;
    merged.tagReference = state.tagReferenceTitleReferences || null;
    merged.valveList = state.valveListTitleReferences || null;
    merged.valveReparo = state.valveReparoTitleReferences || null;
    merged.globalSources = compatibleGlobalSourcesFromBases();
    return merged;
  }''', "fontes dinâmicas da aba Bases")
replace_once("audit_app.js", '    if (row.learnedTitle) return "learned_memory";', '    if (row.learnedTitle) return "learned_memory";\n    if (row.globalTagUsed) return "global_tag";', "categoria global")
replace_once("audit_app.js", '      learned_memory: "Memória de correções (sua edição anterior)",', '      learned_memory: "Memória de correções (sua edição anterior)",\n      global_tag: row.globalTagSource ? `Busca global por TAG · ${row.globalTagSource}` : "Busca global por TAG",', "rótulo global")
replace_once("audit_app.js", '''      row.appendixTitle ? `Apêndice 3 Rev.B (${(row.appendixMatchedTags || []).join(", ") || row.tag || "TAG"}): ${cleanTitleReportValue(row.appendixTitle)}` : "",''', '''      row.appendixTitle ? `Apêndice 3 Rev.B (${(row.appendixMatchedTags || []).join(", ") || row.tag || "TAG"}): ${cleanTitleReportValue(row.appendixTitle)}` : "",
      row.globalTagTitle ? `Busca global por TAG (${row.globalTagSource || row.globalTagPrimarySource || "fonte compatível"}): ${cleanTitleReportValue(row.globalTagTitle)}${row.globalTagConflict ? " · CONFLITO ENTRE BASES IDENTIFICADO" : ""}` : row.globalTagStatusLabel ? row.globalTagStatusLabel : "",''', "evidência global na tela")
replace_once("audit_app.js", '''      row.appendixTitle ? `Descrição cadastrada no Apêndice 3: ${row.appendixTitle}` : "",''', '''      row.appendixTitle ? `Descrição cadastrada no Apêndice 3: ${row.appendixTitle}` : "",
      row.globalTagTitle ? `Melhor referência global da mesma TAG (${row.globalTagSource || row.globalTagPrimarySource || "base compatível"}): ${row.globalTagTitle}${row.globalTagConflict ? " — existem descrições conflitantes em outras bases" : ""}` : row.globalTagStatusLabel || "",''', "relatório global")
replace_once("audit_app.js", '      learned_memory: "Baseado em uma correção que você mesmo já aprovou antes, para o mesmo padrão de título.",', '''      learned_memory: "Baseado em uma correção que você mesmo já aprovou antes, para o mesmo padrão de título.",
      global_tag: row.globalTagConflict
        ? `A TAG foi pesquisada globalmente. A fonte prioritária foi ${row.globalTagPrimarySource || row.globalTagSource || "uma base controlada"}, mas existem descrições conflitantes em outras bases; confira antes de aprovar.`
        : `A TAG foi pesquisada globalmente em todas as bases elegíveis e a sugestão usa ${row.globalTagSource || row.globalTagPrimarySource || "a melhor referência disponível"}.`,''', "resumo da origem global")

replace_once("recon_module_loader.js", '"document_title_standard.js", "scon_catalog_loader.js",', '"document_title_standard.js", "global_tag_title_core.js", "scon_catalog_loader.js",', "loader do módulo de títulos")
replace_once("recon_compute_worker.js", '    "document_title_standard.js", "audit_core.js",', '    "document_title_standard.js", "global_tag_title_core.js", "audit_core.js",', "worker global tag")
replace_once(".github/workflows/validate.yml", '''      - name: Run allocation master hierarchy regression
        run: node ALLOCATION_HIERARCHY_TESTS.mjs''', '''      - name: Run allocation master hierarchy regression
        run: node ALLOCATION_HIERARCHY_TESTS.mjs

      - name: Run global TAG title regression
        run: node GLOBAL_TAG_TITLE_TESTS.mjs''', "CI global tag")

print("global TAG title patch applied")
