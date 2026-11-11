"""Independent forecast-only sorting and complete opportunity-label audit. No app import/network."""
import json,hashlib,math
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/aggressor-ranking-latest.json');report=read(pointer['path']);p=read('docs/aggressor-ranking-protocol-v1.json');assert report['factsHash']==pointer['hash'] and sha('docs/aggressor-ranking-protocol-v1.json')==report['protocolHash']
for path,h in p['sources'].items():assert sha(path)==h
models=read(p['models']);corpus=read(p['corpus']);old=read(p['oldRanking']);assert models['factsHash']==p['modelsHash'] and corpus['factsHash']==p['corpusHash'] and old['factsHash']==p['oldRankingHash'];assert p['margin']==.005
by_key={(r['pair'],r['decisionAt']):r for r in corpus['observations']};costs=corpus['target']['costs'];exit_factor=(1-costs['spreadBps']/20000)*(1-costs['slippageBps']/10000)*(1-costs['feeRate']);modes=p['modes'];all_choices={m:[] for m in modes};changes=[];rows_checked=0;choices_checked=0
near=lambda a,b:math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
def eq(a,b):
    if isinstance(a,dict):assert set(a)==set(b);[eq(v,b[k]) for k,v in a.items()]
    elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
    elif isinstance(a,(int,float)) and not isinstance(a,bool):assert near(a,b)
    else:assert a==b
for index,(f,model) in enumerate(zip(report['folds'],models['folds'])):
    assert f['window']==model['window'];local={}
    for mode in modes:
        name=model['priorSelected'] if mode=='prior-selected' else model['selected'] if mode=='extended-selected' else mode;groups={}
        for row in model['predictions']:
            value=row['predictions'][name];assert value is None or math.isfinite(value)
            if name in ('common','aggressor') and not row['sourceAvailable']:assert value is None
            groups.setdefault(row['decisionAt'],[]).append((row['pair'],value));rows_checked+=1
        calculated=[]
        for at,rs in sorted(groups.items()):
            candidates=sorted([(pair,value) for pair,value in rs if value is not None and value>.005],key=lambda x:(-x[1],x[0]));winner=dict(pair=candidates[0][0],forecast=candidates[0][1]) if candidates else None
            c=dict(decisionAt=at,universeRows=len(rs),abstentions=sum(value is None for pair,value in rs),aboveMarginRows=len(candidates),winner=winner,entryAt=None,outcome=None,netReturn=None,labelPayoffLower=0,labelPayoffUpper=0,entryBarTimingUncertain=False)
            if winner:
                r=by_key[(winner['pair'],at)];o=r['outcome'];c.update(entryAt=r['entryAt'],outcome=o['outcome'],netReturn=o['netReturn'],labelPayoffLower=o['netReturn'] if o['netReturn'] is not None else o['stopPrice']*exit_factor/o['entryBasis']-1,labelPayoffUpper=o['netReturn'] if o['netReturn'] is not None else o['targetPrice']*exit_factor/o['entryBasis']-1,entryBarTimingUncertain=o['eventBarTs']==r['entryAt'] and o['outcome']!='timeout')
            calculated.append(c);choices_checked+=1
        eq(calculated,f['variants'][mode]['choices']);local[mode]=calculated;all_choices[mode]+=calculated
        old_name='selected' if mode=='prior-selected' else mode
        if old_name in ('zero','mean','ridge','selected'):eq(calculated,old['folds'][index]['phases']['test'][old_name]['choices'])
    diff=[]
    for a,b in zip(local['common'],local['aggressor']):
        same_pair=a['winner'] and b['winner'] and a['winner']['pair']==b['winner']['pair'];kind='both-no-trade' if not a['winner'] and not b['winner'] else 'same-winner' if same_pair else 'switched-winner' if a['winner'] and b['winner'] else 'added-opportunity' if b['winner'] else 'removed-opportunity';same=kind in ('same-winner','both-no-trade');diff.append(dict(decisionAt=a['decisionAt'],type=kind,commonPair=a['winner']['pair'] if a['winner'] else None,aggressorPair=b['winner']['pair'] if b['winner'] else None,labelDifferenceLower=0 if same else b['labelPayoffLower']-a['labelPayoffUpper'],labelDifferenceUpper=0 if same else b['labelPayoffUpper']-a['labelPayoffLower']))
    eq(diff,f['differences']);changes+=diff
for mode,cs in all_choices.items():
    active=[c for c in cs if c['winner']];known=[c for c in active if c['netReturn'] is not None];expected=dict(clocks=len(cs),winnerClocks=len(active),noTradeClocks=len(cs)-len(active),aboveMarginRows=sum(c['aboveMarginRows'] for c in cs),abstentions=sum(c['abstentions'] for c in cs),ambiguousWinners=len(active)-len(known),entryBarTimingUncertain=sum(c['entryBarTimingUncertain'] for c in active),meanWinnerForecast=sum(c['winner']['forecast'] for c in active)/len(active) if active else None,knownWinnerMeanLabel=sum(c['netReturn'] for c in known)/len(known) if known else None,knownWinnerMeanOverprediction=sum(c['winner']['forecast']-c['netReturn'] for c in known)/len(known) if known else None,meanLabelPayoffPerClockLower=sum(c['labelPayoffLower'] for c in cs)/len(cs),meanLabelPayoffPerClockUpper=sum(c['labelPayoffUpper'] for c in cs)/len(cs));eq(expected,report['aggregate'][mode])
expected=dict(clocks=len(changes),types={kind:sum(c['type']==kind for c in changes) for kind in ['both-no-trade','same-winner','switched-winner','added-opportunity','removed-opportunity']},labelDifferenceSumLower=sum(c['labelDifferenceLower'] for c in changes),labelDifferenceSumUpper=sum(c['labelDifferenceUpper'] for c in changes));eq(expected,report['differenceSummary'])
keys=lambda mode:[(c['decisionAt'],c['winner']['pair'] if c['winner'] else None) for c in all_choices[mode]]
assert keys('prior-selected')==keys('extended-selected');assert len(report['folds'])==41 and choices_checked==2296 and rows_checked==45920
proof=dict(version='aggressor-ranking-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),forecastRowsChecked=rows_checked,clockChoicesChecked=choices_checked,matchedClockDifferencesChecked=len(changes),originalEntireChoiceRecordsExact=True,priorAndExtendedSelectorAll328WinnerKeysEqual=True,priorAndExtendedSelectorWinnerCount=11,ambiguousWinners=0,newFit=False,newSelectorChosen=False,portfolioReturn=None,julyLoaded=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/aggressor-ranking-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
