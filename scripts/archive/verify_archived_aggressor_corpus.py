"""Independent gzip/raw/Decimal verification of the complete original-clock sidecar."""
import json,gzip,hashlib,math,datetime
from pathlib import Path
from decimal import Decimal as D,getcontext
getcontext().prec=60
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
canonical=lambda x:json.dumps(x,separators=(',',':'),sort_keys=True,ensure_ascii=False).encode()
pointer=read('docs/archived-aggressor-corpus-latest.json');report=read(pointer['path']);protocol=read('docs/archived-aggressor-corpus-protocol-v1.json');assert report['factsHash']==pointer['hash'];assert sha('docs/archived-aggressor-corpus-protocol-v1.json')==report['protocolHash']
for path,h in protocol['sources'].items():assert sha(path)==h
original=read(protocol['corpus']);assert original['factsHash']==protocol['corpusHash']==report['originalCorpusHash'];assert len(report['observations'])==len(original['observations'])==7280
assert [(r['pair'],r['decisionAt']) for r in report['observations']]==[(r['pair'],r['decisionAt']) for r in original['observations']]
assert protocol['periods']==['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03'];assert len(protocol['pairs'])==20
expected_scope=hashlib.sha256(canonical(dict(version='archived-aggressor-data-v1',originalCorpusHash=original['factsHash'],availabilityDomain='modeled-historical-bar-close-v1',sources=report['sources'],featureSource=protocol['sources']['apps/server/src/research/historical-aggressor.ts']))).hexdigest();assert expected_scope==report['dataScope']
raw_count=0;duplicates=0;windows=0;known=0;unknown=0;max_error=0;normalized_files=0
for pair in protocol['pairs']:
    mapping={};retrieval={};candle_map={};loaded=set()
    for source in (s for s in report['sources'] if s['pair']==pair):
        path=Path(source['path']);assert sha(path)==source['pageSha256'];page=json.loads(gzip.decompress(path.read_bytes()));assert page['pair']==pair and page['publicEndpoint']=='https://data-api.binance.vision/api/v3/klines';assert hashlib.sha256(canonical(page['raw'])).hexdigest()==page['canonicalRawHash']==source['rawHash']
        dt=datetime.datetime.fromisoformat(page['retrievedAt'].replace('Z','+00:00'));at=int(dt.timestamp())*1000+dt.microsecond//1000
        target=path.parent.parent.parent/(pair.replace('/','-')+'.json.gz')
        if target not in loaded:
            saved=json.loads(gzip.decompress(target.read_bytes()));assert saved['pair']==pair and saved['repair']['complete'];candle_map.update({r['ts']:r for r in saved['rows']});loaded.add(target);normalized_files+=1
        for row in page['raw']:
            assert len(row)==12;ts=row[0];c=candle_map[ts]
            for name,index in [('open',1),('high',2),('low',3),('close',4),('volume',5)]:assert float(row[index])==c[name]
            assert c['pair']==pair and c['interval']==15 and row[6]==ts+899999;raw_count+=1
            if ts in mapping:assert mapping[ts]==row;duplicates+=1;retrieval[ts]=min(retrieval[ts],at)
            else:mapping[ts]=row;retrieval[ts]=at
    for r in (r for r in report['observations'] if r['pair']==pair):
        end=r['decisionAt'];raw=[mapping[end-(96-i)*900000] for i in range(96)];assert hashlib.sha256(canonical(raw)).hexdigest()==r['rawWindowHash'];assert max(retrieval[b[0]] for b in raw)==r['archiveRetrievedAt'];assert r['last16Quotes']==[[b[7],b[10]] for b in raw[-16:]]
        for row in raw:
            assert 0<=D(row[9])<=D(row[5]) and 0<=D(row[10])<=D(row[7]) and type(row[8])==int and row[8]>=0
        total=sum(D(b[7]) for b in raw[-16:]);buy=sum(D(b[10]) for b in raw[-16:]);f=r['feature'];assert f['availabilityDomain']=='modeled-historical-bar-close-v1' and f['actualFirstReceiptObserved'] is False and f['actualCaptureDecisionEligible'] is False and f['closedAt']==end and f['archiveRetrievedAt']==r['archiveRetrievedAt']
        if total==0:assert f['complete'] is False and f['quoteImbalance'] is None and f['reason']=='zero-executed-quote-reference';unknown+=1
        else:
            expected=float(2*buy/total-1);assert f['complete'] and f['reason'] is None and math.isclose(f['quoteImbalance'],expected,rel_tol=1e-12,abs_tol=1e-12);assert -1<=f['quoteImbalance']<=1;max_error=max(max_error,abs(expected-f['quoteImbalance']));assert math.isclose(f['quoteVolume'],float(total),rel_tol=1e-12,abs_tol=1e-12) and f['trades']==sum(b[8] for b in raw[-16:]);known+=1
        windows+=96
assert raw_count==report['rawBars']==441600 and duplicates==report['duplicateWarmupBars']==76800
assert report['summary']['available']==known==7272 and report['summary']['unknown']==unknown==8 and report['summary']['sourcePages']==len(report['sources'])==480
assert report['newNetworkRequests']==0 and report['modelFitted'] is False and report['julyLoaded'] is False
proof=dict(version='archived-aggressor-corpus-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),dataScope=report['dataScope'],rawSourcePages=480,normalizedMarketFiles=normalized_files,allOriginalOhlcvAndFullRawOverlapExact=True,rawBarsChecked=raw_count,duplicateWarmupBars=duplicates,windowBarReferencesChecked=windows,originalClockOrderExact=True,knownFeaturesVerified=known,unknownFeaturesVerified=unknown,precisionDigits=60,maximumImbalanceDifference=max_error,availabilityDomainsSeparate=True,newNetworkRequests=0,modelFitted=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/archived-aggressor-corpus-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
