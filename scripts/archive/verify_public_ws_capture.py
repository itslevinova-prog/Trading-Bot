import json,sqlite3,hashlib,decimal
from pathlib import Path
from datetime import datetime

decimal.getcontext().prec=100
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
sha=lambda b:hashlib.sha256(b).hexdigest()
canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
pointer=read('docs/public-ws-capture-latest.json');r=read(pointer['path'])
assert r['factsHash']==pointer['hash'] and r['profitabilityEstablished'] is False
assert r['rawRowsChecked']==len(r['sourceRows'])<=384
file=Path(r['captureFile']);db=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
verified=0
try:
    db.execute('BEGIN')
    owner=read_owner=json.loads(db.execute('SELECT metadata_json FROM public_ws_activity_storage WHERE id=?',('main-public-ws-capture-v1',)).fetchone()[0])
    assert owner['hash']==sha(canonical({k:v for k,v in owner.items() if k!='hash'}))
    assert owner['projectFingerprint']==sha(str(Path.cwd().resolve()).encode()) and owner['quote']=='EUR'
    sessions={x['id']:json.loads(x['metadata_json']) for x in db.execute('SELECT * FROM public_ws_activity_sessions')}
    for s in sessions.values():
        assert s['id']==sha(canonical({k:v for k,v in s.items() if k!='id'})) and s['kind']=='public-ws'
        assert s['transport']=='wss://data-stream.binance.vision/stream' and s['producer']=='binance-market-observer-v1'
        deployment=read(Path('data/deployments')/(s['runId']+'.json'))
        assert deployment['verified'] and deployment['build']['verified'] and deployment['build']['buildId']==s['buildId']
        cfg=deployment['tradingConfig'];assert cfg['EXCHANGE']=='binance' and cfg['PAPER_EXPERIMENT_MODE']=='off'
        assert cfg['AI_ENABLED'] is False and cfg['AI_ALLOW_REMOTE'] is False and cfg['AI_PROVIDER'] in ['none','mock']
    assert r['activeSession']==sessions[r['activeSession']['id']]
    for evidence in r['sourceRows']:
        row=dict(db.execute('SELECT o.*,l.session_id FROM public_ws_activity_observations o JOIN public_ws_activity_observation_sessions l ON l.observation_id=o.id WHERE o.id=?',(evidence['id'],)).fetchone())
        m=json.loads(row['raw_text']);assert m.get('fixtureOnly') is not True
        k=m['data']['k'];symbol=row['pair'].replace('/','');assert m['stream']==symbol.lower()+'@kline_15m'
        assert m['data']['s']==k['s']==symbol and m['data']['e']=='kline' and k['x'] is True and k['i']=='15m'
        assert k['t']%900000==0 and k['T']==k['t']+900000-1 and m['data']['E']>=k['T']
        assert row['received_at']>=max(owner['createdAt'],sessions[row['session_id']]['startedAt'])
        assert max(k['t']+900000,m['data']['E'])<=row['received_at']+2000
        assert row['available_after']==max(row['received_at'],k['t']+900000,m['data']['E'])
        assert sha(row['raw_text'].encode())==row['raw_hash'] and sha((row['pair']+':'+str(row['received_at'])+':'+row['raw_hash']).encode())==row['id']
        values={key:decimal.Decimal(k[key]) for key in ['o','h','l','c','v','q','V','Q']}
        assert values['l']>0 and values['l']<=min(values['o'],values['c'])<=max(values['o'],values['c'])<=values['h']
        assert 0<=values['V']<=values['v'] and 0<=values['Q']<=values['q']
        normalized={}
        for key,v in values.items():
            text=format(v,'f');normalized[key]=text.rstrip('0').rstrip('.') if '.' in text else text
        facts={'pair':row['pair'],'openAt':k['t'],'closedAt':k['t']+900000,'decimals':normalized,'trades':k['n']}
        assert sha(canonical(facts))==row['facts_hash']
        assert evidence['rawHash']==row['raw_hash'] and evidence['barFactsHash']==row['facts_hash'] and evidence['sessionId']==row['session_id']
        assert evidence['knownByAudit'] and row['received_at']<=int(datetime.fromisoformat(r['auditedAt'].replace('Z','+00:00')).timestamp()*1000)
        verified+=1
    assert db.execute('SELECT COUNT(*) FROM public_ws_activity_observations').fetchone()[0]>=r['total']['n']
finally:
    db.close()
proof={'version':'actual-public-ws-capture-independent-v1','verifiedAt':datetime.now().astimezone().isoformat(),'report':pointer,'reportFileSha256':sha(Path(pointer['path']).read_bytes()),'verifierSha256':sha(Path(__file__).read_bytes()),'actualRawMessagesVerified':verified,'publicSessionHeadersVerified':len(sessions),'auditedState':r['state'],'profitabilityEstablished':False,'scope':'Independent SQLite/native raw JSON/Decimal/hash/session/deployment checks of audit snapshot only. No fixture insertion, historical backfill, model call or market request. Zero messages proves setup only; counts are not independent trials or bot trades.'}
out=Path('docs/public-ws-capture-independent-'+sha(canonical(proof))[:16]+'.json');out.write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');Path('docs/public-ws-capture-independent-latest.json').write_text(json.dumps({'path':out.as_posix(),'sha256':sha(out.read_bytes())},indent=2)+'\n',encoding='utf-8');print(json.dumps(proof))
