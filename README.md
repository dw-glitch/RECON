# RECON

Relações e conformidade documental da Qualidade.

Versão atual: **1.26.48**.

## Execução

Abra `index.html` no Microsoft Edge ou publique os arquivos estáticos no Vercel.

Ao abrir com `file://`, os Web Workers ficam desligados por restrição do
navegador e o processamento acontece na própria interface. Para arquivos
grandes, prefira a versão publicada em HTTP/HTTPS.

## Estrutura

Aplicativo local em HTML, CSS e JavaScript, sem React e sem servidor obrigatório.

Os módulos (Relações, Alocação, Databook, Títulos, TAGs, Renomeador e Bases) são
carregados sob demanda por `recon_module_loader.js`. Os catálogos de referência
(`scon_*.js`, `tag_reference_catalog.js`, `valve_list_catalog.js`) também são carregados sob demanda. Na
revisão de títulos, todos os fragmentos SCON são reunidos para permitir a busca
da mesma TAG mesmo quando sua descrição está registrada em outra disciplina.

Na correção de títulos, o tipo documental é colocado na frente da descrição
localizada nas bases. O RECON usa a ET-5290.00-22000-912-1LV-001 Rev. P como
norma vigente, consulta a Tabela 13 pelo Grupo 6 dos relatórios e compara o
padrão com títulos anteriores da própria LD antes de montar a recomendação.
A TAG usada na busca vem do Grupo 7 do nome do documento. Para válvulas manuais,
a prioridade é a LI-5290.00-22313-940-CHZ-202 Rev. C; linhas canceladas são
ignoradas e a SCON TAG SGP assume como fallback, mesmo quando a descrição está
em outra disciplina. Para as demais TAGs, SCON e Apêndice 3 podem se
complementar. A SCON ESCOPO só descreve o título quando nenhuma fonte anterior
resolveu a TAG, evitando recomendações vazias.

Cada módulo pode ser aberto direto pela URL: `index.html#relations`,
`#allocation`, `#tags`, `#databook`, `#titles`, `#renamer` ou `#bases`.

No Gerador de Alocação, a recomendação automática deixa situações bloqueadas
desmarcadas, mas o usuário pode selecionar manualmente qualquer linha que tenha
saída técnica válida. A geração pode separar os selecionados por
disciplina/workflow ou reunir tudo no mesmo número de alocação. O relatório da
análise registra o diagnóstico operacional e destaca inclusões manuais. A
consulta rápida de Databook aceita várias linhas no formato Documento + Título.

O caminho de Databook vem da base `Caminho data book_Rev.C.xlsx`, lida da aba
`CAMINHO DB_SIGEM`. A Rev.C escreve a unidade como marcador (`UHDT-X`) porque o
mapa vale para mais de uma unidade; o RECON troca esse marcador pelo N1 real
declarado nas abas `NÍVEL_CAMINHO` e `ESTUTURA` antes de usar o caminho.

A escolha do caminho segue esta ordem: caminho já preenchido na LD, histórico do
próprio documento, documentos da mesma família, melhor encaixe no Mapa Databook
e, por último, a pasta da disciplina no próprio mapa — RIR ou C&M conforme a
família do documento, ou a pasta mais próxima do título quando a disciplina não
separa RIR de C&M, como PINTURA. O caminho geral da disciplina só entra quando
nenhuma dessas pastas resolve, e continua identificado como fallback na análise.

Os níveis N1 a N10 são a EAP do projeto, não as pastas do Databook: N1 é a
unidade, N2 é o grupo da EAP e N3 o subgrupo (`UHDTD U-32`, `03.REPARO`,
`03.04.CIVIL`). Eles vêm da EAP do Grupo 4 do nome do documento, resolvida pelo
controle e pelas alocações anteriores. Quando a EAP exata ainda não apareceu, as
EAPs irmãs — mesmo grupo e mesmo subgrupo — resolvem os níveis que têm em comum.

Carregar as alocações já emitidas como histórico é o que deixa o gerador exato:
com elas, o caminho e os níveis de um documento repetem a decisão anterior em vez
de serem reinferidos.

Nas linhas da Central de Alocação, a coluna ABA é o número da LD identificado no
nome do arquivo anexado (`ET_LD_003`, `ET_LD_004` ou `N-1710_LD_001`). A coluna
VERSÃO DA LD recebe o prazo descrito na LD, copiado exatamente como está na
planilha (data, texto ou prazo contratual): o RECON procura o prazo em qualquer
coluna cujo cabeçalho fale de prazo e dá preferência à coluna `PRAZO`. Sem prazo
para aquele documento, a coluna volta a trazer a versão da LD enviada, para não
sair em branco. O relatório da análise mostra o valor aproveitado na coluna
`PRAZO NA LD (COLUNA VERSÃO DA LD)`. A Data Prevista é sempre a data atual da
geração, sem reaproveitar datas antigas do histórico.

## Bases de referência

A aba Bases (`#bases`) lista as bases que o RECON reconhece, de qual arquivo
cada uma veio e quantos registros tem. Qualquer uma pode ser substituída por uma
planilha do usuário e fixada: `bases_core.js` converte as colunas para o formato
que os leitores do `audit_core.js` esperam e `bases_app.js` guarda o resultado no
IndexedDB (store `base_overrides`), de modo que a troca continue valendo depois
de fechar o navegador. Enquanto existe substituição, a conferência de volume da
base incorporada vira aviso na própria aba, em vez de bloquear a análise.

## Validação

O GitHub Actions (`.github/workflows/validate.yml`) verifica sintaxe JavaScript,
presença do `index.html`, IDs HTML duplicados, referências locais ausentes e roda
a suíte de testes.

Para rodar localmente:

```bash
python3 validate_static.py
node RECON_TESTES.mjs
```
