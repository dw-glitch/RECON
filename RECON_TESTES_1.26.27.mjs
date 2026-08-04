import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

check("cabeçalho abre o GRCON como atalho independente", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /data-version="1\.26\.27"/i);
  assert.match(html, /href="https:\/\/grcon\.vercel\.app\/"/i);
  assert.match(html, /target="_blank"/i);
  assert.match(html, /rel="noopener noreferrer"/i);
});

check("RECON permanece sem cliente, sessão ou banco do GRCON", () => {
  const sources = fs.readdirSync(root)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".min.js"))
    .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /GRCON_CLOUD_CONFIG/);
  assert.doesNotMatch(sources, /supabase\.createClient|createClient\s*\(/);
  assert.doesNotMatch(sources, /grcon_history|grcon_clear_history/);
});

check("HTML não possui IDs duplicados", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});

check("manifesto declara os tamanhos reais dos ícones", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

check("service worker usa cache isolado da versão 1.26.27", () => {
  const source = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(source, /recon-cache-v1\.26\.27/);
  assert.match(source, /recon-static-v1\.26\.27/);
  assert.match(source, /recon-data-v1\.26\.27/);
});

check("arquivos essenciais do fluxo permanecem presentes", () => {
  const required = [
    "relations_app.js", "allocation_app.js", "tag_conference_app.js",
    "audit_app.js", "audit_core.js", "renamer_app.js",
    "recon_module_loader.js", "core.js", "index.html",
  ];
  const missing = required.filter((name) => !fs.existsSync(path.join(root, name)));
  assert.deepEqual(missing, []);
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

console.log(JSON.stringify({ version: "1.26.27", passed: true, checks: checks.length, names: checks }, null, 2));
