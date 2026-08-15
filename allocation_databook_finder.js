(function(root){
  'use strict';

  const byId=(id)=>document.getElementById(id);
  const text=(value)=>String(value==null?'':value);
  const norm=(value)=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const words=(value)=>norm(value).split(/\s+/).filter(Boolean);
  const STOP=new Set(['C1O','RNEST','U32','UHDT','UHDTD','DOCUMENTO','DOCUMENTOS','RELATORIO','RELATORIOS','DE','DA','DO','DAS','DOS','E','EM','PARA','POR','COM','SEM','REV','REVISAO','PDF','XLSX','ANEXO','SISTEMA','UNIDADE']);
  const DISCIPLINES={
    TUB:['TUBULACAO'], TUBULACAO:['TUBULACAO'],
    CVL:['CIVIL'], CIV:['CIVIL'], CIVIL:['CIVIL'],
    ELE:['ELETRICA'], ELT:['ELETRICA'], ELETRICA:['ELETRICA'],
    INS:['INSTRUMENTACAO'], INST:['INSTRUMENTACAO'], INSTRUMENTACAO:['INSTRUMENTACAO'],
    MEC:['MECANICA'], MECA:['MECANICA'], MECANICA:['MECANICA'],
    EQP:['EQUIPAMENTOS'], EQUIPAMENTO:['EQUIPAMENTOS'], EQUIPAMENTOS:['EQUIPAMENTOS'],
    EST:['ESTRUTURA','ESTRUTURAS'], ESTRUTURA:['ESTRUTURA','ESTRUTURAS'],
    PINT:['PINTURA'], PINTURA:['PINTURA'],
    SEG:['SEGURANCA'], SMS:['SEGURANCA'],
    HVAC:['HVAC','AR CONDICIONADO','VENTILACAO'],
  };
  const DOCUMENT_TYPES={
    PR:['PROCEDIMENTO','PROCEDIMENTOS'], REP:['RELATORIO','RELATORIOS'], RIR:['INSPECAO','RECEBIMENTO'],
    DES:['DESENHO','DESENHOS'], DWG:['DESENHO','DESENHOS'], CERT:['CERTIFICADO','CERTIFICADOS'],
    PIT:['PLANO DE INSPECAO','TESTE'], ITP:['PLANO DE INSPECAO','TESTE'],
    PPT:['PREPARACAO PARA TRANSPORTE','TRANSPORTE'],
  };

  function unique(items){return [...new Set(items.filter(Boolean))];}
  function meaningfulTokens(value){return unique(words(value).filter(token=>token.length>2&&!STOP.has(token)&&!/^(19|20)\d{2}$/.test(token)&&!/^\d+$/.test(token)));}
  function codeSignals(code){
    const raw=words(code);
    const direct=meaningfulTokens(code);
    const expanded=[];
    raw.forEach(token=>{
      (DISCIPLINES[token]||[]).forEach(item=>expanded.push(item));
      (DOCUMENT_TYPES[token]||[]).forEach(item=>expanded.push(item));
    });
    return {direct,expanded:unique(expanded),raw};
  }
  function titlePhrases(title){
    const t=meaningfulTokens(title);
    const phrases=[];
    for(let i=0;i<t.length-1;i+=1) phrases.push(`${t[i]} ${t[i+1]}`);
    return {tokens:t,phrases};
  }
  function contains(hay,needle){return needle&&(` ${hay} `).includes(` ${needle} `);}

  function scoreEntry(entry, code, title){
    const description=norm(entry.description);
    const notes=norm(entry.notes);
    const databook=norm(entry.databook);
    const hay=`${description} ${notes} ${databook}`.trim();
    const codeInfo=codeSignals(code);
    const titleInfo=titlePhrases(title);
    let score=0;
    let titleHits=0;
    let codeHits=0;
    const reasons=[];

    if(titleInfo.tokens.length){
      const normalizedTitle=norm(title);
      if(normalizedTitle.length>8&&(description.includes(normalizedTitle)||notes.includes(normalizedTitle))){score+=80;reasons.push('título completo');}
      titleInfo.tokens.forEach(token=>{
        if(contains(description,token)){score+=9;titleHits+=1;}
        else if(contains(notes,token)){score+=7;titleHits+=1;}
        else if(contains(databook,token)){score+=4;titleHits+=1;}
      });
      titleInfo.phrases.forEach(phrase=>{
        if(description.includes(phrase)){score+=15;reasons.push(`expressão “${phrase.toLowerCase()}”`);}
        else if(notes.includes(phrase)){score+=10;}
      });
    }

    codeInfo.expanded.forEach(signal=>{
      if(contains(databook,signal)){score+=16;codeHits+=1;reasons.push(signal.toLowerCase());}
      else if(contains(description,signal)||contains(notes,signal)){score+=11;codeHits+=1;}
    });
    codeInfo.direct.forEach(token=>{
      if(contains(description,token)||contains(notes,token)){score+=4;codeHits+=1;}
      else if(contains(databook,token)){score+=2;codeHits+=1;}
    });

    if(titleInfo.tokens.length>=3&&titleHits===0) score-=18;
    if(codeInfo.expanded.length&&codeHits===0) score-=8;
    const coverage=titleInfo.tokens.length?titleHits/titleInfo.tokens.length:0;
    if(coverage>=.65){score+=18;reasons.push('boa cobertura do título');}
    else if(coverage>=.4){score+=8;}

    return {entry,score,titleHits,codeHits,coverage,reasons:unique(reasons)};
  }

  function confidence(match){
    if(match.score>=78&&match.coverage>=.55) return {key:'strong',label:'Correspondência forte',help:'O título e a disciplina convergem com a referência.'};
    if(match.score>=42&&(match.titleHits>=2||match.codeHits>=1)) return {key:'possible',label:'Correspondência possível',help:'Há sinais relevantes, mas confira o caminho antes de usar.'};
    return {key:'low',label:'Baixa confiança',help:'Use somente como pista e valide na base ou no histórico de alocação.'};
  }

  function escapeHtml(value){return text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function escapeAttr(value){return escapeHtml(value);}

  function catalog(){
    const activeEntries=root.RECONAllocation&&root.RECONAllocation.state&&root.RECONAllocation.state.catalogEntries||[];
    const entries=[...activeEntries,...(root.RECON_DATABOOK_CATALOG||[]),...(root.RECON_DATABOOK_B||[])];
    const seen=new Set();
    return entries.filter(entry=>{
      const key=`${norm(entry.databook)}|${norm(entry.description)}|${entry.rowNumber||''}`;
      if(!entry.databook||seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function looksLikeDocumentCode(value){
    const raw=text(value).trim().replace(/^['"]|['"]$/g,'');
    if(raw.length<7||/\s/.test(raw)) return false;
    return /^C1O[_-]/i.test(raw)||/^\d{4}\.\d{2}-/.test(raw)||(raw.match(/_/g)||[]).length>=2;
  }

  function parseQueryLine(line,index){
    const raw=text(line).trim().replace(/^\s*[•*-]\s+/,'');
    if(!raw) return null;
    const cells=raw.split(/\t+|\s*[;|]\s*/).map(item=>item.trim()).filter(Boolean);
    if(cells.length>=2&&looksLikeDocumentCode(cells[0])) return {code:cells[0],title:cells.slice(1).join(' '),raw,lineNumber:index+1};
    const spaced=raw.match(/^([^\s]+)\s+(.*)$/);
    if(spaced&&looksLikeDocumentCode(spaced[1])) return {code:spaced[1],title:spaced[2].replace(/^[-–—:]\s*/,''),raw,lineNumber:index+1};
    if(looksLikeDocumentCode(raw)) return {code:raw,title:'',raw,lineNumber:index+1};
    return {code:'',title:raw,raw,lineNumber:index+1};
  }

  function parseQueries(value){
    const seen=new Set();
    return text(value).split(/\r?\n/).map(parseQueryLine).filter(query=>{
      if(!query) return false;
      const normalized=norm(query.raw);
      if(/^(DOCUMENTO|CODIGO)( TITULO)?$/.test(normalized)||normalized==='TITULO') return false;
      const queryKey=`${norm(query.code)}|${norm(query.title)}`;
      if(seen.has(queryKey)) return false;
      seen.add(queryKey);
      return true;
    });
  }

  function rankQuery(entries,query,limit){
    const titleTokenCount=titlePhrases(query&&query.title).tokens.length;
    return (entries||[]).map(entry=>scoreEntry(entry,query.code,query.title))
      .filter(item=>item.score>=12&&(!titleTokenCount||item.titleHits>0))
      .sort((a,b)=>b.score-a.score||b.coverage-a.coverage)
      .slice(0,limit||3);
  }

  function matchMarkup(match,index){
    const level=confidence(match);
    const entry=match.entry;
    const evidence=[entry.sourceSheet?`aba ${entry.sourceSheet}`:'',entry.rowNumber?`linha ${entry.rowNumber}`:''].filter(Boolean).join(' · ');
    const reason=match.reasons.length?match.reasons.slice(0,3).join(' · '):level.help;
    return `<article class="finder-match ${index===0?'best':''} confidence-${level.key}">
      <div class="finder-match-main"><span class="finder-rank">${index===0?'Melhor resultado':`Alternativa ${index+1}`}</span><strong>${escapeHtml(entry.description||'Referência Databook')}</strong><small>Base Rev. B${evidence?` · ${escapeHtml(evidence)}`:''}</small></div>
      <span class="finder-confidence ${level.key}" title="${escapeAttr(level.help)}">${escapeHtml(level.label)}</span>
      <p class="finder-path">${escapeHtml(entry.databook)}</p>
      <p class="finder-reason">Evidência: ${escapeHtml(reason)}</p>
      <button type="button" class="secondary-button compact finder-copy" data-value="${escapeAttr(entry.databook)}">Copiar caminho</button>
    </article>`;
  }

  function bindCopyButtons(out){
    out.querySelectorAll('.finder-copy').forEach(button=>button.addEventListener('click',async()=>{
      const original=button.textContent;
      try{
        await navigator.clipboard.writeText(button.dataset.value||'');
        button.textContent='Caminho copiado';
      }catch(_){
        const area=document.createElement('textarea');area.value=button.dataset.value||'';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();button.textContent='Caminho copiado';
      }
      setTimeout(()=>{button.textContent=original;},1400);
    }));
  }

  async function render(){
    const queries=parseQueries(byId('allocation-db-query')?.value||'');
    const out=byId('allocation-db-result');
    if(!out) return;
    out.hidden=false;
    if(!queries.length){
      out.innerHTML='<p class="finder-empty"><strong>Informe pelo menos um documento.</strong><span>Cole uma linha por documento, preferencialmente com o título na segunda coluna.</span></p>';
      return;
    }
    let entries=catalog();
    if(!entries.length&&root.RECONModuleLoader&&root.RECONModuleLoader.ensureModule){
      try{await root.RECONModuleLoader.ensureModule('allocation');entries=catalog();}catch(_){}
    }
    if(!entries.length){
      out.innerHTML='<p class="finder-empty"><strong>Base Databook indisponível.</strong><span>Não foi possível carregar a base incorporada. Reabra o módulo Gerador de Alocação e tente novamente.</span></p>';
      return;
    }
    const analyzed=queries.map(query=>({query,ranked:rankQuery(entries,query,3)}));
    const found=analyzed.filter(item=>item.ranked.length).length;
    out.innerHTML=`<div class="finder-result-heading"><strong>${queries.length} documento${queries.length===1?'':'s'} analisado${queries.length===1?'':'s'}</strong><span>${found} com sugestão · ${queries.length-found} sem referência segura</span></div>`+analyzed.map(({query,ranked})=>{
      const title=query.title||'Título não informado';
      const code=query.code||`Linha ${query.lineNumber} — consulta somente por título`;
      const matches=ranked.length?ranked.map(matchMarkup).join(''):'<p class="finder-empty"><strong>Nenhuma referência segura foi localizada para esta linha.</strong><span>Confira o código e o título ou valide manualmente no módulo Caminho Databook.</span></p>';
      return `<section class="finder-query-group"><header class="finder-query-heading"><strong>${escapeHtml(code)}</strong><span>${escapeHtml(title)}</span></header><div class="finder-query-matches">${matches}</div></section>`;
    }).join('');
    bindCopyButtons(out);
  }

  function clear(){
    const input=byId('allocation-db-query');if(input) input.value='';
    const out=byId('allocation-db-result');if(out){out.hidden=true;out.innerHTML='';}
    byId('allocation-db-query')?.focus();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    byId('allocation-db-search')?.addEventListener('click',()=>{render();});
    byId('allocation-db-clear')?.addEventListener('click',clear);
    byId('allocation-db-query')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();render();}});
  });
  root.RECONDatabookFinder=Object.freeze({parseQueries,rankQuery,scoreEntry,confidence,catalog});
})(window);
