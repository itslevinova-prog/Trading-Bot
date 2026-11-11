"""Independent Decimal aggregates of retained executions; no app import/network."""
import json,hashlib,math
from decimal import Decimal as D,getcontext
from pathlib import Path
getcontext().prec=60
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
p=read('docs/executed-activity-description-latest.json');report=read(p['path']);capture=read(report['capture']);assert report['factsHash']==p['hash'] and report['captureHash']==capture['factsHash']
for path,h in report['sources'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==h
windows=0;values=0;max_volume_error=0;max_share_error=0
for result in report['summaries']:
    source=next(r for r in capture['results'] if r['pair']==result['pair']);assert source['rawHash']==result['rawHash'];assert hashlib.sha256(Path(source['rawPath']).read_bytes()).hexdigest()==source['rawHash'];raw=sorted(read(source['rawPath']),key=lambda x:x[0]);summary=result['summary'];assert summary['capturedAt']==source['capturedAt'];assert summary['closedAt']==capture['closedAt'];assert summary['sourceComplete'] and summary['quoteCurrency']=='EUR'
    for key,count in [('h1',4),('h4',16),('h24',96)]:
        rows=raw[-count:];assert len(rows)==count;actual=summary['windows'][key];assert actual['complete'] and actual['reason'] is None and actual['expectedBars']==count and actual['to']==capture['closedAt'] and actual['from']==capture['closedAt']-count*900000
        base=sum(D(r[5]) for r in rows);quote=sum(D(r[7]) for r in rows);buybase=sum(D(r[9]) for r in rows);buyquote=sum(D(r[10]) for r in rows);trades=sum(r[8] for r in rows)
        expected=dict(baseVolume=base,quoteVolume=quote,trades=trades,takerBuyBaseShare=buybase/base if base else None,takerBuyQuoteShare=buyquote/quote if quote else None,takerQuoteImbalance=2*buyquote/quote-1 if quote else None,executionVwap=quote/base if quote and base else None)
        for field,value in expected.items():
            values+=1
            if value is None:assert actual[field] is None;continue
            if field=='trades':assert actual[field]==value;continue
            reference=float(value);assert math.isclose(actual[field],reference,rel_tol=1e-12,abs_tol=1e-12)
            error=abs(actual[field]-reference)
            if 'Share' in field or field=='takerQuoteImbalance':max_share_error=max(max_share_error,error)
            else:max_volume_error=max(max_volume_error,error)
        windows+=1
proof=dict(version='executed-activity-decimal-proof-v1',reportHash=p['hash'],reportFileSha256=hashlib.sha256(Path(p['path']).read_bytes()).hexdigest(),captureHash=report['captureHash'],verifierSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),precisionDigits=60,windowsVerified=windows,numericFieldsChecked=values,maximumVolumeOrPriceDifference=max_volume_error,maximumParticipationDifference=max_share_error,relativeTolerance=1e-12,sourceClocksAndCaptureIdentityVerified=True,newNetworkRequests=0,independentSamples=None,modelFitted=False,activeContextChanged=False,profitabilityEstablished=False)
Path('docs/executed-activity-decimal-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
