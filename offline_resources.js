(function(root){"use strict";
  const entries=new Map(), urls=new Map(), loads=new Map();
  const manifest=Object.freeze({"Analise_descricoes_Planilha1.xlsx":"offline_recon_audit_bases.js","Caminho data book_Rev.A VINI.xlsx":"offline_recon_audit_bases.js","Caminho data book_Rev.C.xlsx":"offline_recon_databook_c.js","Caminho das Pastas UHDTD.xlsx":"offline_recon_eap_paths.js","pdf.worker.min.js":"offline_recon_pdf_worker.js"});
  function register(source){Object.entries(source||{}).forEach(([name,item])=>entries.set(name,Object.freeze(item))); return api;}
  function loadScript(src){
    if(loads.has(src)) return loads.get(src);
    const promise=new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(node=>node.dataset.offlineChunk===src||String(node.getAttribute("src")||"").split("?")[0].endsWith(src));
      if(existing){ if(existing.dataset.loaded==="true") resolve(); else {existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",()=>reject(new Error(`Falha ao carregar ${src}`)),{once:true});} return; }
      const script=document.createElement("script"); script.src=src; script.async=false; script.dataset.offlineChunk=src;
      script.addEventListener("load",()=>{script.dataset.loaded="true";resolve();},{once:true});
      script.addEventListener("error",()=>reject(new Error(`Falha ao carregar ${src}`)),{once:true});
      document.head.appendChild(script);
    }).finally(()=>loads.delete(src)); loads.set(src,promise); return promise;
  }
  async function ensure(name){ if(entries.has(name)) return true; const src=manifest[name]; if(!src) return false; await loadScript(src); return entries.has(name); }
  function decode(name){const item=entries.get(name); if(!item) throw new Error(`Recurso offline indisponível: ${name}`); const raw=atob(item.base64); const bytes=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i); return bytes;}
  function arrayBuffer(name){const bytes=decode(name); return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
  function objectUrl(name){if(urls.has(name)) return urls.get(name); const item=entries.get(name); const url=URL.createObjectURL(new Blob([decode(name)],{type:item.mime||"application/octet-stream"})); urls.set(name,url); return url;}
  function revokeObjectUrls(){urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();}
  const api=Object.freeze({register,ensure,has:name=>entries.has(name),metadata:name=>entries.get(name)||null,arrayBuffer,objectUrl,revokeObjectUrls,manifest});
  root.RECONOfflineResources=api;
})(typeof globalThis!=="undefined"?globalThis:this);