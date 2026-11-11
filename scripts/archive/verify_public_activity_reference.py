"""Raw retained-field/capture proof; no runtime parser import or network."""
import json,hashlib,math,datetime
from decimal import Decimal as D,getcontext
from pathlib import Path
getcontext().prec=60
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/public-activity-capture-latest.json');report=read(pointer['path']);protocol=read('docs/public-activity-capture-protocol-v1.json')
assert report['factsHash']==pointer['hash'];assert report['protocolHash']==hashlib.sha256(Path('docs/public-activity-capture-protocol-v1.json').read_bytes()).hexdigest()
for path,h in protocol['sources'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==h
assert protocol['pairs']==['BTC/EUR','ETH/EUR'] and protocol['limit']==96
assert len(report['results'])==2 and report['completePairs']==2 and report['rows']==192
checked=0;share_checks=0;max_error=0;summaries=[]
for result,pair in zip(report['results'],protocol['pairs']):
    assert result['pair']==pair;raw_path=Path(result['rawPath']);assert hashlib.sha256(raw_path.read_bytes()).hexdigest()==result['rawHash'];raw=read(raw_path);parsed=result['parsed'];assert len(raw)==len(parsed['bars'])==96
    assert parsed['complete'] and parsed['pair']==pair and parsed['closedAt']==protocol['closedAt'] and parsed['capturedAt']==result['capturedAt'];assert result['requestedAt']<=result['capturedAt'] and result['capturedAt']>=protocol['closedAt']
    qsum=D(0);bsum=D(0);buyq=D(0);buyb=D(0);trades=0
    for i,(source,bar) in enumerate(zip(sorted(raw,key=lambda x:x[0]),parsed['bars'])):
        assert len(source)==12;ts=protocol['from']+i*900000;assert source[0]==ts and source[6]==ts+900000-1
        candle=bar['candle'];assert candle['ts']==ts and candle['pair']==pair and candle['interval']==15
        for field,index in [('open',1),('high',2),('low',3),('close',4),('volume',5)]:assert candle[field]==float(source[index])
        for field,index in [('quoteVolume',7),('takerBuyBaseVolume',9),('takerBuyQuoteVolume',10)]:assert bar[field]==float(source[index])
        assert bar['trades']==source[8] and type(source[8])==int and source[8]>=0
        base=D(source[5]);quote=D(source[7]);tbase=D(source[9]);tquote=D(source[10]);assert 0<=tbase<=base and 0<=tquote<=quote
        for actual,denominator,numerator in [(bar['takerBuyBaseShare'],base,tbase),(bar['takerBuyQuoteShare'],quote,tquote)]:
            if denominator==0:assert actual is None
            else:
                expected=float(numerator/denominator);assert math.isclose(actual,expected,rel_tol=1e-12,abs_tol=1e-12);max_error=max(max_error,abs(actual-expected));share_checks+=1
        # Diagnostic on this actual sample, not an extra undocumented parser rejection rule.
        if base:assert D(source[3])-D('0.00000001')<=quote/base<=D(source[2])+D('0.00000001')
        qsum+=quote;bsum+=base;buyq+=tquote;buyb+=tbase;trades+=source[8];checked+=1
    summaries.append(dict(pair=pair,closedAt=parsed['closedAt'],capturedAt=parsed['capturedAt'],bars=96,actualQuoteVolume=str(qsum),actualBaseVolume=str(bsum),trades=trades,windowTakerBuyQuoteShare=float(buyq/qsum) if qsum else None,windowTakerBuyBaseShare=float(buyb/bsum) if bsum else None,scope='Descriptive one-venue24h aggregate, not book depth, trade prediction or independent profit evidence'))
proof=dict(version='public-activity-raw-decimal-proof-v1',reportHash=pointer['hash'],reportFileSha256=hashlib.sha256(Path(pointer['path']).read_bytes()).hexdigest(),verifierSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),rowsVerified=checked,decimalSharesVerified=share_checks,precisionDigits=60,maximumShareDifference=max_error,captureAndClosedClocksVerified=True,allRawOhlcvAndRetainedFieldsVerified=True,windowSummaries=summaries,modelFitted=False,activeContextChanged=False,profitabilityEstablished=False)
Path('docs/public-activity-raw-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
