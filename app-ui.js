"use strict";
(() => {
    "use strict";
    const APP = (document.documentElement.dataset.app || (document.title.includes("RECON") ? "RECON" : "GRCON"));
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const storageKey = `quality-theme-${APP.toLowerCase()}`;
    const escapeHtml = (value) => String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    class QualityStatus extends HTMLElement {
        connectedCallback() {
            if (!this.hasAttribute("role"))
                this.setAttribute("role", "status");
            if (!this.hasAttribute("aria-live") && this.id)
                this.setAttribute("aria-live", "polite");
            const content = this.textContent?.toLowerCase() || "";
            if (!this.hasAttribute("tone")) {
                if (/erro|bloque|não encontrado|recus/.test(content))
                    this.setAttribute("tone", "danger");
                else if (/alerta|revis|pendente|previsto/.test(content))
                    this.setAttribute("tone", "warning");
                else if (/local|livre|pronto|aprov/.test(content))
                    this.setAttribute("tone", "success");
            }
        }
    }
    class MetricChip extends HTMLElement {
        connectedCallback() {
            if (!this.hasAttribute("role"))
                this.setAttribute("role", "group");
        }
    }
    class EmptyState extends HTMLElement {
        connectedCallback() {
            if (!this.hasAttribute("role"))
                this.setAttribute("role", "status");
            if (!this.querySelector("strong")) {
                const current = this.textContent?.trim() || "Nenhum resultado";
                this.textContent = "";
                const title = document.createElement("strong");
                title.textContent = current;
                this.append(title);
            }
        }
    }
    class AppToast extends HTMLElement {
        connectedCallback() {
            this.setAttribute("role", this.getAttribute("role") || "status");
            this.setAttribute("aria-live", this.getAttribute("aria-live") || "polite");
            this.setAttribute("aria-atomic", "true");
        }
    }
    function registerWebComponents() {
        if (!("customElements" in window))
            return;
        if (!customElements.get("quality-status"))
            customElements.define("quality-status", QualityStatus);
        if (!customElements.get("metric-chip"))
            customElements.define("metric-chip", MetricChip);
        if (!customElements.get("empty-state"))
            customElements.define("empty-state", EmptyState);
        if (!customElements.get("app-toast"))
            customElements.define("app-toast", AppToast);
    }
    function visible(node) {
        return Boolean(node && !node.hidden && node.getAttribute("aria-hidden") !== "true" && node.offsetParent !== null);
    }
    function ensureSupportRegions() {
        if (!$("#ui-announcer")) {
            const announcer = document.createElement("div");
            announcer.id = "ui-announcer";
            announcer.className = "sr-only";
            announcer.setAttribute("role", "status");
            announcer.setAttribute("aria-live", "polite");
            announcer.setAttribute("aria-atomic", "true");
            document.body.appendChild(announcer);
        }
        if (!$("#ui-alert")) {
            const alert = document.createElement("div");
            alert.id = "ui-alert";
            alert.className = "sr-only";
            alert.setAttribute("role", "alert");
            alert.setAttribute("aria-atomic", "true");
            document.body.appendChild(alert);
        }
    }
    function announce(message, urgent = false) {
        const target = urgent ? $("#ui-alert") : $("#ui-announcer");
        if (!target || !message)
            return;
        target.textContent = "";
        window.setTimeout(() => { target.textContent = message; }, 20);
    }
    function setTheme(theme, notify = false, persist = true) {
        const nextTheme = theme === "dark" ? "dark" : "light";
        const dark = nextTheme === "dark";
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;
        document.documentElement.classList.toggle("theme-dark", dark);
        document.body.classList.toggle("p2-dark", dark);
        const themeColor = $('meta[name="theme-color"]');
        if (themeColor)
            themeColor.content = dark ? "#0c141b" : "#0a527d";
        const button = $("#ui-theme-toggle");
        if (button) {
            button.setAttribute("aria-pressed", String(dark));
            button.dataset.themeTarget = dark ? "light" : "dark";
            const text = $("span", button);
            if (text)
                text.textContent = dark ? "Modo claro" : "Modo escuro";
            button.title = dark ? "Usar modo claro" : "Usar modo escuro";
        }
        if (persist) {
            try {
                localStorage.setItem(storageKey, nextTheme);
            }
            catch (_) { /* armazenamento opcional */ }
        }
        window.dispatchEvent(new CustomEvent("quality:theme-changed", {
            detail: { app: APP, theme: nextTheme },
        }));
        if (notify)
            announce(dark ? "Modo escuro ativado." : "Modo claro ativado.");
    }
    function installRuntimeTools() {
        const host = APP === "GRCON" ? $(".runtime-status") : $(".runtime-actions");
        if (!host || $("#ui-runtime-tools"))
            return;
        const tools = document.createElement("div");
        tools.id = "ui-runtime-tools";
        tools.className = "p2-runtime-tools";
        const mode = document.createElement("quality-status");
        mode.className = `p2-mode-badge ${location.protocol === "file:" ? "local" : "online"}`;
        mode.setAttribute("tone", "success");
        mode.innerHTML = `<i aria-hidden="true"></i><span>${location.protocol === "file:" ? "Aberto no computador" : "Versão online"}</span>`;
        mode.title = location.protocol === "file:"
            ? "O aplicativo está sendo executado diretamente neste computador."
            : "O aplicativo está sendo executado por HTTP/HTTPS.";
        const theme = document.createElement("button");
        theme.id = "ui-theme-toggle";
        theme.className = "p2-theme-toggle";
        theme.type = "button";
        theme.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5z"/></svg><span>Modo escuro</span>';
        tools.append(mode, theme);
        host.prepend(tools);
        let saved = "light";
        try {
            if (localStorage.getItem(storageKey) === "dark")
                saved = "dark";
        }
        catch (_) { /* armazenamento opcional */ }
        setTheme(saved);
        theme.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));
        window.addEventListener("storage", (event) => {
            if (event.key !== storageKey)
                return;
            setTheme(event.newValue === "dark" ? "dark" : "light", false, false);
        });
        window.addEventListener("pageshow", () => {
            try {
                setTheme(localStorage.getItem(storageKey) === "dark" ? "dark" : "light", false, false);
            }
            catch (_) { /* armazenamento opcional */ }
        });
    }
    function labelControls() {
        $$('button,[role="button"],input,select,textarea').forEach((control) => {
            if (control.matches('input[type="hidden"]'))
                return;
            const name = control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || control.textContent?.trim();
            if (!name && control.title)
                control.setAttribute("aria-label", control.title);
            if (control instanceof HTMLButtonElement && control.querySelector("svg") && !control.querySelector("span,strong") && !control.getAttribute("aria-label")) {
                control.setAttribute("aria-label", control.title || "Ação");
            }
        });
        $$('input[type="file"]').forEach((input) => {
            if (input.getAttribute("aria-label") || input.getAttribute("aria-labelledby"))
                return;
            const label = input.closest("label");
            const name = String(label?.innerText || "Selecionar arquivo").replace(/\s+/g, " ").trim();
            input.setAttribute("aria-label", name || "Selecionar arquivo");
        });
    }
    function installKeyboardNavigation() {
        const groups = [
            [".module-link", "vertical"], [".ops-nav-button", "vertical"],
            ['[role="tab"]', "horizontal"], [".summary-item", "horizontal"], ["[data-p1-open]", "grid"],
        ];
        groups.forEach(([selector, orientation]) => {
            const nodes = $$(selector);
            if (nodes.length < 2)
                return;
            nodes.forEach((node, index) => node.addEventListener("keydown", (event) => {
                let next = null;
                const previous = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
                const following = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
                if (event.key === previous)
                    next = (index - 1 + nodes.length) % nodes.length;
                if (event.key === following)
                    next = (index + 1) % nodes.length;
                if (event.key === "Home")
                    next = 0;
                if (event.key === "End")
                    next = nodes.length - 1;
                if (orientation === "grid" && event.key === "ArrowUp")
                    next = Math.max(0, index - 2);
                if (orientation === "grid" && event.key === "ArrowDown")
                    next = Math.min(nodes.length - 1, index + 2);
                if (next === null)
                    return;
                event.preventDefault();
                nodes[next]?.focus();
            }));
        });
    }
    function enhanceTables() {
        $$("table").forEach((table, index) => {
            $$("thead th", table).forEach((th) => th.setAttribute("scope", "col"));
            const wrapper = table.closest(".table-scroll,.table-wrap,.audit-table-wrap,.allocation-table-scroll,.v6-conference-table-wrap");
            if (wrapper && !wrapper.hasAttribute("tabindex")) {
                wrapper.tabIndex = 0;
                wrapper.setAttribute("role", "region");
                wrapper.setAttribute("aria-label", table.getAttribute("aria-label") || `Tabela de resultados ${index + 1}`);
            }
        });
    }
    function progressLabel(container) {
        const id = container.id;
        if (/databook/i.test(id))
            return "Análise do Databook";
        if (/title/i.test(id))
            return "Análise dos títulos";
        if (/renamer/i.test(id))
            return "Leitura e renomeação dos PDFs";
        if (/relations/i.test(id))
            return "Geração da relação";
        return "Processamento dos arquivos";
    }
    function enhanceProgress() {
        $$(".progress-wrap,.progress,.sgpar-progress").forEach((container) => {
            container.setAttribute("role", "progressbar");
            container.setAttribute("aria-valuemin", "0");
            container.setAttribute("aria-valuemax", "100");
            if (!container.hasAttribute("aria-valuenow"))
                container.setAttribute("aria-valuenow", "0");
            container.setAttribute("aria-label", progressLabel(container));
        });
    }
    function improveEmptyStates() {
        const messages = {
            "empty-results": ["Nenhum documento encontrado", "Limpe os filtros ou confira os arquivos carregados."],
            "relations-empty": ["Nenhuma linha para mostrar", "Escolha uma aba e ajuste os filtros."],
            "databook-empty": ["Nenhum item nesta seleção", "Troque a aba, limpe os filtros ou execute uma nova análise."],
            "title-empty": ["Nenhum título nesta seleção", "Troque a aba, limpe os filtros ou execute uma nova análise."],
        };
        Object.entries(messages).forEach(([id, [title, detail]]) => {
            const node = document.getElementById(id);
            if (!node || node.dataset.uiEnhanced)
                return;
            node.dataset.uiEnhanced = "true";
            node.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
        });
    }
    function filterValue(control) {
        if (control.disabled)
            return "";
        if (control instanceof HTMLInputElement)
            return control.value.trim();
        const value = control.value.trim();
        if (!value || /^(todos|todas|all)$/i.test(value))
            return "";
        return control.selectedOptions[0]?.textContent?.trim() || value;
    }
    function controlLabel(control) {
        return String(control.closest("label")?.querySelector("span")?.textContent || control.getAttribute("aria-label") || control.getAttribute("placeholder") || "Filtro")
            .replace(/\bobrigatória\b/gi, "").replace(/\s+/g, " ").trim();
    }
    function filterContexts() {
        if (APP === "GRCON") {
            const host = $("#results-section .results-toolbar");
            return host ? [{ host, controls: [$("#search"), $("#sheet-filter")].filter(Boolean) }] : [];
        }
        const candidates = [
            ["#relations-results .results-toolbar", ["#relations-search"]],
            ["#databook-results .audit-toolbar", ["#databook-search", "#databook-issue", "#databook-confidence"]],
            ["#title-results .audit-toolbar", ["#title-search", "#title-issue", "#title-confidence"]],
        ];
        return candidates.map(([hostSelector, controls]) => ({
            host: $(hostSelector),
            controls: controls.map((selector) => $(selector)).filter(Boolean),
        })).filter((context) => Boolean(context.host));
    }
    function installFilterSummaries() {
        filterContexts().forEach((context, index) => {
            const id = `ui-filter-summary-${index + 1}`;
            if (document.getElementById(id))
                return;
            const summary = document.createElement("div");
            summary.id = id;
            summary.className = "p2-filter-summary";
            summary.setAttribute("aria-live", "polite");
            context.host.insertAdjacentElement("afterend", summary);
            const render = () => {
                const active = context.controls.map((control) => ({ control, value: filterValue(control) })).filter((item) => item.value);
                if (!active.length) {
                    summary.innerHTML = '<span class="p2-filter-empty">Nenhum filtro adicional aplicado</span>';
                    return;
                }
                summary.innerHTML = "<strong>Filtros ativos:</strong>";
                active.forEach(({ control, value }) => {
                    const chip = document.createElement("button");
                    chip.type = "button";
                    chip.className = "p2-filter-chip";
                    chip.innerHTML = `<span>${escapeHtml(controlLabel(control))}: ${escapeHtml(value)}</span><b aria-hidden="true">×</b>`;
                    chip.setAttribute("aria-label", `Remover filtro ${controlLabel(control)}: ${value}`);
                    chip.addEventListener("click", () => {
                        control.value = control instanceof HTMLSelectElement ? (control.querySelector('option[value=""]') ? "" : control.options[0]?.value || "") : "";
                        control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
                        render();
                        control.focus();
                    });
                    summary.appendChild(chip);
                });
            };
            context.controls.forEach((control) => {
                control.addEventListener("input", render);
                control.addEventListener("change", render);
            });
            render();
        });
    }
    function installDialogFocus() {
        let lastFocused = null;
        document.addEventListener("click", (event) => {
            const target = event.target;
            const button = target?.closest("button");
            if (button && /export|download|package|apply-ld/.test(button.id))
                lastFocused = button;
        }, true);
        $$('[role="dialog"]').forEach((dialog) => {
            dialog.setAttribute("aria-modal", "true");
            dialog.addEventListener("keydown", (event) => {
                if (event.key !== "Tab" || dialog.hidden)
                    return;
                const focusables = $$('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])', dialog).filter(visible);
                if (!focusables.length)
                    return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            });
        });
        [$("#p1-confirm-cancel"), $("#p1-confirm-ok")].filter(Boolean).forEach((control) => {
            control?.addEventListener("click", () => window.setTimeout(() => lastFocused?.focus(), 0));
        });
    }
    const inspector = { overlay: null, drawer: null, body: null, title: null, close: null, lastFocus: null, grconIndex: null };
    function installInspector() {
        if ($("#ops-inspector"))
            return;
        document.body.insertAdjacentHTML("beforeend", `
      <div class="ops-inspector-overlay" hidden id="ops-inspector-overlay"></div>
      <aside aria-hidden="true" aria-labelledby="ops-inspector-title" class="ops-inspector" id="ops-inspector" inert>
        <header><div><span>Detalhes e evidências</span><h2 id="ops-inspector-title">Documento</h2></div><button aria-label="Fechar detalhes" class="ops-inspector-close" id="ops-inspector-close" type="button">×</button></header>
        <div class="ops-inspector-body" id="ops-inspector-body"></div>
      </aside>`);
        inspector.overlay = $("#ops-inspector-overlay");
        inspector.drawer = $("#ops-inspector");
        inspector.body = $("#ops-inspector-body");
        inspector.title = $("#ops-inspector-title");
        inspector.close = $("#ops-inspector-close");
        inspector.close?.addEventListener("click", closeInspector);
        inspector.overlay?.addEventListener("click", closeInspector);
        inspector.body?.addEventListener("click", (event) => {
            const target = event.target;
            const edit = target?.closest('[data-action="edit-egrdt"]');
            if (!edit || inspector.grconIndex === null)
                return;
            const original = $(`#results-body tr.result-row[data-index="${inspector.grconIndex}"] + .detail-row [data-action="edit-egrdt"]`);
            original?.click();
            closeInspector();
        });
    }
    function openInspector(title, html, grconIndex) {
        installInspector();
        inspector.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        inspector.grconIndex = grconIndex;
        if (inspector.title)
            inspector.title.textContent = title || "Detalhes";
        if (inspector.body)
            inspector.body.innerHTML = html;
        if (inspector.overlay)
            inspector.overlay.hidden = false;
        if (inspector.drawer)
            inspector.drawer.inert = false;
        inspector.drawer?.classList.add("open");
        inspector.drawer?.setAttribute("aria-hidden", "false");
        inspector.close?.focus();
    }
    function closeInspector() {
        inspector.drawer?.classList.remove("open");
        inspector.drawer?.setAttribute("aria-hidden", "true");
        if (inspector.drawer)
            inspector.drawer.inert = true;
        if (inspector.overlay)
            inspector.overlay.hidden = true;
        inspector.grconIndex = null;
        inspector.lastFocus?.focus();
    }
    function genericRowDetails(row) {
        const table = row.closest("table");
        const headings = table ? $$("thead th", table).map((cell) => String(cell.textContent || "").replace(/\s+/g, " ").trim()) : [];
        const cells = $$(":scope > td", row);
        const fields = cells.map((cell, index) => ({
            label: headings[index] || `Campo ${index + 1}`,
            value: String(cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim(),
        })).filter((field) => field.value);
        const titleField = fields.find((field) => /DOCUMENTO|ARQUIVO ORIGINAL|NOME/i.test(field.label)) || fields[0];
        return {
            title: titleField?.value || "Resultado",
            html: `<dl class="ops-inspector-grid">${fields.map((field) => `<div class="ops-inspector-field"><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`).join("")}</dl>`,
        };
    }
    function installTableInspector() {
        if (APP !== "GRCON")
            return;
        document.addEventListener("click", (event) => {
            const target = event.target;
            if (target?.closest("input,select,textarea,a,button") && !target.closest(".expand-button"))
                return;
            const clicked = target?.closest("#results-body .result-row");
            const expand = target?.closest("#results-body .expand-button");
            const row = clicked || expand?.closest(".result-row");
            if (!row)
                return;
            const index = Number(row.dataset.index);
            window.setTimeout(() => {
                const current = $(`#results-body .result-row[data-index="${index}"]`);
                const next = current?.nextElementSibling;
                const detail = next instanceof HTMLTableRowElement && next.classList.contains("detail-row") ? next : null;
                if (!detail) {
                    closeInspector();
                    return;
                }
                const title = current ? $(".document-code", current)?.textContent?.trim() || "Documento" : "Documento";
                openInspector(title, detail.innerHTML, Number.isFinite(index) ? index : null);
            }, 0);
        });
        document.addEventListener("keydown", (event) => { if (event.key === "Escape" && inspector.drawer?.classList.contains("open"))
            closeInspector(); });
    }
    function syncGrconSidebar() {
        if (APP !== "GRCON")
            return;
        const buttons = $$(".ops-sidebar [data-grcon-view]");
        if (!buttons.length)
            return;
        const sync = () => {
            buttons.forEach((button) => {
                const active = Boolean($(`.grcon-view-tabs [data-grcon-view="${button.dataset.grconView}"].active`));
                button.classList.toggle("active", active);
                if (active)
                    button.setAttribute("aria-current", "page");
                else
                    button.removeAttribute("aria-current");
            });
            const original = $("#history-tab-count");
            const target = $("#ops-history-count");
            if (original && target) {
                target.textContent = original.textContent || "0";
                target.hidden = original.hidden || Number(original.textContent || 0) === 0;
            }
        };
        buttons.forEach((button) => button.addEventListener("click", () => window.setTimeout(sync, 0)));
        $("[data-ops-open-settings]")?.addEventListener("click", () => {
            const control = $('.grcon-view-tabs [data-grcon-view="control"]');
            if (control && !control.classList.contains("active"))
                control.click();
            const toggle = $("#advanced-toggle");
            if (toggle && toggle.getAttribute("aria-expanded") !== "true")
                toggle.click();
            window.setTimeout(() => { $("#advanced-panel")?.scrollIntoView({ behavior: "auto", block: "center" }); $("#recent-days")?.focus(); }, 40);
        });
        window.addEventListener("grcon:history-updated", () => window.setTimeout(sync, 0));
        sync();
    }
    function applyRenamerFilters() {
        const search = $("#ops-renamer-search")?.value.trim().toLowerCase() || "";
        const status = $("#ops-renamer-status")?.value || "all";
        const rows = $$("#renamer-queue-list .renamer-queue-item");
        let shown = 0;
        rows.forEach((row) => {
            const matchesText = !search || (row.textContent || "").toLowerCase().includes(search);
            const matchesStatus = status === "all" || row.classList.contains(status);
            row.hidden = !(matchesText && matchesStatus);
            if (!row.hidden)
                shown += 1;
        });
        const count = $("#ops-renamer-filter-count");
        if (count)
            count.textContent = rows.length ? `${shown} de ${rows.length} arquivo(s)` : "Nenhum arquivo";
    }
    function installRenamerUx() {
        if (APP !== "RECON")
            return;
        const search = $("#ops-renamer-search");
        const status = $("#ops-renamer-status");
        if (!search || !status)
            return;
        search.addEventListener("input", applyRenamerFilters);
        status.addEventListener("change", applyRenamerFilters);
        window.addEventListener("recon:ui-update", () => window.setTimeout(applyRenamerFilters, 0));
        window.addEventListener("recon:module", (event) => {
            const detail = event.detail;
            if (detail?.module === "renamer")
                window.setTimeout(applyRenamerFilters, 0);
        });
        document.addEventListener("keydown", (event) => {
            if (!event.altKey || $("#module-renamer")?.hidden)
                return;
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                $("#renamer-prev")?.click();
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                $("#renamer-next")?.click();
            }
            if (event.key === "Enter") {
                event.preventDefault();
                const confirm = $("#renamer-confirm");
                if (confirm && !confirm.hidden && !confirm.disabled)
                    confirm.click();
                else
                    $("#renamer-next")?.click();
            }
        });
        applyRenamerFilters();
    }
    function enrichNavigationNames() {
        $$(".module-link,.ops-nav-button").forEach((button) => {
            const title = $("strong", button)?.textContent?.trim() || button.textContent?.trim() || "";
            const detail = $("small", button)?.textContent?.trim() || "";
            if (!button.title)
                button.title = detail ? `${title} — ${detail}` : title;
        });
    }
    function installSemanticLandmarks() {
        const main = $("main");
        if (main && !main.getAttribute("aria-label") && !main.getAttribute("aria-labelledby"))
            main.setAttribute("aria-label", APP === "GRCON" ? "Área de trabalho do GRCON" : "Área de trabalho do RECON");
        $$(".module-view").forEach((section, index) => {
            if (!section.getAttribute("aria-label") && !section.getAttribute("aria-labelledby")) {
                const heading = $("h2", section);
                if (heading) {
                    if (!heading.id)
                        heading.id = `${APP.toLowerCase()}-module-title-${index + 1}`;
                    section.setAttribute("aria-labelledby", heading.id);
                }
            }
        });
    }
    function init() {
        try {
            registerWebComponents();
            ensureSupportRegions();
            installRuntimeTools();
            installSemanticLandmarks();
            labelControls();
            installKeyboardNavigation();
            enhanceTables();
            enhanceProgress();
            improveEmptyStates();
            installFilterSummaries();
            installDialogFocus();
            installInspector();
            installTableInspector();
            syncGrconSidebar();
            installRenamerUx();
            enrichNavigationNames();
            document.documentElement.dataset.opsUi = "enabled";
            document.documentElement.dataset.p2Design = "semantic-layered-v1";
            document.documentElement.dataset.uiArchitecture = "semantic-layered-v1";
            document.body.removeAttribute("aria-busy");
            document.body.classList.remove("p2-processing");
        }
        catch (error) {
            document.body.removeAttribute("aria-busy");
            document.body.classList.remove("p2-processing", "p1-modal-open");
            console.error("Falha ao iniciar a interface reconstruída:", error);
        }
    }
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", init, { once: true });
    else
        init();
})();
