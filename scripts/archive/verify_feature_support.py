"""Independent vectorized geometry verification; no app/DataSieve import or outcome use."""
import os
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
import json,hashlib,math
from pathlib import Path
import numpy as np
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pointer=read('docs/feature-support-latest.json');report=read(pointer['path']);p=read('docs/feature-support-protocol-v1.json');parent=read(p['models']);request=read(parent['nativeRequest']);assert report['factsHash']==pointer['hash'] and report['modelsHash']==parent['factsHash']==p['modelsHash'];assert sha('docs/feature-support-protocol-v1.json')==report['protocolHash'];assert sha(parent['nativeRequest'])==parent['nativeRequestHash']
for path,h in p['sources'].items():assert sha(path)==h
reference_rows=0;queries=0;unknown=0;max_reference_error=0;max_query_error=0;all_ratios={'8':[],'9':[]};marginal={'8':0,'9':0}
assert len(report['folds'])==len(parent['folds'])==len(request['folds'])==41
for index,(fold,old,inputs) in enumerate(zip(report['folds'],parent['folds'],request['folds'])):
    assert fold['window']==old['window'];training={(r['pair'],r['decisionAt']):r for r in inputs['rows']};assert len(training)==len(inputs['rows'])>=200
    for dim in (8,9):
        v=fold['variants'][str(dim)];m=v['support'];points=m['points'];assert m['version']=='clock-excluded-feature-support-v1' and m['dimensions']==dim and m['trainedAt']==inputs['trainedAt'] and m['rows']==len(training);assert len({(r['pair'],r['decisionAt']) for r in points})==len(training)
        raw=np.asarray([training[(r['pair'],r['decisionAt'])]['x'][:dim] for r in points],dtype=float);assert all(training[(r['pair'],r['decisionAt'])]['labelEnd']<m['trainedAt'] for r in points)
        means=raw.mean(axis=0);stds=raw.std(axis=0);stds=np.where(stds==0,1,stds);assert np.allclose(means,m['means'],rtol=1e-12,atol=1e-12) and np.allclose(stds,m['stds'],rtol=1e-12,atol=1e-12)
        z=np.asarray([r['z'] for r in points]);assert np.allclose(z,(raw-means)/stds,rtol=1e-12,atol=1e-12);clocks=np.asarray([r['decisionAt'] for r in points]);assert len(set(clocks))==m['clocks']>=2
        distances=np.linalg.norm(z[:,None,:]-z[None,:,:],axis=2);distances[clocks[:,None]==clocks[None,:]]=np.inf;nearest=distances.min(axis=1);assert np.allclose(nearest,m['referenceNearest'],rtol=1e-12,atol=1e-12);mean=float(nearest.mean());assert math.isclose(mean,m['referenceMean'],rel_tol=1e-12,abs_tol=1e-12);max_reference_error=max(max_reference_error,float(np.max(np.abs(nearest-np.asarray(m['referenceNearest'])))));reference_rows+=len(points)
        expected_q=inputs['queryX'][old['originalCounts']['validation']:];assert len(v['queries'])==len(expected_q)==len(old['predictions']);assert m['lastLabelEnd']==max(r['labelEnd'] for r in inputs['rows'])
        for q,x,record in zip(v['queries'],expected_q,old['predictions']):
            assert q['pair']==record['pair'] and q['decisionAt']==record['decisionAt'];actual=q['result'];queries+=1
            if x is None:
                assert q['sourceAvailable'] is False and actual['complete'] is False and actual['reason']=='source-features-unavailable' and actual['nearestDistance'] is None and actual['referenceRatio'] is None;unknown+=1;continue
            assert q['sourceAvailable'] and actual['complete'] and actual['reason'] is None;assert m['trainedAt']<=q['decisionAt'] and q['decisionAt']-m['trainedAt']<=864000000 and q['decisionAt']-m['lastLabelEnd']<=864000000
            qz=(np.asarray(x[:dim])-np.asarray(m['means']))/np.asarray(m['stds']);ds=np.linalg.norm(z-qz,axis=1);distance=float(ds.min());ratio=distance/mean;assert math.isclose(distance,actual['nearestDistance'],rel_tol=1e-12,abs_tol=1e-12) and math.isclose(ratio,actual['referenceRatio'],rel_tol=1e-12,abs_tol=1e-12);max_query_error=max(max_query_error,abs(ratio-actual['referenceRatio']));all_ratios[str(dim)].append(actual['referenceRatio'])
            chosen=next(i for i,r in enumerate(points) if r['pair']==actual['nearestPair'] and r['decisionAt']==actual['nearestDecisionAt']);assert math.isclose(float(ds[chosen]),distance,rel_tol=1e-12,abs_tol=1e-12);flag=bool(np.all(np.abs(qz)<=6));assert flag==actual['marginalZ6Pass'];marginal[str(dim)]+=int(flag)
for dim in ('8','9'):
    xs=sorted(all_ratios[dim]);a=report['aggregate'][dim];assert a['rows']==6560 and a['complete']==len(xs)==6552 and a['sourceUnavailable']==8 and a['otherUnknown']==0 and a['marginalZ6Pass']==marginal[dim]
    for field,value in [('ratioMinimum',xs[0]),('ratioMedian',xs[math.ceil(len(xs)*.5)-1]),('ratioP90',xs[math.ceil(len(xs)*.9)-1]),('ratioP99',xs[math.ceil(len(xs)*.99)-1]),('ratioMaximum',xs[-1])]:assert math.isclose(value,a[field],rel_tol=1e-12,abs_tol=1e-12)
assert report['labelsOrForecastsPassedToMetric'] is False and report['thresholdChosen'] is False and report['forecastsChanged'] is False
proof=dict(version='feature-support-independent-v1',reportHash=pointer['hash'],reportFileSha256=sha(pointer['path']),verifierHash=sha(__file__),numpyVersion=np.__version__,supportSnapshots=82,trainReferenceRowsVerified=reference_rows,testQueriesVerified=queries,explicitMissingQueries=unknown,maximumReferenceDistanceDifference=max_reference_error,maximumQueryRatioDifference=max_query_error,clockExclusionAndTrainOnlyScalingVerified=True,nearestSourceIdentityVerified=True,labelsOrForecastsPassedToMetric=False,thresholdChosen=False,forecastsChanged=False,independentSamples=None,profitabilityEstablished=False)
Path('docs/feature-support-independent.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
