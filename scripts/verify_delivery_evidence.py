"""Compare actual export scene pairs and the frozen render source manifest."""
from pathlib import Path
import hashlib,json,re,zipfile
from PIL import Image,ImageChops,ImageStat
project=Path(__file__).resolve().parents[1]
output=project/'renders/final/delivery-20261027T135048Z-7b7800f3'
run=project.parents[1]/'Tools/KaggleHyperframes/runs/kelpie-feature-master-20261027-20261027T131933Z-4402a885/run.json'
state=json.loads(run.read_text(encoding='utf-8-sig'))
manifest=state.get('configuration',state.get('config',{})).get('source_files')
if manifest is None:
    result=json.loads((project/'renders/kaggle-master-a-v11/hyperframes-production/result.json').read_text())
    manifest=result['configuration']['source_files']
checked=[]
metadata_only=[]
for item in manifest:
    file=project/item['path']
    h=hashlib.sha256()
    with file.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    if h.hexdigest()!=item['sha256']:
        if item['path']!='index.html':raise ValueError('Current film differs from frozen render source: '+item['path'])
        with zipfile.ZipFile(run.parent/'input/film.zip') as z: original=z.read('index.html').decode('utf-8-sig')
        current=file.read_text(encoding='utf-8-sig')
        normalize=lambda x:re.sub(r'\sdata-hf-id="[^"]+"','',x).replace('\r\n','\n').replace('\r','\n')
        if normalize(original)!=normalize(current):raise ValueError('Current HTML contains creative/source changes beyond preview metadata')
        metadata_only.append({'path':'index.html','change':'HyperFrames preview inserted data-hf-id attributes and normalized line endings; all other text matches the frozen source'})
    checked.append(item['path'])
pairs=[]
for i in range(1,21):
    images=[]
    for j in [1,2]:
        with Image.open(output/f'frames/scene-{i:02d}-sample-{j}.png') as image:
            if image.size!=(3840,2160):raise ValueError('Non-native export frame')
            images.append(image.convert('RGB').resize((320,180)))
    diff=ImageChops.difference(*images)
    mean=sum(ImageStat.Stat(diff).mean)/3
    if mean<=.1:raise ValueError('Export pair appears frozen: '+str(i))
    pairs.append({'scene':i,'sample_seconds':[3,11],'mean_absolute_rgb_delta_at_320x180':round(mean,4)})
receipt={'status':'passed','native_export_pairs':pairs,'frozen_render_source_files_matched':len(checked),
         'reviewed_metadata_only_differences':metadata_only,
         'note':'Pixel differences support the reviewed camera/geometry movement; parent inspected all40frames as a contact sheet and representative native exports.'}
(project/'evidence/EXPORTED_MOTION_AND_SOURCE.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps({'status':'passed','scene_pairs':len(pairs),'source_files':len(checked),'minimum_pair_delta':min(x['mean_absolute_rgb_delta_at_320x180'] for x in pairs)}))
