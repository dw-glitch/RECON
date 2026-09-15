from pathlib import Path

path = Path("scripts/apply_global_tag_title_index.py")
source = path.read_text(encoding="utf-8")
old = '''    const matches = G.lookup(globalIndex, lookupTag);
    const selected = G.select(matches, {
      discipline: record && record.discipline || "",
      eap: documentEapFromGroup4(record && record.document),
      documentKey: record && record.documentKey || "",
    });
    const matchedTags = [...new Map(matches.map((item) => [G.normalizeTag(item.tag), item.tag]).filter(([key]) => key)).values()];'''
new = '''    const resolvedLookup = G.lookupCandidate(globalIndex, lookupTag);
    const matches = resolvedLookup.matches;
    const selected = G.select(matches, {
      discipline: record && record.discipline || "",
      eap: documentEapFromGroup4(record && record.document),
      documentKey: record && record.documentKey || "",
    });
    const matchedTags = [...new Map(matches.map((item) => [G.normalizeTag(item.tag), item.tag]).filter(([key]) => key)).values()];'''
if source.count(old) != 1:
    raise RuntimeError(f"bloco de busca global esperado uma vez, encontrado {source.count(old)}")
source = source.replace(old, new, 1)
old2 = '      lookupTag: G.normalizeTag(lookupTag),'
new2 = '      lookupTag: resolvedLookup.lookupTag || G.normalizeTag(lookupTag),'
if source.count(old2) != 1:
    raise RuntimeError(f"lookupTag de saída esperado uma vez, encontrado {source.count(old2)}")
source = source.replace(old2, new2, 1)
path.write_text(source, encoding="utf-8")
print("candidate lookup patch source fixed")
