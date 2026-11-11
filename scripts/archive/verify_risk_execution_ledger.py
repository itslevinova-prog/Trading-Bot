import json,hashlib,decimal,math
from pathlib import Path
from datetime import datetime,timezone
D=decimal.Decimal;decimal.getcontext().prec=80
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/risk-execution-comparison-latest.json');r=read(pointer['path']);assert r['factsHash']==pointer['hash'] and r['networkCalls']==0 and r['modelCalls']==0 and r['julyLoaded'] is False
assert len(r['results'])==4 and {(s['period'],s['fee']) for s in r['results']}=={(p,f) for p in ['2026-01','2026-04'] for f in [.001,.002]}
close=lambda a,b: abs(a-b)<=D('0.0000001')*max(D(1),abs(a),abs(b))
filled=0;fees=0;closed=0;cash_checks=0;summary=[]
for scenario in r['results']:
    opts=scenario['options'];rate=D(str(opts['feeRate']))
    for variant in scenario['variants']:
        v=variant['result'];cash=D(str(v['startingBalance']));positions={};fee_total=D(0);wins=0;sells=0
        for f in v['fills']:
            pair=f['pair'];qty=D(str(f['qty']));price=D(str(f['price']));fee=D(str(f['fee']));cost=qty*price
            assert qty>0 and price>0 and fee>=0 and close(fee,cost*rate);fee_total+=fee;fees+=1;filled+=1
            if f['side']=='buy':
                cash-=cost+fee;p=positions.setdefault(pair,{'qty':D(0),'basis':D(0)});p['qty']+=qty;p['basis']+=cost+fee
            else:
                assert f['side']=='sell';p=positions.pop(pair);assert close(p['qty'],qty)
                pnl=cost-fee-p['basis'];assert close(pnl,D(str(f['realizedPnl'])));cash+=cost-fee;sells+=1;closed+=1;wins+=pnl>0
            assert cash>=D('-0.0000001')
        assert sells==v['closedTrades'] and len(positions)==v['unliquidatedPositions'];assert close(fee_total,D(str(v['fees'])))
        if not positions:assert close(cash,D(str(v['finalEquity'])));cash_checks+=1
        else:assert D(str(v['finalEquity']))>=cash-D('0.0000001')
        expected_return=(D(str(v['finalEquity']))/D(str(v['startingBalance']))-1)*100;assert close(expected_return,D(str(v['returnPct'])))
        if sells:assert close(D(wins)/D(sells)*100,D(str(v['winRatePct'])))
        else:assert v['winRatePct'] is None
        summary.append({'period':scenario['period'],'fee':scenario['fee'],'variant':variant['name'],'fills':len(v['fills']),'closedTrades':sells,'unliquidated':len(positions),'computedCash':str(cash),'reportedFinalEquity':v['finalEquity'],'returnPct':v['returnPct']})
    assert math.isclose(scenario['returnDifferencePct'],scenario['variants'][1]['result']['returnPct']-scenario['variants'][0]['result']['returnPct'],abs_tol=1e-12)
facts={'version':'risk-execution-ledger-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'report':pointer,'reportFileSha256':sha(pointer['path']),'verifierSha256':sha(__file__),'variantsVerified':len(summary),'fillsVerified':filled,'feesVerified':fees,'closedPnlsVerified':closed,'fullyLiquidatedCashChecks':cash_checks,'summary':summary,'profitabilityEstablished':False,'scope':'Independent80digitDecimal fill cost/fee/cash/position basis/realized PNL/return/winrate reconstruction. Float tolerance is explicit. Does not re-evaluate entry intelligence, historical source availability or order-book realism; same historical scenarios are dependent/descriptive.'}
raw=json.dumps(facts,sort_keys=True,separators=(',',':')).encode();out='docs/risk-execution-ledger-independent-'+hashlib.sha256(raw).hexdigest()[:16]+'.json';Path(out).write_text(json.dumps(facts,indent=2)+'\n',encoding='utf-8');Path('docs/risk-execution-ledger-independent-latest.json').write_text(json.dumps({'path':out,'sha256':sha(out)},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'fillsVerified':filled,'variantsVerified':len(summary),'fullyLiquidatedCashChecks':cash_checks}))
