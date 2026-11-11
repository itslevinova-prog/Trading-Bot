import json, hashlib, math
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/validation-loss-latest.json');raw=Path(pointer['path']).read_bytes();r=json.loads(raw);assert r['factsHash']==pointer['hash']
p=read('docs/validation-loss-protocol-v1.json');v=read(p['validation']);m=read(p['models']);ranking=read(p['ranking'])
assert v['factsHash']==p['validationHash'] and m['factsHash']==p['modelsHash'] and ranking['factsHash']==p['rankingHash']
modes=['zero','mean','ridge','common','aggressor'];totals={k:[0,0.,0.] for k in ['original','alternate','mean','zero']};selected_counts={k:0 for k in modes};all_winners=[];changed=0;forecasts=0
close=lambda a,b: (a is None and b is None) or (a is not None and b is not None and math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-14))
for vf,mf,rf,actual in zip(v['folds'],m['folds'],ranking['folds'],r['folds'],strict=True):
    assert vf['window']==mf['window']==rf['window']==actual['window'];rows=vf['validationRows'];scores={}
    for x in rows:assert vf['window']['validationStart']<=x['decisionAt']<x['labelEnd']<vf['window']['testStart']
    for mode in modes:
        known=[x for x in rows if x['netReturn'] is not None];e=[(x['predictions'][mode] or 0)-x['netReturn'] for x in known]
        scores[mode]={'knownLabels':len(known),'coverage':sum(x['predictions'][mode] is not None for x in rows)/len(rows),'mae':sum(map(abs,e))/len(e),'mse':sum(x*x for x in e)/len(e)}
        for key,value in scores[mode].items():assert close(value,actual['selection']['scores'][mode][key])
    selected='zero';best=scores['zero']['mse']
    original='zero';best_mae=scores['zero']['mae']
    if scores['zero']['knownLabels']>=40:
        for mode in modes[1:]:
            if scores[mode]['coverage']>=.95:
                if scores[mode]['mse']<best-1e-12:selected=mode;best=scores[mode]['mse']
                if scores[mode]['mae']<best_mae-1e-12:original=mode;best_mae=scores[mode]['mae']
    assert selected==actual['selection']['selected'] and original==actual['selection']['originalSelected']==vf['existingSelected'];selected_counts[selected]+=1
    groups={}
    for source,saved in zip(mf['predictions'],actual['testRows'],strict=True):
        expected={'pair':source['pair'],'decisionAt':source['decisionAt'],'netReturn':source['netReturn'],'originalPrediction':source['predictions'][original],'alternatePrediction':source['predictions'][selected],'meanPrediction':source['predictions']['mean'],'zeroPrediction':0};assert saved==expected;groups.setdefault(source['decisionAt'],[]).append(source)
        for key in totals:
            forecasts+=1
            if source['netReturn'] is None:continue
            error=(saved[key+'Prediction'] or 0)-source['netReturn'];totals[key][0]+=1;totals[key][1]+=error*error;totals[key][2]+=abs(error)
    for choice,original_choice,clock in zip(actual['alternateChoices'],actual['originalChoices'],sorted(groups),strict=True):
        candidates=[x for x in groups[clock] if x['predictions'][selected] is not None and x['predictions'][selected]>.005]
        candidates.sort(key=lambda x:(-x['predictions'][selected],x['pair']));winner=candidates[0] if candidates else None
        expected={'pair':winner['pair'],'forecast':winner['predictions'][selected]} if winner else None
        assert choice['decisionAt']==clock and choice['winner']==expected
        assert choice['netReturn']==(winner['netReturn'] if winner else None)
        if winner:all_winners.append(choice)
        if (choice['winner'] or {}).get('pair')!=(original_choice['winner'] or {}).get('pair'):changed+=1
assert len(r['folds'])==41 and selected_counts==r['summary']['selectedCounts'];assert changed==r['summary']['changedTestClockKeys']
assert len(all_winners)==r['summary']['opportunityClocks'];known=[x for x in all_winners if x['netReturn'] is not None]
assert close(sum(x['netReturn'] for x in known)/len(known) if known else None,r['summary']['meanKnownOpportunityLabel'])
for key,(n,se,ae) in totals.items():
    assert n==r['summary']['testMetrics'][key]['known'];assert close(se/n,r['summary']['testMetrics'][key]['mse']);assert close(ae/n,r['summary']['testMetrics'][key]['mae'])
proof={'version':'validation-loss-independent-v1','reportHash':pointer['hash'],'reportFileSha256':hashlib.sha256(raw).hexdigest(),'verifierHash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'foldsVerified':41,'validationRowsVerified':sum(len(f['validationRows']) for f in v['folds']),'testForecastComparisonsVerified':forecasts,'testClockChoicesVerified':sum(len(f['alternateChoices']) for f in r['folds']),'selectedCounts':selected_counts,'changedClockChoices':changed,'knownOpportunityLabels':len(known),'newModelFitted':False,'actualSelectorChanged':False,'independentSamples':None,'profitabilityEstablished':False}
Path('docs/validation-loss-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
