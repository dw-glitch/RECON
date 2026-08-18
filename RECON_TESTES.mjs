import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

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
    "audit_app.js", "audit_core.js", "document_title_standard.js", "renamer_app.js",
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

  for (const required of ["relations_app.js", "audit_app.js", "allocation_app.js", "document_title_standard.js", "xlsx.full.min.js", "recon_compute_worker.js"]) {
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

check("o título recomendado usa SCON ESCOPO somente como último recurso", () => {
  const source = read("audit_core.js");
  assert.match(source, /sconCombinesWithAppendix\s*=\s*Boolean\(!manualValve && sconInDescription && appendixInDescription\)/,
    "SCON e Apêndice deixaram de se complementar para TAGs que não são válvulas manuais");
  assert.match(source, /trustedSconEscopo[\s\S]{0,160}!strongTagDescription[\s\S]{0,80}!trustedDescription/,
    "SCON ESCOPO pode substituir uma descrição já encontrada em outra base");
  assert.match(source, /"SCON TAG SGP \+ Apêndice 3 Rev\.B/, "categoria de origem combinada SCON+Apêndice nunca é gerada");
  assert.doesNotMatch(source, /"SCON TAG SGP \+ SCON ESCOPO/, "SCON ESCOPO ainda é combinada com uma fonte prioritária");
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

check("a descrição SCON é localizada pela TAG sem limitar pela disciplina da LD", () => {
  const require = createRequire(import.meta.url);
  const Q = require("./audit_core.js");
  const C = require("./core.js");
  const scon = Q.buildSconReferenceIndex([
    {
      document: "INS_CIV_110-FT-32001A",
      titleComplement: "FT-32001A - FILTRO",
      fullDescription: "110 - FILTRAGEM | BASE DE EQUIPAMENTO | FT-32001A - FILTRO",
      sconTag: "INS_CIV_110-FT-32001A",
      discipline: "CIVIL",
      itemType: "BASE DE EQUIPAMENTO(each)",
      row: 10,
    },
    {
      document: "INS_EQE_110-FT-32001A",
      titleComplement: "FT-32001A - FILTRO DE CARGA DE DIESEL DE DESTILAÇÃO DIRETA",
      fullDescription: "110 - FILTRAGEM | EQUIPAMENTO ESTÁTICO | FT-32001A - FILTRO DE CARGA DE DIESEL DE DESTILAÇÃO DIRETA",
      sconTag: "INS_EQE_110-FT-32001A",
      discipline: "EQP ESTATICO",
      itemType: "FILTRO(each)",
      row: 20,
    },
  ], { sourceFile: "SCON atualizada" });
  const document = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_FT-32001A";
  const result = Q.sconReferenceFor({ document, documentKey: C.key(document), discipline: "CIVIL" }, { scon });
  assert.ok(result && result.trusted, "a mesma TAG em outra disciplina não foi aceita");
  assert.match(result.titleComplement, /FILTRO DE CARGA/, "a descrição técnica mais específica da TAG não foi escolhida");
  assert.equal(result.discipline, "EQP ESTATICO");
  assert.match(result.matchMode, /independentemente da disciplina/i);
});

check("a LI incorporada contém todas as TAGs de válvulas e separa as canceladas", () => {
  const require = createRequire(import.meta.url);
  require("./valve_list_catalog.js");
  const Q = require("./audit_core.js");
  const C = require("./core.js");
  const valveList = Q.parseValveListCatalog(globalThis.RECONValveListCatalog);

  assert.equal(valveList.uniqueTagCount, 3066);
  assert.equal(valveList.activeTagCount, 2859);
  assert.equal(valveList.cancelledTagCount, 207);
  assert.match(html, /<option value="valve_list">LI de válvulas Rev\. C<\/option>/,
    "a tela não oferece filtro para as recomendações originadas na LI");

  const activeDocument = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-320002";
  const activeRecord = { document: activeDocument, documentKey: C.key(activeDocument), discipline: "TUBULACAO" };
  const active = Q.valveReferenceFor(activeRecord, { valveList }, Q.resolveTagEvidence(activeRecord, null));
  assert.ok(active && active.trusted);
  assert.equal(active.description, "VÁLVULA MANUAL Gaveta");
  assert.equal(active.diameter, '3"');
  assert.equal(active.page, 2);

  const cancelledDocument = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-320329";
  const cancelledRecord = { document: cancelledDocument, documentKey: C.key(cancelledDocument), discipline: "TUBULACAO" };
  const cancelled = Q.valveReferenceFor(cancelledRecord, { valveList }, Q.resolveTagEvidence(cancelledRecord, null));
  assert.ok(cancelled && cancelled.cancelled);
  assert.equal(cancelled.trusted, false);
});

check("uma TAG VM ativa usa a LI antes de SCON, Apêndice e SCON ESCOPO", () => {
  const require = createRequire(import.meta.url);
  require("./valve_list_catalog.js");
  const C = require("./core.js");
  const Q = require("./audit_core.js");
  const valveList = Q.parseValveListCatalog(globalThis.RECONValveListCatalog);
  const document = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-320002";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 10,
    discipline: "TUBULACAO",
    revision: "0",
    title: "RELATÓRIO DE REPARO DE VÁLVULAS",
  };
  const index = { documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }] };
  const scon = Q.buildSconReferenceIndex([{
    document: "APR_TUB_U32-VM-320002",
    titleComplement: "VM-320002 - DESCRIÇÃO SCON QUE NÃO DEVE SUBSTITUIR A LI",
    fullDescription: "U32 | TUBULACAO | VM-320002 - DESCRIÇÃO SCON QUE NÃO DEVE SUBSTITUIR A LI",
    sconTag: "APR_TUB_U32-VM-320002",
    discipline: "OUTRA DISCIPLINA",
    row: 99,
  }]);
  const sconEscopo = Q.parseSconEscopoTitleCatalog({
    sourceFile: "SCON ESCOPO",
    sheet: "MAPA",
    columns: ["tag", "title", "discipline", "row", "area", "type", "stage", "eap"],
    rows: [["VM-320002", "OUTRA DESCRIÇÃO - ÁREA: U32", "TUBULACAO", 1, "U32", "VALVULA(each)", "REPARO", "3.8.10"]],
  });
  const tagReference = Q.parseTagReferenceCatalog({
    meta: { source: "Apêndice 3 Rev.B", sheet: "Apêndice" },
    entries: [{ tag: "VM-320002", description: "OUTRA DESCRIÇÃO DO APÊNDICE", discipline: "TUBULACAO", row: 1 }],
  });

  const row = Q.auditTitles(index, { valveList, scon, sconEscopo, tagReference }, { titleSourceMode: "auto" })[0];
  assert.equal(row.valveMatch, "SIM");
  assert.equal(row.descriptionSource, "LI de válvulas Rev. C · TAG exata");
  assert.match(row.proposed, /VÁLVULA MANUAL GAVETA/);
  assert.match(row.proposed, /VM-320002$/);
  assert.doesNotMatch(row.proposed, /SCON QUE|APÊNDICE|ÁREA: U32/);
});

check("SCON ESCOPO e a regra mínima VM impedem recomendações vazias", () => {
  const require = createRequire(import.meta.url);
  const C = require("./core.js");
  const Q = require("./audit_core.js");
  const makeIndex = (record) => ({ documents: [{
    document: record.document,
    documentKey: record.documentKey,
    group: { records: [record], history: [] },
  }] });
  const sconEscopo = Q.parseSconEscopoTitleCatalog({
    sourceFile: "SCON ESCOPO",
    sheet: "MAPA",
    columns: ["tag", "title", "discipline", "row", "area", "type", "stage", "eap"],
    rows: [["P-99999", "BOMBA DE TESTE - ÁREA: 210 - PIPE RACK", "EQP ESTATICO", 50, "210 - PIPE RACK", "BOMBA(each)", "REPARO", "6.23.4"]],
  });
  const scopedDocument = "C1O_RNEST_U32_6.23.4.1_EST_REP_P-99999";
  const scopedRecord = {
    document: scopedDocument,
    documentKey: C.key(scopedDocument),
    sheet: "ET",
    row: 50,
    discipline: "EQP ESTATICO",
    revision: "0",
    title: "",
  };
  const scoped = Q.auditTitles(makeIndex(scopedRecord), { sconEscopo }, { titleSourceMode: "auto" })[0];
  assert.match(scoped.descriptionSource, /^SCON ESCOPO/);
  assert.ok(scoped.proposed);
  assert.match(scoped.proposed, /BOMBA/);
  assert.match(scoped.proposed, /P-99999$/);

  const valveDocument = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-999999";
  const valveRecord = {
    document: valveDocument,
    documentKey: C.key(valveDocument),
    sheet: "ET",
    row: 51,
    discipline: "TUBULACAO",
    revision: "0",
    title: "",
  };
  const minimum = Q.auditTitles(makeIndex(valveRecord), {}, { titleSourceMode: "auto" })[0];
  assert.equal(minimum.descriptionSource, "Regra mínima da TAG VM · VÁLVULA MANUAL");
  assert.ok(minimum.proposed);
  assert.match(minimum.proposed, /VÁLVULA MANUAL/);
  assert.match(minimum.proposed, /VM-999999$/);
});

check("o Excel de títulos exporta toda a análise e não somente as linhas visíveis", () => {
  const source = read("audit_app.js");
  assert.match(source, /kind === "title" \? state\.titleRows\.slice\(\) : visibleRows\(kind\)/,
    "filtros ou paginação da tela ainda podem retirar títulos do Excel");
  assert.match(source, /kind === "title" \? "Toda a análise"/,
    "o cabeçalho do Excel não identifica que a exportação cobre toda a análise");
});

check("o catálogo incorporado usa a SCON atualizada de Componentes e Programação", () => {
  const loader = read("scon_catalog_loader.js");
  assert.match(loader, /SCON - COMPONENTES E PROGRAMAÇÃO 2 \(1\)\.xlsx/);
  assert.match(loader, /total: 23341/);
  assert.match(loader, /Object\.keys\(manifest\.chunks\)/,
    "o carregador ainda limita a base SCON à disciplina da LD");
  ["scon_andaime.js", "scon_apoio.js", "scon_canteiro.js", "scon_loa.js", "scon_recursos_etf.js"]
    .forEach((name) => assert.ok(exists(name), `fragmento novo ausente: ${name}`));

  const require = createRequire(import.meta.url);
  require("./scon_tubulacao.js");
  const C = require("./core.js");
  const Q = require("./audit_core.js");
  const scon = Q.parseSconTitleCatalog(globalThis.RECON_SCON_CHUNKS.TUBULACAO);
  const document = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-327721";
  const match = Q.sconReferenceFor({ document, documentKey: C.key(document), discipline: "OUTRA DISCIPLINA" }, { scon });
  assert.ok(match && match.trusted, "a TAG VM-327721 não foi localizada na SCON incorporada");
  assert.equal(match.titleComplement, "VM-327721 - VALVULA MANUAL");
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
    "allocation-template", "databook-rev-a", "databook-rev-c",
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

check("a SCON atualizada pode ser fixada diretamente pelas colunas TAG e TAG_DESC", () => {
  const item = Bases.descriptor("scon-tag-sgp");
  const rows = [
    ["TAG", "TAG_DESC", "DISCIPLINA", "TIPO"],
    ["INS_EQE_110-FT-32001A", "110 - FILTRAGEM | EQUIPAMENTO ESTÁTICO | FT-32001A - FILTRO DE CARGA", "EQP ESTATICO", "FILTRO(each)"],
  ];
  const catalog = Bases.buildCatalog(item, rows, { source: "SCON atualizada.xlsx", sheet: "Componentes" });
  const first = catalog.rows[0];
  assert.equal(first[catalog.columns.indexOf("document")], "INS_EQE_110-FT-32001A");
  assert.equal(first[catalog.columns.indexOf("sconTag")], "INS_EQE_110-FT-32001A");
  assert.equal(first[catalog.columns.indexOf("titleComplement")], "FT-32001A - FILTRO DE CARGA");
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

// ===================== FOLHAS DE ESTILO GÊMEAS =====================

// O repositório tem pares quase idênticos: recon-ui.css / reconui.css e
// recon-final.css / reconfinal.css. O index.html carrega apenas os arquivos
// COM hífen. Três defeitos visuais já vieram de regra escrita só na cópia sem
// hífen: as colunas fixas da tabela de alocação, a fonte da descrição do
// título (que virava texto corrido) e o campo de título proposto.
check("toda classe usada no HTML e estilizada na folha gêmea existe na folha carregada", () => {
  const usadas = new Set();
  for (const attr of html.match(/class="[^"]*"/g) || []) {
    attr.slice(7, -1).split(/\s+/).filter(Boolean).forEach((name) => usadas.add(name));
  }

  const classesDe = (arquivo) => {
    const found = new Set();
    for (const match of read(arquivo).match(/\.[A-Za-z][\w-]*/g) || []) found.add(match.slice(1));
    return found;
  };

  // O que importa é a classe estar estilizada em ALGUMA folha carregada pelo
  // index.html — em qual delas é indiferente, já que a cascata resolve.
  const carregadas = (html.match(/href="([\w.-]+\.css)"/g) || []).map((tag) => tag.slice(6, -1));
  assert.ok(carregadas.length >= 2, "index.html não declara as folhas de estilo esperadas");
  const estilizadas = new Set();
  carregadas.forEach((arquivo) => classesDe(arquivo).forEach((name) => estilizadas.add(name)));

  const ausentes = [];
  for (const gemea of ["reconui.css", "reconfinal.css"]) {
    if (!exists(gemea) || carregadas.includes(gemea)) continue;
    for (const name of classesDe(gemea)) {
      if (usadas.has(name) && !estilizadas.has(name)) ausentes.push(`${name} (só em ${gemea})`);
    }
  }
  assert.deepEqual(ausentes, [], `regra de estilo fora da folha que o index.html carrega: ${ausentes.join(", ")}`);
});

check("os cartões de escolha usam tokens de tema, não branco fixo", () => {
  const css = read("recon-final.css");
  // --color-surface/--color-border não existem no projeto: o fallback #fff
  // deixava o cartão branco com texto quase branco no modo escuro.
  const bloco = css.slice(css.indexOf(".title-source-mode > label"));
  assert.doesNotMatch(bloco.slice(0, 400), /var\(--color-surface/, "cartão de opção voltou a depender de um token inexistente");
  assert.match(bloco.slice(0, 400), /background: var\(--ui-surface/, "cartão de opção não usa o token de superfície do tema");
});

check("as caixas de seleção têm alvo confortável e a barra lateral rola", () => {
  const css = read("recon-final.css");
  const caixas = css.match(/\.module-view input\[type="checkbox"\][\s\S]{0,200}?\}/);
  assert.ok(caixas, "sem regra de dimensionamento das caixas de seleção");
  assert.match(caixas[0], /width: 18px/, "caixa de seleção continua no tamanho padrão apertado");
  assert.match(caixas[0], /accent-color/, "caixa de seleção sem cor da marca");
  // A barra lateral tem altura presa em calc(100vh - 78px); sem rolagem, o
  // último item do menu fica inalcançável em telas de altura menor.
  assert.match(css, /\.module-sidebar \{\s*overflow-y: auto/, "barra lateral sem rolagem própria");
});

check("a coluna de ações da tabela de bases continua sendo uma célula de tabela", () => {
  const css = read("recon-final.css");
  const app = read("bases_app.js");
  // Um <td> com display:flex deixa de ser table-cell, ignora a largura da
  // coluna e transborda para fora do cartão.
  assert.match(app, /<td class="bases-actions"><div class="bases-actions-stack">/, "os botões não estão num wrapper próprio");
  assert.doesNotMatch(css, /\.bases-table \.bases-actions \{[^}]*display: flex/, "display:flex voltou para o próprio <td>");
  assert.match(css, /\.bases-table \.bases-actions-stack \{[\s\S]{0,120}display: flex/, "wrapper de ações sem empilhamento");
  assert.match(css, /\.bases-table \{ width: 100%; min-width: 62rem/, "tabela de bases sem largura mínima para rolar em telas estreitas");
});

// ===================== TÍTULO SEMPRE EM CAIXA ALTA =====================

check("o título recomendado sai em caixa alta qualquer que seja a caixa da base", () => {
  const Q = createRequire(import.meta.url)("./audit_core.js");
  // As três bases gravam a descrição com caixas diferentes; a LD precisa de um
  // padrão único, então a composição normaliza no final.
  assert.equal(Q.buildTitle("bomba de água gelada", "hvac se-3200", "B-32110A"),
    "BOMBA DE ÁGUA GELADA - HVAC SE-3200 - B-32110A");
  assert.equal(Q.buildTitle("Vaso Separador", "unidade de tratamento", "V-32001"),
    "VASO SEPARADOR - UNIDADE DE TRATAMENTO - V-32001");
  // toLocaleUpperCase("pt-BR") preserva acento; toUpperCase() de locale errado
  // ou uma normalização NFD perderiam o "Ç" e o "Ã".
  assert.equal(Q.upperCaseTitle("execução de canaleta"), "EXECUÇÃO DE CANALETA");
  assert.equal(Q.buildTitle("", "caixa de inspeção", "CXINSP-110"), "CAIXA DE INSPEÇÃO - CXINSP-110");
});

check("a sugestão vinda da memória de correções também sai em caixa alta", () => {
  const app = read("audit_app.js");
  // applyTitleMemory não passa por buildTitle: sem isto, uma correção antiga
  // digitada em minúscula voltaria como sugestão fora do padrão.
  assert.match(app, /row\.proposed = Q\.upperCaseTitle\(entry\.title\)/, "memória de correções devolve o texto sem normalizar a caixa");
});

check("o caminho do Databook não é afetado pela regra de caixa alta", () => {
  const source = read("audit_core.js");
  // O mesmo arquivo monta caminhos de Databook, que são pastas e não títulos.
  const trecho = source.slice(source.indexOf("proposed = suggestion.databook"), source.indexOf("proposed = suggestion.databook") + 120);
  assert.doesNotMatch(trecho, /upperCaseTitle/, "o caminho do Databook não pode ser convertido para caixa alta");
});

// ===================== PADRÃO NORMATIVO DOS TÍTULOS =====================

check("a revisão P da ET traz toda a Tabela 13 para o padrão dos relatórios", () => {
  const Standard = createRequire(import.meta.url)("./document_title_standard.js");
  assert.equal(Standard.STANDARD.document, "ET-5290.00-22000-912-1LV-001");
  assert.equal(Standard.STANDARD.revision, "P");
  assert.equal(Standard.reportRowCount, 328);
  assert.equal(Standard.reportCodeCount, 327);
  assert.equal(Standard.reportCodeFromDocument("C1O_RNEST_U32_3.1.1.1_CVL_RIR_V-32001"), "RIR");
  assert.equal(Standard.resolve("C1O_RNEST_U32_3.1.1.1_CVL_RIR_V-32001").title,
    "Relatório de Inspeção de Recebimento");
  assert.equal(Standard.resolve("C1O_RNEST_U32_3.1.1.1_CVL_GRACIM_nt-base-01").title,
    "Relatório de Aplicação de Graute Cimentício", "GRACIM ainda usa a redação substituída da Rev. N");
  assert.equal(Standard.resolve("C1O_RNEST_U32_3.1.1.1_INS_RRIMTI_TI-01").title,
    "Relatório de Execução e Inspeção de Montagem - Tomadas de Instrumento", "inclusão da Rev. P ausente");
  assert.deepEqual(Standard.reportTitlesFor("GRACIMR"), [], "código removido na Rev. P continuou ativo");
  assert.equal(Standard.resolve("ET-5290.00-22000-912-1LV-001").title, "ESPECIFICAÇÃO TÉCNICA");
  const worker = read("recon_compute_worker.js");
  assert.ok(worker.indexOf('"document_title_standard.js"') < worker.indexOf('"audit_core.js"'),
    "o Worker carrega audit_core antes da norma de títulos");
  assert.match(worker, /"audit-titles": \["RECONDocumentTitleStandard", "RECONAuditCore"\]/,
    "o Worker não valida a presença do padrão normativo antes de analisar títulos");
});

check("quando a própria norma repete um código, os títulos anteriores desempatarão a redação", () => {
  const Standard = createRequire(import.meta.url)("./document_title_standard.js");
  const resolved = Standard.resolve("C1O_RNEST_U32_3.1.1.1_CVL_EVSJE_JE-001", {
    previousTitles: ["RELATÓRIO DE ENSAIO VISUAL - JUNTAS EXISTENTES - JE-001"],
  });
  assert.equal(resolved.title, "Relatório de Ensaio Visual - Juntas Existentes");
  assert.equal(resolved.chosenByHistory, true);
  assert.equal(resolved.ambiguous, false);
});

check("o tipo normativo permanece na frente da descrição encontrada nas bases", () => {
  const C = createRequire(import.meta.url)("./core.js");
  const Q = createRequire(import.meta.url)("./audit_core.js");
  const document = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_V-32001";
  const previousDocument = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_V-32000";
  const current = {
    document,
    documentKey: C.key(document),
    sheet: "CVL",
    row: 2,
    discipline: "CIVIL",
    revision: "B",
    title: "VÁLVULA - V-32001",
    ldColumns: [{ header: "DESCRIÇÃO", value: "Válvula de bloqueio" }],
  };
  const previous = {
    ...current,
    document: previousDocument,
    documentKey: C.key(previousDocument),
    row: 1,
    revision: "A",
    title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - VÁLVULA ANTIGA - V-32000",
  };
  const index = { documents: [
    { document, documentKey: current.documentKey, group: { records: [current], history: [] } },
    { document: previousDocument, documentKey: previous.documentKey, group: { records: [previous], history: [] } },
  ] };
  const row = Q.auditTitles(index, null, {}).find((item) => item.document === document);
  assert.equal(row.issue, "document_type");
  assert.equal(row.proposed, "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - VÁLVULA DE BLOQUEIO - V-32001");
  assert.equal(row.titleStandardCode, "RIR");
  assert.equal(row.previousTitlePattern, "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO");
  assert.match(row.evidence, /Rev\. P · Tabela 13/);
  assert.match(row.evidence, /título\(s\) anterior\(es\)/);
});

check("parênteses que fazem parte do título normativo não são removidos", () => {
  const Q = createRequire(import.meta.url)("./audit_core.js");
  assert.equal(Q.buildTitle("CERTIFICADO DE TESTE DE PRESSÃO EM EQUIPAMENTOS (SELO MECÂNICO)", "bomba", "B-1", { preserveType: true }),
    "CERTIFICADO DE TESTE DE PRESSÃO EM EQUIPAMENTOS (SELO MECÂNICO) - BOMBA - B-1");
});

check("a TAG errada do título é substituída exatamente pela TAG do nome do documento", () => {
  const C = createRequire(import.meta.url)("./core.js");
  const Q = createRequire(import.meta.url)("./audit_core.js");
  const document = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_Vm-327721";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 10,
    discipline: "CIVIL",
    revision: "B",
    title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - VÁLVULA MANUAL - VM-327722",
  };
  const index = {
    documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }],
  };
  const row = Q.auditTitles(index, null, {})[0];

  assert.equal(row.issue, "wrong_tag");
  assert.equal(row.reasonCode, "TITLE_WRONG_TAG");
  assert.equal(row.documentNameTag, "Vm-327721");
  assert.equal(row.titleTagFound, "VM-327722");
  assert.equal(row.titleTag, "Vm-327721");
  assert.equal(row.proposed, "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - VÁLVULA MANUAL - Vm-327721");
  assert.ok(!row.proposed.includes("VM-327722"), "a TAG incorreta permaneceu na sugestão");
  assert.equal((row.proposed.match(/Vm-327721/g) || []).length, 1, "a TAG documental deve aparecer uma única vez");
});

check("a TAG já idêntica à do nome do documento não é marcada como incorreta", () => {
  const C = createRequire(import.meta.url)("./core.js");
  const Q = createRequire(import.meta.url)("./audit_core.js");
  const document = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_Vm-327721";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 11,
    discipline: "CIVIL",
    revision: "B",
    title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - VÁLVULA MANUAL - Vm-327721",
  };
  const index = {
    documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }],
  };
  const row = Q.auditTitles(index, null, {})[0];

  assert.equal(row.wrongTitleTag, false);
  assert.notEqual(row.issue, "wrong_tag");
});

check("a correção remove também a forma literal TAG: antes do identificador errado", () => {
  const C = createRequire(import.meta.url)("./core.js");
  const Q = createRequire(import.meta.url)("./audit_core.js");
  const document = "C1O_RNEST_U32_3.1.1.1_CVL_RIR_B-32014A";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 12,
    discipline: "CIVIL",
    revision: "B",
    title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - BOMBA DE TESTE - TAG: B-32014B",
  };
  const index = {
    documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }],
  };
  const row = Q.auditTitles(index, null, {})[0];

  assert.equal(row.issue, "wrong_tag");
  assert.equal(row.proposed, "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO - BOMBA DE TESTE - B-32014A");
  assert.ok(!/TAG\s*:/i.test(row.proposed));
  assert.ok(!row.proposed.includes("B-32014B"));
});

check("uma válvula ausente da LI usa a descrição da SCON antes da SCON ESCOPO", () => {
  const require = createRequire(import.meta.url);
  const C = require("./core.js");
  const Q = require("./audit_core.js");
  const document = "C1O_RNEST_U32_3.8.10.1_TUB_REP_VM-327721";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 306,
    discipline: "TUBULACAO",
    revision: "0",
    title: "RELATÓRIO DE REPARO DE VÁLVULAS - VM-327721",
  };
  const index = {
    documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }],
  };
  const scon = Q.buildSconReferenceIndex([{
    document: "APR_TUB_U32-VM-327721",
    titleComplement: "VM-327721 - VALVULA MANUAL",
    fullDescription: "U32 - UNIDADE HDT | TUBULACAO | VM-327721 - VALVULA MANUAL",
    sconTag: "APR_TUB_U32-VM-327721",
    discipline: "TUBULACAO",
    itemType: "VALVULA(each)",
    row: 9260,
  }], { sourceFile: "SCON atualizada" });
  const sconEscopo = Q.parseSconEscopoTitleCatalog({
    sourceFile: "SCON ESCOPO",
    sheet: "MAPA",
    columns: ["tag", "title", "discipline", "row", "area", "type", "stage", "eap"],
    rows: [[
      "MODERADO-6-A-12",
      "REPARO DE VALVULA(each) - DISCIPLINA: TUBULACAO - ÁREA: U32 - UNIDADE HDT",
      "TUBULACAO", 7791, "U32 - UNIDADE HDT", "VALVULA(each)", "REPARO", "3.8.10",
    ]],
  });
  const row = Q.auditTitles(index, { scon, sconEscopo }, { titleSourceMode: "auto" })[0];
  assert.equal(row.sconEscopoMatch, "SIM");
  assert.match(row.sconEscopoMatchMode, /fallback seguro por EAP \+ atividade documental/i);
  assert.equal(row.proposed, "RELATÓRIO DE REPARO DE VÁLVULAS - VÁLVULA MANUAL - VM-327721");
  assert.equal(row.descriptionSource, "SCON TAG SGP · fallback da LI de válvulas");
  assert.match(row.proposed, /VÁLVULA MANUAL/);
  assert.doesNotMatch(row.proposed, /ÁREA: U32/, "SCON ESCOPO não permaneceu como último recurso");
});

