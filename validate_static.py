#!/usr/bin/env python3
"""Static checks for RECON: unique element IDs in index.html, and JS lookups
by literal ID that resolve to a real element (static HTML or JS-assigned).

Deliberately conservative: only literal-string id lookups are checked
(getElementById("...") and querySelector[All]("#literal-id")). Computed or
concatenated ids (e.g. getElementById(prefix + "-progress")) are skipped
rather than guessed at, to avoid false positives. The "$" helper is not
checked at all: it means document.getElementById in recon_enhancements.js
but document.querySelector(selector) in every other module file, so a
single pattern for it would misreport real code as broken.
"""
import re
import sys
from pathlib import Path

# O script fica na raiz do repositório, ao lado de index.html e dos .js.
# parents[2] apontava para dois diretórios acima, e a verificação abortava com
# "index.html não encontrado" antes de conferir qualquer coisa.
ROOT = Path(__file__).resolve().parent
HTML_FILE = ROOT / "index.html"

HTML_ID_RE = re.compile(r'\bid\s*=\s*["\']([^"\']+)["\']')
JS_ID_ASSIGN_RE = re.compile(r'\.id\s*=\s*["\']([^"\']+)["\']')
JS_SET_ATTR_ID_RE = re.compile(r'setAttribute\(\s*["\']id["\']\s*,\s*["\']([^"\']+)["\']\s*\)')

GET_BY_ID_RE = re.compile(r'getElementById\(\s*["\']([^"\']+)["\']\s*\)')
QUERY_ID_RE = re.compile(r'querySelector(?:All)?\(\s*["\']#([A-Za-z][\w-]*)["\']\s*\)')


def js_files():
    return sorted(p for p in ROOT.glob("*.js") if p.is_file())


def line_of(text, index):
    return text.count("\n", 0, index) + 1


def collect_html_ids():
    html = HTML_FILE.read_text(encoding="utf-8")
    ids = []
    for match in HTML_ID_RE.finditer(html):
        ids.append(match.group(1))
    return ids


def collect_js_declared_ids():
    declared = set()
    for js_file in js_files():
        text = js_file.read_text(encoding="utf-8", errors="ignore")
        # .id = "...", setAttribute("id", "...") for elements built with createElement,
        # plus id="..." embedded in innerHTML/insertAdjacentHTML markup strings.
        for pattern in (JS_ID_ASSIGN_RE, JS_SET_ATTR_ID_RE, HTML_ID_RE):
            for match in pattern.finditer(text):
                declared.add(match.group(1))
    return declared


def find_duplicates(html_ids):
    counts = {}
    for value in html_ids:
        counts[value] = counts.get(value, 0) + 1
    return sorted((value, count) for value, count in counts.items() if count > 1)


def find_broken_references(declared_ids):
    broken = []
    for js_file in js_files():
        text = js_file.read_text(encoding="utf-8", errors="ignore")
        for pattern, label in ((GET_BY_ID_RE, "getElementById"), (QUERY_ID_RE, "querySelector")):
            for match in pattern.finditer(text):
                ref_id = match.group(1)
                if ref_id not in declared_ids:
                    broken.append((js_file.name, line_of(text, match.start()), label, ref_id))
    return broken


def main():
    if not HTML_FILE.exists():
        print(f"ERRO: {HTML_FILE} não encontrado.")
        return 1

    html_ids = collect_html_ids()
    declared_ids = set(html_ids) | collect_js_declared_ids()
    duplicates = find_duplicates(html_ids)
    broken = find_broken_references(declared_ids)

    print(f"IDs únicos declarados (index.html + atribuições .id/setAttribute em JS): {len(declared_ids)}")
    print(f"IDs duplicados em index.html: {len(duplicates)}")
    for value, count in duplicates:
        print(f'  - id="{value}" aparece {count} vezes')
    print(f"Referências a IDs literais sem declaração correspondente: {len(broken)}")
    for file_name, line_no, label, ref_id in broken:
        print(f'  - {file_name}:{line_no} {label}("{ref_id}") -> nenhum elemento com esse id foi encontrado')

    if duplicates or broken:
        print("\nFALHA: corrija os itens acima.")
        return 1

    print("\nOK: nenhum ID duplicado e nenhuma referência quebrada encontrada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
