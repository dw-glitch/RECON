(function (root) {
  "use strict";
  const instances = new Map();
  function create(key, host, onChange, initialSize) {
    if (instances.has(key)) return instances.get(key);
    const state = { page: 1, pageSize: Number(initialSize) || 100, total: 0 };
    const container = document.createElement("div");
    container.className = "recon-pager";
    container.dataset.pager = key;
    if (host && host.parentNode) host.parentNode.insertBefore(container, host.nextSibling);
    function pages() { return Math.max(1, Math.ceil(state.total / state.pageSize)); }
    function render() {
      state.page = Math.max(1, Math.min(state.page, pages()));
      const start = state.total ? (state.page - 1) * state.pageSize + 1 : 0;
      const end = Math.min(state.total, state.page * state.pageSize);
      container.innerHTML = `<span>Exibindo ${start.toLocaleString("pt-BR")}–${end.toLocaleString("pt-BR")} de ${state.total.toLocaleString("pt-BR")}</span><label>Linhas <select data-page-size><option>50</option><option>100</option><option>250</option></select></label><button type="button" data-page="first" aria-label="Primeira página">«</button><button type="button" data-page="prev" aria-label="Página anterior">‹</button><strong>${state.page} / ${pages()}</strong><button type="button" data-page="next" aria-label="Próxima página">›</button><button type="button" data-page="last" aria-label="Última página">»</button>`;
      container.querySelector("[data-page-size]").value = String(state.pageSize);
      container.querySelector('[data-page="first"]').disabled = state.page <= 1;
      container.querySelector('[data-page="prev"]').disabled = state.page <= 1;
      container.querySelector('[data-page="next"]').disabled = state.page >= pages();
      container.querySelector('[data-page="last"]').disabled = state.page >= pages();
    }
    container.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-page]"); if (!button) return;
      const action = button.dataset.page; const count = pages();
      if (action === "first") state.page = 1;
      if (action === "prev") state.page -= 1;
      if (action === "next") state.page += 1;
      if (action === "last") state.page = count;
      render(); if (onChange) onChange();
    });
    container.addEventListener("change", (event) => {
      if (!event.target.matches("[data-page-size]")) return;
      state.pageSize = Number(event.target.value) || 100; state.page = 1; render(); if (onChange) onChange();
    });
    const api = {
      slice(rows) { state.total = (rows || []).length; state.page = Math.max(1, Math.min(state.page, pages())); render(); const start = (state.page - 1) * state.pageSize; return (rows || []).slice(start, start + state.pageSize); },
      reset() { state.page = 1; },
      render(total) { state.total = Number(total) || 0; render(); },
      state,
    };
    instances.set(key, api); render(); return api;
  }
  root.RECONPager = Object.freeze({ create });
})(window);
