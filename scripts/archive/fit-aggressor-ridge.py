"""One fixed8D/9D ridge comparison on identical available training rows. Local NumPy only."""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
import numpy as np
import json,math,sys,hashlib
from pathlib import Path
VERSION='historical-aggressor-ridge-v1'
def fit(request):
    if set(request)!={'version','dataScope','availabilityDomain','folds'} or request['version']!=VERSION or request['availabilityDomain']!='modeled-historical-bar-close-v1' or len(request['dataScope'])!=64:raise ValueError('Invalid source domain')
    results=[]
    def valid_x(x):return isinstance(x,list) and len(x)==9 and all(type(v) in (int,float) and math.isfinite(v) for v in x) and -1<=x[8]<=1
    for f in request['folds']:
        if set(f)!={'trainedAt','rows','queryX'} or type(f['trainedAt'])!=int or f['trainedAt']<0 or len(f['rows'])<200:raise ValueError('Invalid training scope')
        seen=set()
        for r in f['rows']:
            if set(r)!={'pair','decisionAt','labelEnd','x','y'} or not isinstance(r['pair'],str) or not r['pair'] or not valid_x(r['x']) or type(r['y']) not in (int,float) or not math.isfinite(r['y']):raise ValueError('Invalid row')
            if any(type(r[k])!=int or r[k]<0 for k in ('decisionAt','labelEnd')) or not r['decisionAt']<r['labelEnd']<f['trainedAt']:raise ValueError('Unavailable label')
            key=(r['pair'],r['decisionAt'])
            if key in seen:raise ValueError('Duplicate row')
            seen.add(key)
        if any(x is not None and not valid_x(x) for x in f['queryX']):raise ValueError('Invalid query')
        x=np.asarray([r['x'] for r in f['rows']],dtype=np.float64);y=np.asarray([r['y'] for r in f['rows']],dtype=np.float64);models={}
        for dim in (8,9):
            a=x[:,:dim];means=a.mean(axis=0);stds=a.std(axis=0);stds=np.where(stds==0,1,stds);z=(a-means)/stds;intercept=float(y.mean());weights=np.linalg.solve(z.T@z+10*np.eye(dim),z.T@(y-intercept))
            model=dict(version=VERSION,dimensions=dim,trainedAt=f['trainedAt'],lastLabelEnd=max(r['labelEnd'] for r in f['rows']),rows=len(y),lambda_=10,means=means.tolist(),stds=stds.tolist(),weights=weights.tolist(),intercept=intercept)
            predictions=[None if row is None else float(intercept+((np.asarray(row[:dim])-means)/stds)@weights) for row in f['queryX']]
            models[str(dim)]=dict(model=model,rawPredictions=predictions)
        results.append(models)
    return dict(version=VERSION,numpyVersion=np.__version__,folds=results)
if __name__=='__main__':
    src=Path(sys.argv[1]);result=fit(json.loads(src.read_text(encoding='utf-8-sig')));result.update(requestSha256=hashlib.sha256(src.read_bytes()).hexdigest(),fitterSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    with Path(sys.argv[2]).open('x',encoding='utf-8') as stream:json.dump(result,stream,allow_nan=False,separators=(',',':'))
