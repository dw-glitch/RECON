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
    const entries=[...(root.RECON_DATABOOK_CATALOG||[]),...(root.RECON_DATABOOK_B||[])];
    const seen=new Set();
    return entries.filter(entry=>{
      const key=`${norm(entry.databook)}|${norm(entry.description)}|${entry.rowNumber||''}`;
      if(!entry.databook||seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function render(){
    const code=byId('allocation-db-code')?.value||'';
    const title=byId('allocation-db-title')?.value||'';
    const out=byId('allocation-db-result');
    if(!out) return;
    out.hidden=false;
    if(!code.trim()&&!title.trim()){
      out.innerHTML='<p class="finder-empty"><strong>Informe o documento.</strong><span>Preencha o código, o título ou os dois campos para pesquisar.</span></p>';
      return;
    }
    const entries=catalog();
    if(!entries.length){
      out.innerHTML='<p class="finder-empty"><strong>Base ainda não carregada.</strong><span>Abra novamente o módulo Gerador de Alocação e repita a busca.</span></p>';
      return;
    }
    const ranked=entries.map(entry=>scoreEntry(entry,code,title)).filter(item=>item.score>=12).sort((a,b)=>b.score-a.score||b.coverage-a.coverage).slice(0,5);
    if(!ranked.length){
      out.innerHTML='<p class="finder-empty"><strong>Nenhuma referência compatível foi localizada.</strong><span>Revise o título ou faça a conferência pelo módulo Caminho Databook.</span></p>';
      return;
    }
    out.innerHTML=`<div class="finder-result-heading"><strong>${ranked.length} referência${ranked.length===1?'':'s'} encontrada${ranked.length===1?'':'s'}</strong><span>Ordenadas pela proximidade entre código, disciplina e título.</span></div>`+ranked.map((match,index)=>{
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
    }).join('');
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

  function clear(){
    ['allocation-db-code','allocation-db-title'].forEach(id=>{const input=byId(id);if(input) input.value='';});
    const out=byId('allocation-db-result');if(out){out.hidden=true;out.innerHTML='';}
    byId('allocation-db-code')?.focus();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    byId('allocation-db-search')?.addEventListener('click',render);
    byId('allocation-db-clear')?.addEventListener('click',clear);
    ['allocation-db-code','allocation-db-title'].forEach(id=>byId(id)?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();render();}}));
  });
})(window);
