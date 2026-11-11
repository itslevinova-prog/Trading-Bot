import json,sqlite3,hashlib,decimal,math
from pathlib import Path
decimal.getcontext().prec=100
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode();sha=lambda x:hashlib.sha256(x).hexdigest()
pointer=read('docs/ws-activity-window-latest.json');raw=Path(pointer['path']).read_bytes();r=json.loads(raw);assert r['fixtureOnly'] and r['actualLiveMessagesCaptured']==0 and r['factsHash']==pointer['hash'];datasets={};session_count=0;row_count=0;complete=0
for d in r['databases']:
    file=Path(d['file']);assert sha(file.read_bytes())==d['sha256'];db=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    for table,key,order in [('public_ws_activity_observations','rows','received_at'),('public_ws_activity_sessions','sessions','id'),('public_ws_activity_observation_sessions','links','observation_id')]:assert [dict(x) for x in db.execute('SELECT * FROM '+table+' ORDER BY '+order)]==d[key]
    db.close();sessions={}
    for x in d['sessions']:
        s=json.loads(x['metadata_json']);facts={k:v for k,v in s.items() if k!='id'};assert sha(canonical(facts))==s['id']==x['id'];assert s['kind']==d['kind'] and s['transport']=='wss://data-stream.binance.vision/stream' and s['producer']=='binance-market-observer-v1';sessions[s['id']]=s;session_count+=1
    links={x['observation_id']:x['session_id'] for x in d['links']};rows=[]
    for x in d['rows']:
        assert sha(x['raw_text'].encode())==x['raw_hash'];assert sha((x['pair']+':'+str(x['received_at'])+':'+x['raw_hash']).encode())==x['id'];m=json.loads(x['raw_text']);assert m['fixtureOnly'];k=m['data']['k'];values={}
        for key in ['o','h','l','c','v','q','V','Q']:
            s=format(decimal.Decimal(k[key]),'f');values[key]=s.rstrip('0').rstrip('.') if '.' in s else s
        facts={'pair':x['pair'],'openAt':k['t'],'closedAt':k['t']+900000,'decimals':values,'trades':k['n']};assert sha(canonical(facts))==x['facts_hash'];assert x['available_after']==max(x['received_at'],m['data']['E'],k['t']+900000);session=sessions[links[x['id']]];assert session['startedAt']<=x['received_at'];rows.append({**x,'payload':k,'session':session});row_count+=1
    datasets[d['kind']]=rows
for q in r['queries']:
    end=q['asOf']//900000*900000;start=end-q['count']*900000;candles=sorted([c for c in r['candles'] if start<=c['ts']<end],key=lambda c:c['ts']);reason=None;source=[];selected=[]
    if len(candles)!=q['count'] or any(c['ts']!=start+i*900000 for i,c in enumerate(candles)):reason='closed-candle-window-incomplete'
    else:
        for c in candles:
            rows=[x for x in datasets[q['dataset']] if x['open_at']==c['ts'] and x['received_at']<=q['asOf'] and (q['mode']!='actual' or x['session']['kind']=='public-ws')]
            if not rows:reason='no-observed-public-session-source' if q['mode']=='actual' else 'no-observed-source';break
            if len({x['facts_hash'] for x in rows})!=1:reason='conflicting-observed-source';break
            usable=sorted([x for x in rows if x['available_after']<=q['asOf']],key=lambda x:(x['available_after'],x['received_at'],x['id']))
            if not usable:reason='source-not-yet-locally-available';break
            x=usable[0];k=x['payload'];assert [c[f] for f in ['open','high','low','close','volume']]==[float(k[f]) for f in ['o','h','l','c','v']];source.append({'openAt':c['ts'],'barFactsHash':x['facts_hash'],'rawHash':x['raw_hash'],'firstReceivedAt':min(v['received_at'] for v in rows),'firstUsableAfter':min(v['available_after'] for v in rows),'sessionId':x['session']['id']});selected.append(x)
    result=q['result'];flag=result['available'] if q['mode']=='actual' else result['complete'];assert flag==(reason is None)
    if reason:assert result['reason']==reason;continue
    complete+=1;w=result['window'] if q['mode']=='actual' else result;assert w['sourceRows']==source and sha(canonical(source))==w['sourceHash'];assert w['firstCompleteAfter']==max(x['firstUsableAfter'] for x in source);assert w['actualCaptureEligible']==all(x['session']['kind']=='public-ws' for x in selected);assert {s['id'] for s in w['sessions']}=={x['session']['id'] for x in selected}
    total=lambda key:sum(decimal.Decimal(x['payload'][key]) for x in selected);base=total('v');quote=total('q');buybase=total('V');buyquote=total('Q');summary=w['summary'];expected={'baseVolume':base,'quoteVolume':quote,'trades':sum(x['payload']['n'] for x in selected),'takerBuyBaseShare':buybase/base,'takerBuyQuoteShare':buyquote/quote,'takerQuoteImbalance':2*buyquote/quote-1,'executionVwap':quote/base}
    for key,value in expected.items():assert math.isclose(float(value),summary[key],rel_tol=1e-12,abs_tol=1e-14)
proof={'version':'ws-activity-windows-independent-v1','fixtureOnly':True,'reportHash':pointer['hash'],'reportFileSha256':sha(raw),'verifierHash':sha(Path(__file__).read_bytes()),'persistentSourceRowsVerified':row_count,'captureSessionRowsVerified':session_count,'decisionQueriesVerified':len(r['queries']),'completeWindowsVerified':complete,'actualLiveMessagesCaptured':0,'scope':'All source messages and runtime identities here are mocked; internal public-session eligibility markers exercise policy logic only, not empirical first receipt or transport authentication.','profitabilityEstablished':False}
Path('docs/ws-activity-windows-independent.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
