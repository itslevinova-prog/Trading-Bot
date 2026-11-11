"""Independent grouping/quantile/label audit of already frozen geometric outputs."""
import json,hashlib,math
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/support-opportunity-latest.json');report=read(pointer['path']);p=read('docs/support-opportunity-protocol-v1.json');assert report['factsHash']==pointer['hash'] and sha('docs/support-opportunity-protocol-v1.json')==report['protocolHash'];assert sha('scripts/audit-support-opportunities.mjs')==p['runnerHash']
support=read(p['support']);models=read(p['models']);ranking=read(p['ranking']);assert support['factsHash']==p['supportHash'] and models['factsHash']==p['modelsHash'] and ranking['factsHash']==p['rankingHash'];assert read('docs/feature-support-independent.json')['reportHash']==support['factsHash']
rows_checked=0;groups_checked=0;winner_rows=0
near=lambda a,b:math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-12)
def eq(a,b):
    if isinstance(a,dict):assert set(a)==set(b);[eq(v,b[k]) for k,v in a.items()]
    elif isinstance(a,list):assert len(a)==len(b);[eq(x,y) for x,y in zip(a,b)]
    elif isinstance(a,(int,float)) and not isinstance(a,bool):assert near(a,b)
    else:assert a==b
for dim,mode in [('8','common'),('9','aggressor')]:
    rows=[];expected_winners=[]
    for f,m,r in zip(support['folds'],models['folds'],ranking['folds']):
        assert f['window']==m['window']==r['window'];choices={c['decisionAt']:c for c in r['variants'][mode]['choices']}
        for q,old in zip(f['variants'][dim]['queries'],m['predictions']):
            assert q['pair']==old['pair'] and q['decisionAt']==old['decisionAt'];choice=choices[q['decisionAt']];winner=choice['winner'] is not None and choice['winner']['pair']==q['pair'];entry=dict(pair=q['pair'],decisionAt=q['decisionAt'],d=q['result'],forecast=old['predictions'][mode],label=old['netReturn'],winner=winner);rows.append(entry);rows_checked+=1
            if winner:assert entry['d']['complete'] and entry['d']['marginalZ6Pass'] and entry['forecast']>.005;expected_winners.append(dict(pair=q['pair'],decisionAt=q['decisionAt'],referenceRatio=entry['d']['referenceRatio'],forecast=entry['forecast'],opportunityLabel=entry['label']));winner_rows+=1
    predicates=dict(allQueries=lambda r:True,sourceAvailable=lambda r:r['d']['complete'],forecastEligible=lambda r:r['forecast'] is not None,aboveMargin=lambda r:r['forecast'] is not None and r['forecast']>.005,rankedWinners=lambda r:r['winner'],eligibleNonwinners=lambda r:r['forecast'] is not None and not r['winner'])
    for name,predicate in predicates.items():
        group=[r for r in rows if predicate(r)];distances=sorted(r['d']['referenceRatio'] for r in group if r['d']['complete']);forecasts=[r for r in group if r['forecast'] is not None];labels=[r for r in group if r['label'] is not None];scored=[r for r in forecasts if r['label'] is not None]
        expected=dict(rows=len(group),distanceKnown=len(distances),forecastKnown=len(forecasts),labelKnown=len(labels),forecastAndLabelKnown=len(scored),ratioMean=sum(distances)/len(distances) if distances else None,ratioMedian=distances[math.ceil(len(distances)*.5)-1] if distances else None,ratioP90=distances[math.ceil(len(distances)*.9)-1] if distances else None,ratioMaximum=distances[-1] if distances else None,meanForecast=sum(r['forecast'] for r in forecasts)/len(forecasts) if forecasts else None,meanOpportunityLabel=sum(r['label'] for r in labels)/len(labels) if labels else None,meanOverprediction=sum(r['forecast']-r['label'] for r in scored)/len(scored) if scored else None);eq(expected,report['groups'][dim][name]);groups_checked+=1
    eq(expected_winners,report['winners'][dim]);assert len(expected_winners)==ranking['aggregate'][mode]['winnerClocks']
assert rows_checked==13120 and groups_checked==12 and winner_rows==106
assert report['thresholdChosen'] is False and report['forecastsChanged'] is False and report['newPredictiveModelFitted'] is False and report['newSelectorChosen'] is False and report['portfolioReturn'] is None
proof=dict(version='support-opportunity-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),frozenGeometryHash=p['supportHash'],queryRowsChecked=rows_checked,predefinedGroupsChecked=groups_checked,winnerRecordsChecked=winner_rows,sourceMissingAndUnknownLabelsPreserved=True,groupsChosenWithoutOutcomes=True,forecastAndRankingKeysUnchanged=True,thresholdChosen=False,newFit=False,portfolioReturn=None,independentSamples=None,profitabilityEstablished=False)
Path('docs/support-opportunity-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