check("SCON e Apêndice resolvem a TAG sem incorporar a SCON ESCOPO", () => {
  const require = createRequire(import.meta.url);
  const C = require("./core.js");
  const Q = require("./audit_core.js");
  const document = "C1O_RNEST_U32_6.23.4.1_EST_PPT_P-B-32009A";
  const record = {
    document,
    documentKey: C.key(document),
    sheet: "ET",
    row: 342,
    discipline: "EQP ESTATICO",
    revision: "0",
    title: "RELATÓRIO DE PREPARAÇÃO PARA TRANSPORTE - P-B-32009A",
  };
  const index = {
    documents: [{ document, documentKey: record.documentKey, group: { records: [record], history: [] } }],
  };
  const scon = Q.buildSconReferenceIndex([{
    document: "APR_EQE_210-P-B-32009A",
    titleComplement: "P-B-32009A - TROCADOR CASCO TUBO DA B-32009A",
    fullDescription: "210 - PIPE RACK | EQUIPAMENTO ESTÁTICO | P-B-32009A - TROCADOR CASCO TUBO DA B-32009A",
    sconTag: "APR_EQE_210-P-B-32009A",
    discipline: "EQP ESTATICO",
    itemType: "PERMUTADOR(each)",
    row: 1394,
  }], { sourceFile: "SCON atualizada" });
  const sconEscopo = Q.parseSconEscopoTitleCatalog({
    sourceFile: "SCON ESCOPO",
    sheet: "MAPA",
    columns: ["tag", "title", "discipline", "row", "area", "type", "stage", "eap"],
    rows: [[
      "P-B-32009A",
      "6.23.2.1 - PREPARACAO PARA TRANSPORTE DE PERMUTADOR(each) - DISCIPLINA: EQP ESTATICO - ÁREA: 210 - PIPE RACK",
      "EQP ESTATICO", 3856, "210 - PIPE RACK", "PERMUTADOR(each)", "6.23.2.1 - PREPARACAO PARA TRANSPORTE", "6.23.4",
    ]],
  });
  const tagReference = Q.parseTagReferenceCatalog({
    meta: { source: "Apêndice 3 Rev.B", sheet: "Apêndice" },
    entries: [{ tag: "P-B-32009A", description: "TROCADOR CASCO TUBO DA B-32009A", discipline: "EQP ESTATICO", row: 5172 }],
  });
  const row = Q.auditTitles(index, { scon, sconEscopo, tagReference }, { titleSourceMode: "auto" })[0];
  assert.equal(row.proposed,
    "RELATÓRIO DE PREPARAÇÃO PARA TRANSPORTE - TROCADOR CASCO TUBO DA B-32009A - P-B-32009A");
  assert.equal(row.sconEscopoMatch, "SIM");
  assert.equal(row.appendixMatch, "SIM");
  assert.equal(row.descriptionSource, "SCON TAG SGP + Apêndice 3 Rev.B · 3º campo da DESCRIÇÃO");
  assert.match(row.reason, /SCON TAG SGP e do Apêndice 3 Rev\.B/i);
  assert.doesNotMatch(row.proposed, /ÁREA: 210/, "SCON ESCOPO não permaneceu como último recurso");
});

