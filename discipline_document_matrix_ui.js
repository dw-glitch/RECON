(function (root) {
  'use strict';
  const Core = root.DisciplineDocumentMatrix;
  const host = document.getElementById('discipline-matrix-root');
  if (!host || host.dataset.initialized) return;
  host.dataset.initialized = 'true';
  const app = document.documentElement.dataset.app || 'GRCON';
  const state = { sources: new Map(), snapshot: null, page: 0, imported: false, busy: false };
  host.innerHTML = `<header><span>CONFERÊNCIA COMPLEMENTAR</span><h2>Matriz documental por disciplina</h2><p>Compare as famílias de documentos das normas com as fontes do projeto. As pendências são alertas para conferência de escopo.</p></header>
  <div class="matrix-controls"><label>Disciplina<select id="matrix-discipline"><option value="">Selecione</option><option value="tubulacao">Tubulação · N-1692</option><option value="instrumentacao">Instrumentação · N-1883</option><option value="eletrica">Elétrica · N-2040</option><option value="civil">Civil: fundações e concreto · N-1784</option></select></label><label>Fase do projeto<select id="matrix-phase"><option value="">Selecione</option><option value="conceitual">Conceitual</option><option value="basico">Básico</option><option value="feed">Pré-detalhamento (FEED)</option><option value="executivo">Executivo / detalhamento</option></select></label><label>Recorte por EAP / escopo exato (opcional)<input id="matrix-scope" placeholder="Campo EAP ou ESCOPO da planilha"/></label></div>
  <p>Use fontes do mesmo projeto e pacote. A coluna DISCIPLINA deve conter o nome técnico; a classe de serviço do código não a substitui. Documentos Previstos com somente códigos complementam evidências da LD.</p>
  <div class="matrix-sources">${['LD','SCON','Escopo contratual','Documentos Previstos'].map((kind,i)=>`<label>${kind}<input id="matrix-file-${i}" type="file" accept=".xlsx,.xls,.csv" data-matrix-source="${kind}"/><small id="matrix-source-${i}">Nenhuma fonte adicional</small><button type="button" data-matrix-clear="${kind}">Remover fonte adicional</button></label>`).join('')}</div>
  <p>Planilhas: DOCUMENTO, TÍTULO (ou DESCRIÇÃO / ATIVIDADE), DISCIPLINA e, opcionalmente, CATEGORIA, EAP e REGRA MATRIZ. As abas e linhas de origem ficam registradas.</p>
  <div class="matrix-actions"><button id="matrix-analyze" type="button" class="primary-button" disabled>Conferir matriz</button><button id="matrix-json" type="button" class="secondary-button" disabled>Baixar relatório JSON</button><button id="matrix-csv" type="button" class="secondary-button" disabled>Baixar matriz CSV</button><label>Consultar relatório do GRCON / RECON<input id="matrix-import" type="file" accept=".json"/></label></div>
  <p id="matrix-status" role="status" aria-live="polite">Selecione a disciplina e a fase para iniciar.</p><p id="matrix-summary"></p><details><summary>Fontes, cobertura e limites</summary><div id="matrix-provenance"></div></details>
  <div class="matrix-table-scroll"><table><caption class="sr-only">Famílias documentais e evidências da matriz</caption><thead><tr><th>Norma e item</th><th>Documento esperado</th><th>Resultado e condição</th><th>Evidências nas fontes</th></tr></thead><tbody id="matrix-body"></tbody></table></div>
  <div class="matrix-pagination"><button type="button" id="matrix-prev" disabled>Anterior</button><span id="matrix-page"></span><button type="button" id="matrix-next" disabled>Próxima</button></div>`;
  const $ = id => host.querySelector('#'+id);
  function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
  function invalidate() { state.snapshot=null; state.imported=false; state.page=0; render(); }
  function nativeSources() {
    const sources = [];
    const ld = app === 'RECON' ? root.RECONRelations?.state?.parsed : root.GrconMatrixSources?.current?.();
    const records = ld?.records || [];
    if (records.length) sources.push({kind:'LD',name: app === 'RECON' ? root.RECONRelations.state.ldFile?.name || 'LD em Relações' : ld.name,records});
    const planned = root.GrconPlannedDocuments?.current?.();
    if (planned?.keys instanceof Set) sources.push({kind:'Documentos Previstos',name:planned.fileName || 'Base compartilhada',snapshotId:planned.id,records:[...planned.keys].map(document=>({document}))});
    const query=root.GrconSharedSigemQuery?.current?.();
    if (query?.records?.length) sources.push({kind:'Consulta Geral',name:query.meta?.fileName || 'Consulta Geral',snapshotId:query.meta?.snapshotId,records:query.records});
    return sources;
  }
  function render() {
    const snapshot=state.snapshot;
    for(const node of host.querySelectorAll('input,select,[data-matrix-clear]')) node.disabled=state.busy;
    $('matrix-analyze').disabled=state.busy || !$('matrix-discipline').value || !$('matrix-phase').value;
    $('matrix-json').disabled=$('matrix-csv').disabled=!snapshot || state.busy;
    $('matrix-body').replaceChildren(); $('matrix-provenance').replaceChildren();
    $('matrix-summary').textContent=snapshot ? `${snapshot.summary.total} famílias · ${snapshot.summary.identified} identificadas · ${snapshot.summary.alerts} alertas · 0 bloqueios` : '';
    $('matrix-page').textContent=snapshot?.rules.length ? `${state.page+1} / ${Math.ceil(snapshot.rules.length/50)}` : '';
    $('matrix-prev').disabled=!snapshot || state.page===0;
    $('matrix-next').disabled=!snapshot || (state.page+1)*50>=snapshot.rules.length;
    if (!snapshot) return;
    for (const [norm, source] of Object.entries(snapshot.normativeSources)) {
      $('matrix-provenance').append(text('p',`${norm} Rev. ${source.revision} · ${source.edition} · ${source.updates}. ${source.coverage} ${source.currency}`),text('small',`SHA-256 da cópia auditada: ${source.sha256}`));
    }
    $('matrix-provenance').append(text('p', snapshot.sources.map(s=>`${s.kind}: ${s.name} (${s.count} linhas${s.snapshotId ? '; versão '+s.snapshotId : ''})`).join(' · ') || 'Sem fontes carregadas.'));
    for (const limit of snapshot.limitations || []) $('matrix-provenance').append(text('p',limit));
    for (const result of snapshot.rules.slice(state.page*50,(state.page+1)*50)) {
      const tr=document.createElement('tr');
      tr.append(text('td',`${result.norm} Rev. ${result.revision} · ${result.section}`),text('td',`${result.label}${result.category ? ' ('+result.category+')' : ''}`));
      const decision=text('td',`${result.outcome}: ${result.message}`);decision.append(text('p',result.condition));tr.append(decision);
      const evidence=document.createElement('td');
      for (const [kind, list] of [['Identificada',result.evidence],['Candidata',result.candidates]]) for (const e of list) {
        evidence.append(text('p',`${kind} · ${e.source} · ${e.document || 'sem código'} · ${e.title || 'sem título'} · ${e.file || ''} ${e.sheet || ''}, linha ${e.row}${e.inPlannedDocuments === true ? ' · consta em Documentos Previstos' : ''}`));
      }
      if (!result.evidence.length && !result.candidates.length) evidence.append(text('p','Sem correspondência nas fontes carregadas.'));
      if (result.evidenceCount>20 || result.candidateCount>20) evidence.append(text('small','Exibidas as primeiras 20 evidências de cada grupo.'));
      tr.append(evidence);$('matrix-body').append(tr);
    }
  }
  function parseWorkbook(workbook, name) {
    const records=[];
    for (const sheet of workbook.SheetNames || []) {
      const rows=root.XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,defval:'',raw:false});
      const head=rows.slice(0,30).findIndex(row=>row.some(v=>['DOCUMENTO','CODIGO DO DOCUMENTO','CODIGO DOCUMENTO','TITULO','DESCRICAO','ATIVIDADE'].includes(Core.normalize(v))));
      if(head<0) continue;
      const keys=rows[head].map(Core.normalize);
      // Repeated ambiguous headers cannot silently choose a discipline or code.
      for (const key of ['DOCUMENTO','DISCIPLINA','TITULO','DESCRICAO','EAP','ESCOPO']) if(keys.filter(k=>k===key).length>1) throw new Error(`Cabeçalho ${key} repetido em ${sheet}. Ajuste uma cópia da fonte.`);
      for (let i=head+1;i<rows.length;i++) {
        const row=Object.fromEntries(keys.map((k,col)=>[k,rows[i][col]]));row.sheet=sheet;row.row=i+1;
        if(Core.record(row,{kind:'LD',name},i).document || Core.record(row,{kind:'LD',name},i).title) records.push(row);
        if(records.length>100000) throw new Error('Limite de 100.000 linhas por fonte. Divida por pacote.');
      }
    }
    if(!records.length) throw new Error('Nenhuma linha com DOCUMENTO, TÍTULO, DESCRIÇÃO ou ATIVIDADE encontrada.');
    return records;
  }
  for (const input of host.querySelectorAll('[data-matrix-source]')) input.addEventListener('change',async()=>{
    const file=input.files?.[0]; if(!file) return;
    state.busy=true;invalidate();$('matrix-status').textContent='Lendo fonte…';
    try {
      if(file.size>40*1024*1024) throw new Error('Limite de 40 MB por arquivo.');
      const records=parseWorkbook(root.XLSX.read(await file.arrayBuffer(),{type:'array',dense:true}),file.name);
      state.sources.set(input.dataset.matrixSource,{kind:input.dataset.matrixSource,name:file.name,records});
      input.parentElement.querySelector('small').textContent=`${file.name} · ${records.length} linhas`;
      $('matrix-status').textContent='Fonte carregada. Clique em Conferir matriz.';
    } catch(error) { $('matrix-status').textContent=`Fonte não atualizada: ${error.message}. A fonte anterior continua carregada.`; }
    finally {state.busy=false;render();input.value='';}
  });
  for(const button of host.querySelectorAll('[data-matrix-clear]')) button.addEventListener('click',()=>{state.sources.delete(button.dataset.matrixClear);button.parentElement.querySelector('small').textContent='Nenhuma fonte adicional';invalidate();$('matrix-status').textContent='Fonte adicional removida. Confira novamente.';});
  for(const id of ['matrix-discipline','matrix-phase','matrix-scope']) $(id).addEventListener('input',()=>{invalidate();$('matrix-status').textContent='Configuração alterada. Confira novamente.';});
  $('matrix-analyze').addEventListener('click',()=>{
    try {state.snapshot=Core.audit({app,discipline:$('matrix-discipline').value,phase:$('matrix-phase').value,scope:$('matrix-scope').value,sources:[...nativeSources(),...state.sources.values()]});state.imported=false;state.page=0;render();$('matrix-status').textContent='Conferência concluída. Identificação de família não certifica conteúdo ou completude.';}
    catch(error) {$('matrix-status').textContent=error.message;}
  });
  function download(content,type,extension) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=`matriz-${app.toLowerCase()}-${state.snapshot.context.discipline}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('matrix-json').addEventListener('click',()=>download(JSON.stringify(state.snapshot,null,2),'application/json','json'));
  $('matrix-csv').addEventListener('click',()=>download(Core.csv(state.snapshot),'text/csv;charset=utf-8','csv'));
  $('matrix-prev').addEventListener('click',()=>{state.page--;render();});$('matrix-next').addEventListener('click',()=>{state.page++;render();});
  $('matrix-import').addEventListener('change',async()=>{
    const file=$('matrix-import').files?.[0];if(!file)return;
    try {if(file.size>8*1024*1024)throw new Error('Relatório deve ter até 8 MB.');const snapshot=Core.readSnapshot(JSON.parse(await file.text()));state.snapshot=snapshot;state.imported=true;state.page=0;$('matrix-discipline').value=snapshot.context.discipline;$('matrix-phase').value=snapshot.context.phase;$('matrix-scope').value=snapshot.context.scope;render();$('matrix-status').textContent=`Relatório importado de ${snapshot.app || 'outro aplicativo'}, gerado em ${snapshot.generatedAt}. Evidências históricas declaradas no arquivo; confira novamente com fontes atuais.`;}
    catch(error){$('matrix-status').textContent=`Relatório não importado: ${error.message}`;}
    finally{$('matrix-import').value='';}
  });
  function sourceChanged(){if(!state.snapshot || state.imported)return;invalidate();$('matrix-status').textContent='As fontes do aplicativo foram alteradas. Confira novamente.';}
  for(const event of ['grcon:planned-documents-updated','grcon:shared-sigem-updated','grcon:matrix-sources-updated','recon:ui-update'])root.addEventListener(event,sourceChanged);
  render();
  root.DisciplineDocumentMatrixUi=Object.freeze({state,nativeSources,parseWorkbook});
})(window);
