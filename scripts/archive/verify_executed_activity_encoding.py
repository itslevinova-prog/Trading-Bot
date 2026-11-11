"""Independent JSON transport decoder; no TypeScript implementation imports."""
import json,hashlib,re
from pathlib import Path
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
proof=read('docs/executed-activity-encoding-proof.json');path=Path(proof['witnessPath']);assert hashlib.sha256(path.read_bytes()).hexdigest()==proof['witnessHash'];data=read(path);results=[]
for case in data['cases']:
    encoded=dict(case['encoded']);original=case['original'];table=encoded.pop('researchDigestEncoding',None);digests=table['digests'] if table else []
    if table:assert table['format']=='value-digests-v1' and all(re.fullmatch('[a-f0-9]{64}',s) for s in digests) and len(digests)==len(set(digests))
    refs=[0]
    def decode(v):
        if isinstance(v,list):return [decode(x) for x in v]
        if isinstance(v,dict):
            if '$researchDigest' in v:
                assert len(v)==1 and type(v['$researchDigest'])==int and 0<=v['$researchDigest']<len(digests);refs[0]+=1;return digests[v['$researchDigest']]
            return {k:decode(x) for k,x in v.items()}
        return v
    restored=decode(encoded)
    if 'executedActivityEncoding' in restored:
        meta=restored.pop('executedActivityEncoding');assert meta['format']=='market-frame-runs-v1';markets=restored['marketContext']['markets'];i=0
        for run in meta['runs']:
            assert type(run['count'])==int and run['count']>0 and type(run['present'])==bool
            assert run['present']==('value' in run)
            for n in range(run['count']):
                assert i<len(markets) and 'executedActivity' not in markets[i]
                if run['present']:markets[i]['executedActivity']=run['value']
                i+=1
        assert i==len(markets)
    assert restored==original
    results.append(dict(name=case['name'],entireJsonEqual=True,markets=len(original['marketContext']['markets']),fullDigestReferencesDecoded=refs[0]))
result=dict(version='executed-activity-independent-json-proof-v1',witnessHash=proof['witnessHash'],verifierHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases=results,method='Independent Python decoder restores exact complete pre-packing JSON, including every key/value and source clock; no app import',modelCalls=0,newNetworkRequests=0,profitabilityEstablished=False)
Path('docs/executed-activity-independent-json-proof.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
