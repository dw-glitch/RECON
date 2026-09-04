import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Trecho não encontrado: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Trecho duplicado: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

let app = fs.readFileSync("allocation_app.js", "utf8");
app = replaceOnce(
  app,
`  function allocationHistoryFiles(fileList) {
    return [...(fileList || [])].filter((file) => !/^~\\$/.test(file.name) && Number(file.size) > 0
      && /C1O-ALOC-CM-\\d{4}-\\d{4}.*\\.(?:xlsx|xlsm|xls)$/i.test(file.name));
  }`,
`  function allocationHistoryFiles(fileList) {
    // O conteúdo da planilha, e não o nome do arquivo, define se ela é um
    // histórico válido. Pacotes antigos/renomeados podem usar espaços,
    // underscores ou descrições adicionais no nome; filtrá-los pelo padrão
    // C1O-ALOC-CM fazia o RECON ignorar histórico real antes mesmo de ler a
    // planilha.
    return [...(fileList || [])].filter((file) => !/^~\\$/.test(file.name) && Number(file.size) > 0
      && /\\.(?:xlsx|xlsm|xls)$/i.test(file.name));
  }`,
  "allocationHistoryFiles",
);
fs.writeFileSync("allocation_app.js", app);

let core = fs.readFileSync("allocation_core.js", "utf8");

core = replaceOnce(
  core,
`    EQP_SEGURANCA: Object.freeze({
      RIR: "UHDT-D|DATA BOOK C&M|EQP SEGURANÇA|RIR EQP_SEGURANÇA",
      CM: "UHDT-D|DATA BOOK C&M|EQP SEGURANÇA|C&M_EQP. SEGURANÇA",
    }),
    PINTURA: Object.freeze({`,
`    EQP_SEGURANCA: Object.freeze({
      RIR: "UHDT-D|DATA BOOK C&M|EQP SEGURANÇA|RIR EQP_SEGURANÇA",
      CM: "UHDT-D|DATA BOOK C&M|EQP SEGURANÇA|C&M_EQP. SEGURANÇA",
    }),
    QUALIDADE: Object.freeze({
      CM: "UHDT-D|DATA BOOK C&M|GERAL - PROCEDIMENTOS DE EXECUÇÃO|QUALIDADE",
    }),
    PINTURA: Object.freeze({`,
  "fallback QUALIDADE",
);

core = replaceOnce(
  core,
`    if (/HVAC|VENTIL|AR CONDICIONADO/.test(value)) return "HVAC";
    if (/SEGUR|^SEG$/.test(value)) return "EQP_SEGURANCA";
    if (/PINT/.test(value)) return "PINTURA";`,
`    if (/HVAC|VENTIL|AR CONDICIONADO/.test(value)) return "HVAC";
    if (/SEGUR|^SEG$/.test(value)) return "EQP_SEGURANCA";
    if (/QUAL|^QUA$/.test(value)) return "QUALIDADE";
    if (/PINT/.test(value)) return "PINTURA";`,
  "disciplina QUALIDADE",
);

core = replaceOnce(
  core,
`  function parseHistoricalAllocationWorkbook(workbook, XLSX, sourceName) {
    const rows = [];
    const allocationFromName = text(sourceName).match(/C1O-ALOC-CM-\\d{4}-\\d{4}/i);`,
`  function parseHistoricalAllocationWorkbook(workbook, XLSX, sourceName) {
    const rows = [];
    // Histórico real pode ter sido renomeado depois do envio. Aceita hífen,
    // espaço ou underscore entre os blocos e normaliza de volta para o código
    // oficial antes de comparar/ordenar.
    const allocationNameMatch = text(sourceName).match(/C1O[-_ ]*ALOC[-_ ]*CM[-_ ]*(\\d{4})[-_ ]*(\\d{4})/i);
    const allocationFromName = allocationNameMatch
      ? `C1O-ALOC-CM-${allocationNameMatch[1]}-${allocationNameMatch[2]}`
      : "";`,
  "nome histórico flexível",
);

