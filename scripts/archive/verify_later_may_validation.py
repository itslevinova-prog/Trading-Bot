import json,gzip,hashlib,decimal,math
from pathlib import Path
from datetime import datetime,timezone
D=decimal.Decimal;decimal.getcontext().prec=80
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest();canonical=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
pointer=read('docs/later-may-validation-latest.json');r=read(pointer['path']);frozen=read(r['frozenModels']['path']);train=read(frozen['trainingCorpus']['path']);m=frozen['models']['ridge']['ridge'];stage=read(r['scoringProtocol']['path']);forecasts=read(r['frozenForecasts']['path']);assert sha(Path(r['frozenModels']['path']).read_bytes())==stage['frozenModelFileSha256'] and r['modelFileUnchanged'] and not r['modelRefitted'];assert len(r['rows'])==400 and len({x['decisionAt'] for x in r['rows']})==20
assert [{k:v for k,v in x.items() if k not in ['outcome','netReturn','labelKnown']} for x in r['rows']]==forecasts['rows']
source_file=Path('docs/historical-evidence-post-april-protocol-v1.json');protocol=read(source_file);root=Path('data/historical-evidence-post-april-v1')/sha(source_file.read_bytes());maps={};raw_pages=0
for pair in protocol['symbols']:
    doc=json.loads(gzip.decompress((root/'2026-05'/(pair.replace('/','-')+'.json.gz')).read_bytes()));bars={}
    for ref in doc['pages']:
        page=json.loads(gzip.decompress((root/ref['relativePath']).read_bytes()));assert sha(canonical(page['raw']))==ref['canonicalRawHash'];raw_pages+=1
        for row in page['raw']:
            if row[0]>=1779321600000:continue
            bars[row[0]]={k:D(str(row[i])) for k,i in [('open',1),('high',2),('low',3),('close',4)]}
    maps[pair]=bars
costs=train['target']['costs'];fee=D(str(costs['feeRate']));half=D(str(costs['spreadBps']))/20000;slip=D(str(costs['slippageBps']))/10000;entry_factor=(1+half)*(1+slip);exit_factor=(1-half)*(1-slip)*(1-fee);wm=frozen['models']['clockRidge']['ridge'];wmeans=[D(str(v)) for v in wm['means']];wstds=[D(str(v)) for v in wm['stds']];wweights=[D(str(v)) for v in wm['weights']];wintercept=D(str(wm['intercept']));wmean=D(str(frozen['models']['clockMean']['value']));means=[D(str(v)) for v in m['means']];stds=[D(str(v)) for v in m['stds']];weights=[D(str(v)) for v in m['weights']];intercept=D(str(m['intercept']));mean=D(str(frozen['models']['trainingMean']['value']));names=['zero','training-mean','ridge-lambda10','clock-mean30','clock-ridge30'];errors={n:[] for n in names};coverage={n:0 for n in names};positive={n:0 for n in names};margin={n:0 for n in names};classes={};clock_winners={n:{} for n in names};checked=0
near=lambda a,b:abs(a-D(str(b)))<D('1e-10')
for row in r['rows']:
    t=row['decisionAt'];assert 1778457600000<=t<1779321600000 and t%43200000==0 and row['entryAt']==t+900000 and row['labelEnd']==t+33*900000<1779321600000
    date_ok=t-m['trainedAt']<=10*86400000 and t-m['lastLabelEnd']<=10*86400000 and t>=m['trainedAt'];x=row['x'];z=[(D(str(v))-a)/b for v,a,b in zip(x,means,stds)] if x is not None else None
    wz=[(D(str(v))-a)/b for v,a,b in zip(x,wmeans,wstds)] if x is not None else None
    predictions={'zero':D(0),'training-mean':mean if date_ok and x is not None else None,'ridge-lambda10':intercept+sum(a*b for a,b in zip(z,weights)) if date_ok and z is not None and all(abs(v)<=6 for v in z) else None,'clock-mean30':wmean if date_ok and x is not None else None,'clock-ridge30':wintercept+sum(a*b for a,b in zip(wz,wweights)) if date_ok and wz is not None and all(abs(v)<=6 for v in wz) else None}
    for n in names:
        p=predictions[n];saved=row['predictions'][n]
        if p is None:assert saved is None
        else:
            assert saved is not None and near(p,saved);coverage[n]+=1;positive[n]+=p>0;margin[n]+=p>D('.005')
            if p>D('.005'):
                old=clock_winners[n].get(t)
                if old is None or p>old[1] or p==old[1] and row['pair']<old[0]:clock_winners[n][t]=(row['pair'],p)
    path=[maps[row['pair']][row['entryAt']+i*900000] for i in range(32)];fill=path[0]['open']*entry_factor;basis=fill*(1+fee);stop=basis*(1-D('.02'));target=fill*(1+D('.04'));outcome='timeout';execution='horizon-close';bar_index=31;price=path[-1]['close']
    for i,b in enumerate(path):
        if b['open']<=stop:outcome,execution,bar_index,price='stop','gap-open',i,b['open'];break
        if b['open']>=target:outcome,execution,bar_index,price='target','barrier',i,target;break
        if b['low']<=stop and b['high']>=target:outcome,execution,bar_index,price='ambiguous','unknown-path',i,None;break
        if b['low']<=stop:outcome,execution,bar_index,price='stop','barrier',i,stop;break
        if b['high']>=target:outcome,execution,bar_index,price='target','barrier',i,target;break
    saved=row['outcome'];assert (saved['outcome'],saved['execution'],saved['eventBarTs'])==(outcome,execution,row['entryAt']+bar_index*900000);classes[outcome]=classes.get(outcome,0)+1
    if price is None:assert row['netReturn'] is None and not row['labelKnown']
    else:
        net=price*exit_factor/basis-1;assert row['labelKnown'] and near(net,row['netReturn'])
        for n in names:errors[n].append((predictions[n] if predictions[n] is not None else D(0))-net)
    checked+=1
