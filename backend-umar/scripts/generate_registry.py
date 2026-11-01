#!/usr/bin/env python3
"""Generate metadata only; never changes native packs or promotes review status."""
import hashlib, json, pathlib, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
PIN='815e30f0da284b9818fadc0143f4da92544384d3'
def source(path):
    return subprocess.check_output(['git','-C',str(ROOT),'show',f'{PIN}:{path}'])
paths=subprocess.check_output(['git','-C',str(ROOT),'ls-tree','-r','--name-only',PIN],text=True).splitlines()
packs=[]
for path in sorted(p for p in paths if p.startswith('android/content/src/main/assets/packs/') and p.endswith('/v1.json')):
    raw=source(path); data=json.loads(raw); meta=data['meta']; track=meta['track']
    rulepath=f'android/content/src/main/assets/config/rules.{track}.json'
    rules=source(rulepath)
    items={i['item_id']:{'type':i['type'],'unit':i['unit'],'pool':i['pool'],'review_status':i['review_status']} for i in data['items']}
    assert len(items)==len(data['items']), 'duplicate item ids'
    packs.append({'track':track,'content_version':meta['content_version'],'subject':meta['subject'],'audiences':meta['audiences'],'instruction_langs':meta['instruction_langs'],'synthetic':data.get('synthetic',False),'sha256':hashlib.sha256(raw).hexdigest(),'source_path':path,'rules_sha256':hashlib.sha256(rules).hexdigest(),'rules_path':rulepath,'rules_version':json.loads(rules)['rules_version'],'items':items})
output=ROOT/'backend-umar/internal/catalog/registry.json'
output.write_text(json.dumps({'source_commit':PIN,'packs':packs},ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n')
print(f'{len(packs)} packs; {sum(len(p["items"]) for p in packs)} items; source {PIN}')
