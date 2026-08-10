# RECON

Relações e conformidade documental da Qualidade.

Versão atual: **1.26.30**.

## Execução

Abra `index.html` no Microsoft Edge ou publique os arquivos estáticos no Vercel.

Ao abrir com `file://`, os Web Workers ficam desligados por restrição do
navegador e o processamento acontece na própria interface. Para arquivos
grandes, prefira a versão publicada em HTTP/HTTPS.

## Estrutura

Aplicativo local em HTML, CSS e JavaScript, sem React e sem servidor obrigatório.

Os módulos (Relações, Alocação, Databook, Títulos, TAGs, Renomeador e Bases) são
carregados sob demanda por `recon_module_loader.js`. Os catálogos de referência
(`scon_*.js`, `tag_reference_catalog.js`) também são carregados apenas quando a
disciplina correspondente é necessária.

Cada módulo pode ser aberto direto pela URL: `index.html#relations`,
`#allocation`, `#tags`, `#databook`, `#titles`, `#renamer` ou `#bases`.

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
