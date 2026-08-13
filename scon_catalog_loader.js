(function (root) {
  "use strict";
  const manifest = {
    version: "2026-08-13", sourceFile: "SCON - COMPONENTES E PROGRAMAÇÃO 2 (1).xlsx", sheet: "WRHDT_VW_EXTRATO_COMPONENTES + WRHDT_BI_VW_EXTRATO_PROGRAMACAO", total: 23341,
    columns: ["document","titleComplement","fullDescription","sconTag","discipline","itemType","drawingReference","row"],
    chunks: {
      ANDAIME: ["scon_andaime.js",93], APOIO: ["scon_apoio.js",73], CIVIL: ["scon_civil.js",1470],
      ELETRICA: ["scon_eletrica.js",2905], EQP_DINAMICO: ["scon_eqp_dinamico.js",324], EQP_ESTATICO: ["scon_eqp_estatico.js",736],
      EST_METALICA: ["scon_est_metalica.js",1145], HVAC: ["scon_hvac.js",121], INSTRUMENTACAO: ["scon_instrumentacao.js",9818],
      SEGURANCA: ["scon_seguranca.js",36], TUBULACAO: ["scon_tubulacao.js",6086], CANTEIRO: ["scon_canteiro.js",480],
      LOA: ["scon_loa.js",23], RECURSOS_ETF: ["scon_recursos_etf.js",31]
    }
  };
  const loaded = new Set();
  root.RECON_SCON_CHUNKS = root.RECON_SCON_CHUNKS || {};
  function script(src) { return root.RECONModuleLoader ? root.RECONModuleLoader.ensure(src) : Promise.reject(new Error("Carregador de módulos indisponível.")); }
  function disciplinesForDocuments(documents) {
    const set = new Set();
    (documents || []).forEach((item) => {
      const value = String(item && (item.document || item.documentKey) || item || "").toUpperCase();
      if (/_CVL_/.test(value)) { set.add("CIVIL"); set.add("EST_METALICA"); set.add("SEGURANCA"); }
      if (/_ELE_/.test(value)) set.add("ELETRICA");
      if (/_TUB_/.test(value)) set.add("TUBULACAO");
      if (/_INS_|_AUT_/.test(value)) set.add("INSTRUMENTACAO");
      if (/_MEC_/.test(value)) { set.add("EQP_DINAMICO"); set.add("EQP_ESTATICO"); set.add("HVAC"); }
      if (/_EST_/.test(value)) set.add("EST_METALICA");
      if (/_HVAC_/.test(value)) set.add("HVAC");
      if (/_SEG_/.test(value)) set.add("SEGURANCA");
    });
    return set.size ? [...set] : Object.keys(manifest.chunks);
  }
  async function ensureDisciplines(names) {
    const wanted = [...new Set((names || []).filter((name) => manifest.chunks[name]))];
    // Cada disciplina é um arquivo independente buscado pela rede. Antes, um
    // único arquivo falhando (timeout, instabilidade de conexão) derrubava
    // Promise.all inteiro e a base SCON TAG SGP embutida virava nula para
    // TODAS as disciplinas — mesmo as que já tinham carregado com sucesso.
    // allSettled preserva o que deu certo e só avisa sobre o que faltou.
    const pending = wanted.filter((name) => !loaded.has(name));
    const results = await Promise.allSettled(pending.map((name) => script(manifest.chunks[name][0])));
    const failed = [];
    results.forEach((result, index) => {
      const name = pending[index];
      if (result.status === "fulfilled") loaded.add(name);
      else failed.push(name);
    });
    const result = catalog();
    result.failedDisciplines = failed;
    return result;
  }
  function catalog() {
    const rows = [];
    [...loaded].forEach((name) => { const chunk = root.RECON_SCON_CHUNKS[name]; if (chunk && Array.isArray(chunk.rows)) rows.push(...chunk.rows); });
    return { version: manifest.version, sourceFile: manifest.sourceFile, sheet: manifest.sheet, columns: manifest.columns, rows };
  }
  async function ensureForIndex(index, documentKeys) {
    // A descrição é definida pela TAG, mesmo quando a ocorrência disponível na
    // SCON está classificada em outra disciplina. Por isso a auditoria carrega o
    // catálogo completo; limitar pelos grupos da LD esconderia justamente essas
    // correspondências cruzadas.
    void index;
    void documentKeys;
    return ensureDisciplines(Object.keys(manifest.chunks));
  }
  function clear() { Object.keys(root.RECON_SCON_CHUNKS).forEach((key) => delete root.RECON_SCON_CHUNKS[key]); loaded.clear(); }
  root.RECONSconCatalog = Object.freeze({ manifest, ensureDisciplines, ensureForIndex, catalog, clear, loaded: () => [...loaded] });
})(window);
