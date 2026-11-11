import json,hashlib,math,decimal
from pathlib import Path
decimal.getcontext().prec=60
D=lambda v:decimal.Decimal(str(v))
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/synchronized-stress-latest.json');raw=Path(pointer['path']).read_bytes();r=json.loads(raw);assert r['factsHash']==pointer['hash'];sources={x['pair']:x['candles'] for x in r['inputs']};assert len(sources)==20
step=900000;max_price_error=0.;max_cov_error=0.;prices=0;volumes=0;cov_entries=0;budgets=0
for pair,rows in sources.items():
    assert len(rows)==385 and rows[-1]['ts']+step==r['sourceAsOf']
    for i,row in enumerate(rows):assert row['pair']==pair and row['interval']==15 and row['ts']==rows[0]['ts']+i*step and row['ts']+step<=r['sourceAsOf']
for case in r['cases']:
    scenario=case['scenario'];assert scenario['kind']=='synthetic-synchronized-block-v1' and not scenario['actualCaptureEligible'];plan=scenario['plan'];indices=[start+j for start in plan['starts'] for j in range(plan['blockLength'])];assert len(indices)==192
    first=next(iter(sources.values()))[0]['ts'];assert scenario['sourceTimes']==[first+i*step for i in indices];vectors={}
    for panel in scenario['panels']:
        pair=panel['pair'];source=sources[pair];bars=panel['candles'];assert len(bars)==193;previous=D(source[-1]['close']);assert bars[0]['ts']==r['sourceAsOf'] and bars[0]['volume']==0 and D(bars[0]['close'])==previous
        returns=[]
        for j,i in enumerate(indices):
            src=source[i];denom=D(source[i-1]['close']);bar=bars[j+1];assert bar['ts']==r['sourceAsOf']+(j+1)*step
            for field in ['open','high','low','close']:
                expected=previous*D(src[field])/denom;got=D(bar[field]);err=float(abs(got-expected)/expected);max_price_error=max(max_price_error,err);assert err<1e-12;prices+=1
            assert bar['volume']==src['volume'];volumes+=1;assert bar['low']>0 and bar['low']<=min(bar['open'],bar['close']) and bar['high']>=max(bar['open'],bar['close']);previous=previous*D(src['close'])/denom
            returns.append(math.log(src['close'])-math.log(source[i-1]['close']))
        vectors[pair]=returns
    p=case['panel'];assert p['valid']==[True]*20 and p['returns']==192;centered={pair:[x-math.fsum(v)/192 for x in v] for pair,v in vectors.items()};matrix=[]
    for i,pair in enumerate(p['pairs']):
        row=[]
        for j,other in enumerate(p['pairs']):
            cov=math.fsum(x*y for x,y in zip(centered[pair],centered[other],strict=True))/191;max_cov_error=max(max_cov_error,abs(cov-p['covariance'][i][j]));assert math.isclose(cov,p['covariance'][i][j],abs_tol=1e-14,rel_tol=1e-10);row.append(cov);cov_entries+=1
        matrix.append(row)
    b=case['budget'];eth=p['pairs'].index('ETH/EUR');btc=p['pairs'].index('BTC/EUR');standalone=10000*matrix[eth][eth];held=10000*matrix[btc][btc];cross=10000*matrix[eth][btc];z=max(0,cross/standalone);factor=1/(math.hypot(1,z)+z);after=held+standalone*factor*factor+2*cross*factor
    for name,expected in [('factor',factor),('heldVariance',held),('standaloneCandidateVariance',standalone),('crossTermHalf',cross),('beforeVariance',held+standalone+2*cross),('afterVariance',after),('independentIncrementReference',held+standalone)]:assert math.isclose(b[name],expected,rel_tol=1e-10,abs_tol=1e-12)
    assert 0<factor<=1 and after<=held+standalone+1e-10;budgets+=1
manifest=read('docs/upstream-research/jesse/manifest-candle-dependence-review.json')
for f in manifest['files']:assert hashlib.sha256(Path(f['local']).read_bytes()).hexdigest()==f['sha256']
proof={'version':'synchronized-stress-independent-v1','reportHash':pointer['hash'],'reportFileSha256':hashlib.sha256(raw).hexdigest(),'verifierHash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sourceMarketsVerified':20,'sourceBarsVerified':7700,'scenariosVerified':len(r['cases']),'decimalOhlcValuesVerified':prices,'coSampledVolumesVerified':volumes,'covarianceEntriesVerified':cov_entries,'budgetCasesVerified':budgets,'maxDecimalRelativePriceError':max_price_error,'maxSourceReturnCovarianceError':max_cov_error,'pinnedUpstreamFilesVerified':len(manifest['files']),'vendorCodeExecuted':False,'independentSamples':None,'profitabilityEstablished':False}
Path('docs/synchronized-stress-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
