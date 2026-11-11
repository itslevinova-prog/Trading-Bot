"""Project-local numerical research only. No network, broker, pickle or external AI."""
import os
for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[name]='1'
import json,sys,math,hashlib,platform
from pathlib import Path
import numpy as np
import sklearn
from sklearn.ensemble import GradientBoostingRegressor
PARAMS=dict(loss='squared_error',n_estimators=100,learning_rate=.05,max_depth=2,min_samples_leaf=40,subsample=1.0,random_state=0,n_iter_no_change=None)
STEP=900000

def fit_request(request):
    if sklearn.__version__!='1.7.2': raise ValueError('Unregistered sklearn version')
    if request.get('version')!='barrier-tree-fit-request-v1' or request.get('featureSchema')!='closed-bounded750-vector8-v1': raise ValueError('Invalid training schema')
    at=request['trainedAt'];target=request['target'];target_hash=request['targetHash']
    if not isinstance(at,int) or at<0 or not isinstance(target_hash,str) or len(target_hash)!=64 or any(c not in '0123456789abcdef' for c in target_hash): raise ValueError('Invalid target/clock')
    if target['horizonBars']!=32 or target['stopLossPct']!=.02 or target['takeProfitPct']!=.04: raise ValueError('Unexpected barrier target')
    target_facts=dict(version='first-barrier-outcome-v1',**target,entry='candle-open',stopBasis='fee-inclusive',targetBasis='fill',ambiguous='unknown',gapTarget='conservative-target',maturity='full-horizon-close')
    canonical=request.get('targetCanonicalJson','')
    if hashlib.sha256(canonical.encode('utf-8')).hexdigest()!=target_hash or json.loads(canonical)!=target_facts: raise ValueError('Target hash mismatch')
    costs=target['costs'];fee=costs['feeRate'];spread=costs['spreadBps']/20000;slip=costs['slippageBps']/10000
    if not all(math.isfinite(v) for v in (fee,spread,slip)) or not 0<=fee<=.05 or not 0<=spread<=.05 or not 0<=slip<=.1: raise ValueError('Invalid costs')
    exit_factor=(1-spread)*(1-slip)*(1-fee);known=[];unknown=0;seen=set()
    for r in request['rows']:
        key=(r['pair'],r['decisionAt']);o=r['outcome'];x=r['x']
        if key in seen: raise ValueError('Duplicate pair/clock')
        seen.add(key)
        if len(x)!=8 or not all(isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) for v in x): raise ValueError('Invalid features')
        if not all(isinstance(r[k],int) and r[k]>=0 for k in ('decisionAt','entryAt','labelEnd')) or r['decisionAt']%(48*STEP) or r['entryAt']!=r['decisionAt']+STEP or r['labelEnd']!=r['entryAt']+32*STEP or r['labelEnd']>=at: raise ValueError('Unavailable labels')
        if r['targetHash']!=target_hash or o['targetHash']!=target_hash or o['version']!='first-barrier-outcome-v1' or o['entryAt']!=r['entryAt'] or o['availableAt']!=r['labelEnd']: raise ValueError('Mixed target labels')
        if not isinstance(o['eventBarTs'],int) or o['eventBarTs']%STEP or not r['entryAt']<=o['eventBarTs']<r['labelEnd']: raise ValueError('Invalid event clock')
        if not all(isinstance(o[k],(float,int)) and not isinstance(o[k],bool) and math.isfinite(o[k]) and o[k]>0 for k in ('entryFill','entryBasis','stopPrice','targetPrice')): raise ValueError('Invalid geometry')
        if not math.isclose(o['entryBasis'],o['entryFill']*(1+fee),rel_tol=1e-10) or not math.isclose(o['stopPrice'],o['entryBasis']*.98,rel_tol=1e-10) or not math.isclose(o['targetPrice'],o['entryFill']*1.04,rel_tol=1e-10): raise ValueError('Inconsistent target geometry')
        if o['outcome']=='ambiguous':
            if o['execution']!='unknown-path' or o['netReturn'] is not None or o['exitReference'] is not None: raise ValueError('Fabricated ambiguous label')
            unknown+=1;continue
        value=o['netReturn'];basis=o['entryBasis'];reference=o['exitReference']
        if o['outcome'] not in ('stop','target','timeout') or not all(isinstance(v,(float,int)) and math.isfinite(v) for v in (value,basis,reference)) or basis<=0 or reference<=0 or not math.isclose(value,reference*exit_factor/basis-1,rel_tol=1e-10,abs_tol=1e-14): raise ValueError('Inconsistent net label')
        valid_stop=o['outcome']=='stop' and ((o['execution']=='barrier' and math.isclose(reference,o['stopPrice'],rel_tol=1e-10)) or (o['execution']=='gap-open' and reference<=o['stopPrice']))
        valid_target=o['outcome']=='target' and o['execution']=='barrier' and math.isclose(reference,o['targetPrice'],rel_tol=1e-10)
        valid_timeout=o['outcome']=='timeout' and o['execution']=='horizon-close' and o['eventBarTs']==r['labelEnd']-STEP and o['stopPrice']<reference<o['targetPrice']
        if not (valid_stop or valid_target or valid_timeout): raise ValueError('Inconsistent event payoff')
        known.append(r)
    if len(known)<200: raise ValueError('Insufficient known labels')
    X=np.array([r['x'] for r in known],dtype=np.float64);y=np.array([r['outcome']['netReturn'] for r in known],dtype=np.float64)
    model=GradientBoostingRegressor(**PARAMS).fit(X,y)
    means=X.mean(axis=0);stds=X.std(axis=0);stds[stds==0]=1
    trees=[]
    for estimator in model.estimators_[:,0]:
        t=estimator.tree_
        trees.append([dict(feature=int(t.feature[i]),threshold=float(t.threshold[i]),left=int(t.children_left[i]),right=int(t.children_right[i]),value=float(t.value[i,0,0])) for i in range(t.node_count)])
    body=dict(version='barrier-gbr-tree-v1',featureSchema=request['featureSchema'],target=target,targetHash=target_hash,trainedAt=at,lastLabelEnd=max(r['labelEnd'] for r in known),knownLabels=len(known),ambiguousLabels=unknown,sklearnVersion=sklearn.__version__,parameters=PARAMS,baseline=float(model.init_.constant_[0,0]),means=means.tolist(),stds=stds.tolist(),trees=trees)
    query=request.get('queryX',[])
    if any(len(row)!=8 or not all(isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) for v in row) for row in query): raise ValueError('Invalid query')
    predictions=model.predict(np.array(query,dtype=np.float64)).tolist() if query else []
    return dict(modelBody=body,referencePredictions=predictions,environment=dict(python=platform.python_version(),numpy=np.__version__,sklearn=sklearn.__version__),trainingUsesQueryRows=False,resolvedParameters=model.get_params())

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('Expected request JSON and new output JSON paths')
    request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    result=fit_request(request)
    with Path(sys.argv[2]).open('x',encoding='utf-8') as out: json.dump(result,out,allow_nan=False,separators=(',',':'))
    print(json.dumps(dict(knownLabels=result['modelBody']['knownLabels'],ambiguousLabels=result['modelBody']['ambiguousLabels'],trees=len(result['modelBody']['trees']),predictions=len(result['referencePredictions']))))
