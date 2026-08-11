// RECON Service Worker v1.26.32
// Provides offline support, caching, and PWA installation capabilities
const VERSION = "1.26.32";
const CACHE_NAME = `recon-cache-v${VERSION}`;
const STATIC_CACHE = `recon-static-v${VERSION}`;
const DATA_CACHE = `recon-data-v${VERSION}`;

// Casca do aplicativo: precisa estar disponível para a primeira abertura offline.
// Falhas aqui impedem o RECON de abrir, por isso são tratadas como obrigatórias.
const SHELL_URLS = [
  "index.html",
  "manifest.json",
  "design-system.css",
  "legacy-compat.css",
  "recon-ui.css",
  "recon-final.css",
  "output_audit.js",
  "pending_core.js",
  "recon_contracts.js",
  "task_center.js",
  "file_access.js",
  "recon_file_handles.js",
  "recon_module_loader.js",
  "bases_core.js",
  "bases_app.js",
  "recon_compute_client.js",
  "recon_pager.js",
  "recon_app.js",
  "p1_ux.js",
  "app-ui.js",
  "ui-v3.js",
  "productivity_center.js",
  "recon_enhancements.js",
  "allocation_databook_finder.js",
  "recon-favicon.ico",
  "recon-icon.png",
  "recon-icon-192.png",
  "recon-logo-app.png",
  "recon-logo-report.png"
];

// Código dos módulos e bibliotecas de planilha: sem isto, a casca abre mas
// nenhum módulo funciona offline. É o que realmente faltava no precache antigo.
const MODULE_URLS = [
  "recon-brand.js",
  "core.js",
  "ld_conflicts.js",
  "ld_compatibility.js",
  "ld_preservation.js",
  "ld_databook_writer.js",
  "ld_title_writer.js",
  "recon_export_guard.js",
  "timeline_core.js",
  "offline_resources.js",
  "scon_catalog_loader.js",
  "xlsx.full.min.js",
  "recon_workbook_worker.js",
  "recon_workbook_worker_client.js",
  "recon_compute_worker.js",
  "relations_core.js",
  "relations_app.js",
  "allocation_confirmation_sources.js",
  "allocation_core.js",
  "allocation_batches.js",
  "allocation_workbook.js",
  "allocation_title_quality.js",
  "allocation_app.js",
  "databook_catalog.js",
  "databook_allocation_sources.js",
  "non_tagged_title_rules.js",
  "document_title_standard.js",
  "audit_core.js",
  "audit_app.js",
  "tag_conference_core.js",
  "tag_conference_app.js",
  "renamer_core.js",
  "renamer_app.js",
  "exceljs.min.js",
  "jszip.min.js"
];

// Catálogos de referência (scon_*, tag_reference_catalog, bases offline) NÃO são
// precacheados: somam mais de 10 MB e o carregamento já é sob demanda, por
// disciplina, em scon_catalog_loader.js e offline_resources.js. Eles entram no
// cache naturalmente na primeira vez que forem usados, via networkFirst.

// Install: cache the shell first, then the module code, tolerating individual failures
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        // A casca é obrigatória: se algum item falhar, a instalação falha e o
        // Service Worker antigo continua no ar, em vez de ficar meio instalado.
        await cache.addAll(SHELL_URLS);

        // O código dos módulos é best-effort: um arquivo indisponível não pode
        // derrubar a instalação inteira nem deixar o app sem offline nenhum.
        const results = await Promise.allSettled(
          MODULE_URLS.map((url) => cache.add(url))
        );
        const failed = results
          .map((result, index) => (result.status === "rejected" ? MODULE_URLS[index] : null))
          .filter(Boolean);
        if (failed.length) {
          console.warn(`RECON SW: ${failed.length} recurso(s) fora do cache inicial:`, failed);
        }
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  const validCaches = [STATIC_CACHE, DATA_CACHE, CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (!validCaches.includes(name)) {
            return caches.delete(name);
          }
          return undefined;
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: network-first for HTML, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // For JavaScript and CSS assets, prefer the network but fall back to cached copies
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // For images and fonts
  if (url.pathname.match(/\.(png|ico|svg|woff2?)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // For the main document (HTML) - network first
  if (url.pathname === "/" || url.pathname.endsWith("index.html")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Default: network first with cache fallback
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response("Recurso indisponível offline", { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (!response.ok) throw new Error(`Resposta de rede não foi OK: ${response.status}`);
    const cache = await caches.open(DATA_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("Conteúdo offline não disponível", { status: 503 });
  }
}

// Listen for messages from the app
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "CLEAR_CACHE") {
    Promise.all([caches.delete(DATA_CACHE), caches.delete(STATIC_CACHE)])
      .then(() => event.ports[0]?.postMessage({ success: true }))
      .catch((error) => event.ports[0]?.postMessage({ success: false, error: String(error) }));
  }
});
