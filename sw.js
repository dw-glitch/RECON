// RECON Service Worker v1.26.27
// Provides offline support, caching, and PWA installation capabilities
const CACHE_NAME = "recon-cache-v1.26.27";
const STATIC_CACHE = "recon-static-v1.26.27";
const DATA_CACHE = "recon-data-v1.26.27";

const PRECACHE_URLS = [
  // App shell: HTML, CSS, icons, manifest
  "index.html",
  "design-system.css",
  "legacy-compat.css",
  "recon-ui.css",
  "recon-final.css",
  "recon-favicon.ico",
  "recon-icon.png",
  "recon-icon-192.png",
  "recon-logo-app.png",
  "manifest.json",

  // App shell: scripts loaded on every visit (see <script defer> tags in index.html)
  "output_audit.js",
  "pending_core.js",
  "recon-brand.js",
  "recon_contracts.js",
  "task_center.js",
  "file_access.js",
  "recon_module_loader.js",
  "recon_compute_client.js",
  "recon_pager.js",
  "recon_app.js",
  "p1_ux.js",
  "app-ui.js",
  "ui-v3.js",
  "productivity_center.js",
  "recon_enhancements.js",
  "allocation_databook_finder.js",

  // Common group (recon_module_loader.js): required by relations/allocation/databook/titles
  "core.js",
  "ld_conflicts.js",
  "recon_export_guard.js",
  "ld_compatibility.js",
  "timeline_core.js",

  // xlsx + export groups: reading the LD and writing every Excel/ZIP download
  "xlsx.full.min.js",
  "recon_workbook_worker_client.js",
  "exceljs.min.js",
  "jszip.min.js",

  // Compute/workbook web workers and everything they importScripts()
  "recon_compute_worker.js",
  "recon_workbook_worker.js",

  // offline:* groups: hard dependencies of allocation / audit / renamer, not optional extras
  "offline_resources.js",
  "offline_recon_audit_bases.js",
  "offline_recon_databook_b.js",
  "offline_recon_pdf_worker.js",

  // Relations module
  "relations_core.js",
  "relations_app.js",

  // Allocation module
  "allocation_confirmation_sources.js",
  "allocation_core.js",
  "allocation_batches.js",
  "databook_catalog.js",
  "databook_allocation_sources.js",
  "offline_recon_allocation_template.js",
  "allocation_workbook.js",
  "allocation_title_quality.js",
  "allocation_app.js",

  // Audit module (databook + titles). scon_escopo_title_catalog.js is an unconditional
  // dependency of this group (unlike the per-discipline scon_*.js chunks below), so it
  // belongs here, not with the excluded catalogs.
  "non_tagged_title_rules.js",
  "scon_catalog_loader.js",
  "scon_escopo_title_catalog.js",
  "tag_reference_catalog.js",
  "audit_core.js",
  "ld_preservation.js",
  "ld_databook_writer.js",
  "ld_title_writer.js",
  "audit_app.js",

  // Tags module
  "tag_conference_core.js",
  "tag_conference_app.js",

  // Renamer module
  "pdf.min.js",
  "renamer_core.js",
  "renamer_app.js"

  // Deliberately NOT precached: scon_civil.js, scon_eletrica.js, scon_eqp_dinamico.js,
  // scon_eqp_estatico.js, scon_est_metalica.js, scon_hvac.js, scon_instrumentacao.js,
  // scon_seguranca.js, scon_tubulacao.js (~4.9 MB total). scon_catalog_loader.js loads
  // these on demand, one discipline at a time, only for disciplines actually present in
  // the LD being analyzed — networkFirst() below caches each one the first time it's
  // really used instead of downloading all nine up front on every install.
];

// Install: cache static assets. Promise.allSettled (not addAll/all-or-nothing) so one
// missing or renamed file can't abort the whole precache and leave offline mode disabled.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const results = await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn(`RECON Service Worker: falha ao pré-cachear "${PRECACHE_URLS[index]}".`, result.reason);
        }
      });
      return self.skipWaiting();
    })
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
    caches.delete(DATA_CACHE);
    caches.delete(STATIC_CACHE);
    event.ports[0]?.postMessage({ success: true });
  }
});
