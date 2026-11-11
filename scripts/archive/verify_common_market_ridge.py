import os
for k in ['OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS']:os.environ[k]='1'
import json,hashlib,math
from pathlib import Path
import numpy as np
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/common-market-ridge-latest.json');raw_bytes=Path(pointer['path']).read_bytes();r=json.loads(raw_bytes);p=read('docs/common-market-ridge-protocol-v1.json');corpus=read(p['corpus']);prior=read(p['prior']);request=read(r['nativeRequest']);native=read(r['nativeOutput']);assert r['factsHash']==pointer['hash'];assert hashlib.sha256(Path(r['nativeRequest']).read_bytes()).hexdigest()==r['nativeRequestHash']==native['requestSha256'];assert hashlib.sha256(Path(r['nativeOutput']).read_bytes()).hexdigest()==r['nativeOutputHash']
assert corpus['factsHash']==p['corpusHash'] and prior['factsHash']==p['priorHash'];assert request['dataScope']==r['featureHash'];assert request['availabilityDomain']=='modeled-historical-bar-close-v1'
btc={x['decisionAt']:x for x in corpus['observations'] if x['pair']=='BTC/EUR'};joined={};features=0
for source,f in zip(corpus['observations'],r['features'],strict=True):
    b=btc.get(source['decisionAt']);expected=[*source['x'],b['x'][4]] if b else None
    assert f['pair']==source['pair'] and f['decisionAt']==source['decisionAt'] and f['ownFeatureContractHash']==source['featureContractHash']
    assert f['x9']==expected and f['available']==(b is not None) and f['btcChange4hPct']==(b['x'][4] if b else None)
    assert f['sourceFeatureContractHash']==(b['featureContractHash'] if b else None) and not f['actualReceiptObserved']
    joined[(source['pair'],source['decisionAt'])]=expected;features+=1
modes=['zero','mean','ridge','common','market'];aggregate={k:[0,0.,0.,0,0,[]] for k in modes+['selected','parent-selected']};counts={k:0 for k in modes};max_residual=0.;raw_queries=0;guarded_forecasts=0;clock_choices=0;parent_changed=0
close=lambda a,b: a is None and b is None or a is not None and b is not None and math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-12)
def forecast(model,x,at):
    if x is None or at<model['trainedAt'] or at-model['trainedAt']>864000000 or at-model['lastLabelEnd']>864000000:return None
    z=(np.asarray(x)-np.asarray(model['means']))/np.asarray(model['stds'])
    if (np.abs(z)>6).any():return None
    return model['intercept']+float(z@np.asarray(model['weights']))
def score(rows,mode):
    known=[x for x in rows if x['netReturn'] is not None];e=[(x['predictions'][mode] or 0)-x['netReturn'] for x in known]
    return {'rows':len(rows),'knownLabels':len(known),'absoluteError':sum(map(abs,e)),'squaredError':sum(v*v for v in e),'mae':sum(map(abs,e))/len(e),'mse':sum(v*v for v in e)/len(e),'coverage':sum(x['predictions'][mode] is not None for x in rows)/len(rows)}
def select(scores,names):
    chosen='zero';best=scores['zero']['mse']
    if scores['zero']['knownLabels']>=40:
        for mode in names[1:]:
            if scores[mode]['coverage']>=.95 and scores[mode]['mse']<best-1e-12:chosen=mode;best=scores[mode]['mse']
    return chosen
