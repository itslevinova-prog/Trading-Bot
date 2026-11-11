"""Independent validation reconstruction, clock removal, ranking and calendar-role proof."""
import json,hashlib,math
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/validation-evidence-latest.json');report=read(pointer['path']);p=read('docs/validation-evidence-protocol-v1.json');models=read(p['models']);corpus=read(p['corpus']);prior=read(p['prior']);request=read(models['nativeRequest']);assert report['factsHash']==pointer['hash'] and sha('docs/validation-evidence-protocol-v1.json')==report['protocolHash'];assert sha('scripts/audit-validation-evidence.mjs')==p['runnerHash']
for path,h in p['sources'].items():assert sha(path)==h
assert models['factsHash']==p['modelsHash'] and corpus['factsHash']==p['corpusHash'] and prior['factsHash']==p['priorHash'];assert sha(models['nativeRequest'])==models['nativeRequestHash'];modes=['zero','mean','ridge','common','aggressor'];near=lambda a,b:math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
def eq(a,b):
    if isinstance(a,dict):assert set(a)==set(b);[eq(v,b[k]) for k,v in a.items()]
    elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
    elif isinstance(a,(int,float)) and not isinstance(a,bool):assert near(a,b)
    else:assert a==b
def predict(m,x,at):
    if x is None:return None
    z=[(v-m['means'][j])/m['stds'][j] for j,v in enumerate(x)]
    if at<m['trainedAt'] or at-m['trainedAt']>864000000 or at-m['lastLabelEnd']>864000000 or any(abs(v)>6 for v in z):return None
    return m['intercept']+sum(v*m['weights'][j] for j,v in enumerate(z))
def metrics(rows):
    out={}
    for mode in modes:
        known=[r for r in rows if r['netReturn'] is not None];absolute=sum(abs((r['predictions'][mode] or 0)-r['netReturn']) for r in known);squared=sum(((r['predictions'][mode] or 0)-r['netReturn'])**2 for r in known)
        out[mode]=dict(rows=len(rows),knownLabels=len(known),unknownLabels=len(rows)-len(known),absoluteError=absolute,squaredError=squared,mae=absolute/len(known) if known else None,rmse=math.sqrt(squared/len(known)) if known else None,coverage=sum(r['predictions'][mode] is not None for r in rows)/len(rows) if rows else None,positiveForecasts=sum(r['predictions'][mode] is not None and r['predictions'][mode]>0 for r in rows))
    return out
def select(rows):
    ms=metrics(rows);selected='zero';best=ms['zero']['mae'] if ms['zero']['mae'] is not None else math.inf;enough=ms['zero']['knownLabels']>=40
    if enough:
        for mode in modes[1:]:
            v=ms[mode]
            if v['coverage']>=.95 and v['mae'] is not None and v['mae']<best-1e-12:selected=mode;best=v['mae']
    return selected,ms,'existing-validation-MAE-and-coverage-rule' if enough else 'insufficient-known-validation-rows'
