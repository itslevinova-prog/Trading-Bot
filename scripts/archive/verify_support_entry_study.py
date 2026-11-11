"""Independent empirical-cutoff, masking and before-ranking verification. No model fit/network."""
import json,hashlib,math
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/support-entry-study-latest.json');report=read(pointer['path']);p=read('docs/support-entry-study-protocol-v1.json');assert report['factsHash']==pointer['hash'] and sha('docs/support-entry-study-protocol-v1.json')==report['protocolHash'];assert sha('scripts/run-support-entry-study.mjs')==p['runnerHash']
for path,h in p['sources'].items():assert sha(path)==h
support=read(p['support']);models=read(p['models']);old=read(p['ranking']);corpus=read(p['corpus']);assert support['factsHash']==p['supportHash'] and models['factsHash']==p['modelsHash'] and old['factsHash']==p['rankingHash'] and corpus['factsHash']==p['corpusHash'];assert report['originalControls']==old['aggregate']
by_key={(r['pair'],r['decisionAt']):r for r in corpus['observations']};cost=corpus['target']['costs'];exit_factor=(1-cost['spreadBps']/20000)*(1-cost['slippageBps']/10000)*(1-cost['feeRate']);near=lambda a,b:math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
def eq(a,b):
    if isinstance(a,dict):assert set(a)==set(b);[eq(v,b[k]) for k,v in a.items()]
    elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
    elif isinstance(a,(int,float)) and not isinstance(a,bool):assert near(a,b)
    else:assert a==b
rows_checked=0;choices_checked=0;cutoffs=0;aggregate_rows={m:[] for m in ['common','aggressor']};aggregate_choices={m:[] for m in aggregate_rows};reselected={m:0 for m in aggregate_rows}
for f,geometry,parent,rank in zip(report['folds'],support['folds'],models['folds'],old['folds']):
    assert f['window']==geometry['window']==parent['window']==rank['window']
    for mode,dim in [('common','8'),('aggressor','9')]:
        item=f['variants'][mode];m=geometry['variants'][dim]['support'];cal=item['calibration'];assert len(m['referenceNearest'])==m['rows']>=200 and m['referenceMean']>0;cut=sorted(m['referenceNearest'])[math.ceil(.95*m['rows'])-1];ratio=cut/m['referenceMean'];assert cal['ready'] and cal['quantile']==.95 and cal['supportHash']==m['hash'] and near(cut,cal['nearestDistanceCutoff']) and near(ratio,cal['referenceRatioCutoff']);cutoffs+=1
        groups={}
        for r,q,prediction in zip(item['rows'],geometry['variants'][dim]['queries'],parent['predictions']):
            assert r['pair']==q['pair']==prediction['pair'] and r['decisionAt']==q['decisionAt']==prediction['decisionAt'];assert r['diagnostic']==q['result'];original=prediction['predictions'][mode];assert r['originalForecast']==original;d=q['result']
            reason='original-forecast-unavailable' if original is None else d['reason'] if not d['complete'] else 'outside-training-support' if d['referenceRatio']>ratio else None
            expected=original if reason is None else None;assert r['forecast']==expected and r['reason']==reason and r['retained']==(reason is None)
            groups.setdefault(r['decisionAt'],[]).append((r['pair'],expected));aggregate_rows[mode].append(r);rows_checked+=1
        cs=[];old_clock={c['decisionAt']:c for c in rank['variants'][mode]['choices']}
        for at,rows in sorted(groups.items()):
            candidates=sorted([(pair,value) for pair,value in rows if value is not None and value>.005],key=lambda x:(-x[1],x[0]));winner=dict(pair=candidates[0][0],forecast=candidates[0][1]) if candidates else None
            c=dict(decisionAt=at,universeRows=len(rows),abstentions=sum(v is None for pair,v in rows),aboveMarginRows=len(candidates),winner=winner,entryAt=None,outcome=None,netReturn=None,labelPayoffLower=0,labelPayoffUpper=0,entryBarTimingUncertain=False)
            if winner:
                assert old_clock[at]['winner'] is not None
                if old_clock[at]['winner']['pair']!=winner['pair']:reselected[mode]+=1
                source=by_key[(winner['pair'],at)];o=source['outcome'];c.update(entryAt=source['entryAt'],outcome=o['outcome'],netReturn=o['netReturn'],labelPayoffLower=o['netReturn'] if o['netReturn'] is not None else o['stopPrice']*exit_factor/o['entryBasis']-1,labelPayoffUpper=o['netReturn'] if o['netReturn'] is not None else o['targetPrice']*exit_factor/o['entryBasis']-1,entryBarTimingUncertain=o['eventBarTs']==source['entryAt'] and o['outcome']!='timeout')
            cs.append(c);choices_checked+=1
        eq(cs,item['choices']);aggregate_choices[mode]+=cs
for mode in aggregate_rows:
    rows=aggregate_rows[mode];cs=aggregate_choices[mode];active=[c for c in cs if c['winner']];known=[c for c in active if c['netReturn'] is not None]
    expected=dict(clocks=len(cs),rankedOpportunities=len(active),noTradeClocks=len(cs)-len(active),knownOpportunityLabels=len(known),ambiguousWinners=len(active)-len(known),meanForecast=sum(c['winner']['forecast'] for c in active)/len(active) if active else None,meanOpportunityLabel=sum(c['netReturn'] for c in known)/len(known) if known else None,meanOverprediction=sum(c['winner']['forecast']-c['netReturn'] for c in known)/len(known) if known else None,labelSumLower=sum(c['labelPayoffLower'] for c in cs),labelSumUpper=sum(c['labelPayoffUpper'] for c in cs),originalForecastsUnavailable=sum(r['originalForecast'] is None for r in rows),newlyMaskedEntryScores=sum(r['originalForecast'] is not None and r['forecast'] is None for r in rows),newlyMaskedAboveMargin=sum(r['originalForecast'] is not None and r['originalForecast']>.005 and r['forecast'] is None for r in rows));eq(expected,report['aggregate'][mode])
assert cutoffs==82 and rows_checked==13120 and choices_checked==656;assert report['originalForecastFilesChanged'] is False and report['newPredictiveModelFitted'] is False and report['newSelectorChosen'] is False and report['activeStrategyChanged'] is False and report['portfolioReturn'] is None
proof=dict(version='support-entry-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),trainingOnlyCutoffsVerified=cutoffs,entryScoreRowsVerified=rows_checked,clockChoicesVerified=choices_checked,supportedSecondCandidatesReselected=reselected,noNewOpportunityClocksCreated=True,nullForecastsNeverReactivated=True,originalControlsExact=True,originalForecastsUnchanged=True,empiricalQuantile=.95,confidenceInterpretation=False,newFit=False,activeStrategyChanged=False,portfolioReturn=None,julyLoaded=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/support-entry-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
