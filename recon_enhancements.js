// RECON Enhancements v1.0
// Keyboard shortcuts, drag & drop, debouncing, IndexedDB, session management, animations
(function () {
  "use strict";

  // ===================== UTILITY FUNCTIONS =====================

  function $(id) { return document.getElementById(id); }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }
  function qs(sel, root) { return (root || document).querySelector(sel); }

  // Debounce utility
  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, delay);
    };
  }

  // ===================== KEYBOARD SHORTCUTS =====================

  function installKeyboardShortcuts() {
    var moduleMap = {
      "Digit1": "relations", "Numpad1": "relations",
      "Digit2": "allocation", "Numpad2": "allocation",
      "Digit3": "tags", "Numpad3": "tags",
      "Digit4": "databook", "Numpad4": "databook",
      "Digit5": "titles", "Numpad5": "titles",
      "Digit6": "renamer", "Numpad6": "renamer"
    };

    document.addEventListener("keydown", function (e) {
      // Only fire shortcuts when not in input/textarea/select
      var tag = e.target && e.target.tagName;
      if (/^(INPUT|TEXTAREA|SELECT)$/i.test(tag)) return;

      // Ctrl+1..6: Switch modules
      if (e.ctrlKey && !e.shiftKey && !e.altKey && moduleMap[e.code]) {
        e.preventDefault();
        var module = moduleMap[e.code];
        var btn = qs('[data-module="' + module + '"]');
        if (btn) btn.click();
        return;
      }

      // Ctrl+E: Export current result
      if (e.ctrlKey && e.code === "KeyE" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        var exportBtn = $("relations-export") || $("databook-export") || $("title-export") || $("tag-export-report") || $("renamer-download");
        if (exportBtn && !exportBtn.disabled) exportBtn.click();
        return;
      }

      // Ctrl+F: Focus search in current module
      if (e.ctrlKey && e.code === "KeyF" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        var search = qs(".module-view:not([hidden]) .search-box input[type=search]");
        if (search) { search.focus(); search.select(); }
        return;
      }

      // Ctrl+S: Save filters
      if (e.ctrlKey && e.code === "KeyS" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        var saveBtn = $("relations-save-filters");
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
        return;
      }

      // ? : Show shortcuts help
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        showShortcutsHelp();
        return;
      }
    });
  }

  function showShortcutsHelp() {
    var existing = $("recon-shortcuts-dialog");
    if (existing) { existing.hidden = false; existing.removeAttribute("aria-hidden"); return; }

    var overlay = document.createElement("div");
    overlay.className = "recon-preferences-overlay";
    overlay.id = "recon-shortcuts-overlay";
    overlay.style.display = "block";
    document.body.appendChild(overlay);

    var dialog = document.createElement("section");
    dialog.className = "recon-preferences-dialog";
    dialog.id = "recon-shortcuts-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "recon-shortcuts-title");
    dialog.innerHTML =
      '<header><div><span>AJUDA RÁPIDA</span><h2 id="recon-shortcuts-title">Atalhos de teclado</h2><p>Use estas combinações para agilizar seu trabalho.</p></div>' +
      '<button aria-label="Fechar" class="icon-button" id="recon-shortcuts-close" type="button">×</button></header>' +
      '<div class="recon-preferences-body" style="padding:1rem"><div class="macro6-productivity-grid" style="grid-template-columns:1fr 1fr;gap:0.5rem">' +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Ctrl+1</kbd> a <kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Ctrl+6</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Navegar entre módulos</span></div>" +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Ctrl+E</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Exportar resultado atual</span></div>" +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Ctrl+F</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Buscar na tabela atual</span></div>" +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Ctrl+S</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Salvar combinação de filtros</span></div>" +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Alt+←</kbd> <kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>Alt+→</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Navegar (Renomeador)</span></div>" +
      "<div style='padding:0.5rem;background:var(--surface-2);border-radius:var(--radius-sm)'><kbd style='background:var(--surface-1);padding:2px 6px;border-radius:3px;border:1px solid var(--border-1)'>?</kbd> <span style='display:block;margin-top:4px;color:var(--text-2)'>Mostrar esta ajuda</span></div>" +
      "</div></div>" +
      '<footer class="drawer-footer" style="justify-content:flex-end;padding:0.75rem 1rem"><button class="primary-button" id="recon-shortcuts-ok" type="button">Fechar</button></footer>';
    document.body.appendChild(dialog);

    function close() {
      dialog.hidden = true;
      dialog.setAttribute("aria-hidden", "true");
      overlay.style.display = "none";
    }
    $("recon-shortcuts-close").addEventListener("click", close);
    $("recon-shortcuts-ok").addEventListener("click", close);
    overlay.addEventListener("click", close);
    dialog.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    qs("button", dialog).focus();
  }

  // ===================== DRAG & DROP FOR ALL UPLOADS =====================

  function installDragAndDrop() {
    var fileInputs = $$('input[type="file"]');
    fileInputs.forEach(function (input) {
      var label = input.closest("label");
      if (!label) return;
      if (label.dataset.dragEnhanced) return;
      label.dataset.dragEnhanced = "true";

      // Make the label a drop zone
      label.style.position = "relative";
      label.style.cursor = "pointer";
      label.style.transition = "border-color 0.2s, background 0.2s";

      // Add drop indicator (hidden by default)
      var indicator = document.createElement("div");
      indicator.className = "recon-drop-indicator";
      indicator.style.cssText =
        "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
        "background:rgba(20,121,166,0.08);border:2px dashed var(--brand-600);border-radius:inherit;" +
        "z-index:5;pointer-events:none;font-weight:700;color:var(--brand-700);font-size:0.85rem";
      indicator.textContent = "Solte o arquivo aqui";
      label.appendChild(indicator);

      // Drag events
      var dragCounter = 0;
      label.addEventListener("dragenter", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        if (dragCounter === 1) {
          indicator.style.display = "flex";
          label.style.borderColor = "var(--brand-600)";
          label.style.background = "var(--brand-50)";
        }
      });
      label.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      label.addEventListener("dragleave", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
          indicator.style.display = "none";
          label.style.borderColor = "";
          label.style.background = "";
        }
      });
      label.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        indicator.style.display = "none";
        label.style.borderColor = "";
        label.style.background = "";
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
          // If input supports multiple
          if (input.multiple) {
            input.files = files;
          } else {
            input.files = files;
          }
          // Trigger change event
          var evt = new Event("change", { bubbles: true });
          input.dispatchEvent(evt);
        }
      });
    });
  }

  // ===================== DEBOUNCING FOR SEARCH FILTERS =====================

  function installDebouncedSearch() {
    var searchInputs = $$('.search-box input[type="search"], input[type="search"]');
    searchInputs.forEach(function (input) {
      if (input.dataset.debounceEnhanced) return;
      input.dataset.debounceEnhanced = "true";

      var originalListener = null;
      var debounced = debounce(function () {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 300);

      input.addEventListener("input", function (e) {
        if (e.isTrusted) {
          e.stopImmediatePropagation();
          debounced();
        }
      }, true);
    });
  }

  // ===================== INDEXEDDB PERSISTENCE LAYER =====================

  var RECONDB = {
    db: null,
    DB_NAME: "RECONStorage",
    DB_VERSION: 1,

    open: function () {
      return new Promise(function (resolve, reject) {
        if (RECONDB.db) { resolve(RECONDB.db); return; }
        var request = indexedDB.open(RECONDB.DB_NAME, RECONDB.DB_VERSION);
        request.onupgradeneeded = function (e) {
          var db = e.target.result;
          // Stores
          if (!db.objectStoreNames.contains("ld_cache")) {
            db.createObjectStore("ld_cache", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("session")) {
            db.createObjectStore("session", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("preferences")) {
            db.createObjectStore("preferences", { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains("analysis_history")) {
            var store = db.createObjectStore("analysis_history", { keyPath: "id", autoIncrement: true });
            store.createIndex("timestamp", "timestamp", { unique: false });
            store.createIndex("module", "module", { unique: false });
          }
        };
        request.onsuccess = function (e) {
          RECONDB.db = e.target.result;
          resolve(RECONDB.db);
        };
        request.onerror = function (e) { reject(e.target.error); };
      });
    },

    put: function (storeName, data) {
      return RECONDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, "readwrite");
          var store = tx.objectStore(storeName);
          var req = store.put(data);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    get: function (storeName, key) {
      return RECONDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, "readonly");
          var store = tx.objectStore(storeName);
          var req = store.get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    getAll: function (storeName) {
      return RECONDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, "readonly");
          var store = tx.objectStore(storeName);
          var req = store.getAll();
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    delete: function (storeName, key) {
      return RECONDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, "readwrite");
          var store = tx.objectStore(storeName);
          var req = store.delete(key);
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    },

    clear: function (storeName) {
      return RECONDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, "readwrite");
          var store = tx.objectStore(storeName);
          var req = store.clear();
          req.onsuccess = function () { resolve(); };
          req.onerror = function (e) { reject(e.target.error); };
        });
      });
    }
  };

  // Cache LD data in IndexedDB
  function cacheLDData(ldId, data) {
    return RECONDB.put("ld_cache", { id: ldId, data: data, timestamp: Date.now() });
  }

  function getCachedLD(ldId) {
    return RECONDB.get("ld_cache", ldId).then(function (entry) {
      if (!entry) return null;
      // Cache valid for 1 hour
      if (Date.now() - entry.timestamp > 3600000) {
        RECONDB.delete("ld_cache", ldId);
        return null;
      }
      return entry.data;
    });
  }

  // Save session state
  function saveSessionState(key, value) {
    return RECONDB.put("session", { key: key, value: value, timestamp: Date.now() });
  }

  function loadSessionState(key) {
    return RECONDB.get("session", key).then(function (entry) {
      return entry ? entry.value : null;
    });
  }

  // Save analysis to history
  function saveAnalysisToHistory(module, data) {
    return RECONDB.put("analysis_history", {
      module: module,
      data: data,
      timestamp: Date.now(),
      date: new Date().toISOString()
    });
  }

  // ===================== SESSION EXPORT/IMPORT =====================

  function exportSession() {
    Promise.all([
      RECONDB.getAll("session"),
      RECONDB.getAll("preferences"),
      RECONDB.getAll("analysis_history")
    ]).then(function (results) {
      var session = { sessions: results[0], preferences: results[1], history: results[2], exportedAt: new Date().toISOString(), version: "1.0" };
      var blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "RECON-session-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      showToast("Sessão exportada com sucesso.");
    });
  }

  function importSession(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data || !data.version) { showToast("Arquivo de sessão inválido."); return; }
        var promises = [];
        if (data.sessions) {
          data.sessions.forEach(function (item) { promises.push(RECONDB.put("session", item)); });
        }
        if (data.preferences) {
          data.preferences.forEach(function (item) { promises.push(RECONDB.put("preferences", item)); });
        }
        Promise.all(promises).then(function () {
          showToast("Sessão restaurada com sucesso. Recarregue a página para aplicar.");
        });
      } catch (err) {
        showToast("Erro ao importar sessão: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ===================== TOAST NOTIFICATION =====================

  function showToast(message, duration) {
    var toast = $("toast") || document.querySelector("app-toast");
    if (!toast) {
      toast = document.createElement("app-toast");
      toast.id = "toast";
      toast.className = "toast recon-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(function () { toast.classList.remove("visible"); }, duration || 4000);
  }

  // ===================== MICRO-INTERACTIONS & ANIMATIONS =====================

  function installMicroInteractions() {
    var style = document.createElement("style");
    style.textContent =
      // Smooth transitions for module switching
      ".module-view { transition: opacity 0.25s ease, transform 0.25s ease; }" +
      ".module-view.active { opacity: 1; transform: translateY(0); }" +
      ".module-view:not(.active) { opacity: 0; transform: translateY(8px); }" +

      // Progress bar animation
      ".progress-bar, #relations-progress-bar, #databook-progress-bar, #title-progress-bar, #renamer-progress-bar, #allocation-progress-bar {" +
      "  transition: width 0.4s ease;" +
      "}" +

      // Toast animations
      ".recon-toast, app-toast.toast {" +
      "  position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 10000;" +
      "  padding: 0.85rem 1.2rem; border-radius: var(--radius-md);" +
      "  background: var(--surface-1); border: 1px solid var(--border-1);" +
      "  box-shadow: var(--shadow-2); color: var(--text-1);" +
      "  font-weight: 650; max-width: 24rem;" +
      "  transform: translateY(120%); opacity: 0;" +
      "  transition: transform 0.3s ease, opacity 0.3s ease;" +
      "}" +
      ".recon-toast.visible, app-toast.toast.visible {" +
      "  transform: translateY(0); opacity: 1;" +
      "}" +

      // Button press effect
      "button:active:not(:disabled) { transform: translateY(1px) scale(0.98); }" +

      // Skeleton loading animation
      "@keyframes recon-shimmer {" +
      "  0% { background-position: -200% 0; }" +
      "  100% { background-position: 200% 0; }" +
      "}" +
      ".recon-skeleton {" +
      "  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);" +
      "  background-size: 200% 100%; animation: recon-shimmer 1.5s infinite;" +
      "  border-radius: var(--radius-sm); min-height: 1em;" +
      "}" +

      // Drop zone animation
      "@keyframes recon-drop-pulse {" +
      "  0%, 100% { border-color: var(--brand-600); }" +
      "  50% { border-color: var(--brand-400); }" +
      "}" +
      ".recon-drop-indicator { animation: recon-drop-pulse 1.5s ease-in-out infinite; }" +

      // Table row hover
      ".recon-data-table tbody tr { transition: background 0.15s ease; }" +

      // Summary counter animation
      ".audit-summary strong, .allocation-summary strong, .tag-summary strong, .summary strong {" +
      "  transition: color 0.3s ease;" +
      "}" +

      // Dialog entrance
      '[role="dialog"]:not([hidden]) { animation: recon-dialog-enter 0.2s ease; }' +
      "@keyframes recon-dialog-enter {" +
      "  from { opacity: 0; transform: translateY(-10px) scale(0.97); }" +
      "  to { opacity: 1; transform: translateY(0) scale(1); }" +
      "}" +

      // Card hover effect
      ".card { transition: box-shadow 0.2s ease, transform 0.2s ease; }" +
      ".card:hover { box-shadow: var(--shadow-1); }" +

      // Checkmark animation
      "@keyframes recon-check {" +
      "  0% { transform: scale(0); }" +
      "  50% { transform: scale(1.2); }" +
      "  100% { transform: scale(1); }" +
      "}" +
      ".p1-confirm-icon { animation: recon-check 0.3s ease; }" +

      // PWA install button
      "#recon-pwa-install {" +
      "  display: none; align-items: center; gap: 0.4rem;" +
      "  padding: 0.4rem 0.7rem; font-size: 0.72rem;" +
      "  background: var(--surface-2); border: 1px solid var(--border-1);" +
      "  border-radius: var(--radius-sm); cursor: pointer;" +
      "  color: var(--text-2);" +
      "}" +
      "#recon-pwa-install.visible { display: inline-flex; }" +
      "#recon-pwa-install:hover { background: var(--surface-3); }";

    document.head.appendChild(style);
  }

  // ===================== PWA INSTALL PROMPT =====================

  function installPwaPrompt() {
    var deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      var btn = document.createElement("button");
      btn.id = "recon-pwa-install";
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2v12M5 11l7 7 7-7M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Instalar RECON';
      btn.title = "Instalar o RECON como aplicativo";
      var runtime = qs(".runtime-actions");
      if (runtime) {
        runtime.appendChild(btn);
        btn.classList.add("visible");
      }
      btn.addEventListener("click", function () {
        btn.classList.remove("visible");
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choiceResult) {
          if (choiceResult.outcome === "accepted") {
            showToast("RECON instalado com sucesso!");
          }
          deferredPrompt = null;
        });
      });
    });
    window.addEventListener("appinstalled", function () {
      showToast("RECON instalado como aplicativo.");
    });
  }

  // ===================== DASHBOARD ANALYTICS =====================

  function installDashboardAnalytics() {
    // Listen for analysis results and save to history
    document.addEventListener("recon:analysis-complete", function (e) {
      var detail = e.detail;
      if (detail && detail.module && detail.data) {
        saveAnalysisToHistory(detail.module, detail.data);
      }
    });

    // Enhance preferences panel with dashboard
    var preferencesLink = $("recon-preferences-open");
    if (preferencesLink) {
      // Add a dashboard button to the sidebar
      var dashBtn = document.createElement("button");
      dashBtn.className = "module-link";
      dashBtn.id = "recon-dashboard-open";
      dashBtn.type = "button";
      dashBtn.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zM3 21h8v-6H3v6zM13 21h8V11h-8v10zM13 3v6h8V3h-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span><strong>Dashboard</strong><small>Métricas e análises</small></span>';
      var sidebarFoot = qs(".sidebar-foot");
      if (sidebarFoot) {
        sidebarFoot.parentNode.insertBefore(dashBtn, sidebarFoot);
      } else {
        var sidebar = qs(".module-sidebar");
        if (sidebar) sidebar.appendChild(dashBtn);
      }

      dashBtn.addEventListener("click", function () {
        showDashboard();
      });
    }
  }

  function showDashboard() {
    var existing = $("recon-dashboard-overlay");
    if (existing) {
      existing.style.display = "block";
      var dialog = $("recon-dashboard-dialog");
      if (dialog) { dialog.hidden = false; dialog.removeAttribute("aria-hidden"); }
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "recon-preferences-overlay";
    overlay.id = "recon-dashboard-overlay";
    overlay.style.display = "block";
    document.body.appendChild(overlay);

    var dialog = document.createElement("section");
    dialog.className = "recon-preferences-dialog";
    dialog.id = "recon-dashboard-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "recon-dashboard-title");
    dialog.style.maxWidth = "56rem";

    // Build content
    var content = '<header><div><span>ANÁLISES</span><h2 id="recon-dashboard-title">Dashboard de métricas</h2><p>Resumo das análises realizadas nesta sessão.</p></div>' +
      '<button aria-label="Fechar" class="icon-button" id="recon-dashboard-close" type="button">×</button></header>' +
      '<div class="recon-preferences-body" style="padding:1rem;max-height:70vh;overflow:auto">';

    RECONDB.getAll("analysis_history").then(function (history) {
      if (!history || !history.length) {
        content += '<div class="empty" style="text-align:center;padding:2rem"><strong>Nenhuma análise registrada</strong><span style="display:block;margin-top:0.5rem;color:var(--text-2)">As análises serão registradas automaticamente conforme você utilizar os módulos.</span></div>';
      } else {
        // Summary counts
        var moduleCounts = {};
        history.forEach(function (item) {
          moduleCounts[item.module] = (moduleCounts[item.module] || 0) + 1;
        });

        content += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:0.75rem;margin-bottom:1.5rem">';
        content += '<div style="padding:1rem;background:var(--surface-2);border-radius:var(--radius-md);text-align:center"><strong style="font-size:1.5rem;display:block">' + history.length + '</strong><span style="color:var(--text-3);font-size:0.82rem">Total de análises</span></div>';
        var modules = {
          "relations": "Relações", "allocation": "Alocação", "tags": "TAGs",
          "databook": "Databook", "titles": "Títulos", "renamer": "Renomeador"
        };
        Object.keys(modules).forEach(function (key) {
          var count = moduleCounts[key] || 0;
          if (count > 0) {
            content += '<div style="padding:1rem;background:var(--surface-2);border-radius:var(--radius-md);text-align:center"><strong style="font-size:1.5rem;display:block">' + count + '</strong><span style="color:var(--text-3);font-size:0.82rem">' + modules[key] + '</span></div>';
          }
        });
        content += '</div>';

        // Recent history
        content += '<div style="margin-bottom:1rem"><strong>Últimas análises</strong></div>' +
          '<div style="display:grid;gap:0.4rem;max-height:20rem;overflow:auto">';
        var sorted = history.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        sorted.slice(0, 50).forEach(function (item) {
          var moduleName = modules[item.module] || item.module;
          var date = item.date ? new Date(item.date).toLocaleString("pt-BR") : "—";
          content += '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.8rem;background:var(--surface-2);border-radius:var(--radius-sm)">' +
            '<span><strong>' + moduleName + '</strong></span>' +
            '<span style="color:var(--text-3);font-size:0.78rem">' + date + '</span></div>';
        });
        content += '</div>';
      }

      content += '</div>' +
        '<footer class="drawer-footer" style="justify-content:space-between;padding:0.75rem 1rem">' +
        '<button class="secondary-button" id="recon-dashboard-export" type="button">Exportar relatório CSV</button>' +
        '<button class="primary-button" id="recon-dashboard-ok" type="button">Fechar</button></footer>';

      dialog.innerHTML = content;
      document.body.appendChild(dialog);

      function close() {
        dialog.hidden = true;
        dialog.setAttribute("aria-hidden", "true");
        overlay.style.display = "none";
      }
      $("recon-dashboard-close").addEventListener("click", close);
      $("recon-dashboard-ok").addEventListener("click", close);
      overlay.addEventListener("click", close);
      dialog.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

      // Export button
      var exportBtn = $("recon-dashboard-export");
      if (exportBtn) {
        exportBtn.addEventListener("click", function () {
          var csv = "Módulo,Data\n";
          history.forEach(function (item) {
            csv += (modules[item.module] || item.module) + "," + (item.date || "") + "\n";
          });
          var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "RECON-analytics-" + new Date().toISOString().slice(0, 10) + ".csv";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });
      }
    });
  }

  // ===================== SESSION AUTO-SAVE =====================

  function installAutoSave() {
    // Auto-save preferences every 30 seconds
    setInterval(function () {
      try {
        var prefs = {};
        // Collect module filter states
        ["relations", "allocation", "tags", "databook", "titles", "renamer"].forEach(function (mod) {
          var key = "recon." + mod + ".filters";
          var val = localStorage.getItem(key);
          if (val) prefs[key] = val;
        });
        saveSessionState("auto_preferences", prefs);
      } catch (_) { /* silent */ }
    }, 30000);
  }

  // ===================== INIT ALL =====================

  function init() {
    try {
      installKeyboardShortcuts();
      installDragAndDrop();
      installDebouncedSearch();
      installMicroInteractions();
      installPwaPrompt();
      installDashboardAnalytics();
      installAutoSave();
      showToast("RECON aprimorado — atalhos, arrastar e soltar e dashboard disponíveis.", 3000);
    } catch (err) {
      console.warn("RECON Enhancements: " + err.message);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  // Expose public API
  window.RECONDB = RECONDB;
  window.RECONExportSession = exportSession;
  window.RECONImportSession = importSession;
  window.RECONShowDashboard = showDashboard;
  window.RECONShowShortcuts = showShortcutsHelp;
})();