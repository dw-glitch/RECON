(function (root) {
  "use strict";

  const loaded = new Map();
  const loading = new Map();
  const moduleState = new Map();
  const busyModules = new Set();
  let compatibilityMode = false;
  const moduleLabels = { relations: "Relações", allocation: "Alocação", databook: "Databook", titles: "Correção de títulos", tags: "Conferência de TAGs", renamer: "Renomeador" };

  const moduleDeps = {
    relations: ["relations"],
    allocation: ["allocation"],
    databook: ["relations", "audit"],
    titles: ["relations", "audit"],
    tags: ["tags"],
    renamer: ["renamer"],
  };

  const moduleRequirements = {
    relations: ["TriagemCore", "CorporateRelationsCore", "RECONRelations"],
    allocation: ["TriagemCore", "AllocationCore", "RECONAllocation"],
    databook: ["TriagemCore", "RECONAuditCore", "RECONAudits"],
    titles: ["TriagemCore", "RECONAuditCore", "RECONAudits"],
    tags: ["RECONTagConferenceCore", "RECONTagConference"],
    renamer: ["RECONRenamerCore", "RECONRenamer"],
  };

  const groupRequirements = {
    common: ["TriagemCore"],
    relations: ["TriagemCore", "CorporateRelationsCore", "RECONRelations"],
    allocation: ["TriagemCore", "AllocationCore", "RECONAllocation"],
    audit: ["TriagemCore", "RECONAuditCore", "RECONAudits"],
    tags: ["RECONTagConferenceCore", "RECONTagConference"],
    renamer: ["RECONRenamerCore", "RECONRenamer"],
    "offline:scon-escopo-titles": ["RECONSconEscopoTitleCatalog"],
  };

  const groups = {
    shell: ["output_audit.js", "recon-brand.js", "recon_contracts.js"],
    xlsx: ["file_access.js", "xlsx.full.min.js", "recon_workbook_worker_client.js"],
    export: ["exceljs.min.js", "jszip.min.js"],
    offline: ["offline_resources.js"],
    "offline:audit": ["offline", "offline_recon_audit_bases.js"],
    "offline:databook-b": ["offline", "offline_recon_databook_b.js"],
    "offline:pdf-worker": ["offline", "offline_recon_pdf_worker.js"],
    "offline:scon-escopo-titles": ["scon_escopo_title_catalog.js"],
    common: ["recon_compute_client.js", "recon_pager.js", "core.js", "ld_conflicts.js", "recon_export_guard.js", "ld_compatibility.js", "timeline_core.js"],
    relations: ["xlsx", "common", "relations_core.js", "relations_app.js"],
    allocation: ["xlsx", "offline:databook-b", "common", "allocation_confirmation_sources.js", "allocation_core.js", "allocation_batches.js", "databook_catalog.js", "databook_allocation_sources.js", "offline_recon_allocation_template.js", "allocation_workbook.js", "allocation_title_quality.js", "allocation_app.js"],
    audit: ["xlsx", "offline:audit", "offline:scon-escopo-titles", "common", "allocation_confirmation_sources.js", "allocation_core.js", "databook_catalog.js", "databook_allocation_sources.js", "non_tagged_title_rules.js", "scon_catalog_loader.js", "tag_reference_catalog.js", "audit_core.js", "ld_preservation.js", "ld_databook_writer.js", "ld_title_writer.js", "audit_app.js"],
    tags: ["xlsx", "tag_reference_catalog.js", "tag_conference_core.js", "tag_conference_app.js"],
    renamer: ["offline:pdf-worker", "pdf.min.js", "renamer_core.js", "renamer_app.js"],
  };

  function scriptBasename(value) {
    const raw = String(value || "").split("?")[0].split("#")[0];
    if (!raw) return "";
    try {
      const pathname = new URL(raw, document.baseURI).pathname;
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    } catch (_) {
      return decodeURIComponent(raw.replace(/\\/g, "/").split("/").pop() || "");
    }
  }

  function isSameScript(node, src) {
    if (!node) return false;
    if (node.dataset.reconLazy === src) return true;
    return scriptBasename(node.getAttribute("src")) === scriptBasename(src);
  }

  function updateGlobalBusy(message) {
    const busy = busyModules.size > 0;
    document.body.classList.toggle("recon-module-loading", busy);
    document.body.dataset.reconLoadingCount = String(busyModules.size);
    const status = document.getElementById("runtime-status-text") || document.querySelector(".runtime-status span:last-child");
    if (!status) return;
    if (busy && message) status.textContent = message;
    else if (!busy) status.textContent = "Pronto para uso";
  }

  function setBusy(module, busy, message) {
    const view = document.querySelector(`[data-module-view="${module}"]`);
    if (busy) busyModules.add(module); else busyModules.delete(module);
    if (view) {
      view.toggleAttribute("data-module-loading", busy);
      view.setAttribute("aria-busy", String(Boolean(busy)));
    }
    updateGlobalBusy(message);
  }

  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    if (loading.has(src)) return loading.get(src);

    const promise = new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((node) => isSameScript(node, src));
      if (existing) {
        loaded.set(src, true);
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.dataset.reconLazy = src;
      let runtimeError = null;

      const onRuntimeError = (event) => {
        if (scriptBasename(event.filename) !== scriptBasename(src)) return;
        runtimeError = event.error instanceof Error
          ? event.error
          : new Error(event.message || `Falha ao executar ${src}`);
      };

      const cleanup = () => root.removeEventListener("error", onRuntimeError);
      root.addEventListener("error", onRuntimeError);

      script.addEventListener("load", () => {
        cleanup();
        loading.delete(src);
        if (runtimeError) {
          script.remove();
          reject(runtimeError);
          return;
        }
        loaded.set(src, true);
        resolve();
      }, { once: true });

      script.addEventListener("error", () => {
        cleanup();
        loading.delete(src);
        script.remove();
        reject(new Error(`Falha ao carregar ${src}`));
      }, { once: true });

      document.head.appendChild(script);
    });

    loading.set(src, promise);
    return promise;
  }

  function assertGlobals(label, names) {
    const missing = (names || []).filter((name) => root[name] == null);
    if (missing.length) {
      throw new Error(`O grupo ${label} não foi inicializado corretamente. Componente(s) ausente(s): ${missing.join(", ")}.`);
    }
  }

  async function ensure(item) {
    if (groups[item]) {
      for (const dependency of groups[item]) await ensure(dependency);
      assertGlobals(item, groupRequirements[item]);
      return;
    }
    await loadScript(item);
  }

  function assertModuleReady(module) {
    const missing = (moduleRequirements[module] || []).filter((name) => root[name] == null);
    if (missing.length) {
      throw new Error(`O módulo ${module} não foi inicializado corretamente. Componente(s) ausente(s): ${missing.join(", ")}. Recarregue a página e tente novamente.`);
    }
  }

  async function ensureModule(module) {
    const dependencies = moduleDeps[module] || [];
    if (!dependencies.length) return;
    if (moduleState.get(module) === "ready") return;
    if (moduleState.get(module) === "loading") return loading.get(`module:${module}`);

    moduleState.set(module, "loading");
    setBusy(module, true, `Abrindo ${moduleLabels[module] || "módulo"}…`);

    const promise = (async () => {
      try {
        await ensure("shell");
        for (const group of dependencies) await ensure(group);
        assertModuleReady(module);
        moduleState.set(module, "ready");
        root.dispatchEvent(new CustomEvent("recon:module-ready", { detail: { module } }));
        root.dispatchEvent(new CustomEvent("recon:ui-update", { detail: { module } }));
      } catch (error) {
        moduleState.set(module, "failed");
        console.error(error);
        const toast = document.getElementById("toast");
        if (toast) {
          toast.textContent = "Não foi possível abrir este módulo. Recarregue a página e tente novamente.";
          toast.className = "toast show error";
        }
        throw error;
      } finally {
        loading.delete(`module:${module}`);
        setBusy(module, false);
      }
    })();

    loading.set(`module:${module}`, promise);
    return promise;
  }

  root.addEventListener("recon:worker-fallback", () => {
    compatibilityMode = true;
    document.body.classList.add("recon-worker-fallback");
    document.body.dataset.reconWorkerMode = "local";
    updateGlobalBusy();
  });

  root.addEventListener("recon:module", (event) => {
    ensureModule(event.detail && event.detail.module).catch(() => {});
  });

  root.addEventListener("DOMContentLoaded", () => {
    let initial = "relations";
    try { initial = sessionStorage.getItem("recon.active.module.v1") || initial; } catch (_) {}
    ensureModule(initial).catch(() => {});
  }, { once: true });

  root.RECONModuleLoader = Object.freeze({
    ensure,
    ensureModule,
    loaded: (name) => loaded.has(name),
    state: (name) => moduleState.get(name) || "idle",
    activeLoadingCount: () => busyModules.size,
    scriptBasename,
  });
})(window);