core = replaceOnce(
  core,
`        if (candidate.has("NOMEDOCUMENTO") || candidate.has("DOCUMENTO")) {
          headerIndex = index;
          map = candidate;
          break;
        }`,
`        if (["NOMEDOCUMENTO", "NOME DOCUMENTO", "NOME DO DOCUMENTO", "DOCUMENTO", "CODIGO DO DOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO DOCUMENTO", "CÓDIGO DOCUMENTO"].some((header) => candidate.has(norm(header)))) {
          headerIndex = index;
          map = candidate;
          break;
        }`,
  "cabeçalhos históricos",
);

core = replaceOnce(
  core,
`        const document = text(rowValue(row, map, ["NomeDocumento", "DOCUMENTO"]));`,
`        const document = text(rowValue(row, map, ["NomeDocumento", "NOME DOCUMENTO", "NOME DO DOCUMENTO", "DOCUMENTO", "CODIGO DO DOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO DOCUMENTO", "CÓDIGO DOCUMENTO"]));`,
  "coluna documento histórico",
);

core = replaceOnce(
  core,
`          allocation: text(rowValue(row, map, ["ALOCAÇÃO"])) || (allocationFromName ? allocationFromName[0].toUpperCase() : ""),`,
`          allocation: text(rowValue(row, map, ["ALOCAÇÃO"])) || allocationFromName,`,
  "alocação pelo nome normalizado",
);

core = replaceOnce(
  core,
`      const candidateKind = titleKind(candidateTitle);
      const candidateSubjects = subjectTags(row.document, candidateEffectiveTitle, row.databook);
      const subjectMatch = setsIntersect(targetSubjects, candidateSubjects);
      const similarity = titleSimilarityFromTokens(targetTitleTokens, titleTokens(candidateEffectiveTitle));
      const kindMatch = Boolean(targetKind && candidateKind && targetKind === candidateKind);
      if (targetKind && candidateKind && !kindMatch) return;
      if (targetSubjects.size && !subjectMatch) return;
      if (!kindMatch && similarity < 0.32) return;`,
`      const candidateKind = titleKind(candidateTitle);
      const candidateSubjects = subjectTags(row.document, candidateEffectiveTitle, row.databook);
      const subjectMatch = setsIntersect(targetSubjects, candidateSubjects);
      const similarity = titleSimilarityFromTokens(targetTitleTokens, titleTokens(candidateEffectiveTitle));
      const kindMatch = Boolean(targetKind && candidateKind && targetKind === candidateKind);
      // Planilhas oficiais de alocação normalmente não possuem a coluna Título.
      // Para PR da N-1710, a família já combina categoria PR + código de serviço
      // (ex.: PR|700). Se o histórico não traz título, não o descarte antes de
      // avaliar sequência, disciplina e consistência do Caminho Databook.
      const structuralPrHistory = sourceType === "history" && targetFamily.type === "PR" && !candidateKind;
      if (targetKind && candidateKind && !kindMatch) return;
      if (targetSubjects.size && !subjectMatch && !structuralPrHistory) return;
      if (!kindMatch && similarity < 0.32 && !structuralPrHistory) return;`,
  "histórico estrutural PR",
);

core = replaceOnce(
  core,
`    const strong = sourceType === "history"
      ? (top.documents.size >= 2 && share >= 0.60 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.6)))
        || (top.documents.size === 1 && ranked.length === 1 && top.maxScore >= 118)
      : top.documents.size >= 2 && share >= 0.72 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.7));`,
`    const strong = sourceType === "history"
      ? (top.documents.size >= 2 && share >= 0.60 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.6)))
        || (top.documents.size === 1 && ranked.length === 1 && top.maxScore >= 118)
        // Um único PR histórico da mesma família é evidência suficiente quando
        // não existe caminho concorrente: a família PR|serviço é estrutural e
        // a pontuação ainda exige proximidade/consistência mínima.
        || (targetFamily.type === "PR" && top.documents.size === 1 && ranked.length === 1 && top.maxScore >= 77)
      : top.documents.size >= 2 && share >= 0.72 && (!targetKind || kindSupport >= Math.ceil(top.candidates.length * 0.7));`,
  "força histórica PR",
);

fs.writeFileSync("allocation_core.js", core);
console.log("PR/N-1710 fix aplicado.");
