import json,hashlib,sqlite3,decimal
from pathlib import Path
decimal.getcontext().prec=100
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
pointer=read('docs/ws-activity-journal-latest.json');raw=Path(pointer['path']).read_bytes();r=json.loads(raw);assert r['fixtureOnly'] and r['factsHash']==pointer['hash'];file=Path(r['databaseFile']);assert hashlib.sha256(file.read_bytes()).hexdigest()==r['databaseSha256'];db=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;rows=[dict(x) for x in db.execute('SELECT * FROM public_ws_activity_observations ORDER BY received_at')];db.close();assert rows==r['rows'] and len(rows)==5
parsed=[]
def norm(v):
    s=format(decimal.Decimal(v),'f')
    return s.rstrip('0').rstrip('.') if '.' in s else s
for x in rows:
    m=json.loads(x['raw_text']);assert m['fixtureOnly'];d=m['data'];k=d['k'];assert m['stream']=='btceur@kline_15m' and d['s']==k['s']=='BTCEUR' and k['i']=='15m' and k['x'] is True;assert k['t']%900000==0 and k['T']==k['t']+899999
    values={key:norm(k[key]) for key in ['o','h','l','c','v','q','V','Q']};assert decimal.Decimal(values['V'])<=decimal.Decimal(values['v']) and decimal.Decimal(values['Q'])<=decimal.Decimal(values['q'])
    facts={'pair':x['pair'],'openAt':k['t'],'closedAt':k['t']+900000,'decimals':values,'trades':k['n']};encoded=json.dumps(facts,sort_keys=True,separators=(',',':')).encode();assert hashlib.sha256(encoded).hexdigest()==x['facts_hash'];assert hashlib.sha256(x['raw_text'].encode()).hexdigest()==x['raw_hash'];assert hashlib.sha256((x['pair']+':'+str(x['received_at'])+':'+x['raw_hash']).encode()).hexdigest()==x['id'];assert x['available_after']==max(x['received_at'],k['t']+900000,d['E']);parsed.append(x)
for q in r['queries']:
    rows=[x for x in parsed if x['open_at']==q['openAt'] and x['received_at']<=q['asOf']];result=q['result']
    reason='no-observed-source' if not rows else 'conflicting-observed-source' if len({x['facts_hash'] for x in rows})>1 else 'source-not-yet-locally-available' if not any(x['available_after']<=q['asOf'] for x in rows) else None
    assert result['available']==(reason is None)
    if reason:assert result['reason']==reason
    else:
        assert result['firstReceivedAt']==min(x['received_at'] for x in rows);assert result['firstUsableAfter']==min(x['available_after'] for x in rows);assert result['observations']==len(rows);assert result['record']['receivedAt']<=q['asOf'] and result['record']['availableAfter']<=q['asOf']
source=read('docs/protocol-sources/binance-ws-streams-2026-11-03.json');assert hashlib.sha256(Path('docs/protocol-sources/binance-ws-streams-2026-11-03.md').read_bytes()).hexdigest()==source['sha256']
proof={'version':'ws-activity-journal-independent-v1','fixtureOnly':True,'reportHash':pointer['hash'],'reportFileSha256':hashlib.sha256(raw).hexdigest(),'verifierHash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'persistentRowsVerified':len(parsed),'sourceFactsAndRawHashesVerified':len(parsed),'asOfQueriesVerified':len(r['queries']),'officialSchemaSnapshotHashVerified':True,'noBackdatingOrFutureConflictLeakage':True,'actualLiveMessagesCaptured':0,'profitabilityEstablished':False}
Path('docs/ws-activity-journal-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
