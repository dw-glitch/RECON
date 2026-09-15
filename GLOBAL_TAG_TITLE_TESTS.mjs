import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const G = require("./global_tag_title_core.js");
const C = require("./core.js");

assert.equal(G.normalizeTag("NF-228452"), "NF-228452");
assert.equal(G.normalizeTag("nf - 228452"), "NF-228452");
assert.equal(G.normalizeTag("NF–228452"), "NF-228452");
assert.equal(G.normalizeTag(" nt-NF-228452 "), "NF-228452");
assert.notEqual(G.normalizeTag("NF-22845"), G.normalizeTag("NF-228452"));

function source(id, label, priority, entries) {
  return {
    id,
    label,
    priority,
    confidence: priority >= 90 ? "alta" : priority >= 65 ? "media" : "baixa",
    entries,
    tags: (entry) => [entry.tag],
    description: (entry) => entry.description || "",
    document: (entry) => entry.document || "",
    discipline: (entry) => entry.discipline || "",
    eap: (entry) => entry.eap || "",
    row: (entry) => entry.row || 0,
  };
}

const scon = source("scon", "SCON", 100, [
  { tag: "NF-100", description: "BOMBA CENTRÍFUGA", document: "DOC-SCON-OUTRO", discipline: "MEC" },
  { tag: "NF-200", description: "TUBOS", document: "DOC-SCON-OUTRO", discipline: "TUB" },
  { tag: "NF-300", description: "TUBOS", document: "DOC-SCON-MESMO", discipline: "TUB" },
]);
const appendix = source("appendix", "Apêndice", 92, [
  { tag: "NF-200", description: "TUBOS ASTM A106", document: "DOC-APENDICE" },
  { tag: "NF-400", description: "VÁLVULA GAVETA", document: "DOC-APENDICE" },
]);
const scope = source("scope", "SCON Escopo", 86, [
  { tag: "NF-500", description: "TUBOS DE PROCESSO", document: "DOC-ESCOPO", eap: "10.2.1.2" },
]);
const conflict = source("other", "Base Secundária", 70, [
  { tag: "NF-100", description: "TROCADOR DE CALOR", document: "DOC-OUTRO" },
]);
const noDescription = source("nod", "Base sem descrição", 65, [
  { tag: "NF-600", description: "", document: "DOC-SEM-DESC" },
]);

const index = G.buildIndex([scon, appendix, scope, conflict, noDescription]);

// 1 e 2 — SCON encontra no mesmo documento ou em outro documento pela mesma TAG.
assert.equal(G.lookup(index, "NF-300").length, 1);
assert.equal(G.lookup(index, "NF-100")[0].document, "DOC-SCON-OUTRO");

// 3 — sem SCON, Apêndice continua válido.
let selected = G.select(G.lookup(index, "NF-400"), {});
assert.equal(selected.status, "reference_found");
assert.equal(selected.description, "VÁLVULA GAVETA");
assert.equal(selected.primarySource, "Apêndice");

// 4 — sem SCON/Apêndice, SCON Escopo é utilizado.
selected = G.select(G.lookup(index, "NF-500"), { eap: "10.2.1.2" });
assert.equal(selected.description, "TUBOS DE PROCESSO");
assert.equal(selected.primarySource, "SCON Escopo");

// 5 e 12 — uma nova base compatível entra no índice sem mudar o algoritmo.
const dynamic = source("dynamic", "Base Nova Compatível", 68, [
  { tag: "NF-700", description: "FILTRO DE PROCESSO", document: "DOC-NOVO" },
]);
const dynamicIndex = G.buildIndex([dynamic]);
assert.equal(G.select(G.lookup(dynamicIndex, "NF-700"), {}).description, "FILTRO DE PROCESSO");

// 6 — informações complementares: a descrição mais completa vence sem duplicar.
selected = G.select(G.lookup(index, "NF-200"), {});
assert.equal(selected.description, "TUBOS ASTM A106");
assert.ok(selected.sources.includes("SCON"));
assert.ok(selected.sources.includes("Apêndice"));

// 7 — textos duplicados não viram "TUBOS - TUBOS".
const duplicateIndex = G.buildIndex([
  source("a", "A", 90, [{ tag: "NF-800", description: "TUBOS" }]),
  source("b", "B", 80, [{ tag: "NF-800", description: "TUBOS" }]),
]);
selected = G.select(G.lookup(duplicateIndex, "NF-800"), {});
assert.equal(selected.description, "TUBOS");

// 8 — conflito não concatena descrições contraditórias; mantém a fonte forte e sinaliza.
selected = G.select(G.lookup(index, "NF-100"), {});
assert.equal(selected.description, "BOMBA CENTRÍFUGA");
assert.equal(selected.conflict, true);
assert.ok(selected.conflicts.some((item) => item.description === "TROCADOR DE CALOR"));

// 9 — não encontrada só depois de consultar o índice global completo.
selected = G.select(G.lookup(index, "NF-999"), {});
assert.equal(selected.status, "not_found");
assert.equal(G.statusLabel(selected.status), "TAG NÃO ENCONTRADA EM NENHUMA BASE DISPONÍVEL");

// Estado distinto: TAG existe, mas a base não traz descrição aproveitável.
selected = G.select(G.lookup(index, "NF-600"), {});
assert.equal(selected.status, "found_without_description");
assert.equal(G.statusLabel(selected.status), "TAG ENCONTRADA, MAS SEM DESCRIÇÃO VÁLIDA");

// 10 — formatação diferente continua casando.
assert.equal(G.lookup(index, "nf - 200").length, 2);

// 11 — parecido parcialmente não é correspondência.
assert.equal(G.lookup(index, "NF-20").length, 0);

// Integração: Corrigir Títulos deve usar uma base genérica quando as fontes
// tradicionais não possuem a TAG, inclusive se a referência pertencer a outro documento.
const Q = require("./audit_core.js");
const document = "C1O_RNEST_U32_10.2.1.2_TUB_RIR_nt-NF-228452-Tubos";
const record = {
  document,
  documentKey: C.key(document),
  sheet: "LD_001",
  row: 7,
  discipline: "TUB",
  revision: "0",
  title: "RELATORIO DE INSPECAO DE RECEBIMENTO - VALVULA - NF-228452",
  ldColumns: [],
};
const auditIndex = {
  documents: [{
    document,
    documentKey: record.documentKey,
    group: { records: [record], history: [] },
  }],
};
const references = {
  entries: [],
  byDocument: new Map(),
  byTagDiscipline: new Map(),
  scon: null,
  sconEscopo: null,
  tagReference: null,
  valveList: null,
  valveReparo: null,
  globalSources: [{
    id: "auxiliar",
    label: "Base Auxiliar",
    priority: 72,
    entries: [{
      tag: "NF-228452",
      description: "TUBOS",
      document: "C1O_RNEST_U32_10.2.1.9_TUB_RIR_nt-NF-228452-OUTRO",
      discipline: "TUB",
      eap: "10.2.1.9",
      row: 12,
    }],
  }],
};
const rows = Q.auditTitles(auditIndex, references, {});
assert.equal(rows.length, 1);
assert.equal(rows[0].globalTagStatus, "reference_found");
assert.equal(rows[0].globalTagUsed, true);
assert.equal(rows[0].globalTagTitle, "TUBOS");
assert.match(rows[0].proposed, /TUBOS/);
assert.match(rows[0].proposed, /NF-228452/);

console.log("GLOBAL_TAG_TITLE_TESTS: OK");