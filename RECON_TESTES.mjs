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

console.log(JSON.stringify({ version: VERSION, passed: true, checks: checks.length, names: checks }, null, 2));
