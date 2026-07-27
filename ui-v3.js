(function () {
  "use strict";

  const root = document.documentElement;
  const APP = root.dataset.app || "Aplicativo";
  let lastTrigger = null;
  let enhanceTimer = 0;
  let hadModal = false;
  const pendingScopes = new Set();

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function humanize(value) {
    return text(value)
      .replace(/^ops-/, "")
      .replace(/^p1-/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function elementsWithin(scope, selector) {
    const source = scope && scope.nodeType === 1 ? scope : document;
    const items = [];
    if (source.nodeType === 1 && source.matches(selector)) items.push(source);
    if (source.querySelectorAll) items.push(...source.querySelectorAll(selector));
    return items;
  }

  function tableName(table) {
    const section = table.closest("section, article, .card, .module-view");
    const heading = section && section.querySelector("h2, h3, .section-title strong, header strong");
    return text(heading && heading.textContent) || humanize(table.id) || `Tabela do ${APP}`;
  }

  function normalizedSortDirection(th) {
    const raw = text(
      th.dataset.sortDirection ||
      th.getAttribute("data-direction") ||
      th.getAttribute("data-order") ||
      ""
    ).toLowerCase();
    if (["asc", "ascending", "crescente"].includes(raw) || th.classList.contains("sort-asc") || th.classList.contains("sorted-asc")) return "ascending";
    if (["desc", "descending", "decrescente"].includes(raw) || th.classList.contains("sort-desc") || th.classList.contains("sorted-desc")) return "descending";
    return "none";
  }

  function synchronizeSortState(table) {
    table.querySelectorAll("thead th").forEach((th) => {
      const sortable = th.matches("[data-sort], [data-sort-key], .sortable");
      if (!sortable) {
        th.removeAttribute("aria-sort");
        return;
      }
      th.setAttribute("aria-sort", normalizedSortDirection(th));
    });
  }

  function enhanceTable(table) {
    if (!table) return;
    table.dataset.uiV3Enhanced = "true";
    const name = tableName(table);
    if (!table.querySelector(":scope > caption")) {
      const caption = document.createElement("caption");
      caption.className = "ui-v3-sr-only";
      caption.textContent = name;
      table.prepend(caption);
    }
    table.querySelectorAll("thead th").forEach((th) => {
      if (!th.hasAttribute("scope")) th.setAttribute("scope", "col");
    });
    synchronizeSortState(table);
    if (table.dataset.uiV3SortEvents !== "true") {
      table.dataset.uiV3SortEvents = "true";
      const refresh = () => requestAnimationFrame(() => synchronizeSortState(table));
      table.addEventListener("click", refresh, true);
      table.addEventListener("keydown", refresh, true);
      table.addEventListener("change", refresh, true);
    }
    const region = table.closest(".table-wrap, .table-scroll, .history-table-wrap, .analysis-history-table-wrap") || table.parentElement;
    if (region) {
      region.classList.add("ui-v3-table-region");
      if (!region.hasAttribute("role")) region.setAttribute("role", "region");
      if (!region.hasAttribute("aria-label")) region.setAttribute("aria-label", name);
      if (!region.hasAttribute("tabindex")) region.setAttribute("tabindex", "0");
    }
  }

  function enhanceButtons(scope) {
    elementsWithin(scope, "button").forEach((button) => {
      const accessible = text(button.getAttribute("aria-label")) || text(button.textContent) || text(button.getAttribute("title"));
      if (!accessible) button.setAttribute("aria-label", humanize(button.id) || "Ação");
      if (!button.hasAttribute("type")) button.setAttribute("type", "button");
    });
  }

  function enhanceSearchControls(scope) {
    elementsWithin(scope, 'input[type="search"]').forEach((input) => {
      if (!input.getAttribute("aria-label")) {
        const label = input.closest("label");
        input.setAttribute("aria-label", text(label && label.textContent) || text(input.placeholder) || "Buscar resultados");
      }
      const section = input.closest("section, article, .card, .module-view");
      const table = section && section.querySelector("table[id]");
      if (table && !input.hasAttribute("aria-controls")) input.setAttribute("aria-controls", table.id);
    });
  }

  function enhanceLiveRegions(scope) {
    elementsWithin(scope, "quality-status, app-toast, .progress span, [id$='progress-text']").forEach((element) => {
      if (!element.hasAttribute("aria-live")) element.setAttribute("aria-live", "polite");
      if (!element.hasAttribute("role")) element.setAttribute("role", "status");
    });
  }

  function refreshBusyState() {
    const busy = Array.from(document.querySelectorAll(".progress, [id$='progress']")).some((element) => !element.hidden && element.offsetParent !== null);
    document.body.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function configureTabs(scope) {
    elementsWithin(scope, '[role="tablist"]').forEach((tablist) => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      if (!tabs.length || tablist.dataset.uiV3Keys === "true") return;
      tablist.dataset.uiV3Keys = "true";
      tabs.forEach((tab) => tab.setAttribute("tabindex", tab.getAttribute("aria-selected") === "true" ? "0" : "-1"));
      tablist.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const current = Math.max(0, tabs.indexOf(document.activeElement));
        let next = current;
        if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        event.preventDefault();
        tabs[next].focus();
      });
    });
  }

  function visibleModal() {
    return Array.from(document.querySelectorAll('[role="dialog"], aside[aria-hidden="false"]')).find((element) => !element.hidden && element.offsetParent !== null);
  }

  function focusModal(element) {
    if (!element || element.dataset.uiV3Focused === "true") return;
    hadModal = true;
    element.dataset.uiV3Focused = "true";
    const target = element.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  function restoreFocusIfNeeded() {
    if (visibleModal() || !hadModal) return;
    document.querySelectorAll('[data-ui-v3-focused="true"]').forEach((element) => delete element.dataset.uiV3Focused);
    hadModal = false;
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
    lastTrigger = null;
  }

  function enhanceDialogs(scope) {
    elementsWithin(scope, ".compatibility-drawer, .pending-panel-drawer, .databook-assistant-drawer, .settings-drawer, .p1-confirm-dialog").forEach((dialog) => {
      if (!dialog.hasAttribute("role")) dialog.setAttribute("role", "dialog");
      if (!dialog.hasAttribute("aria-modal")) dialog.setAttribute("aria-modal", "true");
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    });
  }

  function enhanceScope(scope) {
    elementsWithin(scope, "table").forEach(enhanceTable);
    enhanceDialogs(scope);
    enhanceButtons(scope);
    enhanceSearchControls(scope);
    enhanceLiveRegions(scope);
    configureTabs(scope);
  }

  function refreshModalState() {
    const modal = visibleModal();
    if (modal) focusModal(modal);
    else restoreFocusIfNeeded();
  }

  function flushEnhancements() {
    enhanceTimer = 0;
    const scopes = Array.from(pendingScopes);
    pendingScopes.clear();
    if (!scopes.length) scopes.push(document);
    scopes.forEach((scope) => enhanceScope(scope));
    refreshBusyState();
    refreshModalState();
  }

  function scheduleEnhancement(scope) {
    if (scope && (scope.nodeType === 1 || scope === document)) pendingScopes.add(scope);
    clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(flushEnhancements, 40);
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("button, [role='button']");
    if (trigger) lastTrigger = trigger;
  }, true);

  document.addEventListener("keydown", (event) => {
    const modal = visibleModal();
    if (!modal) return;
    if (event.key === "Escape") {
      const closer = modal.querySelector("[id$='close'], [id$='cancel'], .drawer-close, [aria-label^='Fechar']");
      if (closer) {
        event.preventDefault();
        closer.click();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"))
      .filter((element) => !element.hidden && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scheduleEnhancement(node);
        });
        const table = mutation.target.nodeType === 1 && mutation.target.closest && mutation.target.closest("table");
        if (table) scheduleEnhancement(table);
      } else if (mutation.type === "attributes") {
        scheduleEnhancement(mutation.target);
        const table = mutation.target.closest && mutation.target.closest("table");
        if (table) scheduleEnhancement(table);
      }
    });
  });

  function start() {
    root.dataset.uiGeneration = "3";
    enhanceScope(document);
    refreshBusyState();
    refreshModalState();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "aria-selected", "data-sort-direction", "data-direction", "data-order", "class"],
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
