(function (root, factory) {
  const api = factory(root.DisciplineDocumentCatalog || (typeof require === 'function' ? require('./discipline_document_catalog.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DisciplineDocumentMatrix = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog) {
  'use strict';
  const VERSION = 'discipline-matrix-1';
  const normalize = value => String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const documentKey = value => normalize(value).replace(/ /g, '');
  const stop = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'PARA', 'NA', 'NO', 'EM', 'ATRAVES', 'PROJETO']);
  function words(value) { return normalize(value).split(' ').filter(w => w && !stop.has(w)).map(w => w.length > 3 && w.endsWith('S') ? w.slice(0, -1) : w); }
  const criteria = new Map(catalog.rules.map(rule => [rule.id, (rule.terms.length ? rule.terms : [rule.label]).map(words)]));
  function discipline(value) {
    const key = normalize(value);
    return ({TUBULACAO:'tubulacao', TUBULACOES:'tubulacao', INSTRUMENTACAO:'instrumentacao', 'INSTRUMENTACAO E AUTOMACAO':'instrumentacao', 'INSTRUMENTACAO CONTROLE E AUTOMACAO':'instrumentacao', ELETRICA:'eletrica', ELETRICIDADE:'eletrica', CIVIL:'civil', 'CIVIL ESTRUTURAS':'civil', 'CIVIL E ESTRUTURAS':'civil', 'CONSTRUCAO CIVIL':'civil'})[key] || '';
  }
  function field(row, aliases) {
    for (const alias of aliases) if (row[alias] != null && String(row[alias]).trim()) return String(row[alias]).trim();
    const entries = Object.entries(row);
    for (const alias of aliases) { const found = entries.find(([key, val]) => normalize(key) === normalize(alias) && val != null && String(val).trim()); if (found) return String(found[1]).trim(); }
    return '';
  }
  function record(row, source, index) {
    const document = field(row, ['document', 'documentKey', 'DOCUMENTO', 'CODIGO DOCUMENTO', 'CODIGO DO DOCUMENTO']);
    const title = field(row, ['title', 'TITULO', 'TITULO DO DOCUMENTO', 'DESCRICAO', 'ATIVIDADE']);
    const category = normalize(field(row, ['documentType', 'CATEGORIA', 'TIPO DOCUMENTO'])) || (String(document).match(/^([A-Z]{2})[-_]/i) || [])[1] || '';
    return { document, title, discipline: discipline(field(row, ['discipline', 'DISCIPLINA'])), category: normalize(category), scope: normalize(field(row, ['scope', 'EAP', 'ESCOPO', 'AREA DO PROJETO'])), source: source.kind, file: source.name || '', row: row.row || row.sourceRow || index + 1, sheet: row.sheet || row.sourceSheet || '', requirementId: field(row, ['requirementId', 'REGRA MATRIZ']), tokens: words(title) };
  }
  function matches(item, rule) {
    if (item.requirementId) return item.requirementId === rule.id;
    if (!item.title) return false;
    if (item.category && rule.category && item.category !== rule.category) return false;
    return criteria.get(rule.id).some(term => term.every(word => item.tokens.includes(word)));
  }
  function audit(input) {
    if (!input || !['tubulacao','instrumentacao','eletrica','civil'].includes(input.discipline)) throw new Error('Selecione uma disciplina técnica. Classe de serviço não é disciplina.');
    if (!['conceitual','basico','feed','executivo'].includes(input.phase)) throw new Error('Selecione a fase do projeto.');
    const selected = catalog.rules.filter(r => r.discipline === input.discipline && (r.phase === input.phase || r.phase === '*'));
    const sources = (input.sources || []).filter(s => ['LD','SCON','Escopo contratual','Documentos Previstos','Consulta Geral'].includes(s.kind));
    const all = sources.flatMap(s => (s.records || []).map((row, i) => record(row, s, i))).filter(r => r.document || r.title);
    const scope = normalize(input.scope);
    const eligible = all.filter(r => (!r.discipline || r.discipline === input.discipline) && (!scope || r.scope === scope));
    const rules = selected.map(rule => {
      const matched = eligible.filter(r => matches(r, rule));
      const certain = matched.filter(r => r.discipline === input.discipline && r.document && ['LD','Escopo contratual','Documentos Previstos','Consulta Geral'].includes(r.source));
      const uncertain = matched.filter(r => !certain.includes(r));
      const evidence = certain.slice(0, 20).map(({tokens, requirementId, ...r}) => r);
      const candidates = uncertain.slice(0, 20).map(({tokens, requirementId, ...r}) => r);
      // Matching metadata establishes presence of a family, never document content compliance.
      const status = certain.length ? 'identified' : uncertain.length ? 'candidate' : 'not-identified';
      return { ruleId: rule.id, norm: rule.norm, revision: catalog.sources[rule.norm].revision, section: rule.section, label: rule.label, category: rule.category, normativeKind: rule.kind, condition: rule.condition, status, outcome: status === 'identified' ? 'INFORMAÇÃO' : 'ALERTA', evidence, candidates, evidenceCount: certain.length, candidateCount: uncertain.length, message: status === 'identified' ? 'Família documental identificada; conferir conteúdo, abrangência e aceite contratual.' : status === 'candidate' ? 'Possível correspondência; confirmar documento, disciplina e pertinência no escopo.' : 'Documento esperado pela norma, porém não identificado no escopo atual. Conferir pertinência, fontes e eventual dispensa.' };
    });
    // Code-only planned lists enrich existing evidence; they cannot establish type or discipline alone.
    const planned = new Set(sources.filter(s => s.kind === 'Documentos Previstos').flatMap(s => (s.records || []).map(r => documentKey(field(r,['document','documentKey','DOCUMENTO'])))).filter(Boolean));
    for (const rule of rules) for (const e of rule.evidence) e.inPlannedDocuments = sources.some(s=>s.kind==='Documentos Previstos') ? planned.has(documentKey(e.document)) : null;
    return { matrixVersion: VERSION, catalogVersion: catalog.version, generatedAt: new Date().toISOString(), app: input.app || '', policy: 'advisory-only', context: { discipline: input.discipline, phase: input.phase, scope: input.scope || '', applicability: 'operator-selected' }, sources: sources.map(s => ({kind:s.kind, name:s.name || '', snapshotId:s.snapshotId || '', count:(s.records || []).length})), normativeSources: Object.fromEntries([...new Set(selected.map(r => r.norm))].map(n => [n, {...catalog.sources[n], coverage:catalog.coverage[n]}])), summary: {total:rules.length, identified:rules.filter(r=>r.status==='identified').length, alerts:rules.filter(r=>r.outcome==='ALERTA').length, blocks:0}, limitations: ['Somente metadados; conteúdo, quantitativos, revisões, aceite e completude não certificados.', 'A matriz complementa LD, SCON, escopo contratual e Documentos Previstos e não altera alocação.', 'Ausência pode significar fonte incompleta, documento combinado, dispensa ou inaplicabilidade.', ...(scope ? ['O recorte exige EAP/escopo explicitamente idêntico; linhas sem esse campo ficam fora do recorte.'] : ['Sem recorte de EAP: confirme que as fontes pertencem ao projeto e pacote selecionados.']), ...(selected.length ? [] : ['Não há cobertura catalogada desta norma para a fase selecionada; não implica conformidade.'])], rules };
  }
  function readSnapshot(value) {
    if (!value || value.matrixVersion !== VERSION || value.catalogVersion !== catalog.version || value.policy !== 'advisory-only' || !value.context || !Array.isArray(value.rules) || value.rules.length > 250 || !value.normativeSources || value.summary?.blocks !== 0) throw new Error('Relatório de matriz inválido ou de outra versão.');
    if (!['tubulacao','instrumentacao','eletrica','civil'].includes(value.context.discipline) || !['conceitual','basico','feed','executivo'].includes(value.context.phase) || !Array.isArray(value.sources) || !Array.isArray(value.limitations)) throw new Error('Contexto do relatório inválido.');
    const expected = catalog.rules.filter(r => r.discipline === value.context.discipline && (r.phase === value.context.phase || r.phase === '*'));
    if (value.rules.length !== expected.length || new Set(value.rules.map(r=>r.ruleId)).size !== expected.length || value.rules.some(r => !expected.some(e => e.id === r.ruleId) || !['identified','candidate','not-identified'].includes(r.status) || !Array.isArray(r.evidence) || !Array.isArray(r.candidates) || r.evidence.length>20 || r.candidates.length>20)) throw new Error('O relatório não corresponde ao catálogo desta disciplina/fase.');
    for(const rule of expected) if(value.normativeSources[rule.norm]?.sha256 !== catalog.sources[rule.norm].sha256) throw new Error('A fonte normativa do relatório diverge da cópia auditada.');
    const snapshot=JSON.parse(JSON.stringify(value));
    snapshot.rules=snapshot.rules.map(r=>{ const canonical=expected.find(e=>e.id===r.ruleId); return {...r,norm:canonical.norm,revision:catalog.sources[canonical.norm].revision,section:canonical.section,label:canonical.label,condition:canonical.condition,outcome:r.status==='identified'?'INFORMAÇÃO':'ALERTA'}; });
    snapshot.summary={total:snapshot.rules.length,identified:snapshot.rules.filter(r=>r.status==='identified').length,alerts:snapshot.rules.filter(r=>r.outcome==='ALERTA').length,blocks:0};
    snapshot.normativeSources=Object.fromEntries([...new Set(expected.map(r=>r.norm))].map(n=>[n,{...catalog.sources[n],coverage:catalog.coverage[n]}]));
    return snapshot;
  }
  function csv(snapshot) {
    const rows = [['DISCIPLINA','FASE','NORMA','REVISAO','ITEM','DOCUMENTO ESPERADO','SITUACAO','RESULTADO','EVIDENCIAS','CANDIDATOS','CONDICAO','VERSAO MATRIZ'], ...snapshot.rules.map(r=>[snapshot.context.discipline,snapshot.context.phase,r.norm,r.revision,r.section,r.label,r.status,r.outcome,r.evidence.map(e=>`${e.source}: ${e.document} / ${e.title}`).join(' | '),r.candidates.map(e=>`${e.source}: ${e.document} / ${e.title}`).join(' | '),r.condition,snapshot.matrixVersion])];
    return '\uFEFF' + rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^(\s*[=+@-])/,'\'$1').replace(/"/g,'""')+'"').join(';')).join('\r\n');
  }
  return Object.freeze({VERSION, catalog, normalize, discipline, record, audit, readSnapshot, csv});
});
