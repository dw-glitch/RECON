# PR F — Matriz documental por disciplina (GRCON e RECON)

Entrega em 02/10/2026. Escopo exclusivo: dw-glitch/GRCON e dw-glitch/RECON.
A autorização do usuário substitui as referências a ReconDocs nas fases posteriores do plano original. Outros aplicativos ficam fora deste plano.

## Comportamento

O catálogo compartilhado contém 175 relações família × fase: 33 N-1692, 65 N-1883, 67 N-2040 e 10 N-1784. Uma mesma família pode aparecer em várias fases.
A disciplina técnica e a fase são selecionadas pelo operador. Classe de serviço N-1710, número da TAG ou aba não comprovam a disciplina. EAP/escopo opcional exige valor explícito idêntico em cada linha.

A conferência lê LD, SCON, escopo contratual, Documentos Previstos e, no GRCON, Consulta Geral. O GRCON reutiliza a LD atualmente analisada e as bases compartilhadas carregadas, sem escrever nelas. O RECON reutiliza a LD carregada em Relações; LDs usadas somente em Alocação podem ser anexadas na matriz. Fontes adicionais não substituem bases operacionais.

Correspondência por palavras do título e categoria é indício de família. Registros com código e disciplina explícita em fonte documental recebem INFORMAÇÃO: família identificada. SCON, registros sem disciplina ou sem código permanecem candidatos em ALERTA. Não há certificação de conteúdo, quantitativos, aceite, revisão ou completude. Dispensas/documentos combinados devem ser conferidos no escopo.

Documentos Previstos com apenas código complementam evidências de outras fontes e não inferem família. A matriz nunca cria, remove, seleciona ou bloqueia alocações. Nenhum alerta normativo desta ferramenta é elevado a bloqueio.

Os arquivos de origem são lidos localmente, com limite de 40 MB/100.000 linhas por fonte adicional. Paginação de 50 famílias, até 20 evidências exibidas/exportadas por grupo e contagem total preservada. Cabeçalhos documentais repetidos são recusados. Alterações de fonte/configuração invalidam o resultado antes da próxima exportação.

JSON registra versão da matriz/catálogo, contexto, fontes/snapshots, norma/revisão/item/hash, evidências e limites. GRCON e RECON consultam o mesmo formato; importação é histórica, não assinatura ou revalidação automática da evidência. Versão, catálogo, contexto e hash são conferidos, e resultado/contagens são recalculados. CSV neutraliza fórmulas e mantém as referências documentais.

## Fontes auditadas

PDFs extraídos do pacote enviado Downloads(1).7z; os PDFs não são redistribuídos nos repositórios. Hashes e revisão de cada cópia estão em discipline_document_catalog.js.

| Norma | Cópia enviada | Extração usada | Limite |
| --- | --- | --- | --- |
| N-1692 | D 04/2019 + 1ª Emenda 03/2021 | Seção 4/Tabela 1 e seções 5–33; tabela revisada visualmente | Dispensa Petrobras; práticas recomendadas preservadas. |
| N-1883 | F 05/2024 | 5.1–5.2 e famílias 6.1.1–6.1.18 / 6.2.1–6.2.47 | Lista acordada, omissões/combinações/fases conforme projeto. |
| N-2040 | F 03/2017, revalidação 12/2023 | Núcleo de famílias 5.2–5.5 | Não transcreve todos os subitens, documentos offshore ou de fabricantes. Aplicabilidade definida no Anexo C/contrato. |
| N-1784 | C 11/2011 + 1ª Emenda 04/2014 | 4.1.2 e desenhos 4.4.1–4.4.2 | Fundações/concreto, sem generalizar para estruturas metálicas. |

A revisão auditada é a da cópia fornecida, não uma declaração de vigência universal em 2026. Esse catálogo de famílias não promove normas para regras impeditivas no registro normativo do GRCON. Conteúdo completo das normas e adequação contratual continuam sujeitos à avaliação responsável.

## Acesso

GRCON: Ferramentas adicionais → Matriz documental por disciplina.
RECON: Matriz documental no menu lateral; URL #matrix.

## Validação

- Regressões do motor: fase, disciplinas, candidatos, fontes, códigos sem metadados, EAP, versão, hash, snapshot, fórmulas CSV e volume.
- GRCON: npm run verify (typecheck, oito builds e regressões completas).
- RECON: validação estática e todas as regressões da workflow validate.yml.
- Chromium: upload XLSX real, Documentos Previstos, relatório JSON, consulta entre apps, mudança de contexto, recorte, navegação, desktop 1440/1024 e tema escuro.

Próxima fase: rastreabilidade de conferências e tratamento de exceções justificados dentro de GRCON e RECON.
