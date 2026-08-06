import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  assert.match(enhancements, /DB_VERSION:\s*2/, "versão do banco não foi incrementada para criar a nova store");

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

console.log(JSON.stringify({ version: VERSION, passed: true, checks: checks.length, names: checks }, null, 2));
