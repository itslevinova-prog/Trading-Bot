import json,decimal,hashlib
from pathlib import Path
from datetime import datetime,timezone
D=decimal.Decimal;decimal.getcontext().prec=80
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/calendar-weighted-training-latest.json');r=read(pointer['path']);corpus=read(r['trainingCorpus']['path']);known=[x for x in corpus['observations'] if x['outcome']['netReturn'] is not None];model=r['weightedModel']['ridge'];at=model['trainedAt'];groups={}
for row in known:
 assert row['labelEnd']<at
 g=groups.setdefault(row['decisionAt'],{'labelEnd':0,'rows':0});g['rows']+=1;g['labelEnd']=max(g['labelEnd'],row['labelEnd'])
assert len(groups)==424
for g in groups.values():g['decay']=D(2)**(-D(at-g['labelEnd'])/(D(86400000)*30))
total=sum(g['decay'] for g in groups.values());normalizer=D(len(known))/total
weights=[normalizer*groups[x['decisionAt']]['decay']/groups[x['decisionAt']]['rows'] for x in known];error=max(abs(w-D(str(saved))) for w,saved in zip(weights,r['weighting']['weights']));assert error<D('1e-11');assert abs(sum(weights)-D(len(known)))<D('1e-70')
xs=[[D(str(v)) for v in row['x']] for row in known];ys=[D(str(row['outcome']['netReturn'])) for row in known];mass=sum(weights);means=[sum(w*x[j] for w,x in zip(weights,xs))/mass for j in range(8)];stds=[(sum(w*(x[j]-means[j])**2 for w,x in zip(weights,xs))/mass).sqrt() or D(1) for j in range(8)];intercept=sum(w*y for w,y in zip(weights,ys))/mass
matrix=[[D(10) if i==j else D(0) for j in range(9)] for i in range(8)]
for x,y,w in zip(xs,ys,weights):
 z=[(x[j]-means[j])/stds[j] for j in range(8)]
 for i in range(8):
  for j in range(8):matrix[i][j]+=w*z[i]*z[j]
  matrix[i][8]+=w*z[i]*(y-intercept)
for col in range(8):
 pivot=max(range(col,8),key=lambda j:abs(matrix[j][col]));matrix[col],matrix[pivot]=matrix[pivot],matrix[col];div=matrix[col][col];assert div
 for k in range(col,9):matrix[col][k]/=div
 for j in range(8):
  if j==col:continue
  factor=matrix[j][col]
  for k in range(col,9):matrix[j][k]-=factor*matrix[col][k]
values={'means':means,'stds':stds,'weights':[matrix[j][8] for j in range(8)],'intercept':[intercept]};errors={}
for key,array in values.items():
 saved=model[key] if key!='intercept' else [model[key]];errors[key]=max(abs(v-D(str(s))) for v,s in zip(array,saved));assert errors[key]<D('1e-9')
proof={'version':'calendar-weighted-fit-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'report':pointer,'reportFileSha256':sha(pointer['path']),'verifierSha256':sha(__file__),'knownRows':len(known),'sharedClocks':424,'rowWeightsChecked':len(weights),'calendarWeightMaxError':str(error),'parameterMaxErrors':{k:str(v) for k,v in errors.items()},'precisionDigits':80,'mayLabelsRead':False,'economicEvaluationPerformed':False,'profitabilityEstablished':False,'scope':'Independent clockgrouprecency/unequalassetcountnormalization andweightedscaling/mean/lambda10normal equations. Training numerical witness only; no future predictive advantage or sample independence inferred.'}
out='docs/calendar-weighted-fit-independent-'+hashlib.sha256(json.dumps(proof,sort_keys=True).encode()).hexdigest()[:16]+'.json';Path(out).write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');Path('docs/calendar-weighted-fit-independent-latest.json').write_text(json.dumps({'path':out,'sha256':sha(out)},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'weightsVerified':len(weights),'maxWeightError':str(error),'parameterErrors':proof['parameterMaxErrors']}))
