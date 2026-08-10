(function (root) {
  "use strict";

  const doc = root.document;
  const Core = root.RECONBasesCore;
  if (!Core) return;

  const STORE = "base_overrides";
  const CHANNEL_NAME = "recon-bases-v1";

  const els = {
    body: doc.getElementById("bases-table-body"),
    empty: doc.getElementById("bases-empty"),
    file: doc.getElementById("bases-file-input"),
    restoreAll: doc.getElementById("bases-restore-all"),
    exportReport: doc.getElementById("bases-export"),
    status: doc.getElementById("bases-status"),
    countTotal: doc.getElementById("bases-count-total"),
    countPinned: doc.getElementById("bases-count-pinned"),
    countBundled: doc.getElementById("bases-count-bundled"),
  };

  // Espelho em memória dos registros do IndexedDB. A leitura acontece uma vez
  // na abertura do módulo; a partir daí toda consulta é síncrona, porque quem
  // consome as bases (audit_app) precisa da resposta durante o carregamento.
  const overrides = new Map();
  let loaded = false;
  let loadPromise = null;
  let loadError = null;
  let pendingBaseId = "";

  const channel = typeof root.BroadcastChannel === "function" ? new root.BroadcastChannel(CHANNEL_NAME) : null;

  function db() {
    if (!root.RECONDB) return Promise.reject(new Error("O armazenamento local do RECON não está disponível neste navegador."));
    return Promise.resolve(root.RECONDB);
  }

  function toast(message, tone) {
    const node = doc.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 7000);
  }

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString("pt-BR");
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Date(Number(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return "—";
    }
  }

  // ===================== PERSISTÊNCIA =====================

  // Uma falha transitória (outra aba segurando o upgrade) merece nova
  // tentativa; uma falha estrutural, não. Sem esse limite, cada chamada de
  // ready() reabria o banco e falhava de novo, enchendo o console de erro
  // repetido a cada análise.
  const MAX_TENTATIVAS = 3;
  let tentativas = 0;

  async function load() {
    if (loaded) return overrides;
    if (loadPromise) return loadPromise;
    if (loadError && tentativas >= MAX_TENTATIVAS) return overrides;
    loadPromise = (async () => {
      try {
        const store = await (await db()).open();
        // A store pode não existir se o banco ficou numa versão antiga: nesse
        // caso a transação lançaria NotFoundError. Detectar antes dá uma
        // mensagem que diz o que fazer, em vez de um erro de baixo nível.
        if (store && store.objectStoreNames && !store.objectStoreNames.contains(STORE)) {
          throw new Error("O espaço das bases fixadas ainda não existe neste navegador. Feche as outras abas do RECON e recarregue a página.");
        }
        const records = await (await db()).getAll(STORE);
        overrides.clear();
        (records || []).forEach((record) => {
          if (record && record.id && Core.descriptor(record.id)) overrides.set(record.id, record);
        });
        loadError = null;
        loaded = true;
        tentativas = 0;
      } catch (error) {
        // Sem IndexedDB o RECON continua funcionando com as bases incorporadas:
        // falhar aqui não pode impedir a abertura de nenhum módulo. Mas `loaded`
        // continua falso de propósito — marcar como carregado faria a análise
        // usar a base incorporada em silêncio, enquanto o usuário acredita que
        // a base que ele fixou está valendo.
        tentativas += 1;
        loadError = error;
        if (tentativas === 1) console.warn("RECON Bases: não foi possível ler as bases fixadas.", error);
      }
      loadPromise = null;
      return overrides;
    })();
    return loadPromise;
  }

  async function persist(record) {
    await (await db()).put(STORE, record);
    overrides.set(record.id, record);
    announce();
  }

  async function remove(id) {
    await (await db()).delete(STORE, id);
    overrides.delete(id);
    announce();
  }

  function announce() {
    render();
    if (channel) {
      try { channel.postMessage({ type: "changed", ids: [...overrides.keys()] }); } catch (_) { /* aba única */ }
    }
    root.dispatchEvent(new CustomEvent("recon:bases-changed", { detail: { pinned: [...overrides.keys()] } }));
  }

  // ===================== LEITURA DO ARQUIVO SUBSTITUTO =====================

  async function readWorkbook(file) {
    if (!root.XLSX) throw new Error("O leitor de planilhas ainda não terminou de carregar. Tente de novo em alguns segundos.");
    const access = root.RECONFileAccess;
    const buffer = access ? await access.readArrayBuffer(file) : await file.arrayBuffer();
    const workbook = root.XLSX.read(buffer, { type: "array", cellDates: true });
    return { buffer, workbook };
  }

  function sheetRows(workbook, name) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet["!ref"]) return [];
    return root.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  }

  /**
   * Percorre as abas até achar uma que traga todas as colunas obrigatórias.
   * Uma planilha exportada do SGP costuma ter abas auxiliares antes da que
   * interessa, e obrigar o usuário a escolher a aba certa de cabeça só gera
   * substituição errada.
   */
  function buildFromWorkbook(item, workbook, fileName) {
    const names = workbook.SheetNames || [];
    const failures = [];
    for (const name of names) {
      const rows = sheetRows(workbook, name);
      if (!rows.length) continue;
      try {
        const catalog = Core.buildCatalog(item, rows, { source: fileName, sheet: name });
        return { catalog, sheet: name };
      } catch (error) {
        failures.push({ sheet: name, missing: error.missing || [], headers: error.headers || [] });
      }
    }
    const detail = failures.length
      ? failures.map((entry) => `“${entry.sheet}” (falta: ${entry.missing.join(", ") || "cabeçalho reconhecível"})`).join("; ")
      : "nenhuma aba com conteúdo";
    const error = new Error(`Nenhuma aba serve para "${item.label}". Abas conferidas: ${detail}.`);
    error.name = "RECONBaseSheetError";
    throw error;
  }

  async function pin(id, file) {
    const item = Core.descriptor(id);
    if (!item) throw new Error("Base desconhecida.");
    if (!file) throw new Error("Nenhum arquivo selecionado.");
    await load();

    const { buffer, workbook } = await readWorkbook(file);
    let payload = null;
    let sheet = "";
    let count = 0;

    if (item.kind === "workbook") {
      // A planilha inteira é entregue aos leitores já existentes, exatamente
      // como a base incorporada seria. Guardar os bytes preserva fórmulas,
      // formatação e abas que o leitor do módulo talvez use depois.
      const usable = (workbook.SheetNames || []).some((name) => sheetRows(workbook, name).length > 1);
      if (!usable) throw new Error(`A planilha escolhida para "${item.label}" não tem nenhuma aba com dados.`);
      payload = buffer;
      sheet = (workbook.SheetNames || [])[0] || "";
      count = Math.max(0, sheetRows(workbook, sheet).length - 1);
    } else {
      const built = buildFromWorkbook(item, workbook, file.name);
      const verdict = Core.review(item, built.catalog);
      if (!verdict.valid) throw new Error(verdict.errors.join(" "));
      verdict.warnings.forEach((message) => toast(message, "warn"));
      payload = built.catalog;
      sheet = built.sheet;
      count = verdict.count;
    }

    const record = {
      ...Core.overrideRecord(item, { fileName: file.name, sheet, size: Number(file.size) || 0, count, pinnedAt: Date.now() }),
      payload,
    };
    await persist(record);
    return record;
  }

  async function restore(id) {
    await load();
    if (!overrides.has(id)) return false;
    await remove(id);
    return true;
  }

  // ===================== CONSULTA PELOS MÓDULOS =====================

  function record(id) {
    return overrides.get(id) || null;
  }

  function arrayBuffer(id) {
    const entry = record(id);
    if (!entry || !(entry.payload instanceof ArrayBuffer)) return null;
    // slice() protege o registro em memória: quem recebe pode transferir o
    // buffer para um Worker, e um buffer transferido fica inutilizável aqui.
    return entry.payload.slice(0);
  }

  function catalog(id) {
    const entry = record(id);
    if (!entry || entry.payload instanceof ArrayBuffer) return null;
    return entry.payload;
  }

  function isPinned(id) {
    return overrides.has(id);
  }

  function list() {
    return Core.descriptors().map((item) => Core.status(item, record(item.id)));
  }

  // ===================== INTERFACE =====================

  function actionsFor(state) {
    const pinLabel = state.origin === "substituida" ? "Trocar arquivo" : "Substituir e fixar";
    const restore = state.origin === "substituida"
      ? `<button class="text-action danger" data-base-restore="${escape(state.id)}" type="button">Restaurar incorporada</button>`
      : "";
    return `<button class="secondary-button compact" data-base-pin="${escape(state.id)}" type="button">${pinLabel}</button>${restore}`;
  }

  function rowFor(state) {
    const pinned = state.origin === "substituida";
    const pill = pinned
      ? '<quality-status class="state-pill review">Substituída e fixada</quality-status>'
      : '<quality-status class="state-pill neutral">Incorporada</quality-status>';
    const drift = pinned && state.bundledCount && state.count !== state.bundledCount
      ? `<small>Incorporada tinha ${formatCount(state.bundledCount)}</small>`
      : "";
    // Rev.B e o modelo de alocação são planilhas usadas inteiras: o RECON não
    // conta registros nelas. Mostrar "0" pareceria base vazia ou quebrada.
    const volume = state.count ? formatCount(state.count) : "—";
    return `<tr data-base-row="${escape(state.id)}">
<td><strong>${escape(state.label)}</strong><small>${escape(state.summary)}</small></td>
<td>${pill}<small>${escape(state.consumer)}</small></td>
<td><strong>${escape(state.source)}</strong><small>aba ${escape(state.sheet)}</small></td>
<td><strong>${volume}</strong><small>${escape(state.unit)}</small>${drift}</td>
<td>${escape(formatDate(state.pinnedAt))}</td>
<td class="bases-actions"><div class="bases-actions-stack">${actionsFor(state)}</div></td>
</tr>`;
  }

  function render() {
    if (!els.body) return;
    const states = list();
    const pinned = states.filter((state) => state.origin === "substituida").length;
    els.body.innerHTML = states.map(rowFor).join("");
    if (els.empty) els.empty.hidden = states.length > 0;
    if (els.countTotal) els.countTotal.textContent = String(states.length);
    if (els.countPinned) els.countPinned.textContent = String(pinned);
    if (els.countBundled) els.countBundled.textContent = String(states.length - pinned);
    if (els.restoreAll) els.restoreAll.disabled = pinned === 0;
    if (els.exportReport) els.exportReport.disabled = states.length === 0;
    if (els.status) {
      if (loadError) {
        els.status.textContent = "Não foi possível ler as bases fixadas neste navegador. A análise está usando as bases incorporadas — feche as outras abas do RECON e recarregue a página.";
      } else {
        els.status.textContent = pinned
          ? `${pinned} base(s) substituída(s) e fixada(s) neste navegador. O RECON usa a sua versão até você restaurar a incorporada.`
          : "Todas as bases em uso são as incorporadas ao RECON.";
      }
    }
  }

  function reportText() {
    const lines = [
      "RECON — bases de referência em uso",
      `Gerado em ${new Date().toLocaleString("pt-BR")}`,
      "",
    ];
    list().forEach((state) => {
      lines.push(`${state.label} — ${state.originLabel}`);
      lines.push(`  Consumida por: ${state.consumer}`);
      lines.push(`  Origem: ${state.source} · aba ${state.sheet}`);
      lines.push(`  Registros: ${formatCount(state.count)} ${state.unit}`);
      if (state.origin === "substituida") {
        lines.push(`  Fixada em: ${formatDate(state.pinnedAt)}`);
        lines.push(`  Base incorporada substituída tinha ${formatCount(state.bundledCount)} ${state.unit}`);
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  function download() {
    const blob = new Blob([reportText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = `RECON_bases_${new Date().toISOString().slice(0, 10)}.txt`;
    doc.body.appendChild(link);
    link.click();
    link.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bind() {
    if (els.body) {
      els.body.addEventListener("click", async (event) => {
        const pinButton = event.target.closest("[data-base-pin]");
        if (pinButton && els.file) {
          pendingBaseId = pinButton.dataset.basePin;
          els.file.value = "";
          els.file.click();
          return;
        }
        const restoreButton = event.target.closest("[data-base-restore]");
        if (!restoreButton) return;
        const id = restoreButton.dataset.baseRestore;
        const item = Core.descriptor(id);
        if (!item) return;
        if (!root.confirm(`Voltar a usar a base incorporada de "${item.label}"? O arquivo que você fixou será descartado.`)) return;
        try {
          await restore(id);
          toast(`"${item.label}" voltou para a base incorporada. Recarregue a página para a mudança valer na análise.`, "success");
        } catch (error) {
          toast(error.message || "Não foi possível restaurar a base incorporada.", "error");
        }
      });
    }

    if (els.file) {
      els.file.addEventListener("change", async () => {
        const file = els.file.files && els.file.files[0];
        const id = pendingBaseId;
        pendingBaseId = "";
        if (!file || !id) return;
        const item = Core.descriptor(id);
        try {
          if (els.status) els.status.textContent = `Lendo “${file.name}”…`;
          const saved = await pin(id, file);
          // O toast escreve por textContent; escapar aqui faria "&" virar "&amp;".
          toast(`"${item.label}" agora usa ${saved.fileName} com ${formatCount(saved.count)} registro(s). Recarregue a página para a mudança valer na análise.`, "success");
        } catch (error) {
          render();
          toast(error.message || "Não foi possível fixar essa base.", "error");
        } finally {
          els.file.value = "";
        }
      });
    }

    if (els.restoreAll) {
      els.restoreAll.addEventListener("click", async () => {
        const ids = [...overrides.keys()];
        if (!ids.length) return;
        if (!root.confirm(`Restaurar as ${ids.length} base(s) incorporada(s) e descartar os arquivos fixados?`)) return;
        try {
          for (const id of ids) await remove(id);
          toast("Todas as bases voltaram para a versão incorporada. Recarregue a página.", "success");
        } catch (error) {
          toast(error.message || "Não foi possível restaurar as bases.", "error");
        }
      });
    }

    if (els.exportReport) els.exportReport.addEventListener("click", download);

    if (channel) {
      channel.addEventListener("message", () => {
        loaded = false;
        load().then(render);
      });
    }
  }

  async function init() {
    await load();
    render();
  }

  bind();
  root.addEventListener("recon:module", (event) => {
    if (event.detail && event.detail.module === "bases") init();
  });

  root.RECONBases = Object.freeze({
    ready: load,
    list,
    pin,
    restore,
    isPinned,
    arrayBuffer,
    catalog,
    record,
    reportText,
    render,
  });

  init();
})(window);
