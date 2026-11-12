"""Mechanical platform-import adaptation of the actual Android core. No algorithm fork.
Generated files and SHA256 manifest remain build artifacts; Android originals are read-only inputs.
"""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parents[1]/'build/generated/shared'
closure={
'model':['AnswerEvent','Scoring','Curriculum','ItemType','Lang','LocalizedText'],
'content':['ContentSchema','PackMeta','PackLoader','Gating','Story'],
'engine':['Scoring','RuleConfig','Session','Freshness','ReviewScheduler','Dates','SkillProjector','Rng'],
}
adapters={
'import java.text.Normalizer':'import id.petalytix.ayailmu.bridge.platform.Normalizer',
'import java.time.Instant':'import id.petalytix.ayailmu.bridge.platform.Instant',
'import java.time.ZoneId':'import id.petalytix.ayailmu.bridge.platform.ZoneId',
'import java.time.LocalDate':'import id.petalytix.ayailmu.bridge.platform.LocalDate',
'import java.time.temporal.ChronoUnit':'import id.petalytix.ayailmu.bridge.platform.ChronoUnit',
'java.util.UUID.randomUUID()':'id.petalytix.ayailmu.bridge.platform.randomUUID()',
'private val NON_WORD = Regex(':'private val NON_WORD = UnicodePattern(',
'import id.petalytix.ayailmu.core.content.AcceptedAnswers':'import id.petalytix.ayailmu.bridge.platform.UnicodePattern\nimport id.petalytix.ayailmu.bridge.platform.replace\nimport id.petalytix.ayailmu.core.content.AcceptedAnswers',
}
manifest=[]
for module,names in closure.items():
 for name in names:
  path=root/f'android/core/{module}/src/main/kotlin/id/petalytix/ayailmu/core/{module}/{name}.kt'
  original=path.read_bytes();text=original.decode();changes=[]
  for old,new in adapters.items():
   if old in text:
    assert text.count(old)==1,(path,old)
    text=text.replace(old,new);changes.append([old,new])
  assert 'import java.' not in text,(path,'Unadapted JVM seam')
  dest=out/f'id/petalytix/ayailmu/core/{module}/{name}.kt';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(text)
  manifest.append(dict(source=str(path.relative_to(root)),source_sha256=hashlib.sha256(original).hexdigest(),generated_sha256=hashlib.sha256(text.encode()).hexdigest(),replacements=changes))
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

fingerprint=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode())
for path in sorted((Path(__file__).resolve().parents[1]/'src').rglob('*.kt')):
 fingerprint.update(path.relative_to(Path(__file__).resolve().parents[1]).as_posix().encode())
 fingerprint.update(path.read_bytes())
bridge=out/'id/petalytix/ayailmu/bridge/SharedSourceFingerprint.kt';bridge.parent.mkdir(parents=True,exist_ok=True)
bridge.write_text('package id.petalytix.ayailmu.bridge\ninternal object SharedSourceFingerprint { const val value = "'+fingerprint.hexdigest()+'" }\n')