metrics={}
for n in names:
    count=D(len(errors[n]));mae=sum(abs(v) for v in errors[n])/count;rmse=(sum(v*v for v in errors[n])/count).sqrt();saved=r['metrics'][n];assert near(mae,saved['mae']) and near(rmse,saved['rmse']);assert coverage[n]==saved['forecasts'] and positive[n]==saved['positiveForecasts'] and margin[n]==saved['aboveFixedMargin'];assert near(D(coverage[n])/400,saved['coverage'])
    assert len(clock_winners[n])==r['opportunities'][n]['opportunityClocks']==0 and r['opportunities'][n]['noTradeClocks']==20
    metrics[n]={'mae':str(mae),'rmse':str(rmse),'coverage':coverage[n]/400}
selected='zero';best=D(metrics['zero']['mae'])
for n in names[1:]:
    value=D(metrics[n]['mae'])
    if len(errors[n])>=40 and D(coverage[n])/400>=D('.95') and value<best-D('1e-12'):selected=n;best=value
assert selected==r['selected']=='ridge-lambda10'
proof={'version':'later-may-validation-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'report':pointer,'reportFileSha256':sha(Path(pointer['path']).read_bytes()),'verifierSha256':sha(Path(__file__).read_bytes()),'sourcePagesVerified':raw_pages,'labelsVerified':checked,'frozenForecastSlotsVerified':checked*len(names),'sharedClocks':20,'classes':classes,'metrics':metrics,'selected':selected,'opportunityClocks':0,'modelFileUnchanged':True,'activeModelChanged':False,'profitabilityEstablished':False,'scope':'Independent original raw-page/80digitDecimal costed labels and saved-model forecasts/guards, MAE/RMSE/coverage/selection and fixed-margin clock ranking. Saved feature vectors rely on separately tested past-only feature pipeline; this audit does not independently reconstruct indicators.20sharedclocks, not2000independent observations; no executed portfolio return inferred.'}
out='docs/later-may-validation-independent-'+sha(canonical(proof))[:16]+'.json';Path(out).write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');Path('docs/later-may-validation-independent-latest.json').write_text(json.dumps({'path':out,'sha256':sha(Path(out).read_bytes())},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'labelsVerified':checked,'forecastSlots':checked*len(names),'selected':selected,'classes':classes,'metrics':metrics}))
