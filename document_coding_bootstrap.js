(function (root) {
  "use strict";

  const Storage = root.RECONDocumentCodingStorage;
  const Core = root.RECONDocumentCodingCore;
  let guardsInstalled = false;
  let reserving = false;

  function report(error) {
    if (root.RECON && typeof root.RECON.reportFailure === "function") root.RECON.reportFailure(error);
    else console.error(error);
  }

  function visibleToast(message, tone) {
    const node = root.document && root.document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.className = `toast show${tone ? ` ${tone}` : ""}`;
    root.setTimeout(() => { node.className = "toast"; }, 7000);
  }

  function reservationCandidates(api) {
    return (api.state.documents || []).filter((item) => {
      const analysis = item.analysis;
      return Boolean(
        item.parsed && analysis && analysis.complete && !analysis.existing
        && analysis.familyKey && analysis.sequence
        && analysis.status !== Core.STATUS.CONFLICT
        && analysis.confidence !== Core.CONFIDENCE.IMPOSSIBLE
      );
    });
  }

  async function reserveAnalyzedSequences(api) {
    if (!Storage || reserving) return;
    reserving = true;
    try {
      const caps = Storage.capabilities();
      const batchReserved = [];
      for (const item of reservationCandidates(api)) {
        const current = item.analysis;
        if (item.reservation && item.reservation.familyKey === current.familyKey && Number(item.reservation.sequence) === Number(current.sequence)) {
          batchReserved.push({ familyKey: current.familyKey, sequence: Number(current.sequence), code: current.code });
          continue;
        }

        if (item.reservation && item.reservation.id) {
          try { await Storage.releaseReservation(item.reservation.id); } catch (_) { /* expirada ou adapter remoto */ }
          item.reservation = null;
        }

        const requested = Number(current.sequence);
        const reservation = await Storage.reserveLocalSequence({
          project: "RECON",
          familyKey: current.familyKey,
          existingMax: Math.max(0, requested - 1),
          minimum: 1,
          owner: item.parsed.hash || item.id,
          code: current.code,
          // Uma sessão documental pode durar bastante. Reserva local longa evita
          // reuso durante a conferência sem transformar a LD automaticamente.
          ttlMs: 24 * 60 * 60 * 1000,
        });
        item.reservation = reservation;

        const width = Math.max(String(current.sequence).length, reservation.sequence > 999 ? 4 : 3);
        const allocated = String(reservation.sequence).padStart(width, "0");
        if (Number(current.sequence) !== Number(reservation.sequence)) {
          const overrides = Object.assign({}, item.overrides || {}, { sequence: allocated });
          const otherReserved = (api.state.documents || [])
            .filter((other) => other !== item && other.analysis && other.analysis.familyKey && other.analysis.sequence)
            .map((other) => ({ familyKey: other.analysis.familyKey, sequence: Number(other.analysis.sequence), code: other.analysis.code }));
          item.analysis = Core.analyzeDocument(
            { filename: item.file.name, text: item.parsed.text, overrides },
            api.state.ldIndex,
            { reserved: [...otherReserved, ...batchReserved] }
          );
          item.analysis.message = `${item.analysis.message || ""} Sequencial ajustado pela reserva concorrente local: ${allocated}.`.trim();
        }

        batchReserved.push({ familyKey: item.analysis.familyKey, sequence: Number(item.analysis.sequence), code: item.analysis.code });

        if (!caps.crossDeviceAtomic && item.analysis && !item.analysis.existing && item.analysis.confidence !== Core.CONFIDENCE.CONFLICT) {
          item.analysis.confidence = Core.CONFIDENCE.REVIEW;
          item.analysis.status = Core.STATUS.REVIEW;
          item.analysis.message = `${item.analysis.message || ""} Requer confirmação antes do uso definitivo porque o RECON atual não possui um serviço transacional compartilhado entre computadores.`.trim();
        }
      }
      if (typeof api.render === "function") api.render();
    } finally {
      reserving = false;
    }
  }

  function selectedReviewItems(api) {
    return (api.state.documents || []).filter((item) => item.selected && item.analysis && item.analysis.confidence === Core.CONFIDENCE.REVIEW && !item.userConfirmedReview);
  }

  function itemFromAction(api, target) {
    const row = target && target.closest && target.closest("[data-coding-id]");
    return row ? (api.state.documents || []).find((item) => item.id === row.dataset.codingId) : null;
  }

  function requireReviewConfirmation(api, event) {
    const target = event.target && event.target.closest && event.target.closest("button");
    if (!target || !target.closest("#module-coding")) return;

    let items = [];
    if (target.matches('[data-action="generate"]')) {
      const item = itemFromAction(api, target);
      if (item) items = [item];
    } else if (target.id === "coding-generate-active") {
      const item = (api.state.documents || []).find((entry) => entry.id === api.state.activeId);
      if (item) items = [item];
    } else if (["coding-generate-selected", "coding-generate-valid", "coding-download-zip"].includes(target.id)) {
      items = selectedReviewItems(api);
    }

    const review = items.filter((item) => item.analysis && item.analysis.confidence === Core.CONFIDENCE.REVIEW && !item.userConfirmedReview);
    if (!review.length) return;

    const ok = root.confirm(`${review.length} documento(s) ainda estão como “Requer confirmação”. Isso pode envolver dado normativo ausente, OCR pendente ou ausência de reserva transacional entre computadores. Deseja confirmar conscientemente esses itens e continuar a geração?`);
    if (!ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
      visibleToast("Geração cancelada até a confirmação dos itens pendentes.", "warn");
      return;
    }
    review.forEach((item) => { item.userConfirmedReview = true; });
  }

  function installGuards(api) {
    if (guardsInstalled || !root.document) return;
    const analyze = root.document.getElementById("coding-analyze");
    if (!analyze) return;
    guardsInstalled = true;

    // Intercepta o botão de análise para aplicar a reserva IndexedDB/Web Locks
    // depois que o motor determinístico terminou o lote.
    analyze.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        await api.analyzeAll();
        await reserveAnalyzedSequences(api);
      } catch (error) {
        report(error);
      }
    }, true);

    root.document.addEventListener("click", (event) => requireReviewConfirmation(api, event), true);
  }

  function boot(module) {
    if (module !== "coding") return;
    const api = root.RECONDocumentCoding;
    if (!api || typeof api.init !== "function") return;
    Promise.resolve(api.init())
      .then(() => installGuards(api))
      .catch(report);
  }

  // O evento recon:module que disparou o lazy-load já aconteceu antes de
  // document_coding_app.js existir. Por isso o bootstrap verifica a view ativa
  // imediatamente e também acompanha reaberturas posteriores do módulo.
  const view = root.document && root.document.querySelector('[data-module-view="coding"]');
  if (view && !view.hidden) boot("coding");

  root.addEventListener("recon:module", (event) => boot(event.detail && event.detail.module));
  root.addEventListener("recon:module-ready", (event) => boot(event.detail && event.detail.module));
})(window);