// ===================== BANCO LOCAL =====================

check("a versão do banco avança quando uma store nova é adicionada", () => {
  const enhancements = read("recon_enhancements.js");
  // A v3 foi publicada duas vezes com conteúdo diferente: quem abriu o app
  // entre as duas ficou com um banco marcado como v3 sem base_overrides, e
  // onupgradeneeded não roda de novo na mesma versão.
  assert.match(enhancements, /DB_VERSION:\s*([4-9]|\d{2,})/, "a versão do banco não avançou depois de somar base_overrides à v3");
  for (const store of ["ld_sheet_profiles", "base_overrides"]) {
    assert.match(enhancements, new RegExp(`objectStoreNames\\.contains\\("${store}"\\)`), `store ${store} não é criada de forma condicional`);
  }
});

check("a leitura das bases não repete a tentativa indefinidamente", () => {
  const app = read("bases_app.js");
  // Sem limite, cada chamada de ready() reabria o banco e falhava de novo,
  // enchendo o console a cada análise.
  assert.match(app, /MAX_TENTATIVAS/, "sem limite de tentativas na leitura das bases");
  assert.match(app, /objectStoreNames && !store\.objectStoreNames\.contains\(STORE\)/, "não detecta store ausente antes de abrir a transação");
});

// ===================== ALOCAÇÃO =====================

