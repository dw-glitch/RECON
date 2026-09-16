(function (root) {
  "use strict";

  const PDFJS_VERSION = "3.11.174";
  const WORKER_CANDIDATES = Object.freeze([
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`,
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`,
  ]);

  let activeWorker = "";

  function pdfjs() { return root.pdfjsLib || root.PDFJS || null; }

  function localWorker() {
    const offline = root.RECONOfflineResources;
    if (!offline || typeof offline.has !== "function" || typeof offline.objectUrl !== "function") return "";
    try {
      return offline.has("pdf.worker.min.js") ? offline.objectUrl("pdf.worker.min.js") : "";
    } catch (_) { return ""; }
  }

  function setWorker(src) {
    const lib = pdfjs();
    if (!lib || !lib.GlobalWorkerOptions) return "";
    const chosen = src || localWorker() || WORKER_CANDIDATES[0];
    lib.GlobalWorkerOptions.workerSrc = chosen;
    activeWorker = chosen;
    return chosen;
  }

  function candidates() {
    const local = localWorker();
    return [...new Set([local, ...WORKER_CANDIDATES].filter(Boolean))];
  }

  function status() {
    return {
      pdfjsVersion: pdfjs() && pdfjs().version || "",
      expectedVersion: PDFJS_VERSION,
      activeWorker: activeWorker || pdfjs() && pdfjs().GlobalWorkerOptions && pdfjs().GlobalWorkerOptions.workerSrc || "",
      localWorkerAvailable: Boolean(localWorker()),
      candidates: candidates(),
    };
  }

  // O chunk offline existente nas versões anteriores estava vazio, fazendo o
  // PDF.js procurar /pdf.worker.min.js e receber 503 do Service Worker. O runtime
  // passa a apontar explicitamente para um worker da MESMA versão da biblioteca
  // (3.11.174) e o fluxo de análise possui retry entre provedores.
  setWorker();

  root.RECONDocumentCodingPDFRuntime = Object.freeze({
    PDFJS_VERSION,
    WORKER_CANDIDATES,
    setWorker,
    candidates,
    status,
  });
})(window);
