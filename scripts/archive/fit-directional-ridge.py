"""Fixed8D/10D local ridge ablation. NumPy numerical solve only; no service or model provider."""
import os
for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[name]='1'
import json,sys,math,hashlib
from pathlib import Path
import numpy as np
VERSION='directional-ridge-ablation-v1'
def fit(request):
    if set(request)!={'version','targetHash','folds'} or request['version']!=VERSION or len(request['targetHash'])!=64:raise ValueError('Invalid experiment contract')
    output=[]
    for f in request['folds']:
        if set(f)!={'trainedAt','rows','queryX'}:raise ValueError('Unexpected fold fields')
        at=f['trainedAt'];rows=f['rows'];seen=set()
        if type(at)!=int or at<0 or len(rows)<200:raise ValueError('Invalid training clock/count')
        for r in rows:
            if set(r)!={'pair','decisionAt','labelEnd','x','y'} or not isinstance(r['pair'],str) or not r['pair']:raise ValueError('Invalid row')
            if any(type(r[k])!=int or r[k]<0 for k in ('decisionAt','labelEnd')) or not r['decisionAt']<r['labelEnd']<at:raise ValueError('Unavailable training label')
            key=(r['pair'],r['decisionAt'])
            if key in seen:raise ValueError('Duplicate row')
            seen.add(key)
            if type(r['y']) not in (int,float) or not math.isfinite(r['y']):raise ValueError('Invalid target')
        def valid_x(v):return isinstance(v,list) and len(v)==10 and all(type(x) in (int,float) and math.isfinite(x) for x in v) and 0<=v[8]<=1 and -1<=v[9]<=1
        if any(not valid_x(r['x']) for r in rows) or any(not valid_x(x) for x in f['queryX']):raise ValueError('Invalid directional feature schema')
        x=np.asarray([r['x'] for r in rows],dtype=np.float64);y=np.asarray([r['y'] for r in rows],dtype=np.float64);q=np.asarray(f['queryX'],dtype=np.float64).reshape((-1,10))
        models={}
        for dim in (8,10):
            raw=x[:,:dim];means=raw.mean(axis=0);stds=raw.std(axis=0);stds=np.where(stds==0,1,stds);z=(raw-means)/stds;intercept=float(y.mean())
            weights=np.linalg.solve(z.T@z+10*np.eye(dim),z.T@(y-intercept))
            model=dict(version=VERSION,dimensions=dim,trainedAt=at,lastLabelEnd=max(r['labelEnd'] for r in rows),rows=len(rows),lambda_=10,means=means.tolist(),stds=stds.tolist(),weights=weights.tolist(),intercept=intercept)
            if not all(math.isfinite(v) for v in [*model['means'],*model['stds'],*model['weights'],intercept]):raise ValueError('Nonfinite model')
            models[str(dim)]=dict(model=model,rawPredictions=(intercept+((q[:,:dim]-means)/stds)@weights).tolist())
        output.append(models)
    return dict(version=VERSION,numpyVersion=np.__version__,folds=output)
if __name__=='__main__':
    source=Path(sys.argv[1]);result=fit(json.loads(source.read_text(encoding='utf-8-sig')));result.update(requestSha256=hashlib.sha256(source.read_bytes()).hexdigest(),fitterSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    with Path(sys.argv[2]).open('x',encoding='utf-8') as stream:json.dump(result,stream,allow_nan=False,separators=(',',':'))