check("a alocação diz o que falta quando o botão Analisar está desabilitado", () => {
  const app = read("allocation_app.js");
  assert.match(app, /function missingRequirements/, "sem enumeração dos requisitos pendentes");
  // As cinco condições do disabled precisam estar todas cobertas pela mensagem,
  // senão o usuário fica sem saber qual delas está travando a análise.
  for (const termo of ["LDs controladas", "controle de solicitações", "relação de documentos", "data da alocação", "número da alocação"]) {
    assert.ok(app.includes(termo), `mensagem de pendência não cita "${termo}"`);
  }
  assert.match(app, /para analisar/, "a mensagem não explica que o botão depende dos itens");
});

check("a coluna ALOCAÇÃO da LD distingue estado operacional de número da alocação", () => {
  const require2 = createRequire(import.meta.url);
  globalThis.window = globalThis; globalThis.self = globalThis;
  const XLSX = require2("./xlsx.full.min.js") || globalThis.XLSX;
  globalThis.XLSX = XLSX;
  const C = require2("./core.js");
  const wb = XLSX.utils.book_new();
  const rows = [
    ["DOCUMENTO", "TÍTULO", "DISCIPLINA", "ALOCAÇÃO"],
    ["C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320001", "RELATÓRIO A", "TUB", "ALOCADO"],
    ["C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320002", "RELATÓRIO B", "TUB", "NÃO ALOCADO"],
    ["C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320003", "RELATÓRIO C", "TUB", "C1O-ALOC-CM-0012-2026"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "ET");
  const parsed = C.parseWorkbook(wb, "LD.xlsx", Date.now(), null);
  assert.equal(parsed.records[0].allocationStatus, "ALOCADO");
  assert.equal(parsed.records[0].allocation, "");
  assert.equal(parsed.records[1].allocationStatus, "NÃO ALOCADO");
  assert.equal(parsed.records[1].allocation, "");
  assert.equal(parsed.records[2].allocationStatus, "");
  assert.equal(parsed.records[2].allocation, "C1O-ALOC-CM-0012-2026");
});

check("o diagnóstico explica alocado, pendente no controle, novo e recusado", () => {
  const A = createRequire(import.meta.url)("./allocation_core.js");
  const record = { allocationStatus: "NÃO ALOCADO" };
  const pending = A.allocationDiagnosis({ record, resolution: { kind: "pending", source: "Central" }, history: { allocation: "C1O-ALOC-CM-0001-2026" }, existingAllocation: "C1O-ALOC-CM-0001-2026" });
  assert.equal(pending.kind, "pending_control");
  assert.match(pending.label, /AGUARDANDO RETORNO DA FISCAL/);
  assert.match(pending.label, /JÁ INCLUÍDO NO CONTROLE/);

  const fresh = A.allocationDiagnosis({ record, resolution: { kind: "not_allocated" }, history: null, base: null });
  assert.equal(fresh.kind, "new_control");
  assert.equal(fresh.label, "NOVO NO CONTROLE");

  const rejected = A.allocationDiagnosis({ record, resolution: { kind: "rejected" }, history: { allocation: "C1O-ALOC-CM-0002-2026" }, existingAllocation: "C1O-ALOC-CM-0002-2026" });
  assert.equal(rejected.kind, "rejected");
  assert.match(rejected.label, /PRECISA DE NOVA ALOCAÇÃO/);

  const accepted = A.allocationDiagnosis({ record: { allocationStatus: "ALOCADO" }, resolution: { kind: "accepted" } });
  assert.equal(accepted.kind, "allocated");
  assert.match(accepted.label, /JÁ CONFIRMADO/);
});

check("a Central usa o número da LD do arquivo, preserva a versão e força a data atual", () => {
  const A = createRequire(import.meta.url)("./allocation_core.js");
  const ld003 = "LD-5290.00-22313-91A-C1O-003_0001_0.xlsx";
  const ld004 = "LD-5290.00-22313-91A-C1O-004_0001_B.xlsx";
  const ld001 = "LD-5290.00-22313-91A-C1O-001_0001_C2.xlsx";
  assert.equal(A.ldNumberFromSource(ld003), "003");
  assert.equal(A.ldNumberFromSource(ld004), "004");
  assert.equal(A.ldNumberFromSource(ld001), "001");
  assert.equal(A.ldVersionFromSource(ld003), "0");
  assert.equal(A.ldVersionFromSource(ld004), "B");
  assert.equal(A.newestLdVersion("0", "A", "A2"), "A2");

  const makeResult = (sheet, source, version) => ({
    document: "C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320001",
    sheet,
    ldSource: source,
    ldVersion: version,
    record: { sheet, source, ldVersion: version },
    base: null,
    output: {
      document: "C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320001",
      plannedDate: "2020-01-01",
      workflow: "TUBULAÇÃO",
      levels: [],
    },
  });
  const meta = { allocationDate: "2026-08-15", allocationCode: "C1O-ALOC-CM-0001-2026", status: "PENDENTE ENVIO DE LD" };
  const et003 = A.controlRow(makeResult("ET", ld003, "0"), meta);
  const et004 = A.controlRow(makeResult("ET", ld004, "B"), meta);
  const n1710 = A.controlRow(makeResult("N-1710", ld001, "C2"), meta);
  assert.equal(et003[A.CONTROL_HEADERS.indexOf("ABA")], "ET_LD_003");
  assert.equal(et004[A.CONTROL_HEADERS.indexOf("ABA")], "ET_LD_004");
  assert.equal(n1710[A.CONTROL_HEADERS.indexOf("ABA")], "N-1710_LD_001");
  assert.equal(et003[A.CONTROL_HEADERS.indexOf("VERSÃO \nDA LD")], "0");
  assert.equal(et003[A.CONTROL_HEADERS.indexOf("Data Prevista")], "2026-08-15");
  assert.equal(A.allocationRow(makeResult("ET", ld003, "0"), meta.allocationDate)[1], "2026-08-15");
});

check("a Central separa a aba da LD do prazo escrito na LD", () => {
  const A = createRequire(import.meta.url)("./allocation_core.js");
  const source = "LD-5290.00-22313-91A-C1O-003_0001_0.xlsx";
  const abaIndex = A.CONTROL_HEADERS.indexOf("ABA");
  const versaoIndex = A.CONTROL_HEADERS.indexOf("VERSÃO \nDA LD");
  const meta = { allocationDate: "2026-08-15", allocationCode: "C1O-ALOC-CM-0001-2026", status: "PENDENTE ENVIO DE LD" };
  const build = (ldColumns) => ({
    document: "C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320001",
    sheet: "ET",
    ldSource: source,
    ldVersion: "0",
    record: { sheet: "ET", source, ldVersion: "0", ldColumns },
    ldDeadline: A.recordDeadline({ ldColumns }),
    base: null,
    output: { document: "C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320001", plannedDate: "2020-01-01", workflow: "TUBULAÇÃO", levels: [] },
  });

  // A ABA é sempre o número da LD; o prazo nunca ocupa essa coluna.
  const comPrazo = build([{ header: "DOCUMENTO", value: "X" }, { header: "PRAZO", value: "30/09/2026" }]);
  assert.equal(A.controlRow(comPrazo, meta)[abaIndex], "ET_LD_003");
  assert.equal(A.controlRow(comPrazo, meta)[versaoIndex], "30/09/2026");

  const prazoTextual = build([{ header: "Prazo de emissão", value: "60 dias após a AS" }]);
  assert.equal(A.controlRow(prazoTextual, meta)[versaoIndex], "60 dias após a AS", "o prazo sai como está na LD");

  const prazoPreferido = build([
    { header: "PRAZO CONTRATUAL", value: "90 DIAS" },
    { header: "PRAZO", value: "15/10/2026" },
  ]);
  assert.equal(A.recordDeadline(prazoPreferido.record), "15/10/2026", "a coluna PRAZO pura tem preferência");

  const semPrazo = build([{ header: "DOCUMENTO", value: "X" }]);
  assert.equal(A.controlRow(semPrazo, meta)[abaIndex], "ET_LD_003");
  assert.equal(A.controlRow(semPrazo, meta)[versaoIndex], "0", "sem prazo na LD a coluna volta para a versão enviada");

  const prazoVazio = build([{ header: "PRAZO", value: "" }]);
  assert.equal(A.controlRow(prazoVazio, meta)[versaoIndex], "0", "prazo em branco não pode apagar a versão");
});

check("o relatório de análise da alocação publica o prazo lido da LD", () => {
  const source = read("allocation_workbook.js");
  assert.ok(source.includes("PRAZO NA LD (COLUNA VERSÃO DA LD)"), "o relatório precisa mostrar o prazo aproveitado na coluna ABA");
  const widths = source.match(/\[20, 38, 29, 52[^\]]*\]/);
  assert.ok(widths, "a lista de larguras da aba Análise precisa continuar existindo");
  const total = widths[0].slice(1, -1).split(",").length;
  const headers = source.match(/function reportHeaders\(\) \{[\s\S]*?\n  \}/)[0].match(/"/g).length / 2;
  assert.equal(total, headers, "cada coluna do relatório precisa de uma largura correspondente");
});

check("a seleção manual inclui resultados bloqueados sem selecionar itens impossíveis", () => {
  const A = createRequire(import.meta.url)("./allocation_core.js");
  const ready = { document: "DOC_READY_001", decision: A.READY, record: {}, output: {} };
  const allocated = { document: "DOC_ALLOCATED_002", decision: A.SKIP, record: {}, output: {} };
  const review = { document: "DOC_REVIEW_003", decision: A.REVIEW, record: {}, output: {} };
  const unavailable = { document: "DOC_MISSING_004", decision: A.REVIEW, record: null, output: null };
  assert.equal(A.defaultSelectedForAllocation(ready), true);
  assert.equal(A.defaultSelectedForAllocation(allocated), false);
  assert.equal(A.canSelectForAllocation(allocated), true);
  assert.equal(A.canSelectForAllocation(unavailable), false);
  const selected = new Set([ready.document, allocated.document, review.document, unavailable.document].map(A.key));
  assert.deepEqual(A.selectedReady([ready, allocated, review, unavailable], selected).map((item) => item.document), [ready.document, allocated.document, review.document]);
});

check("o usuário escolhe entre separar por disciplina e usar uma alocação única", () => {
  const B = createRequire(import.meta.url)("./allocation_batches.js");
  const results = [
    { document: "DOC_TUB_001", sheet: "ET", output: { workflow: "TUBULAÇÃO" } },
    { document: "DOC_ELE_002", sheet: "ET", output: { workflow: "ELÉTRICA" } },
    { document: "DOC_SEM_003", sheet: "ET", output: { workflow: "" } },
  ];
  const split = B.build(results.slice(0, 2), "C1O-ALOC-CM-0010-2026", { mode: "discipline" });
  assert.equal(split.valid, true);
  assert.equal(split.groups.length, 2);
  assert.deepEqual(split.groups.map((group) => group.allocationCode), ["C1O-ALOC-CM-0010-2026", "C1O-ALOC-CM-0011-2026"]);
  assert.equal(B.build(results, "C1O-ALOC-CM-0010-2026", { mode: "discipline" }).valid, false);

  const single = B.build(results, "C1O-ALOC-CM-0010-2026", { mode: "single" });
  assert.equal(single.valid, true);
  assert.equal(single.groups.length, 1);
  assert.equal(single.groups[0].results.length, 3);
  assert.equal(single.groups[0].allocationCode, "C1O-ALOC-CM-0010-2026");
});

check("a tela oferece selecionar tudo, inclusão manual e as duas formas de geração", () => {
  const app = read("allocation_app.js");
  assert.match(html, /id="allocation-select-all"[^>]*\/>Selecionar tudo/);
  assert.match(html, /name="allocation-group-mode"[^>]*value="discipline"/);
  assert.match(html, /name="allocation-group-mode"[^>]*value="single"/);
  assert.match(app, /state\.results\.filter\(canSelectForAllocation\)/, "selecionar tudo não percorre todos os itens tecnicamente geráveis");
  assert.match(app, /result\.manualOverride = Boolean\(selected && result\.decision !== A\.READY\)/, "inclusão contra a recomendação não fica marcada como manual");
  assert.doesNotMatch(app, /const canSelect = result\.decision === A\.READY/, "checkbox continua bloqueado para todo item fora de Pronto");
});

check("a consulta Databook aceita várias linhas com documento e título", () => {
  const documentStub = { getElementById: () => null, addEventListener: () => {} };
  const windowStub = { document: documentStub };
  const context = vm.createContext({ window: windowStub, document: documentStub, navigator: {}, setTimeout });
  vm.runInContext(read("allocation_databook_finder.js"), context);
  const finder = windowStub.RECONDatabookFinder;
  const queries = finder.parseQueries([
    "Documento\tTítulo",
    "C1O_RNEST_U32_3.8.5.1_TUB_REP_VM-320003\tRELATÓRIO DE REPARO DE VÁLVULA MANUAL",
    "C1O_RNEST_U32_6.23.4.1_EST_PPT_P-B-32009A | RELATÓRIO DE PREPARAÇÃO PARA TRANSPORTE",
  ].join("\n"));
  assert.equal(queries.length, 2);
  assert.equal(queries[0].code, "C1O_RNEST_U32_3.8.5.1_TUB_REP_VM-320003");
  assert.equal(queries[0].title, "RELATÓRIO DE REPARO DE VÁLVULA MANUAL");
  assert.match(queries[1].title, /PREPARAÇÃO PARA TRANSPORTE/);
  const ranked = finder.rankQuery([
    { description: "RELATÓRIO DE REPARO DE VÁLVULA MANUAL", notes: "VÁLVULAS", databook: "UHDT-D|C&M|TUBULAÇÃO|VÁLVULAS" },
    { description: "RELATÓRIO DE PREPARAÇÃO PARA TRANSPORTE", notes: "PERMUTADOR", databook: "UHDT-D|C&M|EQUIPAMENTOS|PERMUTADORES" },
  ], queries[0], 3);
  assert.ok(ranked.length > 0, "a primeira linha não devolveu sugestão");
  assert.match(html, /id="allocation-db-query"/);
  assert.match(html, /um por linha/i);
});

check("a alocação nunca deixa Databook vazio e separa fallback RIR de C&M", () => {
  const require2 = createRequire(import.meta.url);
  const C = require2("./core.js");
  const A = require2("./allocation_core.js");
  const makeRecord = (document, title) => ({
    document,
    documentKey: C.key(document),
    sheet: "ET",
    title,
    discipline: "TUBULAÇÃO",
    allocationStatus: "NÃO ALOCADO",
    source: "LD.xlsx",
    row: 2,
    ldColumns: [
      { header: "DISCIPLINA", value: "TUBULAÇÃO" },
      { header: "ALOCAÇÃO", value: "NÃO ALOCADO" },
    ],
  });
  const rir = makeRecord("C1O_RNEST_U32_3.1.1.1_TUB_RIR_VM-320001", "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO");
  const cm = makeRecord("C1O_RNEST_U32_3.1.1.1_TUB_REP_VM-320002", "RELATÓRIO DE REPARO DE VÁLVULA");
  const control = { baseDocuments: new Map(), levelsByDatabook: new Map(), levelsByEap: new Map(), projectLevelBase: [], rows: [], latestLdVersion: "" };
  const analyzed = A.analyze(
    [{ raw: rir.document, hintedSheet: "ET" }, { raw: cm.document, hintedSheet: "ET" }],
    [rir, cm],
    control,
    { allocationDate: "15/08/2026", catalogEntries: [], historyRows: [], confirmationRows: [], ldHistory: [], ldSourceNames: ["LD.xlsx"] },
  );
  assert.equal(analyzed.results.length, 2);
  assert.equal(analyzed.results[0].output.databook, "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|RIR TUBULAÇÃO");
  assert.equal(analyzed.results[1].output.databook, "UHDT-D|DATA BOOK C&M|TUBULAÇÃO|C&M TUBULAÇÃO");
  analyzed.results.forEach((result) => {
    assert.ok(A.completeDatabook(result.output.databook), "fallback não produziu caminho completo");
    assert.equal(result.output.databookEvidence.sourceType, "discipline-fallback");
    assert.match(result.warnings.join(" "), /Databook geral aplicado/);
  });

  const staticEquipment = A.generalDatabookFallback({
    document: "C1O_RNEST_U32_6.23.4.1_MEC_REP_P-B-32009A",
    discipline: "EQP ESTÁTICO",
    title: "RELATÓRIO DE PREPARAÇÃO PARA TRANSPORTE",
  });
  assert.equal(staticEquipment.databook, "UHDT-D|DATA BOOK C&M|EQP ESTÁTICOS|C&M DEMAIS EQP ESTÁTICOS");
});

// ===================== COBERTURA DA LEITURA DA LD =====================

check("a leitura da LD não descarta abas por causa do cabeçalho, da posição ou da largura", () => {
  const require2 = createRequire(import.meta.url);
  globalThis.window = globalThis; globalThis.self = globalThis;
  const XLSX = require2("./xlsx.full.min.js") || globalThis.XLSX;
  const sheetjs = XLSX && XLSX.utils ? XLSX : globalThis.XLSX;
  assert.ok(sheetjs && sheetjs.utils, "SheetJS indisponível para montar a LD de teste");
  globalThis.XLSX = sheetjs; // core.js lê o XLSX do escopo global, como no navegador
  require2("./recon_contracts.js"); require2("./ld_conflicts.js");
  const C = require2("./core.js");

  const wb = sheetjs.utils.book_new();
  // 1. cabeçalho na linha 12 e SEM coluna REVISÃO/STATUS
  const a1 = [...Array(11).fill(["", "", ""]), ["DOCUMENTO", "TÍTULO", "DISCIPLINA"]];
  for (let i = 0; i < 50; i++) a1.push([`C1O_RNEST_U32_3.1.1.1_TUB_RIR_B-${32000 + i}`, `titulo ${i}`, "TUB"]);
  sheetjs.utils.book_append_sheet(wb, sheetjs.utils.aoa_to_sheet(a1), "TUBULACAO");
  // 2. cabeçalho na linha 30, além das 25 linhas que a varredura antiga cobria
  const a2 = [...Array(29).fill([""]), ["DOCUMENTO", "REVISÃO", "TÍTULO"]];
  for (let i = 0; i < 40; i++) a2.push([`C1O_RNEST_U32_3.1.1.1_ELE_RNC_B-${41000 + i}`, "0", `titulo ${i}`]);
  sheetjs.utils.book_append_sheet(wb, sheetjs.utils.aoa_to_sheet(a2), "ELETRICA");
  // 3. coluna DOCUMENTO além da 80ª, que era o limite antigo
  const linha = (v) => { const r = Array(95).fill(""); r[90] = v[0]; r[91] = v[1]; return r; };
  const a3 = [linha(["DOCUMENTO", "TÍTULO"])];
  for (let i = 0; i < 30; i++) a3.push(linha([`C1O_RNEST_U32_3.1.1.1_CVL_CCM_B-${5000 + i}`, `titulo ${i}`]));
  sheetjs.utils.book_append_sheet(wb, sheetjs.utils.aoa_to_sheet(a3), "CIVIL");

  const buf = sheetjs.write(wb, { type: "buffer", bookType: "xlsx" });
  const parsed = C.parseWorkbook(sheetjs.read(buf, { type: "buffer" }), "LD.xlsx", Date.now(), null);

  // O código anterior lia ZERO destes 120: as três abas eram descartadas em
  // silêncio e a análise parecia ter pulado parte da LD.
  assert.equal(parsed.records.length, 120, "a leitura da LD voltou a descartar abas");
  assert.equal(parsed.coverage.rowsRead, 120);
  assert.deepEqual(parsed.coverage.skippedSheets, [], "nenhuma destas abas pode ficar de fora");
  assert.deepEqual(parsed.coverage.sheets.map((s) => `${s.sheet}:${s.rows}`), ["TUBULACAO:50", "ELETRICA:40", "CIVIL:30"]);
});

check("a cobertura da leitura é reportada e chega à tela", () => {
  const core = read("core.js");
  assert.match(core, /coverage = \{ sheets: \[\], skippedSheets: \[\]/, "sem relatório de cobertura na leitura");
  assert.match(core, /skippedSheets\.push\(\{ sheet: sheetName, reason:/, "aba descartada sem motivo registrado");
  assert.match(core, /HEADER_SCAN_ROWS = 60/, "varredura de cabeçalho voltou a ser curta");
  assert.match(core, /MAX_COLUMNS = 400/, "limite de colunas voltou a cortar a coluna DOCUMENTO");

  const app = read("audit_app.js");
  assert.match(app, /state\.parsed && state\.parsed\.coverage/, "a análise de títulos não lê a cobertura");
  assert.match(app, /ficaram fora da leitura/, "a tela não avisa quando uma aba fica fora");
});

check("o SCON ESCOPO é o último recurso da descrição, antes do texto atual da LD", () => {
  const core = read("audit_core.js");
  const inicio = core.indexOf("const rawDescription =");
  const cadeia = core.slice(inicio, inicio + 700);
  const posValvula = cadeia.indexOf('manualValve && "VÁLVULA MANUAL"');
  const posEscopo = cadeia.indexOf("sconEscopoLastResort");
  const posAtual = cadeia.indexOf("currentDescription");
  assert.ok(posEscopo > 0, "a cadeia não tem o recurso final do SCON ESCOPO");
  assert.ok(posValvula > 0 && posValvula < posEscopo, "a LI de válvulas precisa ser consultada antes do SCON ESCOPO");
  // É o último caso justamente para não deixar a recomendação vazia.
  assert.ok(posEscopo < posAtual, "o SCON ESCOPO precisa vir antes de aceitar o texto atual da LD");

  // O recurso final não pode exigir a confirmação que o SCON ESCOPO precisa
  // para entrar antes na cadeia — senão ele nunca preencheria o que faltou.
  const decl = core.slice(core.indexOf("const sconEscopoLastResort"), core.indexOf("const sconEscopoLastResort") + 200);
  assert.doesNotMatch(decl, /trustedSconEscopo/, "o último recurso voltou a depender da confirmação");
});

// ===================== PRECISÃO DO CAMINHO DATABOOK =====================

function databookCatalogFromBase() {
  const require2 = createRequire(import.meta.url);
  const XLSX = require2("./xlsx.full.min.js");
  globalThis.XLSX = XLSX;
  const A = require2("./allocation_core.js");
  const registry = new Map();
  const previous = globalThis.RECONOfflineResources;
  globalThis.RECONOfflineResources = { register: (map) => { Object.entries(map).forEach(([name, item]) => registry.set(name, item)); } };
  try {
    new vm.Script(read("offline_recon_databook_c.js")).runInThisContext();
  } finally {
    globalThis.RECONOfflineResources = previous;
  }
  const item = registry.get("Caminho data book_Rev.C.xlsx");
  assert.ok(item, "a base Rev.C embutida precisa se registrar com o nome que o carregador procura");
  const workbook = XLSX.read(Buffer.from(item.base64, "base64"), { type: "buffer", cellDates: true });
  return { A, XLSX, entries: A.parseDatabookWorkbook(workbook, XLSX).entries };
}

check("a base Rev.C embutida troca o marcador de unidade pelo N1 real e traz os níveis", () => {
  const { A, entries } = databookCatalogFromBase();
  assert.ok(entries.length >= 150, `a base Rev.C precisa carregar as referências (veio ${entries.length})`);
  const marcador = entries.filter((entry) => /UHDT-X|\bXXX\b|NOME UNIDADE/i.test(entry.databook));
  assert.equal(marcador.length, 0, "nenhum caminho pode sair com o marcador de unidade da planilha");
  const unidades = [...new Set(entries.map((entry) => entry.databook.split("|")[0]))];
  assert.deepEqual(unidades, ["UHDT-D"], "todo caminho da base precisa começar pelo N1 declarado nas abas de estrutura");
  entries.forEach((entry) => {
    assert.deepEqual(entry.levels, entry.databook.split("|"), `os níveis de ${entry.databook} precisam ser os trechos do próprio caminho`);
  });
});

check("todo caminho geral por disciplina existe na base Rev.C embutida", () => {
  const { A, entries } = databookCatalogFromBase();
  const prefixos = new Set();
  entries.forEach((entry) => {
    const partes = entry.databook.split("|");
    for (let corte = 3; corte <= partes.length; corte += 1) prefixos.add(A.pathKey(partes.slice(0, corte).join("|")));
  });
  const bloco = read("allocation_core.js").match(/const GENERAL_DATABOOK_BY_DISCIPLINE = Object\.freeze\(\{[\s\S]*?\n  \}\);/)[0];
  const caminhos = [...bloco.matchAll(/"(UHDT-[^"]+)"/g)].map((match) => match[1]);
  assert.ok(caminhos.length >= 20, "a tabela de caminhos gerais precisa continuar existindo");
  const fora = caminhos.filter((caminho) => !prefixos.has(A.pathKey(caminho)));
  assert.deepEqual(fora, [], `estes caminhos gerais não existem na base: ${fora.join(" · ")}`);
});

check("os níveis da alocação vêm da EAP do documento, não do caminho Databook", () => {
  const A = createRequire(import.meta.url)("./allocation_core.js");
  // Níveis conforme as alocações oficiais C1O-ALOC-CM-...: N1 é a unidade e
  // N2/N3 são o grupo e o subgrupo da EAP, não as pastas do Databook.
  const niveisCivil = ["UHDTD U-32", "03.REPARO", "03.04.CIVIL"];
  const control = {
    rows: [], baseDocuments: new Map(), projectLevelBase: [], latestLdVersion: "",
    levelsByEap: new Map([["3.4.21.1", [...niveisCivil, "", "", "", "", "", "", ""]]]),
    levelsByDatabook: new Map(),
  };
  const caminho = "UHDT-D|DATA BOOK C&M|CIVIL|RIR CIVIL";
  const build = (document) => ({
    document, documentKey: A.key(document), title: "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO",
    discipline: "CIVIL", sheet: "ET_LD_003", row: 2,
    ldColumns: [{ header: "CAMINHO DATABOOK", value: caminho }],
  });

  const exata = A.outputFromRecord(build("C1O_RNEST_U32_3.4.21.1_CVL_RIR_NF-3857"), null, null, control, "2026-08-18", null);
  assert.deepEqual(exata.levels.slice(0, 3), niveisCivil, "a EAP do nome do documento precisa resolver os níveis");
  assert.equal(exata.databook, caminho, "o caminho Databook continua vindo da LD");
  assert.notEqual(exata.levels[2], "CIVIL", "o N3 não pode virar a pasta do Databook");

  // EAP irmã, mesmo grupo e subgrupo: 3.4.18.1 cai no mesmo 03.REPARO/03.04.CIVIL.
  const irma = A.outputFromRecord(build("C1O_RNEST_U32_3.4.18.1_CVL_RIR_NF-878"), null, null, control, "2026-08-18", null);
  assert.deepEqual(irma.levels.slice(0, 3), niveisCivil, "EAP irmã precisa aproveitar os níveis do mesmo subgrupo");

  // EAP de outro grupo, sem nada aprendido: não inventa nível.
  const outra = A.outputFromRecord(build("C1O_RNEST_U32_6.16.50.1_ELE_RIR_NF-1"), null, null, control, "2026-08-18", null);
  assert.equal(outra.levels.filter(Boolean).length, 0, "sem EAP conhecida os níveis ficam vazios, não copiam o caminho");
});

check("a alocação prefere a pasta da disciplina ao caminho geral", () => {
  const { A, entries } = databookCatalogFromBase();
  const casos = [
    ["C1O_RNEST_U32_3.1.1.1_TUB_RIR_VM-320001", "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO DE VÁLVULA", "TUBULAÇÃO"],
    ["C1O_RNEST_U32_3.4.1.1_EQD_REP_BA-320001", "RELATÓRIO DE CONSTRUÇÃO E MONTAGEM DE BOMBA", "EQP DINÂMICOS"],
    ["C1O_RNEST_U32_3.8.1.1_PIN_REP_PJ-320001", "RELATÓRIO DE PINTURA E JATEAMENTO", "PINTURA"],
  ];
  const control = { rows: [], baseDocuments: new Map(), levelsByEap: new Map(), levelsByDatabook: new Map(), projectLevelBase: [], latestLdVersion: "" };
  const records = casos.map(([document, title, discipline], indice) => ({
    document, documentKey: A.key(document), title, discipline, sheet: "ET_LD_003", row: indice + 2,
    source: "LD-5290.00-22313-91A-C1O-003_0001_0.xlsx",
    ldColumns: [{ header: "DOCUMENTO", value: document }, { header: "TÍTULO", value: title }, { header: "DISCIPLINA", value: discipline }],
  }));
  const analise = A.analyze(records.map((record) => ({ raw: record.document })), records, control, { catalogEntries: entries, allocationDate: "2026-08-18" });
  const conhecidos = new Set(entries.map((entry) => A.pathKey(entry.databook)));
  assert.equal(analise.results.length, casos.length);
  analise.results.forEach((resultado) => {
    const saida = resultado.output || {};
    const evidencia = saida.databookEvidence || {};
    assert.notEqual(evidencia.sourceType, "discipline-fallback", `${resultado.document} caiu no caminho geral: ${saida.databook}`);
    assert.ok(conhecidos.has(A.pathKey(saida.databook)), `${saida.databook} não existe na base Rev.C`);
  });
});

check("o melhor encaixe do mapa não é descartado por pouco", () => {
  const fonte = read("allocation_core.js");
  const trecho = fonte.slice(fonte.indexOf("function chooseCatalogEvidence"), fonte.indexOf("function evidenceRowsByFamily"));
  assert.doesNotMatch(trecho, /if \(top\.score < 76\) return null;/, "a queda seca de pontuação mandava o documento para o caminho geral");
  assert.match(trecho, /top\.score - runner\.score < 10/, "a proteção contra empate entre pastas precisa continuar");
  assert.match(trecho, /levels: \[\],/, "o Mapa Databook resolve o caminho; os níveis continuam vindo da EAP");
});

check("o histórico de alocações reproduz caminho e níveis já decididos", () => {
  const require2 = createRequire(import.meta.url);
  const XLSX = require2("./xlsx.full.min.js");
  globalThis.XLSX = XLSX;
  const A = require2("./allocation_core.js");

  // Uma alocação oficial anterior, no formato da aba GERAL: é assim que o
  // usuário alimenta o gerador com as decisões que já tomou.
  const cabecalho = [...A.ALLOCATION_HEADERS];
  const linha = [
    "C1O_RNEST_U32_3.4.21.1_CVL_LAC_B-32001B", "2026-07-22", "RNEST UHDTD U-32 C&M/CIVIL", "", "INCLUSÃO", "",
    "PARA CONSTRUÇÃO", "", "", "UHDT-D|DATA BOOK C&M|CIVIL|CONCRETO - SUPERESTRUTURA",
    "UHDTD U-32", "03.REPARO", "03.04.CIVIL", "", "", "",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([cabecalho, linha]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "GERAL");
  const historyRows = A.parseHistoricalAllocationWorkbook(book, XLSX, "C1O-ALOC-CM-0221-2026.xlsx").rows;
  assert.equal(historyRows.length, 1, "o leitor precisa enxergar a linha da alocação anterior");

  const control = { rows: [], baseDocuments: new Map(), levelsByEap: new Map(), levelsByDatabook: new Map(), projectLevelBase: [], latestLdVersion: "" };
  const record = {
    document: linha[0], documentKey: A.key(linha[0]), title: "", discipline: "CIVIL",
    sheet: "ET_LD_003", row: 2, source: "LD.xlsx",
    ldColumns: [{ header: "DOCUMENTO", value: linha[0] }, { header: "DISCIPLINA", value: "CIVIL" }],
  };
  const analise = A.analyze([{ raw: record.document }], [record], control, { catalogEntries: [], historyRows, allocationDate: "2026-08-18" });
  const saida = analise.results[0].output;
  assert.equal(saida.databook, "UHDT-D|DATA BOOK C&M|CIVIL|CONCRETO - SUPERESTRUTURA", "o caminho já decidido precisa ser repetido");
  assert.deepEqual(saida.levels.slice(0, 3), ["UHDTD U-32", "03.REPARO", "03.04.CIVIL"], "os níveis da EAP precisam vir do histórico");
});

check("pastas quase homônimas são decididas pela palavra que só uma delas tem", () => {
  const { A, entries } = databookCatalogFromBase();
  const control = { rows: [], baseDocuments: new Map(), levelsByEap: new Map(), levelsByDatabook: new Map(), projectLevelBase: [], latestLdVersion: "" };
  const casos = [
    ["C1O_RNEST_U32_3.4.21.1_CVL_LAC_B-32001B", "LAUDO DE ACABAMENTO DE CONCRETO DA SUPERESTRUTURA DA BASE B-32001B", "CIVIL", "UHDT-D|DATA BOOK C&M|CIVIL|CONCRETO - SUPERESTRUTURA"],
    ["C1O_RNEST_U32_3.4.21.1_CVL_LAC_nt-R-32001", "LAUDO DE ACABAMENTO DE CONCRETO DA INFRAESTRUTURA", "CIVIL", "UHDT-D|DATA BOOK C&M|CIVIL|CONCRETO - INFRAESTRUTURA"],
    // Grupo 7 começando por EMT manda o documento de civil para estrutura metálica.
    ["C1O_RNEST_U32_3.5.1.5_CVL_RIR_EMT-NF-3857", "RELATÓRIO DE INSPEÇÃO DE RECEBIMENTO DE ESTRUTURA METÁLICA", "CIVIL", "UHDT-D|DATA BOOK C&M|CIVIL|RIR ESTRUTURA METÁLICA"],
  ];
  const records = casos.map(([document, title, discipline], indice) => ({
    document, documentKey: A.key(document), title, discipline, sheet: "ET_LD_003", row: indice + 2, source: "LD.xlsx",
    ldColumns: [{ header: "TÍTULO", value: title }, { header: "DISCIPLINA", value: discipline }],
  }));
  const analise = A.analyze(records.map((record) => ({ raw: record.document })), records, control, { catalogEntries: entries, allocationDate: "2026-08-18" });
  analise.results.forEach((resultado, indice) => {
    assert.equal(A.pathKey((resultado.output || {}).databook || ""), A.pathKey(casos[indice][3]), `${casos[indice][0]} escolheu a pasta errada`);
  });
});

check("o caminho geral escreve PROCEDIMENTOS DE EXECUÇÃO como na base", () => {
  const fonte = read("allocation_core.js");
  const bloco = fonte.slice(fonte.indexOf("function generalDatabookFallback"), fonte.indexOf("function titleTokens"));
  assert.doesNotMatch(bloco, /EDECUÇÃO/, "o caminho gravado precisa usar a grafia da Rev.C, não a da Rev.B");
  assert.match(bloco, /GERAL - PROCEDIMENTOS DE EXECUÇÃO/);
});

console.log(JSON.stringify({ version: VERSION, passed: true, checks: checks.length, names: checks }, null, 2));
