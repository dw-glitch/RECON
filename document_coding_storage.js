(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONDocumentCodingStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const DB_NAME = "recon-document-coding-v1";
  const DB_VERSION = 1;
  const STORES = Object.freeze({
    AUDIT: "audit",
    RESERVATIONS: "sequence_reservations",
    TEMPLATES: "templates",
    SETTINGS: "settings",
    NORMS: "norms",
  });

  function hasIndexedDb() {
    return Boolean(root && root.indexedDB);
  }

  function openDb() {
    if (!hasIndexedDb()) return Promise.reject(new Error("IndexedDB indisponível neste navegador."));
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("Falha ao abrir a base de codificação."));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.AUDIT)) {
          const store = db.createObjectStore(STORES.AUDIT, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("code", "code");
          store.createIndex("project", "project");
        }
        if (!db.objectStoreNames.contains(STORES.RESERVATIONS)) {
          const store = db.createObjectStore(STORES.RESERVATIONS, { keyPath: "id" });
          store.createIndex("familyKey", "familyKey");
          store.createIndex("expiresAt", "expiresAt");
        }
        if (!db.objectStoreNames.contains(STORES.TEMPLATES)) db.createObjectStore(STORES.TEMPLATES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) db.createObjectStore(STORES.SETTINGS, { keyPath: "key" });
        if (!db.objectStoreNames.contains(STORES.NORMS)) db.createObjectStore(STORES.NORMS, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function withStore(name, mode, callback) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const store = tx.objectStore(name);
        let result;
        try { result = callback(store, tx); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error(`Falha na transação ${name}.`));
        tx.onabort = () => reject(tx.error || new Error(`Transação ${name} abortada.`));
      });
    } finally {
      db.close();
    }
  }

  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Falha na operação IndexedDB."));
    });
  }

  async function putAudit(record) {
    if (!record || !record.id) throw new Error("Registro de auditoria sem id.");
    await withStore(STORES.AUDIT, "readwrite", (store) => { store.put(record); });
    return record;
  }

  async function listAudit(limit) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORES.AUDIT, "readonly");
      const store = tx.objectStore(STORES.AUDIT);
      const all = await req(store.getAll());
      return (all || []).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, limit || 500);
    } finally { db.close(); }
  }

  async function saveTemplate(template) {
    if (!template || !template.id) throw new Error("Template sem id.");
    const clean = Object.assign({}, template, { updatedAt: new Date().toISOString() });
    await withStore(STORES.TEMPLATES, "readwrite", (store) => { store.put(clean); });
    return clean;
  }

  async function getTemplate(id) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORES.TEMPLATES, "readonly");
      return await req(tx.objectStore(STORES.TEMPLATES).get(id));
    } finally { db.close(); }
  }

  async function saveNorm(norm) {
    if (!norm || !norm.id) throw new Error("Referência normativa sem id.");
    await withStore(STORES.NORMS, "readwrite", (store) => { store.put(norm); });
    return norm;
  }

  async function listNorms() {
    const db = await openDb();
    try {
      const tx = db.transaction(STORES.NORMS, "readonly");
      return await req(tx.objectStore(STORES.NORMS).getAll());
    } finally { db.close(); }
  }

  async function setSetting(key, value) {
    await withStore(STORES.SETTINGS, "readwrite", (store) => { store.put({ key, value, updatedAt: new Date().toISOString() }); });
  }

  async function getSetting(key) {
    const db = await openDb();
    try {
      const row = await req(db.transaction(STORES.SETTINGS, "readonly").objectStore(STORES.SETTINGS).get(key));
      return row ? row.value : undefined;
    } finally { db.close(); }
  }

  function lockName(project, familyKey) {
    return `recon-coding:${String(project || "default")}:${String(familyKey || "unknown")}`;
  }

  async function localLock(name, callback) {
    if (root.navigator && root.navigator.locks && typeof root.navigator.locks.request === "function") {
      return root.navigator.locks.request(name, { mode: "exclusive" }, callback);
    }
    // Fallback para navegadores sem Web Locks. A transação IndexedDB continua
    // serializando a gravação, mas a seleção + gravação entre abas não é tão forte.
    return callback();
  }

  async function cleanupExpired(store, now) {
    const all = await req(store.getAll());
    (all || []).forEach((item) => {
      if (item.expiresAt && item.expiresAt <= now) store.delete(item.id);
    });
  }

  async function reserveLocalSequence(params) {
    const input = Object.assign({ ttlMs: 30 * 60 * 1000, minimum: 1 }, params || {});
    if (!input.familyKey) throw new Error("familyKey obrigatório para reservar sequência.");
    const shared = root.RECONDocumentCodingSharedSequenceAdapter;
    if (shared && typeof shared.reserve === "function") {
      const result = await shared.reserve(input);
      return Object.assign({ scope: "shared", crossDeviceAtomic: true }, result);
    }

    return localLock(lockName(input.project, input.familyKey), async () => {
      const db = await openDb();
      try {
        const tx = db.transaction(STORES.RESERVATIONS, "readwrite");
        const store = tx.objectStore(STORES.RESERVATIONS);
        const now = Date.now();
        await cleanupExpired(store, now);
        const all = await req(store.getAll());
        const family = (all || []).filter((item) => item.familyKey === input.familyKey && item.project === (input.project || "default"));
        const reservedMax = family.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0);
        const existingMax = Math.max(Number(input.existingMax) || 0, Number(input.minimum || 1) - 1);
        const sequence = Math.max(existingMax, reservedMax) + 1;
        const id = `${input.project || "default"}|${input.familyKey}|${sequence}`;
        const record = {
          id,
          project: input.project || "default",
          familyKey: input.familyKey,
          sequence,
          owner: input.owner || "anonymous",
          createdAt: now,
          expiresAt: now + Number(input.ttlMs || 0),
          code: input.code || "",
          state: "reserved",
        };
        store.put(record);
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error("Falha ao reservar sequencial."));
          tx.onabort = () => reject(tx.error || new Error("Reserva de sequencial abortada."));
        });
        return Object.assign({ scope: "browser-local", crossDeviceAtomic: false }, record);
      } finally { db.close(); }
    });
  }

  async function commitReservation(id, code) {
    const shared = root.RECONDocumentCodingSharedSequenceAdapter;
    if (shared && typeof shared.commit === "function") return shared.commit(id, code);
    const db = await openDb();
    try {
      const tx = db.transaction(STORES.RESERVATIONS, "readwrite");
      const store = tx.objectStore(STORES.RESERVATIONS);
      const record = await req(store.get(id));
      if (!record) throw new Error("Reserva não encontrada ou expirada.");
      record.state = "committed";
      record.code = code || record.code || "";
      record.expiresAt = Number.MAX_SAFE_INTEGER;
      store.put(record);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Falha ao confirmar reserva."));
      });
      return record;
    } finally { db.close(); }
  }

  async function releaseReservation(id) {
    const shared = root.RECONDocumentCodingSharedSequenceAdapter;
    if (shared && typeof shared.release === "function") return shared.release(id);
    await withStore(STORES.RESERVATIONS, "readwrite", (store) => { store.delete(id); });
    return true;
  }

  async function listReservations(project) {
    const db = await openDb();
    try {
      const all = await req(db.transaction(STORES.RESERVATIONS, "readonly").objectStore(STORES.RESERVATIONS).getAll());
      return (all || []).filter((item) => !project || item.project === project);
    } finally { db.close(); }
  }

  function capabilities() {
    const shared = root.RECONDocumentCodingSharedSequenceAdapter;
    return {
      indexedDb: hasIndexedDb(),
      webLocks: Boolean(root.navigator && root.navigator.locks),
      sharedSequenceAdapter: Boolean(shared && typeof shared.reserve === "function"),
      crossDeviceAtomic: Boolean(shared && typeof shared.reserve === "function"),
      auditPersistence: hasIndexedDb(),
      templatePersistence: hasIndexedDb(),
    };
  }

  return Object.freeze({
    DB_NAME,
    STORES,
    openDb,
    putAudit,
    listAudit,
    saveTemplate,
    getTemplate,
    saveNorm,
    listNorms,
    setSetting,
    getSetting,
    reserveLocalSequence,
    commitReservation,
    releaseReservation,
    listReservations,
    capabilities,
  });
});
