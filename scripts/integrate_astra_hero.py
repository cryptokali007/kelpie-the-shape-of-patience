from pathlib import Path
import json,hashlib,re,shutil
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parents[1]/'Research/KelpieRecovery-2026-10-27/hero-20261027T124114Z/download'
hero=next(SOURCE.rglob('astra-hero.js'));code=hero.read_text(encoding='utf-8')
assert 'export function createHero(THREE)' in code
assert not re.search(r'\b(?:eval|fetch)\s*\(|new\s+Function|https?://|\bMath\.random\s*\(',code)
shutil.copyfile(hero,ROOT/'assets/astra-hero.js')
p=ROOT/'film.js';s=p.read_text()
s=s.replace('heroFactory({THREE,materials:mats})','heroFactory(THREE)')
s=s.replace('mode:current.mode,transition:current.transition','mode:current.mode,mood:current.mood,transition:current.transition')
old='if(heroIntegration?.api?.draw)heroIntegration.api.draw(t,{mode,shot,bands,camera,group:heroIntegration.main,finaleGroup:heroIntegration.finale});'
new="""if(heroIntegration?.api?.draw){heroIntegration.api.draw(t,bands);heroIntegration.main.visible=mode==='water'||mode==='finale';heroIntegration.finale.visible=false;const anchor=mode==='finale'?horseCopy:horse;heroIntegration.main.position.copy(anchor.position);heroIntegration.main.rotation.copy(anchor.rotation);heroIntegration.main.scale.copy(anchor.scale);if(mode==='finale')heroIntegration.main.scale.multiplyScalar(1.5);}"""
assert old in s;s=s.replace(old,new);p.write_text(s)
p=ROOT/'index.html';s=p.read_text()
s=s.replace('clamp((Number(seconds)||0)+segmentOffset,0,300)','clamp(Number(seconds)||0,0,300)')
s=s.replace('window.__drawFilm(timeline.time())','window.__drawFilm(segmentOffset+timeline.time())')
s=s.replace('window.__drawFilm(Number(root.dataset.timeOffset)||0);','window.__drawFilm(segmentOffset);')
p.write_text(s)
p=ROOT/'assets/film-manifest.json';j=json.loads(p.read_text());j['hero']['enabled']=True;p.write_text(json.dumps(j,indent=2))
(ROOT/'evidence/ASTRA_HERO_INTEGRATION.json').write_text(json.dumps({'model':'openai/gpt-6-astra','reasoning':'xhigh','run_id':'5537989','source_sha256':hashlib.sha256(hero.read_bytes()).hexdigest(),'module_unchanged':hashlib.sha256((ROOT/'assets/astra-hero.js').read_bytes()).hexdigest()==hashlib.sha256(hero.read_bytes()).hexdigest(),'parent_adapter_changes':['Namespacefactorycall','Passmeasuredaudiobandsdirectly','Useoneanimatedheroinfinale','Exposescenemoodforcontrast','AbsoluteseekAPIwithsegmentoffsetonlyintimeline']},indent=2))
print('Integrated actual Astra geometry source; original module retained unchanged.')
