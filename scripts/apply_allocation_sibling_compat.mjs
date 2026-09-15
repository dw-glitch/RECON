import fs from "node:fs";

const path = "allocation_core.js";
let source = fs.readFileSync(path, "utf8");
const before = `    return {
      ...empty,
      reason: "REVISAR CAMINHO DE ALOCAÇÃO — EAP " + eap + " sem caminho seguro na Base - Caminho das Pastas.",
      blockFallback: true,
    };`;
const after = `    // Compatibilidade legada: se a árvore mestre realmente não cobre o EAP e
    // também não há EAP exata no histórico, uma EAP irmã do mesmo subgrupo pode
    // fornecer apenas os níveis que são comuns a todos os irmãos. Esse fallback
    // nunca roda quando a Base - Caminho das Pastas possui candidatos.
    const sibling = levelsFromSiblingEaps(control.levelsByEap, eap);
    if (sibling.some(Boolean) && levelsCompatibleWithRecord(sibling, record)) {
      return {
        levels: sibling.slice(),
        source: "Histórico de EAP irmã (Base sem cobertura)",
        sourceType: "history-sibling",
        confidence: "baixa",
        reason: "EAP " + eap + " não existe na Base; preservados somente níveis comuns de EAPs irmãs compatíveis.",
        blockFallback: false,
        candidateCount: 0,
      };
    }

    // Sem qualquer candidato na Base, não bloqueie fontes oficiais posteriores
    // do próprio documento (base documental/histórico). outputFromRecord ainda
    // valida a disciplina antes de permitir que esses níveis sejam exportados.
    return {
      ...empty,
      source: "Base - Caminho das Pastas sem cobertura",
      sourceType: "project-base-missing",
      confidence: "revisar",
      reason: "EAP " + eap + " sem candidato na Base - Caminho das Pastas; avaliar fontes oficiais do próprio documento.",
      blockFallback: false,
    };`;
const index = source.indexOf(before);
if (index < 0) throw new Error("Trecho final da resolução EAP não encontrado");
if (source.indexOf(before, index + before.length) >= 0) throw new Error("Trecho final da resolução EAP duplicado");
source = source.slice(0, index) + after + source.slice(index + before.length);
fs.writeFileSync(path, source);
console.log("Fallback seguro de EAP irmã e histórico direto preservados.");
