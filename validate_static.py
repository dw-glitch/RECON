from pathlib import Path
import re, sys
html=Path('index.html').read_text(encoding='utf-8')
ids=re.findall(r'\bid=["\']([^"\']+)',html)
dup=sorted({x for x in ids if ids.count(x)>1})
refs=[]
refs+=re.findall(r'<script[^>]+src=["\']([^"\']+)',html,re.I)
refs+=re.findall(r'<link[^>]+href=["\']([^"\']+)',html,re.I)
refs+=re.findall(r'<img[^>]+src=["\']([^"\']+)',html,re.I)
missing=[]
for ref in refs:
 ref=ref.split('?',1)[0]
 if re.match(r'^(?:https?:|data:|#)',ref): continue
 if not Path(ref).exists(): missing.append(ref)
if dup or missing:
 print({'duplicate_ids':dup,'missing_references':sorted(set(missing))})
 sys.exit(1)
print({'ids':len(ids),'missing_references':0})
