/**
 * RECON — Melhorias UX/UI
 * recon-ux-enhancements.js
 *
 * Módulo de aprimoramentos progressivos. Carregado com `defer` após app-ui.js.
 * Não altera nenhum JS existente — estende comportamentos via eventos e DOM.
 *
 * Pontos cobertos:
 *   #9  — Focus-trap nos modais (confirmação + preferências)
 *   #6  — Badges "Precisa de LD" nos cards da home
 *   #5  — Pulso visual após carregamento da LD
 *   #11 — Scroll controlado no renamer-inspector
 *   #13 — Estado de loading nos botões primários durante análise
 *   #18 — Atalhos globais: Ctrl+K (busca), Alt+1–7 (navegação)
 *   #3  — aria-expanded nos <details> expansíveis
 *   #12 — Ocultar contadores "0 itens" no estado inicial
 */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ────────────────────────────────────────────────
     Utilitário: todos os focusáveis dentro de um nó
     ──────────────────────────────────────────────── */
  function getFocusables(container) {
    return $$(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"]),' +
      'summary',
      container
    ).filter(el => !el.hidden && el.offsetParent !== null);
  }

  /* ────────────────────────────────────────────────
     #9 — Focus-trap genérico para qualquer [role="dialog"]
     ──────────────────────────────────────────────── */
  function installFocusTrap(dialog, overlayId) {
    if (!dialog) return;
    const overlay = overlayId ? document.getElementById(overlayId) : null;
    let lastFocused = null;

    // Observa quando o dialog aparece para mover o foco
    const observer = new MutationObserver(() => {
      if (dialog.hidden) return;
      lastFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const focusables = getFocusables(dialog);
      if (focusables.length) {
        // Foca o primeiro botão de ação (geralmente "Confirmar")
        const primary = focusables.find(el =>
          el.matches('.primary-button, #p1-confirm-ok, #recon-preferences-close')
        ) || focusables[0];
        setTimeout(() => primary.focus(), 30);
      }
    });
    observer.observe(dialog, { attributeFilter: ['hidden'] });

    // Tab / Shift+Tab prendem o foco dentro do dialog
    dialog.addEventListener('keydown', e => {
      if (dialog.hidden) return;

      // Escape fecha
      if (e.key === 'Escape') {
        e.preventDefault();
        const closeBtn = $(
          '#p1-confirm-cancel, #recon-preferences-close, [aria-label="Fechar"]',
          dialog
        );
        closeBtn ? closeBtn.click() : (dialog.hidden = true);
        lastFocused?.focus();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusables = getFocusables(dialog);
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Clicar no overlay fecha o dialog
    overlay?.addEventListener('click', () => {
      const closeBtn = $('#p1-confirm-cancel, #recon-preferences-close', dialog);
      closeBtn?.click();
      lastFocused?.focus();
    });
  }

  /* ────────────────────────────────────────────────
     #6 — Badges "Precisa de LD" nos cards da home
     ──────────────────────────────────────────────── */
  const MODULES_NEED_LD = ['relations', 'databook', 'titles'];

  function updateHomeCardBadges() {
    const ldLoaded = (() => {
      const meta = ($('#relations-ld-meta')?.textContent || '').toLowerCase();
      return Boolean(meta && !/nenhum arquivo|selecionar|aguardando/.test(meta));
    })();

    $$('[data-p1-open]').forEach(card => {
      const module = card.dataset.p1Open;
      const needsLd = MODULES_NEED_LD.includes(module);
      if (needsLd && !ldLoaded) {
        card.classList.add('card-needs-ld');
        card.setAttribute('data-needs-badge', 'Precisa de LD');
      } else {
        card.classList.remove('card-needs-ld');
        card.removeAttribute('data-needs-badge');
      }
    });
  }

  /* ────────────────────────────────────────────────
     #5 — Pulso visual no card da LD após carregamento
     ──────────────────────────────────────────────── */
  function watchLdCard() {
    const ldMeta = document.getElementById('relations-ld-meta');
    const sourceCard = document.querySelector('.recon-source');
    if (!ldMeta || !sourceCard) return;

    let lastText = ldMeta.textContent || '';
    const mo = new MutationObserver(() => {
      const current = ldMeta.textContent || '';
      if (current === lastText) return;
      lastText = current;

      const loaded = !/nenhum arquivo|selecionar|aguardando/i.test(current);
      if (loaded) {
        sourceCard.classList.remove('ld-just-loaded');
        // Força re-flow para reiniciar animação
        void sourceCard.offsetWidth;
        sourceCard.classList.add('ld-just-loaded');
        sourceCard.addEventListener('animationend', () => {
          sourceCard.classList.remove('ld-just-loaded');
        }, { once: true });
      }
      updateHomeCardBadges();
    });
    mo.observe(ldMeta, { childList: true, characterData: true, subtree: true });
    updateHomeCardBadges();
  }

  /* ────────────────────────────────────────────────
     #13 — Estado de loading nos botões primários
     Monitora o início de análise (barra de progresso)
     ──────────────────────────────────────────────── */
  const ANALYZE_PAIRS = [
    { btn: '#relations-analyze',  progress: '#relations-progress' },
    { btn: '#allocation-analyze', progress: '#allocation-progress' },
    { btn: '#databook-analyze',   progress: '#databook-progress'  },
    { btn: '#title-analyze',      progress: '#title-progress'     },
    { btn: '#renamer-analyze',    progress: '#renamer-progress'   },
    { btn: '#tag-analyze',        progress: null                  },
  ];

  function installLoadingStates() {
    ANALYZE_PAIRS.forEach(({ btn: btnSel, progress: progSel }) => {
      const btn = $(btnSel);
      if (!btn) return;

      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.classList.add('btn-loading');
        btn.setAttribute('aria-busy', 'true');

        // Remove o estado quando a análise terminar
        // (detectado pela ocultação da barra de progresso ou aparição do resultado)
        const stop = () => {
          btn.classList.remove('btn-loading');
          btn.removeAttribute('aria-busy');
        };

        if (progSel) {
          const prog = $(progSel);
          if (prog) {
            const obs = new MutationObserver(() => {
              if (prog.hidden) { stop(); obs.disconnect(); }
            });
            obs.observe(prog, { attributeFilter: ['hidden'] });
          }
        }
        // Fallback: remove loading após 30s no máximo
        setTimeout(stop, 30000);
      });
    });
  }

  /* ────────────────────────────────────────────────
     #11 — Scroll controlado no renamer-inspector
     Garante que o inspector não estoura a viewport
     ──────────────────────────────────────────────── */
  function fixRenamerInspector() {
    const inspector = document.querySelector('.renamer-inspector');
    if (!inspector) return;

    function applyMaxHeight() {
      const topbar = document.querySelector('.topbar');
      const topbarH = topbar ? topbar.getBoundingClientRect().height : 72;
      const available = window.innerHeight - topbarH;
      inspector.style.maxHeight = `${available}px`;
      inspector.style.overflowY = 'auto';
    }

    applyMaxHeight();
    window.addEventListener('resize', applyMaxHeight, { passive: true });
  }

  /* ────────────────────────────────────────────────
     #3 — aria-expanded automático para <details>
     ──────────────────────────────────────────────── */
  function installDetailsAriaExpanded() {
    $$('details').forEach(details => {
      const summary = $('summary', details);
      if (!summary) return;

      const update = () => {
        summary.setAttribute('aria-expanded', String(details.open));
      };
      update();
      details.addEventListener('toggle', update);
    });
  }

  /* ────────────────────────────────────────────────
     #12 — Ocultar contadores "0 itens" no estado inicial
     ──────────────────────────────────────────────── */
  const INITIAL_COUNTERS = [
    '#relations-text-count',
    '#allocation-text-count',
    '#tag-text-count',
  ];

  function hideZeroCounters() {
    INITIAL_COUNTERS.forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const isZero = /^0\s/.test((el.textContent || '').trim());
      if (isZero) el.classList.add('counter-zero');

      // Observer para mostrar quando valor mudar
      const mo = new MutationObserver(() => {
        const zero = /^0\s/.test((el.textContent || '').trim());
        el.classList.toggle('counter-zero', zero);
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ────────────────────────────────────────────────
     #18 — Atalhos globais de teclado
     Ctrl+K: foca a busca do módulo ativo
     Alt+1–7: navega entre módulos
     ──────────────────────────────────────────────── */
  const MODULE_ORDER = [
    'relations', 'allocation', 'tags', 'databook', 'titles', 'renamer', 'bases'
  ];

  const SEARCH_SELECTORS = {
    relations:  '#relations-search',
    allocation: '#allocation-search',
    tags:       '#tag-search',
    databook:   '#databook-search',
    titles:     '#title-search',
  };

  function activeModule() {
    return document.querySelector('.module-link.active[data-module]')
      ?.dataset.module || 'relations';
  }

  function installKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      // Ignorar quando dentro de input/textarea
      if (document.activeElement?.matches('input, textarea, select')) return;
      // Ignorar quando modal aberto
      if (!document.getElementById('p1-confirm-dialog')?.hidden === false) return;

      // Ctrl+K — foca a busca do módulo ativo
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const module = activeModule();
        const searchSel = SEARCH_SELECTORS[module];
        if (searchSel) {
          const search = $(searchSel);
          if (search && !search.closest('[hidden]')) {
            e.preventDefault();
            search.focus();
            search.select?.();
          }
        }
        return;
      }

      // Alt+1–7 — navega entre módulos
      if (e.altKey && e.key >= '1' && e.key <= '7') {
        const index = parseInt(e.key, 10) - 1;
        const moduleName = MODULE_ORDER[index];
        if (!moduleName) return;
        const link = document.querySelector(`.module-link[data-module="${moduleName}"]`);
        if (link && !link.hidden) {
          e.preventDefault();
          link.click();
          link.focus();
        }
      }
    });

    // Atalho Alt+H — volta ao início
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'h') {
        e.preventDefault();
        document.getElementById('p1-home-button')?.click();
      }
    });
  }

  /* ────────────────────────────────────────────────
     Reorganizar toolbar de alocação em dois grupos
     (filtros à esquerda, exportações à direita)
     ──────────────────────────────────────────────── */
  function reorganizeAllocationToolbar() {
    const toolbar = document.querySelector('.allocation-toolbar');
    if (!toolbar || toolbar.dataset.reorganized) return;
    toolbar.dataset.reorganized = 'true';

    // IDs dos botões de exportação
    const EXPORT_IDS = [
      'allocation-export-report',
      'allocation-export-file',
      'allocation-export-control',
      'allocation-export-package',
    ];

    const filtersGroup = document.createElement('div');
    filtersGroup.className = 'allocation-toolbar-filters';

    const exportsGroup = document.createElement('div');
    exportsGroup.className = 'allocation-toolbar-exports';

    // Classificar filhos existentes
    const children = Array.from(toolbar.children);
    children.forEach(child => {
      if (EXPORT_IDS.some(id => child.id === id)) {
        exportsGroup.appendChild(child);
      } else if (!child.classList.contains('toolbar-spacer')) {
        filtersGroup.appendChild(child);
      }
    });

    toolbar.innerHTML = '';
    toolbar.appendChild(filtersGroup);
    if (exportsGroup.children.length) toolbar.appendChild(exportsGroup);
  }

  /* ────────────────────────────────────────────────
     Adicionar dicas de acessibilidade às tabelas (aria-label)
     para as que não têm caption (complemento ao HTML)
     ──────────────────────────────────────────────── */
  const TABLE_LABELS = {
    'relations-table':         'Prévia da relação de documentos',
    'allocation-decision-table': 'Tabela de decisões de alocação',
    'tag-evidence-table':      'Tabela de conferência de TAGs',
    'bases-table':             'Tabela de bases de referência',
    'databook-body':           'Tabela de análise do Databook',
    'title-body':              'Lista de revisão de títulos',
  };

  function enhanceTableAccessibility() {
    Object.entries(TABLE_LABELS).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const table = el.tagName === 'TABLE' ? el : el.closest('table');
      if (!table) return;
      if (!table.querySelector('caption') && !table.getAttribute('aria-label')) {
        const caption = document.createElement('caption');
        caption.textContent = label;
        table.prepend(caption);
      }
    });
  }

  /* ────────────────────────────────────────────────
     Inicialização
     ──────────────────────────────────────────────── */
  function init() {
    // Focus-trap nos dois dialogs principais
    installFocusTrap(
      document.getElementById('p1-confirm-dialog'),
      'p1-confirm-overlay'
    );
    installFocusTrap(
      document.getElementById('recon-preferences-dialog'),
      'recon-preferences-overlay'
    );

    watchLdCard();
    installLoadingStates();
    fixRenamerInspector();
    installDetailsAriaExpanded();
    hideZeroCounters();
    installKeyboardShortcuts();
    enhanceTableAccessibility();

    // Reorganização da toolbar aguarda o módulo de alocação estar ativo
    // (pode não estar no DOM completo ainda)
    reorganizeAllocationToolbar();
    document.addEventListener('recon:module', e => {
      if (e?.detail?.module === 'allocation') {
        setTimeout(reorganizeAllocationToolbar, 50);
      }
    });

    // Re-avaliar badges quando o estado muda
    window.addEventListener('recon:ui-update', updateHomeCardBadges);
    document.addEventListener('change', e => {
      if (e.target?.id === 'relations-ld') {
        setTimeout(updateHomeCardBadges, 200);
      }
    });

    console.info('[RECON UX] Melhorias carregadas — v1.0');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
