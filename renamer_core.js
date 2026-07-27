(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.RECONRenamerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INVALID_WINDOWS = /[\\/:*?"<>|\u0000-\u001f]/g;
  const RESERVED_WINDOWS = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
  const CERTIFICATE_LABEL = /(?:CERTIFICADO|CERTIFICATE|CERT\.?)(?:\s+(?:DE|DO|DA))?/i;

  function text(value) { return String(value == null ? "" : value).trim(); }
  function fileStem(filename) { return text(filename).replace(/\.[^.]+$/, ""); }
  function extension(filename) { const match = text(filename).match(/\.([^.]+)$/); return match ? `.${match[1].toLowerCase()}` : ""; }
  function escapeRegExp(value) { return text(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function normalizeSpaces(value) { return text(value).replace(/[\u00a0\t ]+/g, " ").replace(/\s*\n\s*/g, "\n"); }
  function compact(value) { return normalizeSpaces(value).replace(/\s+/g, " ").trim(); }

  function naturalCompare(a, b) {
    return text(a).localeCompare(text(b), "pt-BR", { numeric: true, sensitivity: "base" });
  }

  function longestCommonPrefix(values) {
    if (!values.length) return "";
    let prefix = values[0];
    for (let index = 1; index < values.length && prefix; index += 1) {
      while (prefix && !values[index].startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    return prefix;
  }

  function longestCommonSuffix(values, prefixLength) {
    if (!values.length) return "";
    const reversed = values.map((value) => [...value].reverse().join(""));
    let suffix = [...longestCommonPrefix(reversed)].reverse().join("");
    const maxLength = Math.max(0, Math.min(...values.map((value) => value.length)) - Number(prefixLength || 0));
    if (suffix.length > maxLength) suffix = suffix.slice(suffix.length - maxLength);
    return suffix;
  }

  function inferFilenamePattern(filenames) {
    const stems = (filenames || []).map(fileStem).filter(Boolean);
    if (!stems.length) return { prefix: "", suffix: "", variables: [], numeric: false, suggestion: "{original}" };
    if (stems.length === 1) return { prefix: stems[0], suffix: "", variables: [""], numeric: false, suggestion: "{original}" };
    let prefix = longestCommonPrefix(stems);
    let suffix = longestCommonSuffix(stems, prefix.length);
    let variables = stems.map((stem) => stem.slice(prefix.length, Math.max(prefix.length, stem.length - suffix.length)));
    let numeric = variables.every((value) => /^\D*\d+\D*$/.test(value));
    if (numeric && /\d+$/.test(prefix)) {
      const sharedDigits = prefix.match(/\d+$/)[0];
      prefix = prefix.slice(0, -sharedDigits.length);
      variables = variables.map((value) => `${sharedDigits}${value}`);
    }
    numeric = variables.every((value) => /^\d+$/.test(value));
    const cleanPrefix = prefix.replace(/[\s._-]+$/, "");
    const cleanSuffix = suffix.replace(/^[\s._-]+/, "");
    const separatorBefore = prefix.slice(cleanPrefix.length) || (cleanPrefix ? "_" : "");
    const separatorAfter = suffix.slice(0, suffix.length - cleanSuffix.length) || (cleanSuffix ? "_" : "");
    const token = numeric ? "{sequencia}" : "{certificado}";
    const suggestion = `${cleanPrefix}${separatorBefore}${token}${separatorAfter}${cleanSuffix}` || token;
    return { prefix, suffix, variables, numeric, suggestion };
  }

  function cleanCandidate(value) {
    let candidate = text(value).replace(/^[#:\-–—.\s]+|[;,.:\-–—\s]+$/g, "");
    candidate = candidate.replace(/^(?:N[º°O.]?|N[ÚU]MERO)\s*/i, "");
    if (!/[0-9]/.test(candidate) || candidate.length < 2 || candidate.length > 64) return "";
    if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(candidate)) return "";
    if (/^(?:P[ÁA]GINA|FOLHA|REV(?:IS[ÃA]O)?|DATA)$/i.test(candidate)) return "";
    return candidate;
  }

  function addCandidate(map, raw, score, page, reason) {
    const value = cleanCandidate(raw);
    if (!value) return;
    const key = value.toLocaleUpperCase("pt-BR");
    const previous = map.get(key);
    if (!previous || score > previous.score) map.set(key, { value, score, page, reason });
  }

  function extractCertificateCandidates(pages, customLabel) {
    const found = new Map();
    (pages || []).forEach((entry, pageIndex) => {
      const source = compact(entry && entry.text != null ? entry.text : entry);
      const page = Number(entry && entry.page) || pageIndex + 1;
      if (!source) return;

      const direct = /(?:CERTIFICADO|CERTIFICATE|CERT\.?)\s*(?:DE\s+)?(?:N[ÚU]MERO|N[º°O.]?)?\s*[:#\-–]?\s*([A-Z0-9][A-Z0-9./_-]{1,63})/gi;
      let match;
      while ((match = direct.exec(source))) addCandidate(found, match[1], 100, page, "Após o rótulo de certificado");

      const separated = /(?:CERTIFICADO|CERTIFICATE|CERT\.?).{0,45}?(?:N[ÚU]MERO|N[º°O.]?)\s*[:#\-–]?\s*([A-Z0-9][A-Z0-9./_-]{1,63})/gi;
      while ((match = separated.exec(source))) addCandidate(found, match[1], 92, page, "Próximo ao rótulo de certificado");

      if (text(customLabel)) {
        const custom = new RegExp(`${escapeRegExp(customLabel)}\\s*(?:N[ÚU]MERO|N[º°O.]?)?\\s*[:#\\-–]?\\s*([A-Z0-9][A-Z0-9./_-]{1,63})`, "gi");
        while ((match = custom.exec(source))) addCandidate(found, match[1], 110, page, `Após “${text(customLabel)}”`);
      }

      const lines = normalizeSpaces(entry && entry.text != null ? entry.text : entry).split(/\n+/).map(compact).filter(Boolean);
      lines.forEach((line, lineIndex) => {
        if (!CERTIFICATE_LABEL.test(line)) return;
        const sameLine = line.match(/(?:N[ÚU]MERO|N[º°O.]?)?\s*[:#\-–]?\s*([A-Z0-9][A-Z0-9./_-]{2,63})\s*$/i);
        if (sameLine) addCandidate(found, sameLine[1], 88, page, "Na linha do certificado");
        const nextLine = lines[lineIndex + 1];
        if (nextLine && /^[A-Z0-9][A-Z0-9./_-]{1,63}$/i.test(nextLine)) addCandidate(found, nextLine, 82, page, "Na linha seguinte ao certificado");
      });
    });

    const candidates = [...found.values()].sort((a, b) => b.score - a.score || naturalCompare(a.value, b.value));
    const first = candidates[0];
    const second = candidates[1];
    const confidence = !first ? "none" : first.score >= 100 && (!second || first.score - second.score >= 8) ? "high" : first.score >= 88 && (!second || first.value === second.value) ? "high" : "review";
    return { candidates, selected: first ? first.value : "", confidence, page: first ? first.page : 0 };
  }

  function pad(value, size) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.trunc(number)).padStart(Math.max(1, Number(size) || 1), "0") : text(value);
  }

  function sanitizeComponent(value) {
    return text(value).replace(INVALID_WINDOWS, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  }

  function formatTemplate(template, item, options) {
    const settings = options || {};
    const sequence = pad(item.sequence, settings.padding || 3);
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const values = {
      original: fileStem(item.originalName || item.name),
      certificado: item.certificate || "",
      sequencia: sequence,
      indice: String(Number(item.index || 0) + 1),
      data: date,
      pagina: item.page || "",
    };
    let name = text(template || "{original}").replace(/\{(original|certificado|sequencia|indice|data|pagina)\}/gi, (_, token) => values[token.toLowerCase()] || "");
    name = sanitizeComponent(name.replace(/(?:[ _.-]){2,}/g, (chunk) => chunk.includes("_") ? "_" : chunk.includes("-") ? "-" : " "));
    return `${name}${extension(item.originalName || item.name) || ".pdf"}`;
  }

  function validateFilename(filename) {
    const value = text(filename);
    const stem = fileStem(value);
    if (!stem) return { valid: false, code: "RENAME_EMPTY", message: "Informe o novo nome do arquivo." };
    if (!/\.pdf$/i.test(value)) return { valid: false, code: "RENAME_EXTENSION", message: "O novo nome precisa terminar em .pdf." };
    if (INVALID_WINDOWS.test(value)) { INVALID_WINDOWS.lastIndex = 0; return { valid: false, code: "RENAME_INVALID_CHARACTER", message: "O novo nome possui um caractere que o Windows não aceita." }; }
    INVALID_WINDOWS.lastIndex = 0;
    if (/[. ](?:\.[^.]+)?$/.test(value)) return { valid: false, code: "RENAME_TRAILING_DOT", message: "Retire o ponto ou espaço do final do nome." };
    if (RESERVED_WINDOWS.test(stem)) return { valid: false, code: "RENAME_RESERVED", message: "Este nome é reservado pelo Windows. Escolha outro nome." };
    if (value.length > 240) return { valid: false, code: "RENAME_TOO_LONG", message: "O novo nome está muito longo. Reduza o texto." };
    return { valid: true, code: "RENAME_READY", message: "Pronto para renomear." };
  }

  function validateBatch(items) {
    const names = new Map();
    (items || []).forEach((item) => {
      const key = text(item.finalName).toLocaleUpperCase("pt-BR");
      names.set(key, (names.get(key) || 0) + 1);
    });
    return (items || []).map((item) => {
      const base = validateFilename(item.finalName);
      const duplicate = names.get(text(item.finalName).toLocaleUpperCase("pt-BR")) > 1;
      const missingCertificate = /\{certificado\}/i.test(text(item.template)) && !text(item.certificate);
      const needsCertificate = /\{certificado\}/i.test(text(item.template));
      const needsReview = needsCertificate && (item.confidence === "review" || item.confidence === "none");
      const valid = base.valid && !duplicate && !missingCertificate;
      const code = !base.valid ? base.code : duplicate ? "RENAME_DUPLICATE" : missingCertificate ? "RENAME_CERTIFICATE_MISSING" : needsReview ? "RENAME_CERTIFICATE_REVIEW" : "RENAME_READY";
      const message = !base.valid ? base.message : duplicate ? "Dois arquivos ficariam com o mesmo nome. Ajuste um deles." : missingCertificate ? "O número do certificado não foi encontrado. Informe o número antes de continuar." : needsReview ? "Confira se o número identificado no PDF está correto." : "Pronto para renomear.";
      return { ...item, valid, needsReview, status: valid ? (needsReview ? "review" : "ready") : "blocked", code, message };
    });
  }

  return {
    text,
    fileStem,
    extension,
    naturalCompare,
    inferFilenamePattern,
    extractCertificateCandidates,
    formatTemplate,
    validateFilename,
    validateBatch,
    sanitizeComponent,
  };
});
