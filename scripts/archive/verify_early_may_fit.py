import json,decimal,hashlib
from pathlib import Path
from datetime import datetime,timezone
D=decimal.Decimal;decimal.getcontext().prec=80
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/early-may-frozen-models-latest.json');report=read(pointer['path']);corpus=read(report['trainingCorpus']['path']);model=report['models']['ridge']['ridge'];known=[r for r in corpus['observations'] if r['outcome']['netReturn'] is not None];assert len(known)==8479 and all(r['labelEnd']<model['trainedAt'] for r in known)
xs=[[D(str(v)) for v in r['x']] for r in known];ys=[D(str(r['outcome']['netReturn'])) for r in known];n=D(len(xs));means=[sum(x[j] for x in xs)/n for j in range(8)];stds=[(sum((x[j]-means[j])**2 for x in xs)/n).sqrt() or D(1) for j in range(8)];intercept=sum(ys)/n
matrix=[[D(10) if i==j else D(0) for j in range(9)] for i in range(8)]
for x,y in zip(xs,ys):
    z=[(x[j]-means[j])/stds[j] for j in range(8)]
    for i in range(8):
        for j in range(8):matrix[i][j]+=z[i]*z[j]
        matrix[i][8]+=z[i]*(y-intercept)
for col in range(8):
    pivot=max(range(col,8),key=lambda j:abs(matrix[j][col]));matrix[col],matrix[pivot]=matrix[pivot],matrix[col];div=matrix[col][col];assert div
    for k in range(col,9):matrix[col][k]/=div
    for j in range(8):
        if j==col:continue
        factor=matrix[j][col]
        for k in range(col,9):matrix[j][k]-=factor*matrix[col][k]
weights=[matrix[j][8] for j in range(8)];errors={}
for name,values in [('means',means),('stds',stds),('weights',weights)]:
    errors[name]=max(abs(v-D(str(m))) for v,m in zip(values,model[name]));assert errors[name]<D('1e-9')
errors['intercept']=abs(intercept-D(str(model['intercept'])));assert errors['intercept']<D('1e-12') and abs(intercept-D(str(report['models']['trainingMean']['value'])))<D('1e-12')
facts={'version':'early-may-fit-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'report':pointer,'reportFileSha256':sha(pointer['path']),'verifierSha256':sha(__file__),'trainingRows':len(known),'ambiguousRowsExcluded':len(corpus['observations'])-len(known),'sharedClocks':424,'parametersReconstructed':25,'precisionDigits':80,'maxAbsoluteErrors':{k:str(v) for k,v in errors.items()},'mayFeaturesOrLabelsRead':False,'activeModelChanged':False,'profitabilityEstablished':False,'scope':'Independent population scaling,mean target,8x8lambda10normal equations and partial-pivot solution reconstructed from strictly mature training rows. In-sample parameter agreement is not prediction validation or trading performance.'}
out='docs/early-may-fit-independent-'+hashlib.sha256(json.dumps(facts,sort_keys=True).encode()).hexdigest()[:16]+'.json';Path(out).write_text(json.dumps(facts,indent=2)+'\n',encoding='utf-8');Path('docs/early-may-fit-independent-latest.json').write_text(json.dumps({'path':out,'sha256':sha(out)},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'trainingRows':len(known),'maxAbsoluteErrors':facts['maxAbsoluteErrors']}))