val_clocks=set();test_clocks=set();val_keys=set();test_keys=set();loco_cases=0;loco_changes=0;changed_folds=0;total_rows=0;predictions=0;opportunity_choices=0;selected_counts={m:0 for m in modes};histograms={m:{str(n):0 for n in range(9)} for m in modes};numeric=0;numeric_without=0
for f,parent,old,inp in zip(report['folds'],models['folds'],prior['folds'],request['folds']):
    w=f['window'];assert w==parent['window']==old['window'];raw=[r for r in corpus['observations'] if w['validationStart']<=r['decisionAt']<w['testStart'] and r['labelEnd']<w['testStart']];assert len(raw)==160
    evidence=[]
    for i,(r,actual) in enumerate(zip(raw,f['validationRows'])):
        x=inp['queryX'][i];expected=dict(pair=r['pair'],decisionAt=r['decisionAt'],labelEnd=r['labelEnd'],netReturn=r['outcome']['netReturn'],sourceAvailable=x is not None,predictions=dict(zero=0,mean=old['model']['ridge']['intercept'],ridge=predict(old['model']['ridge'],r['x'],r['decisionAt']),common=predict(parent['controlModel'],r['x'] if x is not None else None,r['decisionAt']),aggressor=predict(parent['model'],x,r['decisionAt'])));eq(expected,actual);evidence.append(expected);predictions+=5;total_rows+=1;val_clocks.add(r['decisionAt']);val_keys.add((r['pair'],r['decisionAt']))
    for r in parent['predictions']:test_clocks.add(r['decisionAt']);test_keys.add((r['pair'],r['decisionAt']))
    a=f['audit'];clocks=sorted({r['decisionAt'] for r in evidence});assert a['rows']==160 and a['distinctClocks']==len(clocks)==8 and a['distinctCalendarDays']==4 and a['pairs']==20 and a['knownLabels']==sum(r['netReturn'] is not None for r in evidence) and a['unknownLabels']==sum(r['netReturn'] is None for r in evidence) and a['sourceUnavailableRows']==sum(not r['sourceAvailable'] for r in evidence);assert a['clockTimes']==clocks
    selected,ms,reason=select(evidence);assert selected==a['full']['selected']==f['existingSelected']==parent['selected'];eq(ms,a['full']['metrics']);assert reason==a['full']['reason'];selected_counts[selected]+=1
    changes=0
    for clock,saved in zip(clocks,a['leaveOneClockOut']):
        remaining=[r for r in evidence if r['decisionAt']!=clock];name,_,reason=select(remaining);expected=dict(removedClock=clock,removedRows=20,remainingRows=140,remainingClocks=7,selected=name,changedFromFull=name!=selected,reason=reason);eq(expected,saved);loco_cases+=1;changes+=int(name!=selected)
    assert changes==a['leaveOneClockOutChanges'];loco_changes+=changes;changed_folds+=int(changes>0)
    for mode in modes:
        choices=[]
        for clock in clocks:
            rs=[r for r in evidence if r['decisionAt']==clock];eligible=sorted([r for r in rs if r['predictions'][mode] is not None and r['predictions'][mode]>.005],key=lambda r:(-r['predictions'][mode],r['pair']));winner=eligible[0] if eligible else None;c=dict(decisionAt=clock,universeRows=20,abstentions=sum(r['predictions'][mode] is None for r in rs),aboveMarginRows=len(eligible),winner=dict(pair=winner['pair'],forecast=winner['predictions'][mode]) if winner else None,labelEnd=winner['labelEnd'] if winner else None,netReturn=winner['netReturn'] if winner else None);choices.append(c);opportunity_choices+=1
        active=[c for c in choices if c['winner']];known=[c for c in active if c['netReturn'] is not None];expected=dict(choices=choices,rankedOpportunityClocks=len(active),noTradeClocks=8-len(active),knownOpportunityLabels=len(known),unknownOpportunityLabels=len(active)-len(known),distinctWinnerDays=len({c['decisionAt']//86400000 for c in active}),meanForecast=sum(c['winner']['forecast'] for c in active)/len(active) if active else None,meanKnownOpportunityLabel=sum(c['netReturn'] for c in known)/len(known) if known else None,meanKnownOverprediction=sum(c['winner']['forecast']-c['netReturn'] for c in known)/len(known) if known else None);eq(expected,a['opportunities'][mode]);histograms[mode][str(len(active))]+=1
    if selected not in ('zero','mean'):numeric+=1;numeric_without+=int(a['opportunities'][selected]['rankedOpportunityClocks']==0)
    assert a['independentSamples'] is None and a['confidenceEstimated'] is False and a['selectorChanged'] is False
summary=dict(folds=41,validationAssetRows=total_rows,clocksPerFold=8,calendarDaysPerFold=4,uniqueValidationClocks=len(val_clocks),uniqueTestClocks=len(test_clocks),validationTestSharedClocks=len(val_clocks&test_clocks),unionRoleClocks=len(val_clocks|test_clocks),uniqueValidationRowKeys=len(val_keys),uniqueTestRowKeys=len(test_keys),sharedValidationTestRowKeys=len(val_keys&test_keys),leaveOneClockOutCases=loco_cases,leaveOneClockOutSelectionChanges=loco_changes,foldsWithAnyLeaveOneClockOutChange=changed_folds,existingSelectionCounts=selected_counts,numericSelectedFolds=numeric,numericSelectedFoldsWithNoValidationOpportunity=numeric_without,validationOpportunityHistogram=histograms);eq(summary,report['summary']);assert report['sharedRoleClockTimes']==sorted(val_clocks&test_clocks)
proof=dict(version='validation-evidence-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),validationRowsReconstructed=total_rows,forecastValuesChecked=predictions,leaveOneClockOutCasesChecked=loco_cases,opportunityClockChoicesChecked=opportunity_choices,allLabelsStrictlyMature=True,fullSelectorsExact=True,uniqueValidationClocks=len(val_clocks),sharedValidationTestClocks=len(val_clocks&test_clocks),roleUnionClocks=len(val_clocks|test_clocks),selectorChanged=False,newModelFitted=False,confidenceEstimated=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/validation-evidence-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
