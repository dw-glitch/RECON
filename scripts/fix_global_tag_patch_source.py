from pathlib import Path

path = Path("scripts/apply_global_tag_title_index.py")
source = path.read_text(encoding="utf-8")
old = '''    const lookupTag = tagEvidence && tagEvidence.tag
      || group7 && group7.validTag && group7.tag
      || extractTagFromDocument(record && record.document)
      || tagEvidence && tagEvidence.possibleTag
      || "";'''
new = '''    const normalizedGroupLookup = sconEscopoLookupTag(record, tagEvidence);
    const groupIdentifierWithoutNt = group7 && (group7.lookupIdentifier || cleanSpaces(group7.identifier).replace(/^NT[-./_]+/i, "")) || "";
    const lookupTag = tagEvidence && tagEvidence.tag
      || group7 && group7.validTag && group7.tag
      || normalizedGroupLookup && normalizedGroupLookup.tag
      || groupIdentifierWithoutNt
      || extractTagFromDocument(record && record.document)
      || tagEvidence && tagEvidence.possibleTag
      || "";'''
if source.count(old) != 1:
    raise RuntimeError(f"bloco de lookup esperado uma vez, encontrado {source.count(old)}")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("nt- lookup patch source fixed")
