// RECON Service Worker v1.26.27
// Provides offline support, caching, and PWA installation capabilities
const CACHE_NAME = "recon-cache-v1.26.27";
const STATIC_CACHE = "recon-static-v1.26.27";
const DATA_CACHE = "recon-data-v1.26.27";

const PRECACHE_URLS = [
  "index.html",
  "design-system.css",
  "legacy-compat.css",
  "recon-ui.css",
  "recon-final.css",
  "recon-brand.js",
  "recon_contracts.js",
  "recon_app.js",
  "app-ui.js",
  "ui-v3.js",
  "core.js",
  "p1_ux.js",
  "productivity_center.js",
  "task_center.js",
  "file_access.js",
  "recon_module_loader.js",
  "recon_compute_client.js",
  "recon_pager.js",
  "output_audit.js",
  "pending_core.js",
  "recon-favicon.ico",
  "recon-icon.png",
  "recon-icon-192.png",
  "recon-logo-app.png",
  "recon-logo-report.png",
  "manifest.json"
];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
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

  // For JavaScript modules that may be loaded dynamically
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(cacheFirst(request));
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
  if (cached) return cached;
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
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
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
