from pathlib import Path

path = Path("audit_core.js")
source = path.read_text(encoding="utf-8")
old = '''                : globalTagUsed
                  ? globalTagReference && globalTagReference.primarySource === "SCON ESCOPO"
                    ? "SCON ESCOPO · busca global pela mesma TAG"
                    : globalTagReference && globalTagReference.primarySource === "SCON TAG SGP"
                      ? "SCON TAG SGP · busca global pela mesma TAG"
                      : globalTagReference && globalTagReference.primarySource === "Apêndice 3 Rev.B"
                        ? "Apêndice 3 Rev.B · busca global pela mesma TAG"
                        : globalTagReference && globalTagReference.sourceLabel
                          ? `Busca global por TAG · ${globalTagReference.sourceLabel}`
                          : "Busca global por TAG"
                : externalTagDrivesDescription'''
new = '''                : globalTagUsed
                  ? globalTagReference && globalTagReference.primarySource === "SCON ESCOPO"
                    ? "SCON ESCOPO · busca global pela mesma TAG"
                    : `Busca global por TAG · ${globalTagReference && globalTagReference.sourceLabel || "fonte compatível"}`
                : externalTagDrivesDescription'''
if source.count(old) != 1:
    raise RuntimeError(f"bloco global longo esperado uma vez, encontrado {source.count(old)}")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("global description source compacted")
