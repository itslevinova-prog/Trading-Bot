"""Batch only the exact fixed local requests in a registered manifest. No network."""
import json,hashlib,importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('local_barrier_tree_fit',Path(__file__).with_name('fit-barrier-tree.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
fitter_hash=hashlib.sha256(Path(__file__).with_name('fit-barrier-tree.py').read_bytes()).hexdigest()
manifest=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
for item in manifest['requests']:
    source=Path(item['request']);data=source.read_bytes();input_hash=hashlib.sha256(data).hexdigest()
    if input_hash!=item['sha256']:raise ValueError('Request SHA mismatch')
    output=Path(item['output'])
    if output.exists():
        saved=json.loads(output.read_text())
        if saved['requestSha256']!=input_hash or saved['fitterSha256']!=fitter_hash:raise ValueError('Cache provenance mismatch')
        print(json.dumps(dict(fold=item['fold'],reused=True)),flush=True);continue
    result=module.fit_request(json.loads(data))
    result.update(requestSha256=input_hash,fitterSha256=fitter_hash)
    with output.open('x',encoding='utf-8') as stream:json.dump(result,stream,allow_nan=False,separators=(',',':'))
    print(json.dumps(dict(fold=item['fold'],knownLabels=result['modelBody']['knownLabels'],trees=len(result['modelBody']['trees']))),flush=True)
