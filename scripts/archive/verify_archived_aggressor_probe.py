"""Independent original gzip/raw OHLCV and Decimal feature verification. No app imports/network."""
import json,gzip,hashlib,math,datetime
from pathlib import Path
from decimal import Decimal as D,getcontext
getcontext().prec=60
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/archived-aggressor-probe-latest.json');report=read(pointer['path']);protocol=read('docs/archived-aggressor-probe-protocol-v1.json');assert report['factsHash']==pointer['hash']
assert hashlib.sha256(Path('docs/archived-aggressor-probe-protocol-v1.json').read_bytes()).hexdigest()==report['protocolHash']
for path,h in protocol['sources'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==h
raw_maps={};normalized={};retrieval={};raw_bars=0
for source in report['sources']:
    path=Path(source['path']);assert hashlib.sha256(path.read_bytes()).hexdigest()==source['pageSha256'];page=json.loads(gzip.decompress(path.read_bytes()));pair=source['pair'];assert page['pair']==pair and page['publicEndpoint']=='https://data-api.binance.vision/api/v3/klines'
    raw_hash=hashlib.sha256(json.dumps(page['raw'],separators=(',',':'),ensure_ascii=False).encode()).hexdigest();assert raw_hash==page['canonicalRawHash']==source['rawHash'];at=int(datetime.datetime.fromisoformat(page['retrievedAt'].replace('Z','+00:00')).timestamp()*1000)
    if pair not in normalized:
        target=path.parent.parent.parent/(pair.replace('/','-')+'.json.gz');saved=json.loads(gzip.decompress(target.read_bytes()));expected=next(m['hash'] for m in report['marketFiles'] if m['pair']==pair);assert hashlib.sha256(target.read_bytes()).hexdigest()==expected;normalized[pair]={r['ts']:r for r in saved['rows']}
    mapping=raw_maps.setdefault(pair,{});times=retrieval.setdefault(pair,{})
    for row in page['raw']:
        assert len(row)==12 and row[0] not in mapping;mapping[row[0]]=row;times[row[0]]=at;c=normalized[pair][row[0]]
        for name,index in [('open',1),('high',2),('low',3),('close',4),('volume',5)]:assert float(row[index])==c[name]
        assert c['pair']==pair and c['interval']==15 and row[6]==row[0]+899999;raw_bars+=1
max_error=0;window_checks=0
for r in report['observations']:
    pair=r['pair'];end=r['decisionAt'];window=[raw_maps[pair][end-(96-i)*900000] for i in range(96)];assert hashlib.sha256(json.dumps(window,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==r['rawWindowHash'];assert r['archiveRetrievedAt']==max(retrieval[pair][b[0]] for b in window)
    assert r['last16Quotes']==[[b[7],b[10]] for b in window[-16:]];total=sum(D(b[7]) for b in window[-16:]);buy=sum(D(b[10]) for b in window[-16:]);f=r['feature'];assert f['availabilityDomain']=='modeled-historical-bar-close-v1' and f['actualFirstReceiptObserved'] is False and f['actualCaptureDecisionEligible'] is False and f['closedAt']==end
    if not total:assert f['complete'] is False and f['quoteImbalance'] is None
    else:
        expected=float(2*buy/total-1);assert f['complete'] and math.isclose(expected,f['quoteImbalance'],rel_tol=1e-12,abs_tol=1e-12);max_error=max(max_error,abs(expected-f['quoteImbalance']));assert math.isclose(float(total),f['quoteVolume'],rel_tol=1e-12,abs_tol=1e-12);assert f['trades']==sum(b[8] for b in window[-16:])
    window_checks+=96
assert len(report['observations'])==124 and report['newNetworkRequests']==0 and report['modelFitted'] is False and report['julyLoaded'] is False
proof=dict(version='archived-aggressor-probe-independent-v1',reportHash=pointer['hash'],reportFileSha256=hashlib.sha256(Path(pointer['path']).read_bytes()).hexdigest(),verifierHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourcePages=len(report['sources']),rawBarsChecked=raw_bars,windowBarReferencesChecked=window_checks,featureRowsChecked=124,precisionDigits=60,maximumImbalanceDifference=max_error,allNormalizedOhlcvExact=True,availabilityDomainsSeparate=True,newNetworkRequests=0,modelFitted=False,profitabilityEstablished=False)
Path('docs/archived-aggressor-probe-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
