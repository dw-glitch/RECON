import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const exists = (name) => fs.existsSync(path.join(root, name));

const html = read("index.html");
const sw = read("sw.js");
const readme = read("README.md");

// A versão é lida do index.html em vez de fixada no teste: antes cada release
// exigia um arquivo de teste novo, com a versão no próprio nome.
const VERSION = (html.match(/name="application-version"/) && html.match(/content="([\d.]+)" name="application-version"/) || [])[1];

const appSources = fs.readdirSync(root)
  .filter((name) => name.endsWith(".js") && !name.endsWith(".min.js"))
  .filter((name) => !/^(scon_|offline_recon|tag_reference_catalog)/.test(name));

const allSources = appSources.map((name) => ({ name, source: read(name) }));

// ===================== ESTRUTURA E VERSÃO =====================

check("index.html declara uma versão de aplicação", () => {
  assert.ok(VERSION, "meta application-version ausente ou ilegível");
  assert.match(html, new RegExp(`data-version="${VERSION.replace(/\./g, "\\.")}"`));
});

check("versão é a mesma em index.html, sw.js e README", () => {
  assert.match(sw, new RegExp(`const VERSION = "${VERSION.replace(/\./g, "\\.")}"`));
  assert.match(readme, new RegExp(`Versão atual: \\*\\*${VERSION.replace(/\./g, "\\.")}\\*\\*`));
  assert.ok(html.includes(`RECON ${VERSION} ·`), "rodapé do index.html com versão divergente");
});

check("cabeçalho abre o GRCON como atalho independente", () => {
  assert.match(html, /href="https:\/\/grcon\.vercel\.app\/"/i);
  assert.match(html, /target="_blank"/i);
  assert.match(html, /rel="noopener noreferrer"/i);
});

check("RECON permanece sem cliente, sessão ou banco do GRCON", () => {
  const sources = allSources.map((item) => item.source).join("\n");
  assert.doesNotMatch(sources, /GRCON_CLOUD_CONFIG/);
  assert.doesNotMatch(sources, /supabase\.createClient|createClient\s*\(/);
  assert.doesNotMatch(sources, /grcon_history|grcon_clear_history/);
});

check("HTML não possui IDs duplicados", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});

check("manifesto declara os tamanhos reais dos ícones", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

check("service worker usa cache isolado da versão atual", () => {
  for (const prefix of ["recon-cache-v", "recon-static-v", "recon-data-v"]) {
    assert.ok(sw.includes(`\`${prefix}\${VERSION}\``), `cache ${prefix} não derivado de VERSION`);
  }
});

check("arquivos essenciais do fluxo permanecem presentes", () => {
  const required = [
    "relations_app.js", "allocation_app.js", "tag_conference_app.js",
    "audit_app.js", "audit_core.js", "renamer_app.js",
    "recon_module_loader.js", "core.js", "index.html",
  ];
  assert.deepEqual(required.filter((name) => !exists(name)), []);
});

check("todos os JavaScripts têm sintaxe válida", () => {
  const scripts = fs.readdirSync(root).filter((name) => /\.(?:m?js)$/.test(name) && !name.endsWith(".min.js"));
  const failures = [];
  for (const name of scripts) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, name)], { encoding: "utf8" });
    if (result.status !== 0) failures.push(`${name}: ${result.stderr.trim()}`);
  }
  assert.deepEqual(failures, []);
});

// ===================== REGRESSÕES CORRIGIDAS =====================
// A suíte anterior passava com todos os defeitos abaixo presentes.

check("o workflow do CI está em .github/workflows e aponta para scripts existentes", () => {
  const workflowPath = path.join(root, ".github", "workflows", "validate.yml");
  assert.ok(fs.existsSync(workflowPath), "workflow fora de .github/workflows não é executado pelo GitHub Actions");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  for (const script of workflow.match(/(?:python3|node) ([\w./-]+\.(?:py|mjs))/g) || []) {
    const file = script.split(/\s+/)[1];
    assert.ok(exists(file), `workflow referencia ${file}, que não existe`);
  }
});

