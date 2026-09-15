(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingNormative = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NORMS = Object.freeze([
    {
      id: "ET-5290.00-22000-912-1LV-001",
      title: "Definição de Codificação de Documentos",
      revision: "Q",
      date: "2026-08-12",
      status: "active",
      scope: "RNEST",
      precedence: 100,
      source: "ET-5290.00-22000-912-1LV-001 Rev. Q aprovada",
    },
    {
      id: "ET-5290.00-22000-912-1LV-001",
      title: "Definição de Codificação de Documentos",
      revision: "P",
      date: "2026-06-17",
      status: "historical",
      scope: "RNEST",
      precedence: 100,
      source: "ET-5290.00-22000-912-1LV-001 Rev. P",
    },
    {
      id: "N-1710",
      title: "Codificação de Documentos Técnicos de Engenharia",
      revision: "N",
      date: "2020-04-01",
      status: "active",
      scope: "engineering",
      precedence: 70,
      source: "PETROBRAS N-1710 Rev. N 04/2020",
    },
    {
      id: "N-381",
      title: "Formulários para Emissão de Documentos Técnicos de Engenharia",
      revision: "M",
      date: "2022-06-01",
      status: "active",
      scope: "cover",
      precedence: 60,
      source: "PETROBRAS N-381 Rev. M + 1ª Errata 06/2022",
    },
    {
      id: "N-2064",
      title: "Emissão e Revisão de Documentos de Projeto",
      revision: "C",
      date: "2014-02-01",
      status: "active",
      scope: "revision",
      precedence: 60,
      source: "PETROBRAS N-2064 Rev. C, emendas disponíveis",
    },
  ]);

  const SOURCE = Object.freeze({
    ET_ADMIN: "ET-5290.00-22000-912-1LV-001 Rev. Q, itens 2.1 e 2.2 / Tabelas 1 a 4",
    ET_MINUTES: "ET-5290.00-22000-912-1LV-001 Rev. Q, item 3 / Tabelas 5 a 7",
    ET_PROJECT: "ET-5290.00-22000-912-1LV-001 Rev. Q, item 4.1",
    ET_CT_SIT: "ET-5290.00-22000-912-1LV-001 Rev. Q, itens 5.1 e 5.2",
    ET_CV: "ET-5290.00-22000-912-1LV-001 Rev. Q, item 6 / Tabelas 8 e 9",
    ET_REPORT: "ET-5290.00-22000-912-1LV-001 Rev. Q, item 7 / Tabelas 10 a 13",
    ET_TAG: "ET-5290.00-22000-912-1LV-001 Rev. Q, itens 7.1.7 a 7.1.7.3",
    N1710_STRUCTURE: "PETROBRAS N-1710 Rev. N, itens 5.1 a 5.3",
    N1710_LANGUAGE: "PETROBRAS N-1710 Rev. N, item 6.1",
    N1710_CATEGORY: "PETROBRAS N-1710 Rev. N, item 6.2 / Anexo A",
    N1710_INSTALLATION: "PETROBRAS N-1710 Rev. N, item 6.3 / Anexo B",
    N1710_ACTIVITY: "PETROBRAS N-1710 Rev. N, item 6.4 / Anexo C ou E",
    N1710_CLASS: "PETROBRAS N-1710 Rev. N, item 6.5 / Anexo D ou F",
    N1710_ORIGIN: "PETROBRAS N-1710 Rev. N, item 6.6",
    N1710_SEQUENCE: "PETROBRAS N-1710 Rev. N, item 6.7",
    N381: "PETROBRAS N-381 Rev. M + 1ª Errata",
    N2064: "PETROBRAS N-2064 Rev. C",
  });

  const ADMIN_DOC_TYPES = Object.freeze({
    C: "Carta",
    E: "E-mail",
    GRD: "Guia de Remessa de Documento",
    GRDT: "Guia de Remessa de Documento Técnico",
    OD: "On Demand",
  });

  const ET_UNITS = Object.freeze({
    U22: "UCR",
    U27: "UCR",
    U29S: "UCR",
    U68: "Pátio de Coque",
    U32: "UHDT-D",
    U39S: "UHDT-D",
    U36: "UGH",
    U34: "UHDT-N",
    U12: "UDA",
    U42: "UTAA+TR",
    U54: "UTAA+TR / Resfriamento de Água III",
    CISC: "CISC",
    CIC: "CIC",
    A83A: "CRE",
    A97: "Sistema de Tocha II",
    A66: "Expedição de Recebimento",
    SE8040: "SE-8040",
    A90: "ETDI",
    U53: "Resfriamento de Água II",
  });

  const ET_DISCIPLINES = Object.freeze({
    ADC: "Administração Contratual",
    ARR: "Arranjo",
    DBU: "Databook de Unidade",
    CVL: "Civil",
    CTO: "Comissionamento",
    CRS: "Comunicação e Responsabilidade Social",
    CDR: "Coordenação",
    DOC: "Documentação",
    ELE: "Elétrica",
    REQ: "Equipe",
    ETF: "Equipe de Tratamento de Falhas",
    FSC: "Fiscalização do Contrato",
    FOR: "Fornos",
    GER: "Gerencial",
    HVAC: "HVAC",
    INSP: "Inspeção",
    INS: "Instrumentação",
    PDMS: "Maquete Eletrônica",
    MEC: "Mecânica",
    DIN: "Mecânica - Dinâmicos",
    EST: "Mecânica - Estáticos",
    PLA: "Planejamento e Controle",
    PRS: "Processo",
    PRJ: "Projeto",
    QUA: "Qualidade",
    SMS: "Saúde, Segurança e Meio Ambiente",
    SEG: "Segurança",
    SIS: "Sistemas Computacionais",
    SUP: "Suprimentos",
    TEL: "Telecomunicação",
    TUB: "Tubulação",
  });

  const ET_MEETING_THEMES = Object.freeze({
    PRJ: "Projeto",
    FSC: "Fiscalização de Contrato",
    CDR: "Coordenação",
    SUP: "Suprimentos",
    KOM: "Reunião de Abertura",
    INT: "Interfaces",
    RAC: "Reunião de Análise Crítica",
  });

  // Tabela 13 da Rev. Q. O catálogo é deliberadamente estruturado e versionado;
  // regras futuras podem substituir esta tabela sem alterar o motor.
  const REPORT_CODES = Object.freeze({
    ACCD: "Relatório de Assentamento e Nivelamento Topográfico de Calços, Chumbadores e Dispositivos",
    ARM: "Relatório de Armação",
    ATCT: "Assistência Técnica para Equipamentos Fornecidos pela Contratada",
    "ATPB-AOP-ADM": "Assistência Técnica ao Condicionamento, Pré-operação, Partida e Operação Assistida - ADM",
    "ATPB-AOP-HE": "Assistência Técnica ao Condicionamento, Pré-operação, Partida e Operação Assistida - HE",
    "ATPB-INSP": "Assistência Técnica de Fornecedores à Inspeção Inicial",
    BFENT: "Relatório de Bota fora",
    BOR: "Relatório de Inspeção por Boroscopia",
    CCM: "Certificado de Completação Mecânica",
    CCP: "Certificado de Calibração",
    CERS: "Certificado de Estanqueidade e Remontagem dos Sistemas",
    CHUMB: "Relatório de Chumbadores Químicos",
    CIME: "Certificado de Inspeção e Montagem do Equipamento",
    CIME1: "Certificado de Inspeção e Montagem do Equipamento - Instalação Estágio 1",
    CIME2: "Certificado de Inspeção e Montagem do Equipamento - Instalação Final",
    CLT: "Certificado de Limpeza de Tubulação",
    CONC: "Relatório de Concretagem",
    CONCPM: "Relatório de concreto pré-moldado",
    CONTROLTUB: "Registro das inspeções no CONTROLTUB",
    CRL: "Certificado de Recomposição de Linha",
    CSV: "Certificado de Sopragem com Vapor",
    CTEE: "Certificado de Teste de Estanqueidade - Equipamento",
    CTF: "Certificado de Torqueamento de Uniões Flangeadas",
    CTFA: "Certificado de Teste Funcional de Automação",
    CTFI: "Certificado de Teste Funcional de Intertravamento",
    CTME: "Certificado de Teste de Malhas de Elétrica",
    CTMI: "Certificado de Teste de Malha de Instrumentação",
    CTPE: "Certificado de Teste de Pressão - Equipamento",
    CTPES: "Certificado de Teste de Pressão em Equipamentos (Selo Mecânico)",
    CTPT: "Certificado de Teste de Pressão em Tubulação",
    DB: "Data Book",
    DCONC: "Relatório de Demolições de Concreto",
    DESEM: "Relatório de Desmontagem de Estrutura Metálica",
    DIMAT: "Relatório de Disponibilização de material",
    DIN: "Relatório de Inspeção Dimensional",
    DR: "Relatório de Demolições e Remoções",
    DTAND: "Relatório de Desmontagem de Andaimes de Terceiros",
    EAC: "Relatório de Esquadrias e Acessórios",
    ENDR: "Relatório de Ensaio Não Destrutivos - Reparo",
    EPEIR: "Emissão de Procedimento de Execução e Inspeção de Reparo",
    EPS: "Especificação de Procedimento de Soldagem",
    EPSR: "Especificação de Procedimento de Soldagem - Reparo",
    EVS: "Relatório de Ensaio Visual de Solda",
    EVSJE: "Relatório de Ensaio Visual de Solda - Juntas Existentes",
    FORM: "Relatório de Forma",
    FVI: "Folha de Verificação de Item",
    FVM: "Folha de Verificação de Malhas",
    IEISR: "Instrução de Execução e Inspeção de Soldagem - Reparo",
    INSCOB: "Relatório de Instalação de Estruturas de Coberta",
    INSHS: "Relatório de Instalações Hidro Sanitária",
    INSMET: "Relatório de Instalações de Metais",
    INSMOB: "Relatório de Instalação de Mobiliário",
    INSPL: "Relatório de Instalações Pluviais",
    INSREC: "Relatório de Inspeção de recebimento (Civil)",
    IP: "Relatório de Inspeção Prévia",
    IRIS: "Relatório de Ensaio de IRIS",
    ITEMP: "Teste de Eletrodutos, Manholes e Pull Point",
    LAC: "Relatório de Liberação de Acabamento",
    LALV: "Relatório de Liberação de Alvenaria",
    LARM: "Relatório de Liberação de Armadura",
    LCOMP: "Relatório de Liberação de Compactação",
    LP: "Relatório de Ensaio Líquido Penetrante",
    LPISO: "Relatório de Liberação de Piso",
    LPJE: "Relatório de Ensaio Líquido Penetrante - Juntas Existentes",
    LPR: "Relatório de Ensaio Líquido Penetrante - Reparo",
    MATAPL: "Relatório de Material de aplicação",
    MTAND: "Relatório de Montagem de Andaimes Aplicados",
    MTEM: "Relatório de Montagem de Estruturas Metálicas",
    PMC: "Plano de Movimentação de Carga",
    PMI: "Relatório de Identificação Positiva de Material",
    PMIR: "Relatório de Ensaio PMI - Reparo",
    PPT: "Relatório de preparação para transporte",
    RATP: "Relatório de Atualização Tecnológica de Painéis",
    RCCE: "Relatório de Classificação, Categorização e Enquadramento de Equipamento",
    RCCED: "Relatório de Conclusão de Condicionamento de Equipamento Dinâmico",
    RCCEE: "Relatório de Conclusão de Condicionamento de Equipamento Estático",
    RCCES: "Relatório de Conclusão de Condicionamento de Equipamento de Segurança",
    RCCM: "Relatório de Certificado de Completação Mecânica",
    RCCTS: "Relatório de Conclusão de Condicionamento de Tubulação de SOP",
    RDO: "Relatório Diário de Obras",
    REP: "Relatório de Reparo de Válvulas",
    RFAB: "Relatório de Fabricação de Suportes",
    RID: "Relatório de Inspeção Dimensional",
    RIE: "Relatório de Identificação de Equipamento",
    RII: "Relatório de Inspeção de Isolamento",
    RILICE: "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo Elétrico",
    RILICT: "Relatório de Inspeção do Lançamento e das Interligações dos Cabos de Telecomunicações",
    RILITCE: "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo Elétrico",
    RILITCT: "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo de Telecomunicações",
    RILM: "Relatório de Inspeção de Ligas Metálicas",
    RILTCI: "Relatório da Ligação e Testes de Cabos de Instrumentação",
    RIMJ: "Relatório de Inspeção de Montagem - Junta de Expansão",
    RIMS: "Relatório de Inspeção de Montagem de Suportes de Instrumentação",
    RIMSE: "Relatório de Inspeção de Montagem de Suporte Elétrico",
    RIMSI: "Relatório de Inspeção de Montagem de Suportes de Instrumentação",
    RIMTET: "Relatório de Inspeção de Montagem e Testes de Equipamentos de Telecom",
    RIMTU: "Relatório de Inspeção de Montagem de Tubing de Instrumentação",
    RIP: "Relatório de Inspeção de Pintura",
    RIR: "Relatório de Inspeção de Recebimento",
    RIRP: "Relatório de Inspeção de Reparo de Pintura",
    RIRSS: "Relatório de Inspeção de Recebimento de Sobressalentes",
    "RIR-STH": "Relatório de Inspeção de Recebimento para STH",
    RISI: "Relatório de Inspeção de Segurança Inicial",
    RISOL: "Relatório de Isolamento Térmico",
    RIVVT: "Relatório de Verificação de Válvulas",
    RL: "Emissão e Aprovação via SIGEM da Documentação, conforme codificação N-1710",
    RLFAB: "Relatório de Fabricação de Suportes",
    RLISOL: "Relatório de Isolamento Térmico",
    RLMANG: "Relatório de Montagem de Mangotes",
    RLMTCL: "Relatório de Montagem e Calibração de Item Tagueado",
    RLPIN: "Relatório de Pintura",
    RLRCD: "Relatório de Recondicionamento de Item Tagueado",
    RLREVEST: "Relatório de Revestimento",
    RLSUP: "Relatório de Suportação Final do STH",
    RME: "Relatório de Medição de Espessura por Ultrassom",
    RMTCL: "Relatório de Montagem e Calibração de Item Tagueado",
    RNC: "Relatório de Não Conformidade",
    RPIN: "Relatório de Pintura",
    RPL: "Resolução do Punch List",
    RTA: "Relatório de Teste de Aderência",
    RTAR: "Relatório de Teste de Aderência - Reparo",
    RTCFO: "Relatório de Teste e Certificação de Fibra Óptica",
    RTIS: "Relatório de Teste de Integração de Sistemas",
    RTTAT: "Relatório de Tratamento Térmico de Alívio de Tensões",
    RUFF: "Relatório de Usinagem em Face de Flange",
    RUS: "Relatório de Ensaio Ultrassom - Reparo",
    TFEM: "Relatório de Torqueamento Final de Estruturas Metálicas",
    TTI: "Termo de transferência de instalações",
    US: "Relatório de Ensaio Ultrassom",
    USJE: "Relatório de Ensaio Ultrassom - Juntas Existentes",
    "US-ME": "Relatório de Medição de Espessura + Análise de Vida Residual",
  });

  const N1710_CATEGORY_HINTS = Object.freeze({
    ET: "Especificação Técnica",
    MD: "Memorial Descritivo",
    DE: "Desenho Técnico",
    RM: "Requisição de Material",
    FD: "Folha de Dados",
    MA: "Manual",
    MC: "Memória de Cálculo",
    PR: "Procedimento",
    RL: "Relatório",
    CT: "Consulta Técnica",
    SIT: "Solicitação de Informações Técnicas",
    CR: "Cronograma",
  });

  const RULES = Object.freeze({
    N1710: Object.freeze({
      id: "n1710",
      label: "N-1710 — documento técnico de engenharia",
      separator: "-",
      groups: ["language", "category", "installation", "activityArea", "serviceClass", "origin", "sequence"],
      sequenceDigits: 3,
      sequenceFamily: ["category", "installation", "activityArea", "serviceClass", "origin"],
      source: SOURCE.N1710_STRUCTURE,
    }),
    ET_ADMIN_CONTRACT: Object.freeze({
      id: "et-admin-contract",
      label: "ET — documento administrativo com contrato",
      separator: "-",
      groups: ["contract", "emitter", "documentType", "sequence", "yearMonth"],
      sequenceDigits: 4,
      resetSequenceByYear: true,
      sequenceFamily: ["contract", "emitter", "documentType", "year"],
      source: SOURCE.ET_ADMIN,
    }),
    ET_ADMIN_INTERNAL: Object.freeze({
      id: "et-admin-internal",
      label: "ET — documento administrativo sem vínculo contratual",
      separator: "-",
      groups: ["managementEmitter", "documentType", "sequence", "yearMonth"],
      sequenceDigits: 4,
      resetSequenceByYear: true,
      sequenceFamily: ["managementEmitter", "documentType", "year"],
      source: SOURCE.ET_ADMIN,
    }),
    ET_MINUTES_CONTRACT: Object.freeze({
      id: "et-minutes-contract",
      label: "ET — ata de reunião com contrato",
      separator: "-",
      groups: ["contract", "emitter", "documentType", "theme", "discipline", "sequence", "yearMonth"],
      sequenceDigits: 4,
      resetSequenceByYear: true,
      sequenceFamily: ["contract", "emitter", "documentType", "theme", "discipline", "year"],
      source: SOURCE.ET_MINUTES,
    }),
    ET_MINUTES_INTERNAL: Object.freeze({
      id: "et-minutes-internal",
      label: "ET — ata de reunião sem contrato",
      separator: "-",
      groups: ["managementEmitter", "documentType", "theme", "discipline", "sequence", "yearMonth"],
      sequenceDigits: 4,
      resetSequenceByYear: true,
      sequenceFamily: ["managementEmitter", "documentType", "theme", "discipline", "year"],
      source: SOURCE.ET_MINUTES,
    }),
    ET_CV: Object.freeze({
      id: "et-cv",
      label: "ET — currículo",
      separator: "-",
      groups: ["contract", "emitter", "documentType", "discipline", "sequence"],
      sequenceDigits: 4,
      sequenceFamily: ["contract", "emitter", "documentType"],
      source: SOURCE.ET_CV,
      normativeConflict: "A Rev. Q descreve 4 algarismos no item 6.6, mas um exemplo da Tabela 9 aparece com 3; o motor usa 4 e registra o conflito para auditoria.",
    }),
    ET_REPORT: Object.freeze({
      id: "et-report",
      label: "ET — relatório RNEST",
      separator: "_",
      groups: ["emitter", "enterprise", "unit", "eap", "discipline", "reportCode", "tag"],
      source: SOURCE.ET_REPORT,
    }),
  });

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function norm(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function latestNorm(id, norms) {
    const candidates = (norms || NORMS).filter((item) => norm(item.id) === norm(id));
    if (!candidates.length) return null;
    return candidates.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  }

  function compareRevisions(a, b) {
    const A = text(a).toUpperCase();
    const B = text(b).toUpperCase();
    if (A === B) return 0;
    const numeric = /^\d+$/.test(A) && /^\d+$/.test(B);
    if (numeric) return Number(A) - Number(B);
    return A.localeCompare(B, "pt-BR", { numeric: true });
  }

  function reportCodeFromText(value) {
    const haystack = norm(value);
    let best = null;
    Object.entries(REPORT_CODES).forEach(([code, title]) => {
      const titleNorm = norm(title);
      if (!titleNorm) return;
      let score = 0;
      if (new RegExp(`(^|[^A-Z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`, "i").test(value || "")) score += 100;
      const words = titleNorm.split(/\s+/).filter((w) => w.length >= 4);
      const matched = words.filter((w) => haystack.includes(w)).length;
      score += words.length ? (matched / words.length) * 70 : 0;
      if (!best || score > best.score) best = { code, title, score };
    });
    return best && best.score >= 38 ? best : null;
  }

  function isKnownReportCode(code) {
    return Boolean(REPORT_CODES[text(code).toUpperCase()]);
  }

  function validateReportTag(tag) {
    const value = text(tag);
    const forbidden = /[ç?\|!@#$%¨&*(),\s]/i;
    return {
      valid: Boolean(value) && !forbidden.test(value),
      forbidden: forbidden.test(value),
      nonTagged: /^nt-/i.test(value),
      canonicalNonTagged: value.startsWith("nt-"),
      source: SOURCE.ET_TAG,
    };
  }

  function sourceForN1710Group(group) {
    return {
      language: SOURCE.N1710_LANGUAGE,
      category: SOURCE.N1710_CATEGORY,
      installation: SOURCE.N1710_INSTALLATION,
      activityArea: SOURCE.N1710_ACTIVITY,
      serviceClass: SOURCE.N1710_CLASS,
      origin: SOURCE.N1710_ORIGIN,
      sequence: SOURCE.N1710_SEQUENCE,
    }[group] || SOURCE.N1710_STRUCTURE;
  }

  return Object.freeze({
    NORMS,
    SOURCE,
    RULES,
    ADMIN_DOC_TYPES,
    ET_UNITS,
    ET_DISCIPLINES,
    ET_MEETING_THEMES,
    REPORT_CODES,
    N1710_CATEGORY_HINTS,
    text,
    norm,
    latestNorm,
    compareRevisions,
    reportCodeFromText,
    isKnownReportCode,
    validateReportTag,
    sourceForN1710Group,
  });
});
