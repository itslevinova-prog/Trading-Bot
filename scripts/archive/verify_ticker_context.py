import json, hashlib, datetime
from pathlib import Path
pointer=json.loads(Path('docs/ticker-source-latest.json').read_text())
raw=Path(pointer['path']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==pointer['sha256']
r=json.loads(raw)
assert hashlib.sha256(Path(r['fixturePath']).read_bytes()).hexdigest()==r['fixtureSha256']
def decode(v,ctx,kind):
    key=kind+'FieldSet'
    if not isinstance(v,dict) or key not in v:return v
    assert set(v)=={key,'values'}
    meta=ctx['transmission'][kind+'TableEncoding']
    assert meta['format']=='market-'+kind+'-columns-v1'
    i=v[key]
    assert type(i)==int and 0<=i<len(meta['fieldSets'])
    fields=meta['fieldSets'][i]
    assert len(fields)==len(set(fields))==len(v['values'])
    return dict(zip(fields,v['values']))
records=0
for c in r['cases']:
    for key in ['packed','repacked']:
        ctx=c[key];got=[{'pair':m['pair'],'ticker':decode(m['ticker'],ctx,'ticker'),'quality':decode(m['quality'],ctx,'quality')} for m in ctx['marketContext']['markets']]
        assert got==c['expected'];assert len(got)==20
        for m in got:
            t=m['ticker'];clocks=t['fieldReceivedAt'];now=round(datetime.datetime.fromisoformat(ctx['timeUTC'].replace('Z','+00:00')).timestamp()*1000)
            ages=[None if x is None or x>now else now-x for x in clocks.values()]
            expected=max(ages) if all(x is not None for x in ages) else None
            assert m['quality']['tickerAgeMs']==expected
        records+=len(got)
    assert c['chars']<=115000 and c['repackedChars']<=115000
proof={'version':'ticker-source-independent-v1','reportSha256':pointer['sha256'],'verifierSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':len(r['cases']),'marketRecordsVerified':records,'allTickerAndQualityFieldsExact':True,'nullClocksStayUnknown':True,'budget':115000,'newApiCalls':0,'profitabilityEstablished':False}
Path('docs/ticker-source-independent.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
