from pathlib import Path

path = Path("audit_core.js")
source = path.read_text(encoding="utf-8")

old_reason = '''            : externalTagDrivesDescription
              ? sconEscopoInDescription && appendixInDescription
                ? "As descrições localizadas no SCON ESCOPO e no Apêndice 3 Rev.B não aparecem no título atual"
                : sconEscopoInDescription
                  ? "A descrição localizada no SCON ESCOPO não aparece no título atual"
                  : "A descrição localizada no Apêndice 3 Rev.B não aparece no título atual"
            : "A descrição validada não aparece no título";'''
new_reason = '''            : globalTagUsed
              ? `A descrição localizada pela busca global da TAG${globalTagReference && globalTagReference.sourceLabel ? ` (${globalTagReference.sourceLabel})` : ""} não aparece no título atual`
            : externalTagDrivesDescription
              ? sconEscopoInDescription && appendixInDescription
                ? "As descrições localizadas no SCON ESCOPO e no Apêndice 3 Rev.B não aparecem no título atual"
                : sconEscopoInDescription
                  ? "A descrição localizada no SCON ESCOPO não aparece no título atual"
                  : "A descrição localizada no Apêndice 3 Rev.B não aparece no título atual"
            : "A descrição validada não aparece no título";'''
if source.count(old_reason) != 1:
    raise RuntimeError(f"reason global esperado uma vez, encontrado {source.count(old_reason)}")
source = source.replace(old_reason, new_reason, 1)

old_source = '''                ? "Complementar da LD"
                : externalTagDrivesDescription
                  ? sconEscopoInDescription && appendixInDescription
                    ? "SCON ESCOPO + Apêndice 3 Rev.B"
                    : sconEscopoInDescription
                      ? sconEscopoReference && sconEscopoReference.tagFallback
                        ? "SCON ESCOPO · EAP + atividade documental"
                        : sconEscopoReference && sconEscopoReference.eapFallback
                          ? "SCON ESCOPO · mesma TAG em outro EAP"
                          : sconEscopoReference && sconEscopoReference.exactTag
                            ? "SCON ESCOPO · TAG + EAP"
                            : "SCON ESCOPO · busca progressiva"
                      : "Apêndice 3 Rev.B · TAG do equipamento"
                  : explicitDescription ? "Descrição da LD" : explicitScon ? "SCON da LD" : manualValve ? "Regra mínima da TAG VM · VÁLVULA MANUAL" : sconEscopoLastResortUsed ? "SCON ESCOPO · último recurso" : "Título atual",'''
new_source = '''                ? "Complementar da LD"
                : globalTagUsed
                  ? globalTagReference && globalTagReference.primarySource === "SCON ESCOPO"
                    ? "SCON ESCOPO · busca global pela mesma TAG"
                    : globalTagReference && globalTagReference.primarySource === "SCON TAG SGP"
                      ? "SCON TAG SGP · busca global pela mesma TAG"
                      : globalTagReference && globalTagReference.primarySource === "Apêndice 3 Rev.B"
                        ? "Apêndice 3 Rev.B · busca global pela mesma TAG"
                        : globalTagReference && globalTagReference.sourceLabel
                          ? `Busca global por TAG · ${globalTagReference.sourceLabel}`
                          : "Busca global por TAG"
                : externalTagDrivesDescription
                  ? sconEscopoInDescription && appendixInDescription
                    ? "SCON ESCOPO + Apêndice 3 Rev.B"
                    : sconEscopoInDescription
                      ? sconEscopoReference && sconEscopoReference.tagFallback
                        ? "SCON ESCOPO · EAP + atividade documental"
                        : sconEscopoReference && sconEscopoReference.eapFallback
                          ? "SCON ESCOPO · mesma TAG em outro EAP"
                          : sconEscopoReference && sconEscopoReference.exactTag
                            ? "SCON ESCOPO · TAG + EAP"
                            : "SCON ESCOPO · busca progressiva"
                      : "Apêndice 3 Rev.B · TAG do equipamento"
                  : explicitDescription ? "Descrição da LD" : explicitScon ? "SCON da LD" : manualValve ? "Regra mínima da TAG VM · VÁLVULA MANUAL" : sconEscopoLastResortUsed ? "SCON ESCOPO · último recurso" : "Título atual",'''
if source.count(old_source) != 1:
    raise RuntimeError(f"description source global esperado uma vez, encontrado {source.count(old_source)}")
source = source.replace(old_source, new_source, 1)

path.write_text(source, encoding="utf-8")
print("global description source fixed")
