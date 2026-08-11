(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentTitleStandard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STANDARD = Object.freeze({
    document: "ET-5290.00-22000-912-1LV-001",
    revision: "P",
    date: "17/06/2026",
    reportTable: "Tabela 13",
  });

  // Extraído da revisão P, que substitui a revisão N para a codificação de
  // relatórios. A ordem original é preservada porque a própria norma contém
  // duas descrições para EVSJE; nesse único caso, títulos anteriores ajudam a
  // selecionar a redação que já vem sendo usada.
  const RAW_REPORT_TITLES = [
  [
    "ACCD",
    "Relatório de Assentamento e Nivelamento Topográfico de Calços, Chumbadores e Dispositivos"
  ],
  [
    "ARM",
    "Relatório de Armação"
  ],
  [
    "ATCT",
    "Assistência Técnica para Equipamentos Fornecidos pela Contratada"
  ],
  [
    "ATPB-AOP-ADM",
    "Assistência Técnica ao Condicionamento, Pré-operação, Partida e Operação Assistida para Equipamentos Fornecidos pela Petrobras ADM"
  ],
  [
    "ATPB-AOP-HE",
    "Assistência Técnica ao Condicionamento, Pré-operação, Partida e Operação Assistida para Equipamentos Fornecidos pela Petrobras HE"
  ],
  [
    "ATPB-INSP",
    "Assistência Técnica de Fornecedores à Inspeção Inicial para Equipamentos Fornecidos pela Petrobras ADM"
  ],
  [
    "BFENT",
    "Relatório de Bota fora"
  ],
  [
    "BOR",
    "Relatório de Inspeção por Boroscopia"
  ],
  [
    "CCM",
    "Certificado de Completação Mecânica"
  ],
  [
    "CCP",
    "CERTIFICADO DE CALIBRAÇÃO"
  ],
  [
    "CERS",
    "Certificado de Estanqueidade e Remontagem dos Sistemas"
  ],
  [
    "CHUMB",
    "Relatório de Chumbadores Químicos"
  ],
  [
    "CICN",
    "CONFORMIDADE DA INSTALAÇÃO CONTROLNET"
  ],
  [
    "CIFF",
    "CONFORMIDADE DA INSTALAÇÃO FOUNDATION FIELDBUS"
  ],
  [
    "CIM",
    "CONFORMIDADE DA INSTALAÇÃO MODBUS"
  ],
  [
    "CIME",
    "Certificado de Inspeção e Montagem do Equipamento"
  ],
  [
    "CIME1",
    "Certificado de Inspeção e Montagem do Equipamento - Instalação Estágio 1"
  ],
  [
    "CIME2",
    "Certificado de Inspeção e Montagem do Equipamento - Instalação Final"
  ],
  [
    "CIP",
    "CONFORMIDADE DA INSTALAÇÃO PROFIBUS"
  ],
  [
    "CISMM",
    "CONFORMIDADE DA INSTALAÇÃO DO SISTEMA DE MONITORAÇÃO DE MÁQUINAS"
  ],
  [
    "CLT",
    "Certificado de Limpeza de Tubulação"
  ],
  [
    "CONC",
    "Relatório de Concretagem"
  ],
  [
    "CONCPM",
    "Relatório de concreto pré-moldado"
  ],
  [
    "CONTROLTUB",
    "Registro das inspeções no CONTROLTUB"
  ],
  [
    "CRCN",
    "CERTIFICADO DE REDE CONTROLNET"
  ],
  [
    "CRE",
    "CERTIFICADO DE REDE ETHERNET"
  ],
  [
    "CRF",
    "CERTIFICADO DE REDE FIELDBUS FOUNDATION"
  ],
  [
    "CRL",
    "Certificado de Recomposição de Linha"
  ],
  [
    "CRM",
    "CERTIFICADO DE REDE MODBUS"
  ],
  [
    "CRP",
    "CERTIFICADO DE REDE PROFIBUS"
  ],
  [
    "CRSDF",
    "CERTIFICADO DE REDE DO SISTEMA DE DETECÇÃO DE FUMAÇA"
  ],
  [
    "CRSMM",
    "CERTIFICADO DE REDE DO SISTEMA DE MONITORAÇÃO DE MÁQUINAS"
  ],
  [
    "CSV",
    "Certificado de Sopragem com Vapor"
  ],
  [
    "CTECRI",
    "Certificado de Teste Estático em Cabos de Rede de Instrumentação"
  ],
  [
    "CTEE",
    "CERTIFICADO DE TESTE DE ESTANQUEIDADE - EQUIPAMENTO"
  ],
  [
    "CTF",
    "Certificado de Torqueamento de Uniões Flangeadas"
  ],
  [
    "CTFA",
    "CERTIFICADO DE TESTE FUNCIONAL DE AUTOMAÇÃO"
  ],
  [
    "CTFI",
    "Certificado de Teste Funcional de Intertravamento"
  ],
  [
    "CTME",
    "Certificado de Teste de Malhas de Elétrica"
  ],
  [
    "CTMI",
    "Certificado de Teste de Malha de Instrumentação"
  ],
  [
    "CTPE",
    "Certificado de Teste de Pressão - Equipamento"
  ],
  [
    "CTPES",
    "Certificado de Teste de Pressão em Equipamentos (Selo Mecânico)"
  ],
  [
    "CTPT",
    "Certificado de Teste de Pressão em Tubulação"
  ],
  [
    "DB",
    "Data Book NR-13_SPIE, Data Book de Unidade, Data Book Fabricante, Data Book em Geral"
  ],
  [
    "DCONC",
    "Relatório de Demolições de Concreto"
  ],
  [
    "DESEM",
    "Relatório de Desmontagem de Estrutura Metálica"
  ],
  [
    "DIMAT",
    "Relatório de Disponibilização de material"
  ],
  [
    "DIN",
    "Relatório de Inspeção Dimensional"
  ],
  [
    "DR",
    "Relatório de Demolições e Remoções"
  ],
  [
    "DTAND",
    "Relatório de Desmontagem de Andaimes de Terceiros"
  ],
  [
    "EAC",
    "Relatório de Esquadrias e Acessórios"
  ],
  [
    "ENDR",
    "Relatório de Ensaio Não Destrutivos - Reparo"
  ],
  [
    "EPEIR",
    "Emissão de Procedimento de Execução e Inspeção de Reparo"
  ],
  [
    "EPS",
    "Especificação de Procedimento de Soldagem"
  ],
  [
    "EPSR",
    "Especificação de Procedimento de Soldagem - Reparo"
  ],
  [
    "EVS",
    "Relatório de Ensaio Visual de Solda"
  ],
  [
    "EVSJE",
    "Relatório de Ensaio Visual de Solda - Juntas Existentes"
  ],
  [
    "EVSJE",
    "Relatório de Ensaio Visual - Juntas Existentes"
  ],
  [
    "FLUXOG.SPIE",
    "FLUXOGRAMA DE INSPEÇÃO DE ISOCORROSIVO"
  ],
  [
    "FORM",
    "Relatório de Forma"
  ],
  [
    "FVI",
    "FOLHA DE VERIFICAÇÃO DE ITEM"
  ],
  [
    "FVM",
    "FOLHA DE VERIFICAÇÃO DE MALHAS"
  ],
  [
    "RRIMTI",
    "Relatório de Execução e Inspeção de Montagem - Tomadas de Instrumento"
  ],
  [
    "RRIMTIR",
    "Relatório de Execução e Inspeção de Montagem - Tomadas de Instrumento - Reparo"
  ],
  [
    "IEISR",
    "Instrução de Execução e Inspeção de Soldagem - Reparo"
  ],
  [
    "INSCOB",
    "Relatório de Instalação de Estruturas de Coberta"
  ],
  [
    "INSHS",
    "Relatório de Instalações Hidro Sanitária"
  ],
  [
    "INSMET",
    "Relatório de Instalações de Metais"
  ],
  [
    "INSMOB",
    "Relatório de Instalação de Mobiliário"
  ],
  [
    "INSPL",
    "Relatório de Instalações Pluviais"
  ],
  [
    "INSREC",
    "Relatório de Inspeção de recebimento (Civil)"
  ],
  [
    "IP",
    "Relatório de Inspeção Prévia"
  ],
  [
    "IRIS",
    "RELATÓRIO DE ENSAIO DE IRIS"
  ],
  [
    "IS-XXXX.XX-YYYY-955-ZZZ-DDDD",
    "Isométrico com numeração de juntas (spooletado)"
  ],
  [
    "ITEMP",
    "TESTE DE ELETRODUTOS, MANHOLES E PULL POINT"
  ],
  [
    "LAC",
    "Relatório de Liberação de Acabamento"
  ],
  [
    "LALV",
    "Relatório de Liberação de Alvenaria"
  ],
  [
    "LARM",
    "Relatório de Liberação de Armadura"
  ],
  [
    "LCOMP",
    "Relatório de Liberação de Compactação"
  ],
  [
    "LP",
    "Relatório de Ensaio Líquido Penetrante"
  ],
  [
    "LPCMT",
    "Relatório de Lixamento e pintura das cantoneiras metálicas"
  ],
  [
    "LPISO",
    "Relatório de Liberação de Piso"
  ],
  [
    "LPJE",
    "Relatório de Ensaio Líquido Penetrante - Juntas Existentes"
  ],
  [
    "LPR",
    "Relatório de Ensaio Líquido Penetrante - Reparo"
  ],
  [
    "LREVEST",
    "Relatório de Liberação de Revestimento para Pavimentação"
  ],
  [
    "LSBASE",
    "Relatório de Liberação de Sub-base para Pavimentação"
  ],
  [
    "LSBLE",
    "Relatório de Liberação de Subleito para Pavimentação"
  ],
  [
    "MATAPL",
    "Relatório de Material de aplicação"
  ],
  [
    "MTAND",
    "Relatório de Montagem de Andaimes Aplicados"
  ],
  [
    "MTEM",
    "Relatório de Montagem de Estruturas Metálicas"
  ],
  [
    "PAR.SPIE",
    "Projeto de Alteração e Reparo"
  ],
  [
    "PCFEM",
    "Relatório de Reparo de Proteção Contra Fogo de Estruturas Metálicas"
  ],
  [
    "PETPE",
    "Plano de Execução de Teste de Pressão"
  ],
  [
    "PJSI",
    "Relatório de Pisos, Juntas, Selagem e Impermeabilização"
  ],
  [
    "PMC",
    "Plano de Movimentação de Carga"
  ],
  [
    "PMI",
    "Relatório de Identificação Positiva de Material"
  ],
  [
    "PMI.SPIE",
    "RELATÓRIO DE IDENTIFICAÇÃO POSITIVA DE MATERIAL"
  ],
  [
    "PMIR",
    "Relatório de Ensaio PMI - Reparo"
  ],
  [
    "PPT",
    "Relatório de preparação para transporte"
  ],
  [
    "PSTC",
    "Procedimento de Substituição dos Tubos Catalisadores"
  ],
  [
    "RAEM",
    "Relatório de Revestimento e Acabamento de Estruturas Metálicas"
  ],
  [
    "RAOEQPD",
    "Relatório de Assistência à Operação de Equipamentos Dia"
  ],
  [
    "RAOEQPN",
    "Relatório de Assistência à Operação de Equipamentos Noite"
  ],
  [
    "RAOMODD",
    "Relatório de Assistência à Operação (Mão de Obra Direta Dia)"
  ],
  [
    "RAOMODN",
    "Relatório de Assistência à Operação (Mão de Obra Direta Noite)"
  ],
  [
    "RAPFI",
    "Relatório de Aplicação de Proteção Contra Fogo em Instrumentação"
  ],
  [
    "RAQ",
    "Relatório de Alinhamento do Queimador"
  ],
  [
    "RAQR",
    "Relatório de Alinhamento do Queimador - Reparo"
  ],
  [
    "RARF",
    "Relatório de Acompanhamento de Aplicação de Refratário - Formado"
  ],
  [
    "RARNF",
    "Relatório de Acompanhamento de Aplicação de Refratário - Não Formado"
  ],
  [
    "RATMQ",
    "Relatório de Assistência Técnica na Montagem dos Queimadores"
  ],
  [
    "RATMQR",
    "Relatório de Assistência Técnica na Montagem dos Queimadores - Reparo"
  ],
  [
    "RATP",
    "Relatório de Atualização Tecnológica de Painéis"
  ],
  [
    "RCCE",
    "RELATÓRIO DE CLASSIFICAÇÃO, CATEGORIZAÇÃO E ENQUADRAMENTO DE EQUIPAMENTO"
  ],
  [
    "RCCED",
    "Relatório de Conclusão de Condicionamento de Equipamento Dinâmico"
  ],
  [
    "RCCEE",
    "Relatório de Conclusão de Condicionamento de Equipamento Estático"
  ],
  [
    "RCCES",
    "Relatório de Conclusão de Condicionamento de Equipamento de Segurança"
  ],
  [
    "RCCTS",
    "Relatório de Conclusão de Condicionamento de Tubulação de SOP"
  ],
  [
    "RCIMCR",
    "Relatório de Inspeção Dimensional - Chapas Perfuradas - Reparo"
  ],
  [
    "RCIME",
    "Certificado de Inspeção e Montagem do Equipamento - Reparo"
  ],
  [
    "RDCD",
    "Relatório de Desmontagem - Chapas de Deslizamento"
  ],
  [
    "RDIT",
    "Relatório de Desmontagem de Isolamento Térmico em Fornos"
  ],
  [
    "RDO",
    "Relatório Diário de Obras"
  ],
  [
    "RDRF",
    "Relatório de Desmontagem de Refratário - Formado"
  ],
  [
    "RDSM",
    "Relatório de Desmontagem - Suportes de Mola"
  ],
  [
    "RECOMP",
    "Execução da Recomposição do Gabinete"
  ],
  [
    "REIDT",
    "Relatório de Execução e Inspeção de Desmontagem dos Tubos Catalisadores"
  ],
  [
    "REP",
    "Relatório de Reparo de Válvulas"
  ],
  [
    "REPORT",
    "Relatório de Reparo de Portas"
  ],
  [
    "REVS",
    "Relatório de Ensaio Visual de Solda - Reparo"
  ],
  [
    "RFAB",
    "Relatório de Fabricação de Suportes"
  ],
  [
    "RID",
    "Relatório de Inspeção Dimensional"
  ],
  [
    "RIDCPR",
    "Relatório de Inspeção Dimensional - Chapas Perfuradas - Reparo"
  ],
  [
    "RIDDR",
    "Relatório de Inspeção Dimensional - Damper - Reparo"
  ],
  [
    "RIDGR",
    "Relatório de Inspeção Dimensional - Guias e Chapas Deslizantes - Reparo"
  ],
  [
    "RIDR",
    "Relatório de Inspeção Dimensional - Reparo"
  ],
  [
    "RIDSR",
    "Relatório de Inspeção Dimensional - Suportes de Mola - Reparo"
  ],
  [
    "RIDVR",
    "Relatório de Inspeção Dimensional - Visor de Chama - Reparo"
  ],
  [
    "RIE",
    "RELATÓRIO DE IDENTIFICAÇÃO DE EQUIPAMENTO"
  ],
  [
    "RIFMAI",
    "Relatório de Inspeção de Fabricação e Montagem de Abrigo de Instrumentação"
  ],
  [
    "RIFMI",
    "Relatório de Inspeção de Fixação e Montagem de Instrumentação"
  ],
  [
    "RIFP",
    "Relatório de Inspeção de Isolamento Antichama"
  ],
  [
    "RIFPNI",
    "RELATÓRIO DE INSPEÇÃO E FUNCIONAMENTO DE PAINEL DE INSTRUMENTAÇÃO"
  ],
  [
    "RIFPR",
    "Relatório de Inspeção de Fire Proofing - Reparo"
  ],
  [
    "RIFRF",
    "Relatório de Inspeção Final de Refratário - Formado"
  ],
  [
    "RIFRNF",
    "Relatório de Inspeção Final de Refratário - Não Formado"
  ],
  [
    "GRACIM",
    "Relatório de Aplicação de Graute Cimentício"
  ],
  [
    "RIGE",
    "Relatório de Inspeção de Grauteamento"
  ],
  [
    "RII",
    "Relatório de Inspeção de Isolamento"
  ],
  [
    "RIIT",
    "Relatório de Inspeção de Isolamento Térmico em Fornos"
  ],
  [
    "RIITR",
    "Relatório de Execução e Inspeção de Isolamento Térmico em Fornos - Reparo"
  ],
  [
    "RILICE",
    "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo Elétrico"
  ],
  [
    "RILICT",
    "Relatório de Inspeção do Lançamento e das Interligação dos Cabos de Telecomunicações"
  ],
  [
    "RILITCE",
    "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo Elétrico"
  ],
  [
    "RILITCT",
    "Relatório de Inspeção de Lançamento, Interligação e Testes de Cabo de Telecomunicações"
  ],
  [
    "RILM",
    "RELATÓRIO DE INSPEÇÃO DE LIGAS METÁLICAS (TESTE PELO IMÃ E TESTE POR PONTO)"
  ],
  [
    "RILTCI",
    "Relatório de Inspeção da Ligação e Testes de Cabos de Instrumentação"
  ],
  [
    "RIMCD",
    "Relatório de Inspeção de Montagem - Chapa Defletora"
  ],
  [
    "RIMCV",
    "Relatório de Inspeção de Montagem - Chapa de Vedação"
  ],
  [
    "RIMDT",
    "Relatório de Inspeção de Montagem - Dutos"
  ],
  [
    "RIMG",
    "Relatório de Inspeção de Montagem - Guilhotina"
  ],
  [
    "RIMHB",
    "Relatório de Inspeção de Montagem - Header Box"
  ],
  [
    "RIMIBP",
    "Relatório de Inspeção da Montagem e das Interligações do Botão de Pânico"
  ],
  [
    "RIMIBSE",
    "Relatório de Inspeção da Montagem e das Interligações das Botoeiras Elétricas e Sinalizadores"
  ],
  [
    "RIMIBT",
    "Relatório de Inspeção da Montagem e das Interligações do Banco de Baterias"
  ],
  [
    "RIMICB",
    "Relatório de Inspeção da Montagem e das Interligações do Carregador de Bateria"
  ],
  [
    "RIMICF",
    "Relatório de Inspeção da Montagem e das Interligações do Conversor de Frequência"
  ],
  [
    "RIMICFU",
    "Relatório de Inspeção da Montagem e das Interligações do Conversor de Mídia"
  ],
  [
    "RIMICJE",
    "Relatório de Inspeção da Montagem e das Interligações da Caixa de Junção Elétrica"
  ],
  [
    "RIMICJT",
    "Relatório de Inspeção da Montagem e das Interligações da Caixas de Junção de Telecomunicações"
  ],
  [
    "RIMICV",
    "Relatório de Inspeção da Montagem e das Interligações da Câmera"
  ],
  [
    "RIMIDB",
    "Relatório de Inspeção da Montagem e das Interligações do Duto de Barra"
  ],
  [
    "RIMIDJ",
    "Relatório de Inspeção da Montagem e das Interligações do Disjuntor"
  ],
  [
    "RIMIDO",
    "Relatório de Inspeção da Montagem e das Interligações do Distribuidor Óptico"
  ],
  [
    "RIMIEE",
    "Relatório de Inspeção de Montagem das Interligações de Eletrodutos e Eletrocalhas"
  ],
  [
    "RIMIELEE",
    "Relatório de Inspeção da Montagem e das Interligações de Eletrodutos Leitos e Eletrocalhas Elétricas"
  ],
  [
    "RIMIELET",
    "Relatório de Inspeção da Montagem e das Interligações dos Eletrodutos, Leitos e Eletrocalhas de Telecomunicações"
  ],
  [
    "RIMIES",
    "Relatório de Inspeção da Montagem e das Interligações dos Equipamentos e Sistemas Especiais"
  ],
  [
    "RIMII",
    "Relatório de Inspeção de Montagem de Infraestrutura de Instrumentação"
  ],
  [
    "RIMILC",
    "Relatório de Inspeção da Montagem e das Interligações do Leitor de Cartão e Teclado de Acesso"
  ],
  [
    "RIMILM",
    "Relatório de Inspeção da Montagem e das Interligações das Luminárias"
  ],
  [
    "RIMIMA",
    "Relatório de Inspeção de Montagem das Interligações da Malha de Aterramento"
  ],
  [
    "RIMIMT",
    "Relatório de Inspeção da Montagem e das Interligações do Motor"
  ],
  [
    "RIMIP",
    "Relatório de Inspeção de Montagem das Interligações de Poste"
  ],
  [
    "RIMIPN",
    "Relatório de Inspeção da Montagem e das Interligações do Painel Elétrico"
  ],
  [
    "RIMIPP",
    "Relatório de Inspeção da Montagem e das Interligações do Patch Painel"
  ],
  [
    "RIMIPT",
    "Relatório de Inspeção da Montagem e das Interligações dos Postes"
  ],
  [
    "RIMIRK",
    "Relatório de Inspeção da Montagem e das Interligações do Rack"
  ],
  [
    "RIMIRS",
    "Relatório de Inspeção da Montagem e das Interligações do Resistor de Aterramento"
  ],
  [
    "RIMISE",
    "Relatório de Inspeção da Montagem e das Interligações dos Suportes Elétricos"
  ],
  [
    "RIMISPDA",
    "Relatório de Inspeção da Montagem e das Interligações do SPDA"
  ],
  [
    "RIMISW",
    "Relatório de Inspeção da Montagem e das Interligações do Switch"
  ],
  [
    "RIMITB",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Bateria"
  ],
  [
    "RIMITBE",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Botoeira Elétrica"
  ],
  [
    "RIMITCB",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Carregador de Bateria"
  ],
  [
    "RIMITCF",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Conversor de Frequência"
  ],
  [
    "RIMITCJ",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Caixas de Junção"
  ],
  [
    "RIMITDB",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Dutos de Barra"
  ],
  [
    "RIMITDJ",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Disjuntor"
  ],
  [
    "RIMITE",
    "Relatório de Inspeção da Montagem e das Interligações das Tomada Elétrica Não Tagueadas"
  ],
  [
    "RIMITEL",
    "Relatório de Inspeção da Montagem e das Interligações do Telefone"
  ],
  [
    "RIMITES",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Equipamentos e Sistemas Especiais"
  ],
  [
    "RIMITF",
    "Relatório de Inspeção da Montagem e das Interligações do Transformador"
  ],
  [
    "RIMITL",
    "Relatório de Inspeção da Montagem e das Interligações do Telefone"
  ],
  [
    "RIMITM",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Motor"
  ],
  [
    "RIMITP",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Painel Elétrico"
  ],
  [
    "RIMITPI",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Painel de Instrumentação"
  ],
  [
    "RIMITR",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Resistor de Aterramento"
  ],
  [
    "RIMITS",
    "Relatório de Inspeção da Montagem e das Interligações da Tomada de Solda"
  ],
  [
    "RIMITT",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Transformador"
  ],
  [
    "RIMITTE",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Tomada Elétrica"
  ],
  [
    "RIMITTS",
    "Relatório de Inspeção de Montagem das Interligações e Testes de Tomada de Solda"
  ],
  [
    "RIMJ",
    "Relatório de Inspeção de Montagem - Junta de Expansão"
  ],
  [
    "RIMJBI",
    "Relatório de Inspeção de Montagem de Caixas de Junção de Instrumentação"
  ],
  [
    "RIMPI",
    "Relatório de Inspeção de Montagem - Porta de Inspeção"
  ],
  [
    "RIMPV",
    "Relatório de Inspeção de Montagem - Porta de Visita"
  ],
  [
    "RIMS",
    "Relatório de Inspeção de Montagem de Suportes de Instrumentação"
  ],
  [
    "RIMSE",
    "Relatório de Inspeção de Montagem de Suporte Elétrico"
  ],
  [
    "RIMSI",
    "Relatório de Inspeção de Montagem de Suportes de Instrumentação"
  ],
  [
    "RIMTET",
    "Relatório de Inspeção de Montagem e Testes de Equipamentos de Telecom"
  ],
  [
    "RIMTU",
    "Relatório de Inspeção de Montagem de Tubing de Instrumentação"
  ],
  [
    "RIMV",
    "Relatório de Inspeção de Montagem - Visor de Inspeção"
  ],
  [
    "RIMVC",
    "Relatório de Inspeção de Montagem - Visor de Chama"
  ],
  [
    "RIP",
    "Relatório de Inspeção de Pintura"
  ],
  [
    "RIPBE",
    "Relatório de Inspeção de Posicionamento na Base"
  ],
  [
    "RIPSV",
    "RELATÓRIO DE INSPEÇÃO DE SEGURANCA INICIAL DE PSV"
  ],
  [
    "RIR",
    "Relatório de Inspeção de Recebimento"
  ],
  [
    "RIRP",
    "Relatório de Inspeção de Reparo de Pintura"
  ],
  [
    "RIRSS",
    "Relatório de Inspeção de Recebimento de Sobressalentes"
  ],
  [
    "RIR-STH",
    "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO PARA STH"
  ],
  [
    "RIRV",
    "Relatório de Inspeção de Reparo - Visor de Chama"
  ],
  [
    "RISI",
    "RELATÓRIO DE INSPEÇÃO DE SEGURANCA INICIAL"
  ],
  [
    "RISI.EXT.INT.SPIE",
    "RELATÓRIO DE INSPEÇÃO EXTERNA/ INTERNA"
  ],
  [
    "RISI.INT.SPIE",
    "RELATÓRIO DE INSPEÇÃO INTERNA"
  ],
  [
    "RISOL",
    "Relatório de Isolamento Térmico"
  ],
  [
    "RITSR",
    "Relatório de Inspeção de Tratamento de Superfície - Reparo"
  ],
  [
    "RIVVT",
    "Relatório de Verificação de Válvulas"
  ],
  [
    "RL",
    "Emissão e Aprovação via SIGEM da Documentação, conforme Cod. da N-1710"
  ],
  [
    "RLFAB",
    "Relatório de Fabricação de Suportes"
  ],
  [
    "RLISOL",
    "Relatório de Isolamento Térmico"
  ],
  [
    "RLMANG",
    "Relatório de Montagem de Mangotes"
  ],
  [
    "RLMTCL",
    "Relatório de Montagem e Calibração de Item Tagueado"
  ],
  [
    "RLPIN",
    "Relatório de Pintura"
  ],
  [
    "RLRCD",
    "Relatório de Recondicionamento de Item Tagueado"
  ],
  [
    "RLREVEST",
    "Relatório de Revestimento"
  ],
  [
    "RLSUP",
    "Relatório de Suportação Final do STH"
  ],
  [
    "RMCME",
    "Relatório de Montagem de Caixa de Medição de Espessura"
  ],
  [
    "RME",
    "RELATÓRIO DE MEDIÇÃO DE ESPESSURA POR ULTRA-SOM"
  ],
  [
    "RMTCL",
    "Relatório de Montagem e Calibração de Item Tagueado"
  ],
  [
    "RMTPR",
    "Relatório de Montagem dos Trilhos da Ponte Rolante"
  ],
  [
    "RMTVI",
    "RELATÓRIO DE MANUTENCAO E TESTE DE VÁLVULAS DE INSTRUMENTAÇÃO"
  ],
  [
    "RNC",
    "RELATÓRIO DE NÃO CONFORMIDADE"
  ],
  [
    "RPIN",
    "Relatório de Pintura"
  ],
  [
    "RPL",
    "Resolução do Punch List"
  ],
  [
    "RPLH",
    "Resolução do Punch List hardware"
  ],
  [
    "RPLS",
    "Resolução do Punch List software"
  ],
  [
    "RSOFT-CPS",
    "Configuração de software - CPS - Entrega cenário de Teste Triconex SV)"
  ],
  [
    "RSOFT-DESC",
    "Configuração de software - DC - Dinamizar as Telas"
  ],
  [
    "RSOFT-SCMD",
    "Configuração de software - SCMD - Dinamizar as Telas"
  ],
  [
    "RSOFT-SDCD",
    "Configuração de software - SDCD - Dinamizar as Telas"
  ],
  [
    "RREMG",
    "Relatório de Execução e Inspeção de Montagem - Guias e Chapas Deslizantes - Reparo"
  ],
  [
    "RRIDC",
    "Relatório de Execução e Inspeção de Montagem - Chapas de Deslizamento - Reparo"
  ],
  [
    "RRII",
    "Relatório de Reparo de Inspeção de Isolamento"
  ],
  [
    "RRIMD",
    "Relatório de Inspeção de Montagem - Damper - Reparo"
  ],
  [
    "RRIMG",
    "Relatório de Inspeção Montagem - Guilhotina - Reparo"
  ],
  [
    "RRIMS",
    "Relatório de Inspeção de Montagem - Suportes de Mola - Reparo"
  ],
  [
    "RRIMT",
    "Relatório de Inspeção de Montagem dos Tubos Catalisadores - Reparo"
  ],
  [
    "RRMCP",
    "Relatório de Inspeção de Montagem - Chapas Perfuradas - Reparo"
  ],
  [
    "RRRF",
    "Relatório de Reparo de Refratário - Formado"
  ],
  [
    "RTA",
    "Relatório de Teste de Aderência"
  ],
  [
    "RTACH-CPS",
    "Relatório do Teste de Aceitação de Campo de Hardware"
  ],
  [
    "RTACH-SDCD",
    "Relatório do Teste de Aceitação de Campo de Hardware"
  ],
  [
    "RTACS",
    "Relatório de Teste de Aceitação de Campo de Software"
  ],
  [
    "RTACS-CPS",
    "Relatório do Teste de Aceitação de Campo de Software"
  ],
  [
    "RTACS-SDCD",
    "Relatório do Teste de Aceitação de Campo de Software"
  ],
  [
    "RTAFH-CPS",
    "Relatório de Teste de Aceitação de Fábrica do Hardware"
  ],
  [
    "RTAFH-SDCD",
    "Relatório de Teste de Aceitação de Fábrica do Hardware"
  ],
  [
    "RTAFS-CPS",
    "Relatório de Teste de Aceitação de Fábrica do Software"
  ],
  [
    "RTAFS-DESC",
    "Relatório de Teste de Aceitação de Fábrica do Software"
  ],
  [
    "RTAFS-SCMD",
    "Relatório de Teste de Aceitação de Fábrica do Software"
  ],
  [
    "RTAFS-SDCD",
    "Relatório de Teste de Aceitação de Fábrica do Software"
  ],
  [
    "RTAR",
    "Relatório de Teste de Aderência - Reparo"
  ],
  [
    "RTCFO",
    "Relatório de Teste e Certificação de Fibra Óptica"
  ],
  [
    "RTDBE",
    "Relatório dos Testes de Desempenho da Botoeira"
  ],
  [
    "RTDBSE",
    "Relatório dos Testes de Desempenho das Botoeiras Elétricas e Sinalizadores"
  ],
  [
    "RTDBT",
    "Relatório dos Testes de Desempenho do Banco de Baterias"
  ],
  [
    "RTDCB",
    "Relatório dos Testes de Desempenho do Carregador de Bateria"
  ],
  [
    "RTDCE",
    "Relatório dos Testes de Desempenho dos Cabos Elétricos"
  ],
  [
    "RTDCF",
    "Relatório dos Testes de Desempenho do Conversor de Frequência"
  ],
  [
    "RTDCFU",
    "Relatório dos Testes de Desempenho do Conversor de Mídia"
  ],
  [
    "RTDCJE",
    "Relatório dos Testes de Desempenho da Caixa de Junção Elétrica"
  ],
  [
    "RTDCJT",
    "Relatório dos Testes de Desempenho da Caixa de Junção de Telecomunicações"
  ],
  [
    "RTDCT",
    "Relatório dos Testes de Desempenho dos Cabo de Telecomunicações"
  ],
  [
    "RTDCV",
    "Relatório dos Testes de Desempenho da Câmera"
  ],
  [
    "RTDDB",
    "Relatório dos Testes de Desempenho do Duto de Barra"
  ],
  [
    "RTDDJ",
    "Relatório dos Testes de Desempenho do Disjuntor"
  ],
  [
    "RTDDO",
    "Relatório dos Testes de Desempenho do Distribuidor Óptico"
  ],
  [
    "RTDES",
    "Relatório dos Testes de Desempenho dos Equipamentos e Sistemas Especiais"
  ],
  [
    "RTDLC",
    "Relatório dos Testes de Desempenho do Leitor de Cartão e Teclado de Acesso"
  ],
  [
    "RTDLM",
    "Relatório dos Testes de Desempenho das Luminárias"
  ],
  [
    "RTDMT",
    "Relatório dos Testes de Desempenho do Motor"
  ],
  [
    "RTDPN",
    "Relatório dos Testes de Desempenho do Painel Elétrico"
  ],
  [
    "RTDPP",
    "Relatório dos Testes de Desempenho do Patch Panel"
  ],
  [
    "RTDRP",
    "Relatório dos Testes de Desempenho do Relé de Proteção"
  ],
  [
    "RTDRS",
    "Relatório dos Testes de Desempenho do Resistor de Aterramento"
  ],
  [
    "RTDSPDA",
    "Relatório dos Testes de Desempenho do SPDA"
  ],
  [
    "RTDSW",
    "Relatório dos Testes de Desempenho do Switch"
  ],
  [
    "RTDTE",
    "Relatório dos Testes de Desempenho das Tomada Elétrica Não Tagueadas"
  ],
  [
    "RTDTF",
    "Relatório dos Testes de Desempenho do Transformador"
  ],
  [
    "RTDTL",
    "Relatório dos Testes de Desempenho do Telefone"
  ],
  [
    "RTDTS",
    "Relatório dos Testes de Desempenho da Tomada de Solda"
  ],
  [
    "RTFCJI",
    "RELATÓRIO DE TESTE FUNCIONAL EM CAIXAS DE JUNÇÃO DE INSTRUMENTAÇÃO"
  ],
  [
    "RTIS",
    "RELATÓRIO DE TESTE DE INTEGRAÇÃO DE SISTEMAS"
  ],
  [
    "RTTAT",
    "RELATÓRIO DE TRATAMENTO TÉRMICO DE ALÍVIO DE TENSÕES"
  ],
  [
    "RUFF",
    "Relatório de Usinagem em Face de Flange"
  ],
  [
    "RUS",
    "Relatório de Ensaio Ultrassom - Reparo"
  ],
  [
    "SUP.MOLA.SPIE",
    "CERTIFICADO DE CALIBRAÇÃO DE SUPORTE DE MOLA"
  ],
  [
    "TFEM",
    "Relatório de Torqueamento Final de Estruturas Metálicas"
  ],
  [
    "TH.SPIE",
    "CERTIFICADO DE TESTE HIDROSTÁTICO"
  ],
  [
    "TREINCT",
    "Treinamento para Equipamentos Fornecidos pela Contratada"
  ],
  [
    "TREINPB",
    "Treinamento para Equipamentos Fornecidos pela Petrobras"
  ],
  [
    "TTAS1",
    "Termo de Transferência e Aceitação de Sistema, sem pendências impeditivas à partida do SOP"
  ],
  [
    "TTAS2",
    "Termo de Transferência e Aceitação de Sistema final, sem pendências do SOP"
  ],
  [
    "TTI",
    "Termo de transferência de instalações"
  ],
  [
    "US",
    "Relatório de Ensaio Ultrassom"
  ],
  [
    "USJE",
    "Relatório de Ensaio Ultrassom - Juntas Existentes"
  ],
  [
    "US-ME",
    "RELATÓRIO DE MEDIÇÃO DE ESPESSURA + ANÁLISE DE VIDA RESIDUAL"
  ],
  [
    "US-ME.SPIE",
    "RELATÓRIO DE MEDIÇÃO DE ESPESSURA + ANÁLISE DE VIDA RESIDUAL"
  ]
];

  const REPORT_TITLES = Object.freeze(RAW_REPORT_TITLES.map((entry) => Object.freeze(entry.slice())));
  const REPORTS_BY_CODE = new Map();
  REPORT_TITLES.forEach(([code, title]) => {
    if (!REPORTS_BY_CODE.has(code)) REPORTS_BY_CODE.set(code, []);
    const titles = REPORTS_BY_CODE.get(code);
    if (!titles.some((candidate) => normalize(candidate) === normalize(title))) titles.push(title);
  });

  const GENERIC_DOCUMENT_TYPES = Object.freeze({
    C: "CARTA",
    E: "E-MAIL",
    GRD: "GUIA DE REMESSA DE DOCUMENTO",
    GRDT: "GUIA DE REMESSA DE DOCUMENTO TÉCNICO",
    OD: "ON DEMAND",
    AR: "ATA DE REUNIÃO",
    CV: "CURRÍCULO",
    CT: "CONSULTA TÉCNICA",
    SIT: "SOLICITAÇÃO DE INFORMAÇÕES TÉCNICAS",
    CR: "CRONOGRAMA",
    PR: "PROCEDIMENTO",
    DE: "DESENHO",
    RT: "RELATÓRIO TÉCNICO",
    MD: "MEMORIAL DESCRITIVO",
    MC: "MEMÓRIA DE CÁLCULO",
    LM: "LISTA DE MATERIAIS",
    ET: "ESPECIFICAÇÃO TÉCNICA",
    FD: "FOLHA DE DADOS",
    IE: "INSTRUÇÃO DE EXECUÇÃO",
    PL: "PLANO",
    RL: "RELATÓRIO",
    CE: "CERTIFICADO",
  });

  const TOKEN_STOP_WORDS = new Set(["A", "AS", "O", "OS", "DE", "DA", "DAS", "DO", "DOS", "E", "EM", "PARA", "POR"]);

  function text(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function normalize(value) {
    return text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-")
      .toUpperCase()
      .replace(/\s+/g, " ");
  }

  function cleanCode(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function reportCodeFromDocument(document) {
    const raw = text(document).replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    const groups = raw.split("_");
    if (groups.length < 6 || normalize(groups[1]) !== "RNEST") return "";
    return cleanCode(groups[5]);
  }

  function documentTypeCode(document) {
    const raw = text(document).replace(/\.(?:PDF|DOCX?|XLSX?|XLSM|DWG|DGN|PPTX?)$/i, "");
    const reportCode = reportCodeFromDocument(raw);
    if (reportCode) return reportCode;
    if (/-C1O-CV-/i.test(raw)) return "CV";
    const first = cleanCode(raw.split(/[-_]/)[0]);
    if (GENERIC_DOCUMENT_TYPES[first]) return first;
    const administrative = normalize(raw).match(/-(GRDT|GRD|OD|AR|CV|SIT|CT|C|E)-(?=\d)/);
    return administrative ? administrative[1] : "";
  }

  function reportTitlesFor(code) {
    return (REPORTS_BY_CODE.get(cleanCode(code)) || []).slice();
  }

  function tokens(value) {
    return new Set(normalize(value).split(/[^A-Z0-9]+/).filter((token) => token.length >= 2 && !TOKEN_STOP_WORDS.has(token)));
  }

  function candidateCoverage(candidate, evidence) {
    const candidateTokens = tokens(candidate);
    const evidenceTokens = tokens(evidence);
    if (!candidateTokens.size || !evidenceTokens.size) return 0;
    let overlap = 0;
    candidateTokens.forEach((token) => {
      if (evidenceTokens.has(token)) overlap += 1;
    });
    return overlap / candidateTokens.size;
  }

  function chooseReportTitle(candidates, evidenceTitles) {
    if (!candidates.length) return { title: "", ambiguous: false, chosenByHistory: false, score: 0 };
    if (candidates.length === 1) return { title: candidates[0], ambiguous: false, chosenByHistory: false, score: 1 };
    const evidence = (evidenceTitles || []).map(text).filter(Boolean);
    const ranked = candidates.map((title, order) => ({
      title,
      order,
      score: evidence.reduce((best, item) => Math.max(best, candidateCoverage(title, item)), 0),
    })).sort((left, right) => right.score - left.score || left.order - right.order);
    const chosenByHistory = Boolean(ranked[0].score > (ranked[1] && ranked[1].score || 0));
    return {
      title: ranked[0].title,
      ambiguous: !chosenByHistory,
      chosenByHistory,
      score: ranked[0].score,
    };
  }

  function resolve(document, options) {
    const settings = options || {};
    const code = documentTypeCode(document);
    const reportCandidates = reportTitlesFor(code);
    if (reportCandidates.length) {
      const choice = chooseReportTitle(reportCandidates, [
        ...(settings.previousTitles || []),
        settings.referenceType,
        settings.currentTitle,
      ]);
      return {
        code,
        title: choice.title,
        kind: "report-table",
        source: `${STANDARD.document} Rev. ${STANDARD.revision} · ${STANDARD.reportTable} · Grupo 6 ${code}`,
        normative: true,
        candidates: reportCandidates,
        ambiguous: choice.ambiguous,
        chosenByHistory: choice.chosenByHistory,
        historyScore: choice.score,
      };
    }
    const genericTitle = GENERIC_DOCUMENT_TYPES[code] || "";
    if (genericTitle) {
      return {
        code,
        title: genericTitle,
        kind: "document-code",
        source: `${STANDARD.document} Rev. ${STANDARD.revision} · tipo documental ${code}`,
        normative: true,
        candidates: [genericTitle],
        ambiguous: false,
        chosenByHistory: false,
        historyScore: 0,
      };
    }
    return {
      code,
      title: "",
      kind: "unknown",
      source: "",
      normative: false,
      candidates: [],
      ambiguous: false,
      chosenByHistory: false,
      historyScore: 0,
    };
  }

  return Object.freeze({
    STANDARD,
    REPORT_TITLES,
    GENERIC_DOCUMENT_TYPES,
    normalize,
    reportCodeFromDocument,
    documentTypeCode,
    reportTitlesFor,
    candidateCoverage,
    resolve,
    reportRowCount: REPORT_TITLES.length,
    reportCodeCount: REPORTS_BY_CODE.size,
  });
});

