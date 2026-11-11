"""Independent candidate-key sensitivity; deliberately never reads test payoffs."""
import json,hashlib
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/validation-behavior-latest.json');report=read(pointer['path']);p=read('docs/validation-behavior-protocol-v1.json');validation=read(p['validation']);ranking=read(p['ranking']);assert report['factsHash']==pointer['hash'] and report['validationHash']==validation['factsHash']==p['validationHash'] and report['rankingHash']==ranking['factsHash']==p['rankingHash'];assert sha('docs/validation-behavior-protocol-v1.json')==report['protocolHash'] and sha('scripts/audit-validation-behavior.mjs')==p['runnerHash']
all_cases=[];changed_fold_count=0
for fold,v,r in zip(report['folds'],validation['folds'],ranking['folds']):
    assert fold['window']==v['window']==r['window'];baseline=r['variants']['extended-selected']['choices'];expected_cases=[]
    for l in v['audit']['leaveOneClockOut']:
        alternate=r['variants'][l['selected']]['choices'];changes=[]
        for a,b in zip(baseline,alternate):
            assert a['decisionAt']==b['decisionAt'];ap=a['winner']['pair'] if a['winner'] else None;bp=b['winner']['pair'] if b['winner'] else None
            if ap!=bp:changes.append(dict(decisionAt=a['decisionAt'],baselinePair=ap,alternatePair=bp))
        expected_cases.append(dict(removedValidationClock=l['removedClock'],baselineSelected=v['existingSelected'],alternateSelected=l['selected'],modeChanged=l['changedFromFull'],testClockComparisons=8,changedTestClockKeys=changes))
    assert expected_cases==fold['cases'];all_cases+=expected_cases;changed_fold_count+=int(any(c['changedTestClockKeys'] for c in expected_cases))
changes=[r for c in all_cases for r in c['changedTestClockKeys']];expected=dict(folds=41,clockRemovalCases=len(all_cases),modeChangedCases=sum(c['modeChanged'] for c in all_cases),casesWithChangedTestDecisions=sum(bool(c['changedTestClockKeys']) for c in all_cases),foldsWithChangedTestDecisions=changed_fold_count,testClockComparisons=sum(c['testClockComparisons'] for c in all_cases),changedClockComparisons=len(changes),uniqueChangedTestClocks=len({r['decisionAt'] for r in changes}));assert expected==report['summary'];assert report['testPayoffsUsed'] is False and report['actualSelectorChanged'] is False
proof=dict(version='validation-behavior-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),clockRemovalCasesVerified=len(all_cases),candidateClockComparisonsVerified=expected['testClockComparisons'],modeChanges=expected['modeChangedCases'],casesWithChangedDecisions=expected['casesWithChangedTestDecisions'],uniqueChangedEconomicClocks=expected['uniqueChangedTestClocks'],testPayoffsUsed=False,actualSelectorChanged=False,newModelFitted=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/validation-behavior-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
