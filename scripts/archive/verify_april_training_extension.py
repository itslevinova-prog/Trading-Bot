import json,gzip,hashlib,decimal
from pathlib import Path
from datetime import datetime,timezone
D=decimal.Decimal;decimal.getcontext().prec=80
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest();canonical=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
pointer=read('docs/training-through-april-latest.json');r=read(pointer['path']);original=read('docs/barrier-clock-corpus-3262b4fb3be9b47e.json');old={(x['pair'],x['decisionAt']):x for x in original['observations']};same=0
for row in r['observations']:
    assert row['labelEnd']<r['toExclusive'] and row['entryAt']==row['decisionAt']+900000 and row['labelEnd']==row['entryAt']+32*900000
    before=old.get((row['pair'],row['decisionAt']))
    if before:
        assert row['x']==before['x'] and row['referenceGrossEndpointReturn']==before['referenceGrossEndpointReturn'];assert {k:v for k,v in row['outcome'].items() if k!='targetHash'}=={k:v for k,v in before['outcome'].items() if k!='targetHash'};same+=1
assert same==7280
pfile=Path('docs/historical-regime-protocol-v1.json');protocol=read(pfile);root=Path('data/historical-regime-v1')/sha(pfile.read_bytes());maps={};pages=0;raw_bars=0
for pair in protocol['symbols']:
    doc=json.loads(gzip.decompress((root/'2026-04'/(pair.replace('/','-')+'.json.gz')).read_bytes()));source=[]
    for ref in doc['pages']:
        page=json.loads(gzip.decompress((root/ref['relativePath']).read_bytes()));assert sha(canonical(page['raw']))==ref['canonicalRawHash']==page['canonicalRawHash'];pages+=1
        for raw in page['raw']:
            assert raw[6]==raw[0]+899999
            source.append({'pair':pair,'interval':15,'ts':raw[0],**{k:float(raw[i]) for k,i in [('open',1),('high',2),('low',3),('close',4),('volume',5)]}})
    assert source==doc['rows'];raw_bars+=len(source);maps[pair]={c['ts']:c for c in source}
fee=D(str(r['target']['costs']['feeRate']));spread=D(str(r['target']['costs']['spreadBps']))/20000;slip=D(str(r['target']['costs']['slippageBps']))/10000
entry_factor=(1+spread)*(1+slip);exit_factor=(1-spread)*(1-slip)*(1-fee);counts={};checked=0
near=lambda a,b:abs(a-D(str(b)))<=D('1e-10')*max(D(1),abs(a),abs(D(str(b))))
for row in r['observations']:
    if row['decisionAt']<1775001600000:continue
    path=[maps[row['pair']][row['entryAt']+i*900000] for i in range(32)];fill=D(str(path[0]['open']))*entry_factor;basis=fill*(1+fee);stop=basis*(1-D(str(r['target']['stopLossPct'])));target=fill*(1+D(str(r['target']['takeProfitPct'])));outcome='timeout';execution='horizon-close';bar=path[-1];price=D(str(bar['close']))
    for b in path:
        o,h,l=(D(str(b[k])) for k in ['open','high','low'])
        if o<=stop:outcome,execution,bar,price='stop','gap-open',b,o;break
        if o>=target:outcome,execution,bar,price='target','barrier',b,target;break
        if l<=stop and h>=target:outcome,execution,bar,price='ambiguous','unknown-path',b,None;break
        if l<=stop:outcome,execution,bar,price='stop','barrier',b,stop;break
        if h>=target:outcome,execution,bar,price='target','barrier',b,target;break
    saved=row['outcome'];assert (saved['outcome'],saved['execution'],saved['eventBarTs'])==(outcome,execution,bar['ts']);assert near(fill,saved['entryFill']) and near(basis,saved['entryBasis']) and near(stop,saved['stopPrice']) and near(target,saved['targetPrice'])
    if price is None:assert saved['netReturn'] is None and saved['exitReference'] is None
    else:assert near(price,saved['exitReference']) and near(price*exit_factor/basis-1,saved['netReturn'])
    counts[outcome]=counts.get(outcome,0)+1;checked+=1
assert checked==1200
facts={'version':'april-training-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'report':pointer,'reportFileSha256':sha(Path(pointer['path']).read_bytes()),'verifierSha256':sha(Path(__file__).read_bytes()),'oldFeatureAndPayoffRowsExactlyMatched':same,'aprilRawPagesVerified':pages,'aprilRawBarsVerified':raw_bars,'aprilBarrierLabelsVerified':checked,'aprilClasses':counts,'modelFitted':False,'mayLabelsRead':False,'juneLoaded':False,'julyLoaded':False,'profitabilityEstablished':False,'scope':'Independent original April raw-page/normalized reconstruction and80digitDecimal fixed barrier/fee/slippage/horizon labels; exact old7280feature/payoff preservation. Historical idealized targets are not executable PNL or independent samples.'}
out='docs/april-training-independent-'+sha(canonical(facts))[:16]+'.json';Path(out).write_text(json.dumps(facts,indent=2)+'\n',encoding='utf-8');Path('docs/april-training-independent-latest.json').write_text(json.dumps({'path':out,'sha256':sha(Path(out).read_bytes())},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'oldRowsMatched':same,'newAprilLabels':checked,'sourcePages':pages,'classes':counts}))
