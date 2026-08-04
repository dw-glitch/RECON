(function () {
  "use strict";

  const Core = window.RECONTagConferenceCore;
  const Embedded = window.RECONTagReferenceCatalog;
  if (!Core || !Embedded) return;

  const FILTER_KEY = "recon.tags.filters.v2";
  const $ = (selector, root) => (root || document).querySelector(selector);
  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const elements = {
    referenceInput: $("#tag-reference-input"),
    referenceMeta: $("#tag-reference-meta"),
    listInput: $("#tag-list-input"),
    listMeta: $("#tag-list-meta"),
    text: $("#tag-text"),
    textCount: $("#tag-text-count"),
    clear: $("#tag-clear"),
    analyze: $("#tag-analyze"),
    results: $("#tag-results"),
    body: $("#tag-results-body"),
    empty: $("#tag-empty"),
    search: $("#tag-search"),
    status: $("#tag-status-filter"),
    clearFilters: $("#tag-clear-column-filters"),
    filters: $("#tag-column-filters"),
    countTotal: $("#tag-count-total"),
    countConfirmed: $("#tag-count-confirmed"),
    countCorrect: $("#tag-count-correct"),
    countReview: $("#tag-count-review"),
    copy: $("#tag-copy-corrected"),
    export: $("#tag-export-report"),
    previewLimit: $("#tag-preview-limit"),
    officialEvidence: $("#tag-official-evidence-text"),
  };

  const state = {
    reference: Core.buildReferenceIndex(Embedded.entries, Embedded.meta),
    listEntries: [],
    result: { rows: [], counts: {}, total: 0 },
    columnFilters: {},
  };
  const pager = window.RECONPager && window.RECONPager.create("tags", elements.previewLimit, () => render(), 100);

  function toast(message, tone) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.setAttribute("tone", tone || "neutral");
    node.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => node.classList.remove("show"), 3600);
  }

  function readFilters() {
    try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {}; } catch (_) { return {}; }
  }

  function saveFilters() {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ search: elements.search && elements.search.value, status: elements.status && elements.status.value })); } catch (_) {}
  }

  function linesFromText(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function updateTextCount() {
    const count = linesFromText(elements.text && elements.text.value).length + state.listEntries.length;
    if (elements.textCount) elements.textCount.textContent = `${count.toLocaleString("pt-BR")} ${count === 1 ? "item" : "itens"}`;
    if (elements.analyze) elements.analyze.disabled = count === 0 || !state.reference.entries.length;
  }

  function normHeader(value) {
    return Core.norm(value).replace(/[^A-Z0-9]+/g, " ").trim();
  }

  function findHeaderRow(rows, required) {
    const max = Math.min(rows.length, 80);
    for (let index = 0; index < max; index += 1) {
      const normalized = (rows[index] || []).map(normHeader);
      if (required.every((aliases) => aliases.some((alias) => normalized.includes(normHeader(alias))))) return index;
    }
    return -1;
  }

  function headerIndex(row, aliases) {
    const normalized = (row || []).map(normHeader);
    for (const alias of aliases) {
      const index = normalized.indexOf(normHeader(alias));
      if (index >= 0) return index;
    }
    return -1;
  }

  async function readWorkbook(file) {
    if (window.RECONWorkbookWorker) return window.RECONWorkbookWorker.read(file, { cellDates: true, cellFormula: true });
    const buffer = window.RECONFileAccess ? await window.RECONFileAccess.readArrayBuffer(file) : await file.arrayBuffer();
    return XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
  }

  function parseReferenceWorkbook(workbook) {
    const sheetName = (workbook.SheetNames || []).find((name) => Core.norm(name) === "APENDICE") || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    const headerRow = findHeaderRow(rows, [["TAG", "TAG (NOTA 1)"], ["DESCRIÇÃO", "DESCRICAO"]]);
    if (headerRow < 0) throw new Error("A coluna TAG não foi encontrada na aba Apêndice.");
    const header = rows[headerRow] || [];
    const columns = {
      unit: headerIndex(header, ["UNIDADE DE PROCESSO"]),
      discipline: headerIndex(header, ["DISCIPLINA"]),
      tag: headerIndex(header, ["TAG (NOTA 1)", "TAG"]),
      description: headerIndex(header, ["DESCRIÇÃO", "DESCRICAO"]),
      responsible: headerIndex(header, ["RESPONSÁVEL PELO FORNECIMENTO", "RESPONSAVEL PELO FORNECIMENTO"]),
      equipmentArea: headerIndex(header, ["EQUIPAMENTO PRINCIPAL/ÁREA (NOTA 2)", "EQUIPAMENTO PRINCIPAL/AREA (NOTA 2)", "EQUIPAMENTO PRINCIPAL/ÁREA"]),
      criticality: headerIndex(header, ["CRITICIDADE (NOTA 3)", "CRITICIDADE"]),
      originalSupplier: headerIndex(header, ["FORNECEDOR ORIGINAL (NOTA 5)", "FORNECEDOR ORIGINAL"]),
    };
    if (columns.tag < 0) throw new Error("A coluna TAG não foi reconhecida.");
    const data = [];
    for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const tag = String(row[columns.tag] || "").trim();
      if (!tag) continue;
      data.push({
        unit: columns.unit >= 0 ? row[columns.unit] : "",
        discipline: columns.discipline >= 0 ? row[columns.discipline] : "",
        tag,
        description: columns.description >= 0 ? row[columns.description] : "",
        responsible: columns.responsible >= 0 ? row[columns.responsible] : "",
        equipmentArea: columns.equipmentArea >= 0 ? row[columns.equipmentArea] : "",
        criticality: columns.criticality >= 0 ? row[columns.criticality] : "",
        originalSupplier: columns.originalSupplier >= 0 ? row[columns.originalSupplier] : "",
        referenceRow: rowIndex + 1,
      });
    }
    if (!data.length) throw new Error("Nenhuma TAG foi localizada na planilha selecionada.");
    return Core.buildReferenceIndex(data, { source: state.referenceFileName || "Base selecionada", sheet: sheetName, revision: "Atualizada" });
  }

  function parseListWorkbook(workbook) {
    const output = [];
    const aliases = ["DOCUMENTO", "NOME DO DOCUMENTO", "NOMEDOCUMENTO", "CÓDIGO DO DOCUMENTO", "CODIGO DO DOCUMENTO", "ARQUIVO"];
    (workbook.SheetNames || []).forEach((sheetName) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
      let headerRow = -1;
      let column = -1;
      const max = Math.min(rows.length, 50);
      for (let index = 0; index < max; index += 1) {
        column = headerIndex(rows[index] || [], aliases);
        if (column >= 0) { headerRow = index; break; }
      }
      if (headerRow >= 0) {
        for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
          const value = String((rows[rowIndex] || [])[column] || "").trim();
          if (value) output.push(value);
        }
      } else {
        rows.forEach((row) => (row || []).forEach((cell) => {
          const value = String(cell || "").trim();
          if (/_RNEST_/i.test(value)) output.push(value);
        }));
      }
    });
    return output;
  }

  function resultRows() {
    const general = Core.norm(elements.search && elements.search.value);
    const status = elements.status && elements.status.value || "all";
    return state.result.rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      const values = rowValues(row);
      if (general && !values.some((value) => Core.norm(value).includes(general))) return false;
      return Object.entries(state.columnFilters).every(([index, filter]) => !filter || Core.norm(values[Number(index)]).includes(Core.norm(filter)));
    });
  }

  function rowValues(row) {
    const reference = row.reference || {};
    return [
      row.statusLabel, row.document, row.identifier, row.candidateTag,
      reference.tag || "", reference.description || "", reference.discipline || "",
      reference.responsible || "", row.correctedCode, row.reason,
      row.matchType === "punctuation" ? "Sem pontuação" : row.matchType === "contract" ? "Contratual" : "—",
      row.confidence,
    ].map((value) => String(value == null ? "" : value));
  }

  function statusClass(status) {
    return ({ confirmed: "ready", non_tagged: "neutral", remove_nt: "review", add_nt: "review", review: "blocked" })[status] || "neutral";
  }

  function renderFilters() {
    if (!elements.filters || elements.filters.children.length) return;
    const count = 12;
    for (let index = 0; index < count; index += 1) {
      const cell = document.createElement("th");
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "Filtrar";
      input.setAttribute("aria-label", `Filtrar coluna ${index + 1}`);
      input.addEventListener("input", () => {
        state.columnFilters[index] = input.value;
        render();
      });
      cell.appendChild(input);
      elements.filters.appendChild(cell);
    }
  }

  function matchLabel(row) {
    if (row.matchType === "punctuation") return "Correspondência sem pontuação";
    if (row.matchType === "contract") return "Correspondência contratual";
    if (row.status === "non_tagged") return "Item não tagueado confirmado";
    return row.reference && row.reference.tag ? "TAG localizada na base" : "Sem correspondência segura";
  }

  function render() {
    const rows = resultRows();
    const preview = pager ? pager.slice(rows) : rows.slice(0, 100);
    if (elements.body) {
      elements.body.innerHTML = preview.map((row) => {
        const ref = row.reference || {};
        const tagKind = row.status === "non_tagged" || row.status === "add_nt" ? "NÃO TAGUEADO" : "TAG";
        return `<tr class="tag-evidence-row ${statusClass(row.status)}">
          <td><quality-status class="state-pill ${statusClass(row.status)}">${escapeHtml(row.statusLabel)}</quality-status></td>
          <td><code>${escapeHtml(row.document || "—")}</code></td>
          <td><div class="tag-field-card"><strong>${escapeHtml(tagKind)}</strong><code>${escapeHtml(row.identifier || "—")}</code>${row.candidateTag ? `<small>Consultado: ${escapeHtml(row.candidateTag)}</small>` : ""}</div></td>
          <td><div class="tag-reference-card"><strong>${escapeHtml(ref.tag || "Nenhuma TAG localizada")}</strong><span>${escapeHtml(ref.description || row.reason || "Sem descrição oficial")}</span><small>${escapeHtml([ref.discipline, ref.responsible, matchLabel(row)].filter(Boolean).join(" · "))}</small></div></td>
          <td><code class="tag-corrected-code">${escapeHtml(row.correctedCode || row.document || "—")}</code></td>
          <td><div class="tag-conclusion-card"><strong>${escapeHtml(row.reason || row.statusLabel || "—")}</strong><span>${escapeHtml(matchLabel(row))}</span></div></td>
          <td><span class="confidence-pill ${escapeHtml(String(row.confidence || "").toLowerCase())}">${escapeHtml(row.confidence || "—")}</span></td>
        </tr>`;
      }).join("");
    }
    if (elements.empty) elements.empty.hidden = rows.length > 0;
    if (elements.previewLimit) {
      elements.previewLimit.hidden = false;
      elements.previewLimit.textContent = `${rows.length.toLocaleString("pt-BR")} resultado(s) filtrado(s) · relatório completo`;
    }
    const counts = state.result.counts || {};
    if (elements.countTotal) elements.countTotal.textContent = state.result.total.toLocaleString("pt-BR");
    if (elements.countConfirmed) elements.countConfirmed.textContent = Number(counts.confirmed || 0).toLocaleString("pt-BR");
    if (elements.countCorrect) elements.countCorrect.textContent = Number(counts.non_tagged || 0).toLocaleString("pt-BR");
    if (elements.countReview) elements.countReview.textContent = Number((counts.add_nt || 0) + (counts.remove_nt || 0) + (counts.review || 0)).toLocaleString("pt-BR");
    if (elements.copy) elements.copy.disabled = !state.result.total;
    if (elements.export) elements.export.disabled = !state.result.total;
    if (elements.officialEvidence) elements.officialEvidence.textContent = `${state.reference.entries.length.toLocaleString("pt-BR")} TAGs · Rev. ${state.reference.meta.revision || "B"} · ${state.reference.meta.source || "Anexo I - Apêndice 3"}`;
  }

  function formattedToday() {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  }

  async function ensureExportLibraries() {
    if (window.RECONModuleLoader) await window.RECONModuleLoader.ensure("export");
    if (!window.ExcelJS) throw new Error("Biblioteca de exportação indisponível.");
  }

  async function addLogo(workbook) {
    if (window.RECONBrand && window.RECONBrand.addReportLogo) return window.RECONBrand.addReportLogo(workbook);
    return null;
  }

  function styleHeader(row) {
    row.height = 28;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155C8A" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FF0E476B" } } };
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function exportReport() {
    await ensureExportLibraries();
    const rows = resultRows();
    if (!rows.length) return toast("Nenhum resultado corresponde aos filtros.", "warning");
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "RECON";
    workbook.created = new Date();
    const logoId = await addLogo(workbook);

    const summary = workbook.addWorksheet("Resumo", { views: [{ state: "frozen", ySplit: 6 }] });
    summary.columns = [{ width: 25 }, { width: 28 }, { width: 28 }, { width: 28 }];
    summary.mergeCells("A1:D3");
    if (logoId !== null) summary.addImage(logoId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 158, height: 58 } });
    summary.mergeCells("A4:D4");
    summary.getCell("A4").value = "CONFERÊNCIA DE TAGS ANTES DA INCLUSÃO NA LD";
    summary.getCell("A4").font = { bold: true, size: 15, color: { argb: "FF155C8A" } };
    summary.getCell("A4").alignment = { horizontal: "center" };
    summary.addRow(["Data do relatório", formattedToday(), "Base consultada", state.reference.meta.source || "Base de TAGs"]);
    summary.addRow(["Revisão da base", state.reference.meta.revision || "—", "TAGs cadastradas", state.reference.entries.length]);
    summary.addRow(["Documentos analisados", state.result.total, "Resultados no filtro", rows.length]);
    summary.addRow(["TAGs confirmadas", state.result.counts.confirmed || 0, "Não tagueados corretos", state.result.counts.non_tagged || 0]);
    summary.addRow(["Correções necessárias", (state.result.counts.add_nt || 0) + (state.result.counts.remove_nt || 0), "Revisões manuais", state.result.counts.review || 0]);
    summary.addRow(["Normalização do Grupo 7", "U32- é retirado da chave de consulta", "Exemplo", "U32-AD-05584 → AD-05584"]);
    [5, 6, 7, 8, 9, 10].forEach((rowNumber) => {
      summary.getRow(rowNumber).eachCell((cell, col) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col % 2 ? "FFEAF3F8" : "FFF7FAFC" } };
        cell.font = { bold: col % 2 === 1, color: { argb: "FF17324D" } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    const sheet = workbook.addWorksheet("Conferência", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
    const headers = [
      "SITUAÇÃO", "DOCUMENTO INFORMADO", "CAMPO 7", "TAG CONSULTADA", "TAG NA BASE", "DESCRIÇÃO DA BASE",
      "UNIDADE", "DISCIPLINA", "RESPONSÁVEL PELO FORNECIMENTO", "EQUIPAMENTO PRINCIPAL / ÁREA", "CRITICIDADE",
      "FORNECEDOR ORIGINAL", "CÓDIGO CORRIGIDO", "MOTIVO", "TIPO DA CORRESPONDÊNCIA", "CONFIANÇA",
      "BASE CONSULTADA", "REVISÃO DA BASE",
    ];
    sheet.addRow(headers);
    styleHeader(sheet.getRow(1));
    sheet.autoFilter = { from: "A1", to: "R1" };
    rows.forEach((row) => {
      const ref = row.reference || {};
      const added = sheet.addRow([
        row.statusLabel, row.document, row.identifier, row.candidateTag, ref.tag || "", ref.description || "",
        ref.unit || "", ref.discipline || "", ref.responsible || "", ref.equipmentArea || "", ref.criticality || "",
        ref.originalSupplier || "", row.correctedCode, row.reason,
        row.matchType === "punctuation" ? "Sem pontuação" : row.matchType === "contract" ? "Contratual" : "Não localizada",
        row.confidence, state.reference.meta.source || "", state.reference.meta.revision || "",
      ]);
      const tone = row.status === "confirmed" ? "FFDDF3E4" : row.status === "non_tagged" ? "FFEAF3F8" : row.status === "review" ? "FFFCE8E6" : "FFFFF2CC";
      added.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone } };
      added.eachCell((cell) => { cell.alignment = { vertical: "top", wrapText: true }; });
    });
    const widths = [30, 54, 28, 26, 24, 38, 12, 18, 22, 32, 14, 22, 58, 56, 20, 12, 36, 14];
    sheet.columns.forEach((column, index) => { column.width = widths[index] || 18; });
    sheet.getColumn(2).numFmt = "@";
    sheet.getColumn(13).numFmt = "@";

    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `RECON_Conferencia_TAGs_${stamp}.xlsx`);
  }

  async function copyCorrected() {
    const values = resultRows().map((row) => row.correctedCode).filter(Boolean).join("\n");
    if (!values) return;
    try {
      await navigator.clipboard.writeText(values);
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = values;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("Códigos corrigidos copiados.", "success");
  }

  elements.referenceInput && elements.referenceInput.addEventListener("change", async () => {
    const file = elements.referenceInput.files && elements.referenceInput.files[0];
    if (!file) return;
    try {
      state.referenceFileName = file.name;
      state.reference = parseReferenceWorkbook(await readWorkbook(file));
      state.reference.meta.source = file.name;
      if (elements.referenceMeta) elements.referenceMeta.textContent = `${state.reference.entries.length.toLocaleString("pt-BR")} TAGs · ${file.name}`;
      toast("Base de TAGs atualizada.", "success");
      updateTextCount();
    } catch (error) {
      toast(error.message || "Não foi possível ler a base de TAGs.", "error");
    }
  });

  elements.listInput && elements.listInput.addEventListener("change", async () => {
    const file = elements.listInput.files && elements.listInput.files[0];
    if (!file) return;
    try {
      state.listEntries = parseListWorkbook(await readWorkbook(file));
      if (elements.listMeta) elements.listMeta.textContent = `${state.listEntries.length.toLocaleString("pt-BR")} itens · ${file.name}`;
      updateTextCount();
    } catch (error) {
      state.listEntries = [];
      toast(error.message || "Não foi possível ler a lista.", "error");
    }
  });

  elements.text && elements.text.addEventListener("input", updateTextCount);
  elements.clear && elements.clear.addEventListener("click", () => {
    if (elements.text) elements.text.value = "";
    state.listEntries = [];
    if (elements.listInput) elements.listInput.value = "";
    if (elements.listMeta) elements.listMeta.textContent = "Excel ou CSV opcional";
    updateTextCount();
  });
  elements.analyze && elements.analyze.addEventListener("click", async () => {
    const entries = [...linesFromText(elements.text && elements.text.value), ...state.listEntries];
    elements.analyze.disabled = true;
    try {
      state.result = window.RECONCompute ? await window.RECONCompute.run("tags", "tag-analyze", { values: entries, index: state.reference }) : Core.analyze(entries, state.reference);
      if (pager) pager.reset();
      state.columnFilters = {};
      if (elements.filters) elements.filters.querySelectorAll("input").forEach((input) => { input.value = ""; });
      if (elements.results) elements.results.hidden = false;
      render();
      toast(`${state.result.total.toLocaleString("pt-BR")} documentos conferidos.`, "success");
    } catch (error) {
      toast(error.name === "AbortError" ? "Conferência cancelada." : (error.message || "Não foi possível conferir as TAGs."), error.name === "AbortError" ? "warn" : "error");
    } finally { elements.analyze.disabled = false; }
  });
  elements.search && elements.search.addEventListener("input", () => { saveFilters(); if (pager) pager.reset(); render(); });
  elements.status && elements.status.addEventListener("change", () => { saveFilters(); if (pager) pager.reset(); render(); });
  elements.clearFilters && elements.clearFilters.addEventListener("click", () => {
    state.columnFilters = {};
    if (elements.search) elements.search.value = "";
    if (elements.status) elements.status.value = "all";
    if (elements.filters) elements.filters.querySelectorAll("input").forEach((input) => { input.value = ""; });
    try { localStorage.removeItem(FILTER_KEY); } catch (_) {}
    render();
  });
  elements.copy && elements.copy.addEventListener("click", copyCorrected);
  elements.export && elements.export.addEventListener("click", exportReport);

  if (elements.referenceMeta) elements.referenceMeta.textContent = `${state.reference.entries.length.toLocaleString("pt-BR")} TAGs incorporadas · Rev. ${state.reference.meta.revision || "B"}`;
  const savedFilters = readFilters();
  if (elements.search) elements.search.value = String(savedFilters.search || "");
  if (elements.status && [...elements.status.options].some((option) => option.value === savedFilters.status)) elements.status.value = savedFilters.status || "all";
  render();
  updateTextCount();
  window.RECONTagConference = { state, analyze: Core.analyze };
})();