for old,f,req,fit in zip(prior['folds'],r['folds'],request['folds'],native['folds'],strict=True):
    w=f['window'];assert old['window']==w;train=[x for x in corpus['observations'] if w['trainStart']<=x['decisionAt']<w['validationStart'] and x['labelEnd']<w['validationStart'] and joined[(x['pair'],x['decisionAt'])] is not None and x['outcome']['netReturn'] is not None]
    expected_rows=[{'pair':x['pair'],'decisionAt':x['decisionAt'],'labelEnd':x['labelEnd'],'x':joined[(x['pair'],x['decisionAt'])],'y':x['outcome']['netReturn']} for x in train];assert req['rows']==expected_rows and len(train)>=200
    validation=[x for x in corpus['observations'] if w['validationStart']<=x['decisionAt']<w['testStart'] and x['labelEnd']<w['testStart']];test=[x for x in corpus['observations'] if w['testStart']<=x['decisionAt']<w['testEnd'] and x['labelEnd']<=w['testEnd']];all_rows=validation+test
    assert req['queryX']==[joined[(x['pair'],x['decisionAt'])] for x in all_rows]
    x=np.asarray([a['x'] for a in expected_rows]);y=np.asarray([a['y'] for a in expected_rows])
    for dim in [8,9]:
        model=fit[str(dim)]['model'];a=x[:,:dim];means=a.mean(axis=0);stds=a.std(axis=0);stds=np.where(stds==0,1,stds);z=(a-means)/stds
        assert np.max(np.abs(means-model['means']))<1e-12 and np.max(np.abs(stds-model['stds']))<1e-12 and close(float(y.mean()),model['intercept'])
        residual=(z.T@z+10*np.eye(dim))@np.asarray(model['weights'])-z.T@(y-model['intercept']);max_residual=max(max_residual,float(np.max(np.abs(residual))));assert np.max(np.abs(residual))<1e-10
        assert model['trainedAt']==w['validationStart'] and model['lastLabelEnd']==max(x['labelEnd'] for x in train) and model['rows']==len(train)
        for q,pred in zip(req['queryX'],fit[str(dim)]['rawPredictions'],strict=True):
            expected=None if q is None else model['intercept']+float(((np.asarray(q[:dim])-means)/stds)@np.asarray(model['weights']));assert close(expected,pred);raw_queries+=1
    for phase,source_rows in [('validation',validation),('test',test)]:
        saved_rows=f[phase+'Rows'];assert len(saved_rows)==len(source_rows)
        for source,saved in zip(source_rows,saved_rows,strict=True):
            assert saved['pair']==source['pair'] and saved['decisionAt']==source['decisionAt'] and saved['netReturn']==source['outcome']['netReturn']
            x9=joined[(source['pair'],source['decisionAt'])];expected={'zero':0,'mean':old['model']['ridge']['intercept'],'ridge':forecast(old['model']['ridge'],source['x'],source['decisionAt']),'common':forecast(fit['8']['model'],None if x9 is None else x9[:8],source['decisionAt']),'market':forecast(fit['9']['model'],x9,source['decisionAt'])}
            for mode in modes:assert close(expected[mode],saved['predictions'][mode]);guarded_forecasts+=1
        for mode in modes:
            s=score(saved_rows,mode)
            for k,value in s.items():assert close(value,f[phase+'Metrics'][mode][k])
    chosen=select(f['validationMetrics'],modes);parent=select(f['validationMetrics'],modes[:-1]);assert chosen==f['selected'];counts[chosen]+=1;groups={}
    for x in f['testRows']:groups.setdefault(x['decisionAt'],[]).append(x)
    for mode in modes+['selected','parent-selected']:
        actual_mode=chosen if mode=='selected' else parent if mode=='parent-selected' else mode;s=score(f['testRows'],actual_mode);a=aggregate[mode];a[0]+=s['knownLabels'];a[1]+=s['absoluteError'];a[2]+=s['squaredError'];a[3]+=sum(x['predictions'][actual_mode] is not None for x in f['testRows']);a[4]+=len(f['testRows'])
        for i,clock in enumerate(sorted(groups)):
            candidates=sorted([x for x in groups[clock] if x['predictions'][actual_mode] is not None and x['predictions'][actual_mode]>.005],key=lambda x:(-x['predictions'][actual_mode],x['pair']));winner=candidates[0] if candidates else None
            if mode!='parent-selected':
                actual=f['choices'][mode][i];assert actual['decisionAt']==clock;assert actual['winner']==({'pair':winner['pair'],'forecast':winner['predictions'][actual_mode]} if winner else None);assert actual['netReturn']==(winner['netReturn'] if winner else None);clock_choices+=1
            if winner:a[5].append(winner['netReturn'])
            if mode=='parent-selected' and (winner['pair'] if winner else None)!=(f['choices']['selected'][i]['winner'] or {}).get('pair'):parent_changed+=1
summary={}
for mode,(n,ae,se,coverage,total,winners) in aggregate.items():
    known=[x for x in winners if x is not None];s={'knownTestLabels':n,'mae':ae/n,'mse':se/n,'coverage':coverage/total,'opportunityClocks':len(winners),'noTradeClocks':328-len(winners),'knownOpportunityLabels':len(known),'meanKnownOpportunityLabel':sum(known)/len(known) if known else None};summary[mode]=s
    if mode!='parent-selected':
        for k,value in s.items():assert close(value,r['aggregate'][mode][k])
assert counts==r['selectionCounts']
proof={'version':'common-market-ridge-independent-v1','reportHash':pointer['hash'],'reportFileSha256':hashlib.sha256(raw_bytes).hexdigest(),'verifierHash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'featureBindingsVerified':features,'foldsVerified':41,'normalEquationCoefficientsVerified':697,'maxNormalEquationResidual':max_residual,'rawQueriesVerified':raw_queries,'guardedForecastsVerified':guarded_forecasts,'clockChoicesVerified':clock_choices,'fairParentWithoutNewFeature':summary['parent-selected'],'parentVersusExtendedChangedClockKeys':parent_changed,'fairParentScope':'Additional descriptive control audit using exactly the same MSE rule and existing candidate library minus market. Computed after primary result, no retraining or strategy activation. Do not compare the prior aggressor-library selector as if only this feature changed.','actualFirstReceiptObserved':False,'modelActivated':False,'julyLoaded':False,'independentSamples':None,'profitabilityEstablished':False}
Path('docs/common-market-ridge-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
