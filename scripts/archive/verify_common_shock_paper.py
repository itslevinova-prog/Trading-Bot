import json,hashlib,decimal,math
from pathlib import Path
decimal.getcontext().prec=60
D=lambda x:decimal.Decimal(str(x));read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
index=read('docs/common-shock-paper-witnesses.json');cases=[];fills=0;fees=0;max_error=D(0)
def close(a,b):
    global max_error
    error=abs(D(a)-D(b));max_error=max(max_error,error);assert error<D('0.00000001'),(a,b,error)
for p,h in index['sources'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h
for file in index['cases']:
    raw=Path(file['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==file['sha256'];r=json.loads(raw);assert r['hash']==file['hash'];f=r['facts'];assert f['feeRate']==.001;initial=f['initial'];final=f['after'];entry={x['pair']:x for x in initial['positions']};assert initial['policy']['mode']==r['mode'] and len(entry)==2;trades=final['trades'];assert len(trades)==4 and len({t['id'] for t in trades})==4;cash=D(1000);pnl=D(0);per_pair={}
    for t in trades:
        pair=t['pair'];qty=D(t['qty']);fill=D(t['fillPrice']);cost=qty*fill;fee=cost*D('.001');close(t['costEur'],cost);close(t['feeEur'],fee);fees+=1;fills+=1;per_pair.setdefault(pair,[]).append(t)
        if t['side']=='buy':
            base=D(100) if 'BTC' in pair else D(50);ask=base*D('1.0001');expected_qty=((D(100)/(1+D('.001'))/ask)*D(1000000)).to_integral_value(rounding=decimal.ROUND_FLOOR)/D(1000000);close(qty,expected_qty);close(fill,ask);cash-=cost+fee;close(entry[pair]['costBasisEur'],cost+fee);close(entry[pair]['stopLossPrice'],(cost+fee)/qty*D('.95'))
        else:
            close(qty,entry[pair]['qty']);expected_pnl=cost-fee-D(entry[pair]['costBasisEur']);close(t['realizedPnlEur'],expected_pnl);pnl+=expected_pnl;cash+=cost-fee
            if r['kind']=='full-exit' or 'BTC' in pair:
                base=D(100) if 'BTC' in pair else D(50);close(fill,base*D('.675'));assert fill<D(entry[pair]['stopLossPrice'])
            else:close(fill,D(entry[pair]['avgEntryPrice'])*D('1.05'));assert fill>D(entry[pair]['stopLossPrice'])
    for pair,items in per_pair.items():assert sorted(t['side'] for t in items)==['buy','sell']
    close(final['account']['cash'],cash);close(final['valuation']['equity'],cash);close(cash-D(1000),pnl);assert final['account']['status']=='paused' and final['account']['peakEquity']==1000;assert final['positions']==[] and final['failures']==[]
    if r['kind']=='full-exit':assert D(1000)-cash>D(initial['policy']['maxPortfolioRiskPct'])*1000
    else:
        mid=f['interim'];assert len(mid['positions'])==1 and len(mid['failures'])==1 and mid['valuation']['equity'] is None and mid['account']['status']=='paused';failure=mid['failures'][0];assert failure['state']=='retry_wait' and failure['trigger']=='Stop-Loss ausgelöst';assert failure['positionId']==mid['positions'][0]['id'];retry=next(t for t in trades if t['side']=='sell' and 'ETH' in t['pair']);assert retry['ts']>=failure['retryAt'] and retry['reason']==failure['trigger'];assert len(mid['trades'])==3
    cases.append({'mode':r['mode'],'kind':r['kind'],'finalCash':str(cash),'realizedPnl':str(pnl),'profitabilityEvidence':False})
proof={'version':'paper-common-shock-independent-v1','witnessIndexSha256':hashlib.sha256(Path('docs/common-shock-paper-witnesses.json').read_bytes()).hexdigest(),'verifierSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'casesVerified':len(cases),'realPaperFillsVerified':fills,'feeAmountsVerified':fees,'maxDecimalCurrencyError':str(max_error),'cases':cases,'scope':'Deterministic synthetic Safe/Risky held-position scenarios; arithmetic/ledger-state verification, not historical or forward profitability evidence. ActualPaper means local simulator transactions only.','externalAiCalls':0,'realOrders':0,'profitabilityEstablished':False}
Path('docs/common-shock-paper-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