check("o toast usa a classe de estado que existe no CSS", () => {
  const css = ["design-system.css", "legacy-compat.css", "recon-ui.css", "recon-final.css"]
    .map((name) => read(name)).join("\n");
  assert.match(css, /\.toast\.show/, "estado visível do toast ausente no CSS");

  // `.visible` não é definida em nenhuma folha: usá-la deixava a mensagem
  // invisível, com o texto trocado e opacidade zero.
  assert.ok(!/\.recon-toast\b/.test(css), "classe .recon-toast sem definição no CSS");
  const offenders = [["index.html", html], ...allSources.map((i) => [i.name, i.source])]
    .filter(([, source]) => /toast[^;\n]*classList\.add\(\s*["']visible["']\s*\)/.test(source))
    .map(([name]) => name);
  assert.deepEqual(offenders, [], "toast usando a classe .visible, que não existe no CSS");
});

check("o auto-save lê as chaves de filtro realmente gravadas pelos módulos", () => {
  const enhancements = read("recon_enhancements.js");
  const declared = [...enhancements.matchAll(/"(recon\.[\w.]+\.v\d)"/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, "nenhuma chave de auto-save declarada");

  const written = new Set();
  for (const { source } of allSources) {
    for (const match of source.matchAll(/["'](recon\.[\w.]+\.v\d)["']/g)) written.add(match[1]);
  }
  const unknown = declared.filter((key) => !written.has(key));
  assert.deepEqual(unknown, [], "auto-save aponta para chaves que nenhum módulo grava");
});

check("o dashboard recebe o evento que alimenta o histórico", () => {
  const listeners = allSources.filter((i) => /addEventListener\(\s*["']recon:analysis-complete["']/.test(i.source));
  assert.ok(listeners.length > 0, "ninguém escuta recon:analysis-complete");

  const emitters = allSources.filter((i) => /CustomEvent\(\s*["']recon:analysis-complete["']/.test(i.source));
  assert.ok(emitters.length > 0, "nenhum módulo dispara recon:analysis-complete — o dashboard abriria sempre vazio");
});

check("o service worker precacheia o código dos módulos, não os catálogos gigantes", () => {
  const precached = [...sw.matchAll(/^\s*"([\w./-]+\.(?:js|css|html|png|ico|json))"/gm)].map((m) => m[1]);

  for (const required of ["relations_app.js", "audit_app.js", "allocation_app.js", "xlsx.full.min.js", "recon_compute_worker.js"]) {
    assert.ok(precached.includes(required), `${required} fora do precache: o módulo não abre na primeira sessão offline`);
  }

  // Catálogos de referência são carregados sob demanda por disciplina; colocá-los
  // no precache fazia a instalação baixar mais de 6 MB desnecessários.
  // scon_catalog_loader.js é o carregador (3 KB) e deve continuar no precache;
  // os chunks de disciplina é que não.
  const heavy = precached.filter((name) => /^scon_(?!catalog_loader)|^tag_reference_catalog|^offline_recon_/.test(name));
  assert.deepEqual(heavy, [], "catálogos de referência não devem ser precacheados");
});

check("a instalação do service worker tolera recurso indisponível", () => {
  assert.match(sw, /allSettled/, "cache.addAll é atômico: um arquivo falho aborta o offline inteiro");
});

check("os atalhos do manifesto encontram roteamento por hash", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const targets = (manifest.shortcuts || [])
    .map((item) => (item.url.split("#")[1] || "").trim())
    .filter(Boolean);
  assert.ok(targets.length > 0, "manifesto sem atalhos");

  const routes = allSources.some((i) => /location\.hash/.test(i.source));
  assert.ok(routes, "nenhum arquivo lê location.hash: os atalhos do PWA não fariam nada");

  for (const target of targets) {
    assert.ok(html.includes(`data-module-view="${target}"`), `atalho #${target} sem módulo correspondente`);
  }
});

check("erros de regra de negócio no Worker não reexecutam na thread principal", () => {
  for (const name of ["recon_compute_client.js", "recon_workbook_worker_client.js"]) {
    const source = read(name);
    assert.match(source, /data\.infrastructure/, `${name} não distingue falha de infraestrutura de erro de análise`);
    assert.match(source, /failLogic/, `${name} sem caminho de erro que evita o reprocessamento`);
  }
  for (const name of ["recon_compute_worker.js", "recon_workbook_worker.js"]) {
    assert.match(read(name), /infrastructure/, `${name} não sinaliza o tipo da falha`);
  }
});

check("existe rede de segurança para erros não tratados", () => {
  const sources = allSources.map((i) => i.source).join("\n");
  assert.match(sources, /addEventListener\(\s*["']unhandledrejection["']/, "promessas rejeitadas ficariam silenciosas");
});

check("os fatos da confirmação são escapados antes de virar HTML", () => {
  const source = read("p1_ux.js");
  assert.match(source, /confirmFacts\.innerHTML[^\n]*escapeHtml\(fact\)/, "nome de arquivo e de aba entram no HTML sem escape");
});

check("o logo do relatório não é carregado no caminho crítico", () => {
  assert.ok(!/<script[^>]+src="recon-brand\.js"/.test(html),
    "recon-brand.js embute 178 KB de logo em base64 e só é usado ao exportar");
});

check("a camada final de CSS (recon-final.css) não fica órfã por versão", () => {
  // 134 regras em recon-final.css só valem com data-functional-generation="4"
  // (inclui todo o layout dos cards de título e o dimensionamento da tabela
  // de alocação). Se o atributo no <html> não bater, essas regras nunca
  // aplicam e a tabela quebra ao rolar na horizontal.
  assert.match(html, /data-functional-generation="4"/, "html raiz não declara a geração funcional 4");
  assert.doesNotMatch(html, /data-functional-generation="(?!4")/, "html raiz aponta para uma geração sem CSS correspondente");
  const finalCss = read("recon-final.css");
  assert.doesNotMatch(finalCss, /data-functional-generation="5"/, "recon-final.css não tem regras para a geração 5");
});

check("as colunas fixas da tabela de alocação usam a mesma largura das colunas reais", () => {
  const finalCss = read("recon-final.css");
  const width1 = finalCss.match(/\.allocation-decision-table th:nth-child\(1\) \{ width: (\d+)px; \}/);
  const width2 = finalCss.match(/\.allocation-decision-table th:nth-child\(2\) \{ width: (\d+)px; \}/);
  assert.ok(width1 && width2, "larguras das colunas 1 e 2 não encontradas");
  const left2 = Number(width1[1]);
  const left3 = Number(width1[1]) + Number(width2[1]);
  assert.match(finalCss, new RegExp(`allocation-decision-table td:nth-child\\(2\\) \\{ left: ${left2}px; \\}`),
    "deslocamento sticky da coluna 2 não bate com a largura real da coluna 1");
  assert.match(finalCss, new RegExp(`allocation-decision-table td:nth-child\\(3\\) \\{ left: ${left3}px; \\}`),
    "deslocamento sticky da coluna 3 não bate com a soma das larguras reais");
});

check("o título recomendado combina SCON TAG SGP com Apêndice/SCON ESCOPO quando ambos confirmam a TAG", () => {
  const source = read("audit_core.js");
  assert.match(source, /sconCombinesWithSconEscopo\s*=\s*Boolean\(trustedScon/, "combinação com SCON ESCOPO não está gerada a partir de trustedScon");
  assert.match(source, /sconCombinesWithAppendix\s*=\s*Boolean\(trustedScon/, "combinação com Apêndice não está gerada a partir de trustedScon");
  assert.match(source, /"SCON TAG SGP \+ Apêndice 3 Rev\.B/, "categoria de origem combinada SCON+Apêndice nunca é gerada");
  assert.match(source, /"SCON TAG SGP \+ SCON ESCOPO \+ Apêndice 3 Rev\.B/, "categoria de origem combinada com as três bases nunca é gerada");
});

check("existe uma opção global para restringir a fonte do título a Apêndice ou SCON", () => {
  assert.match(read("audit_core.js"), /titleSourceMode/, "auditTitles não recebe titleSourceMode");
  assert.match(read("audit_app.js"), /titleSourceMode/, "audit_app.js não lê o seletor de fonte");
  assert.match(html, /name="title-source-mode"/, "seletor de fonte (Automático\\/Apêndice\\/SCON) ausente do HTML");
  assert.match(html, /value="appendix_only"/);
  assert.match(html, /value="scon_only"/);
});

check("o título recomendado é editável antes da exportação e a edição exige nova aprovação", () => {
  const source = read("audit_app.js");
  assert.match(source, /data-proposed-edit/, "campo de título recomendado não é editável");
  assert.match(source, /autoProposed/, "sugestão automática original não é preservada para comparação");
  assert.match(source, /row\.decision = undefined/, "editar o título recomendado não invalida uma aprovação anterior");
});

check("a base SCON TAG SGP embutida tolera falha de rede em uma disciplina sem derrubar a análise inteira", () => {
  const loader = read("scon_catalog_loader.js");
  assert.doesNotMatch(loader, /await Promise\.all\(/, "ensureDisciplines ainda usa Promise.all: uma disciplina falhando derruba todas as outras");
  assert.match(loader, /Promise\.allSettled/, "carregamento das disciplinas SCON não tolera falha parcial");

  const app = read("audit_app.js");
  const start = app.indexOf("async function ensureSconForTitles");
  const end = app.indexOf("async function analyzeTitles");
  assert.ok(start >= 0 && end > start, "ensureSconForTitles não encontrada antes de analyzeTitles");
  const body = app.slice(start, end);
  assert.match(body, /try \{/, "ensureSconForTitles não protege o carregamento embutido com try/catch");
  assert.match(body, /catch \(error\) \{/, "ensureSconForTitles não trata a falha do carregamento embutido");
  assert.match(body, /falha ao carregar a base SCON TAG SGP embutida/,
    "falha ao carregar a base embutida ainda pode abortar analyzeTitles inteiro, como se nada tivesse sido gerado");
});

check("é possível abrir a LD e salvar a revisão direto no arquivo original (File System Access API)", () => {
  assert.ok(exists("recon_file_handles.js"), "módulo recon_file_handles.js ausente");
  const handles = read("recon_file_handles.js");
  assert.match(handles, /showOpenFilePicker/, "não usa showOpenFilePicker para obter permissão de escrita");
  assert.match(handles, /createWritable/, "não usa createWritable para gravar no arquivo original");
  assert.match(handles, /isSupported/, "sem checagem de suporte do navegador — quebraria em Firefox/Safari");

  assert.match(html, /id="relations-ld-open-editable"/, "botão de abrir com edição direta ausente do HTML");
  assert.match(html, /id="title-apply-ld-inplace"/, "botão de salvar título no arquivo original ausente do HTML");
  assert.match(html, /id="databook-apply-ld-inplace"/, "botão de salvar databook no arquivo original ausente do HTML");

  const relations = read("relations_app.js");
  assert.match(relations, /ldFileHandle/, "relations_app.js não guarda o handle do arquivo aberto");
  assert.match(relations, /fileHandle: state\.ldFileHandle/, "o handle não é propagado no evento recon:ld-ready");

  const app = read("audit_app.js");
  assert.match(app, /async function applyTitlesToLd\(options\)/, "applyTitlesToLd não aceita o modo inPlace");
  assert.match(app, /RECONFileHandles\.writeBuffer/, "gravação no arquivo original não usa RECONFileHandles.writeBuffer");

  const p1ux = read("p1_ux.js");
  assert.match(p1ux, /protect\("title-apply-ld-inplace"/, "botão de salvar título original sem confirmação explícita");
  assert.match(p1ux, /protect\("databook-apply-ld-inplace"/, "botão de salvar databook original sem confirmação explícita");
  assert.match(p1ux, /substitui o conteúdo do arquivo/i, "confirmação de salvar no original não avisa que o arquivo será substituído");
});

check("o RECON lembra correções de título manuais e sugere de novo quando faltar sugestão segura", () => {
  const enhancements = read("recon_enhancements.js");
  assert.match(enhancements, /title_corrections/, "object store title_corrections não foi criada no IndexedDB");
  assert.match(enhancements, /DB_VERSION:\s*[3-9]\d*/, "versão do banco não foi incrementada para criar a nova store");

  const app = read("audit_app.js");
  assert.match(app, /function titleMemoryKey/, "sem chave de memória por TAG/documento");
  assert.match(app, /function shouldRememberCorrection/, "sem checagem para só aprender edições reais, não sugestões aceitas sem alteração");
  assert.match(app, /function applyTitleMemory/, "sem aplicação da memória na análise");

  // A memória só pode preencher lacunas, nunca substituir uma sugestão que já
  // veio confiável da base controlada (SCON/Apêndice/SCON ESCOPO).
  const applyStart = app.indexOf("function applyTitleMemory");
  const applyEnd = app.indexOf("\n  }", applyStart);
  const applyBody = app.slice(applyStart, applyEnd);
  assert.match(applyBody, /if \(row\.issue === "ok" \|\| row\.proposed\) return;/,
    "memória de correções pode sobrescrever uma sugestão já confiável da base controlada");

  assert.match(app, /storeDecision[\s\S]{0,200}rememberTitleCorrection/, "aprovar um título não aciona o aprendizado da correção");
  assert.match(app, /await loadTitleMemory\(\)/, "analyzeTitles não carrega a memória de correções salva");

  assert.match(html, /id="title-memory-count"/, "sem indicador de quantas correções estão guardadas");
  assert.match(html, /id="title-memory-clear"/, "sem forma de apagar a memória de correções");
  assert.match(html, /value="learned_memory"/, "filtro de origem sem a categoria de memória de correções");
});

check("o casamento de documentos (matchDocuments) usa um índice O(1) em vez de varrer a LD inteira por item", () => {
  const source = read("core.js");
  assert.match(source, /byDocumentKey/, "buildIndex não cria o índice de correspondência exata usado pelo caminho rápido");
  assert.match(source, /DOCUMENT_EXTENSION_PATTERN/, "matchDocuments não remove a extensão do arquivo antes de comparar — nomes como .pdf nunca batem no caminho rápido");
});

check("chooseCatalogEvidence não recalcula por entrada do catálogo o que é igual para todo documento da LD", () => {
  const source = read("allocation_core.js");
  assert.match(source, /catalogEntryCache/, "sem memoização por entrada do catálogo — cada documento sem Databook confirmado reprocessa o catálogo inteiro do zero");
  assert.match(source, /function titleSimilarityFromTokens/, "sem função que aceita tokens já calculados");
  assert.match(source, /titleSimilarityFromTokens\(targetTokens, prepared\.searchableTokens\)/, "chooseCatalogEvidence recalcula os tokens do título do registro a cada entrada do catálogo comparada");
  assert.match(source, /titleSimilarityFromTokens\(targetTitleTokens, titleTokens\(candidateTitle\)\)/, "chooseFamilyEvidence recalcula os tokens do título do registro a cada linha do histórico comparada");
});

check("a análise de alocação processa uma LD grande em tempo hábil (regressão de desempenho)", () => {
  const require = createRequire(import.meta.url);
  const C = require(path.join(root, "core.js"));
  const A = require(path.join(root, "allocation_core.js"));

  const discs = ["ELE", "TUB", "CVL", "INS", "MEC", "EST"];
  function makeRecord(i) {
    const disc = discs[i % discs.length];
    const document = `C1O_RNEST_U32_3.1.1.1_${disc}_REP_${String(i).padStart(5, "0")}`;
    return { documentKey: document, document, sheet: disc, title: `RELATÓRIO ${i}`, discipline: disc, source: "LD.xlsx", allocation: "" };
  }
  const records = Array.from({ length: 3000 }, (_, i) => makeRecord(i));
  const entries = Array.from({ length: 2000 }, (_, i) => ({
    raw: `C1O_RNEST_U32_3.1.1.1_${discs[i % discs.length]}_REP_${String(i).padStart(5, "0")}.pdf`,
    sheetName: "Entrada", rowNumber: i + 1, hintedSheet: "",
  }));
  const catalogEntries = Array.from({ length: 160 }, (_, i) => ({
    description: `ITEM DE CATÁLOGO ${i}`, databook: `UHDT-D|GRUPO ${i % 10}|ITEM ${i}`, notes: "", rowNumber: i,
  }));
  const control = { baseDocuments: new Map(), levelsByDatabook: new Map(), rows: [], latestLdVersion: "" };
  const options = { allocationDate: "01/2026", catalogEntries, historyRows: [], confirmationRows: [], ldHistory: [], ldSourceNames: ["LD.xlsx"] };

  const start = Date.now();
  const analyzed = A.analyze(entries, records, control, options);
  const elapsedMs = Date.now() - start;

  assert.equal(analyzed.results.length, entries.length, "a análise não gerou um resultado por item da relação");
  // O algoritmo anterior (sem os índices O(1) e sem memoização por entrada do
  // catálogo) levava dezenas de segundos nesta mesma escala; 5s é uma folga
  // generosa para não quebrar em runners de CI mais lentos, mas ainda pega
  // uma regressão real para o comportamento O(itens × documentos).
  assert.ok(elapsedMs < 5000, `analyze() levou ${elapsedMs} ms para ${entries.length} itens x ${records.length} documentos — esperado bem abaixo de 5000 ms`);
});

// ===================== BASES DE REFERÊNCIA =====================

const Bases = createRequire(import.meta.url)("./bases_core.js");

check("a aba Bases está registrada na interface, no carregador e no precache", () => {
  assert.match(html, /data-module="bases"/, "sem botão de módulo na barra lateral");
  assert.match(html, /data-module-view="bases"/, "sem área de trabalho do módulo");
  assert.match(html, /id="bases-table-body"/, "sem corpo da tabela de bases");
  assert.match(html, /id="bases-file-input"/, "sem campo para escolher a base substituta");

  const loader = read("recon_module_loader.js");
  assert.match(loader, /bases: \["bases"\]/, "módulo bases não declarado em moduleDeps");
  assert.match(loader, /bases: \["RECONBasesCore", "RECONBases"\]/, "requisitos do módulo bases ausentes");
  // Sem bases_* em `common`, a análise leria a base incorporada antes de saber
  // que existe uma substituição fixada.
  assert.match(loader, /common: \[[^\]]*"bases_core\.js", "bases_app\.js"\]/, "bases_* fora do grupo common");

  for (const file of ["bases_core.js", "bases_app.js"]) {
    assert.ok(exists(file), `${file} não existe`);
    assert.ok(sw.includes(`"${file}"`), `${file} fora do precache do Service Worker`);
  }
});

check("o registro de bases descreve as sete bases que o RECON reconhece", () => {
  const ids = Bases.descriptors().map((item) => item.id);
  assert.deepEqual(ids.slice().sort(), [
    "allocation-template", "databook-rev-a", "databook-rev-b",
    "scon-escopo", "scon-tag-sgp", "tag-appendix", "titles-control",
  ]);
  // Os volumes precisam bater com o que audit_app.js confere ao carregar as
  // bases incorporadas; divergir aqui produziria aviso de troca falso.
  const app = read("audit_app.js");
  assert.equal(Bases.descriptor("titles-control").bundled.count, 782);
  assert.equal(Bases.descriptor("databook-rev-a").bundled.count, 158);
  assert.equal(Bases.descriptor("scon-escopo").bundled.count, 7798);
  assert.match(app, /!== 782/);
  assert.match(app, /!== 158/);
  assert.match(app, /!== 7798/);
});

check("uma planilha substituta é convertida no formato que o audit_core espera", () => {
  const item = Bases.descriptor("tag-appendix");
  const rows = [
    ["ANEXO I - APÊNDICE 3", "", "", ""],
    [],
    ["Unidade", "Disciplina", "TAG", "Descrição"],
    ["U-32", "Dinâmicos", "B-32110A", "BOMBA DE ÁGUA GELADA"],
    ["U-32", "Estáticos", "P-32001", "VASO SEPARADOR"],
    ["", "", "", ""],
  ];
  const catalog = Bases.buildCatalog(item, rows, { source: "meu_apendice.xlsx", sheet: "Apêndice" });
  assert.equal(catalog.entries.length, 2, "cabeçalho fora da linha 1 não foi localizado");
  assert.equal(catalog.entries[0].tag, "B-32110A");
  assert.equal(catalog.entries[0].description, "BOMBA DE ÁGUA GELADA");
  assert.equal(catalog.meta.source, "meu_apendice.xlsx");
  assert.equal(catalog.meta.sheet, "Apêndice");
});

check("cabeçalho com acento, caixa ou pontuação diferente ainda é reconhecido", () => {
  const item = Bases.descriptor("scon-escopo");
  const rows = [
    ["TAG", "TÍTULO", "DISCIPLINA", "E.A.P."],
    ["CXESC03-EL01", "EXECUCAO CHAPISCO DE PAREDE", "CIVIL", "3528"],
    ["FACHADA2L", "EXECUCAO CHAPISCO DE PAREDE", "CIVIL", "3529"],
  ];
  const catalog = Bases.buildCatalog(item, rows, { source: "escopo.xlsx", sheet: "MAPA" });
  assert.equal(catalog.rows.length, 2);
  assert.equal(catalog.uniqueTagCount, 2);
  assert.equal(catalog.uniqueEapCount, 2);
  // A ordem das colunas do catálogo é a que parseSconEscopoTitleCatalog lê por
  // posição — inverter aqui deslocaria todos os títulos silenciosamente.
  assert.deepEqual(catalog.columns, ["tag", "title", "discipline", "area", "type", "stage", "eap", "row"]);
  assert.equal(catalog.rows[0][catalog.columns.indexOf("title")], "EXECUCAO CHAPISCO DE PAREDE");
});

check("planilha sem as colunas obrigatórias é recusada dizendo qual falta", () => {
  const item = Bases.descriptor("tag-appendix");
  const rows = [["Unidade", "Disciplina", "Observação"], ["U-32", "Civil", "nada"]];
  assert.throws(() => Bases.buildCatalog(item, rows, {}), (error) => {
    assert.equal(error.name, "RECONBaseColumnError");
    assert.deepEqual(error.missing, ["TAG", "Descrição"]);
    return true;
  });
});

check("divergência grande de volume vira aviso, e base vazia vira erro", () => {
  const item = Bases.descriptor("scon-escopo");
  const vazio = Bases.review(item, { rowCount: 0 });
  assert.equal(vazio.valid, false, "base sem registros deveria ser recusada");

  // 7.798 é o volume da incorporada: 100 linhas é queda de mais de 90%, sinal
  // clássico de aba errada — mas continua sendo escolha do usuário.
  const encolhida = Bases.review(item, { rowCount: 100 });
  assert.equal(encolhida.valid, true, "volume menor não pode bloquear a substituição");
  assert.equal(encolhida.warnings.length, 1, "queda brusca de volume deveria avisar");
});

check("a análise só dispensa a conferência de volume quando a base foi substituída", () => {
  const app = read("audit_app.js");
  assert.match(app, /const replaced = \(id\) => Boolean\(bases && bases\.isPinned\(id\)\)/, "sem checagem de base substituída");
  assert.match(app, /!replaced\("titles-control"\) && parsed\.entries\.length !== 782/, "conferência de títulos deixou de valer para a base incorporada");
  assert.match(app, /!replaced\("scon-escopo"\)/, "conferência do SCON ESCOPO deixou de valer para a base incorporada");
  // A base substituída não fica sem nenhuma checagem: continua precisando
  // produzir ao menos um registro aproveitável.
  assert.match(app, /replaced\("titles-control"\) && !parsed\.entries\.length/, "base substituída vazia não é recusada");
});

check("a substituição é guardada em IndexedDB, não em localStorage", () => {
  const enhancements = read("recon_enhancements.js");
  assert.match(enhancements, /base_overrides/, "store base_overrides não foi criada");
  const app = read("bases_app.js");
  assert.match(app, /const STORE = "base_overrides"/);
  // Uma base passa de 1 MB com folga; localStorage estouraria a cota.
  assert.doesNotMatch(app, /localStorage/, "bases não podem ser guardadas em localStorage");
});

check("o listener unload descontinuado foi trocado por pagehide", () => {
  const enhancements = read("recon_enhancements.js");
  assert.doesNotMatch(enhancements, /addEventListener\("unload"/, "unload viola a Permissions Policy e gera violação no console");
  // Parar o cronômetro num pagehide de bfcache deixaria a aba restaurada sem
  // salvamento automático.
  assert.match(enhancements, /if \(!event\.persisted\) clearInterval\(timer\)/, "pagehide de bfcache não pode encerrar o auto-save");
});

check("as colunas fixas da tabela de alocação existem no CSS que o index.html carrega", () => {
  // O ajuste tinha sido escrito em reconfinal.css, que não é o arquivo ligado
  // no index.html — na prática a tabela continuava desalinhada ao rolar.
  assert.match(html, /href="recon-final\.css"/, "index.html não carrega recon-final.css");
  const finalCss = read("recon-final.css");
  assert.match(finalCss, /allocation-decision-table td:nth-child\(2\) \{ left: 150px; \}/);
});

console.log(JSON.stringify({ version: VERSION, passed: true, checks: checks.length, names: checks }, null, 2));
