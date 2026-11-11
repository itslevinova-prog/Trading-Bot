import json,gzip,hashlib,math
from pathlib import Path
from datetime import datetime,timezone
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest();canonical=lambda x:json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
protocol_file=Path('docs/historical-evidence-post-april-protocol-v1.json');protocol=read(protocol_file);h=sha(protocol_file.read_bytes());root=Path('data/historical-evidence-post-april-v1')/h;state=read(root/'state.json');period=protocol['periods'][0]
assert protocol['periodRoles']=={'2026-05':'validation-source-only'} and len(protocol['symbols'])==20
assert state['protocolHash']==h and state['periods']['2026-05']['complete'] is True and state['networkRequestsReserved']<=120
assert period['id']=='2026-05' and period['warmupDays']==8
start=period['fromTs']-8*86400000;end=period['toExclusive'];step=900000;expected=(end-start)//step
assert expected==3744
rows_checked=pages_checked=0;files=[]
for pair in protocol['symbols']:
    file=root/'2026-05'/(pair.replace('/','-')+'.json.gz');data=json.loads(gzip.decompress(file.read_bytes()));assert data['protocolHash']==h and data['pair']==pair and data['period']==period and data['repair']['complete'] is True
    source=[]
    for ref in data['pages']:
        pagefile=root/ref['relativePath'];assert pagefile.resolve().is_relative_to(root.resolve())
        page=json.loads(gzip.decompress(pagefile.read_bytes()));assert page['protocolHash']==h and page['pair']==pair and page['from']==ref['from'] and page['toInclusive']==ref['toInclusive']==end-1
        assert sha(canonical(page['raw']))==page['canonicalRawHash']==ref['canonicalRawHash']
        assert datetime.fromisoformat(page['retrievedAt'].replace('Z','+00:00')).timestamp()*1000>end
        for raw in page['raw']:
            assert len(raw)==12 and page['from']<=raw[0]<=page['toInclusive'] and raw[0]%step==0 and raw[6]==raw[0]+step-1
            vals={key:float(raw[i]) for key,i in [('open',1),('high',2),('low',3),('close',4),('volume',5)]};assert all(math.isfinite(v) for v in vals.values()) and vals['low']>0 and vals['volume']>=0 and vals['low']<=min(vals['open'],vals['close'])<=max(vals['open'],vals['close'])<=vals['high']
            source.append({'pair':pair,'interval':15,'ts':raw[0],**vals})
        pages_checked+=1
    assert len(source)==expected and all(c['ts']==start+i*step for i,c in enumerate(source)) and source==data['rows']
    assert state['periods']['2026-05']['markets'][pair]['complete'] is True
    rows_checked+=len(source);files.append({'pair':pair,'file':file.as_posix(),'sha256':sha(file.read_bytes()),'bars':len(source),'pages':len(data['pages'])})
proof={'version':'may-evidence-source-independent-v1','verifiedAt':datetime.now(timezone.utc).isoformat(),'protocolFile':protocol_file.as_posix(),'protocolSha256':h,'verifierSha256':sha(Path(__file__).read_bytes()),'markets':len(files),'barsIncludingWarmup':rows_checked,'rawPagesVerified':pages_checked,'networkRequestsReserved':state['networkRequestsReserved'],'role':'validation-source-only','modelTrained':False,'economicOutcomesEvaluated':False,'juneLoaded':False,'julyLoaded':False,'files':files,'profitabilityEstablished':False,'scope':'Independent original raw page checksum/UTC15mgrid/OHLCV/normalized row reconciliation, including8daywarmup; current survivor universe/metadata and later retrieval do not establish historical tradability or first receipt. No labels, return summaries, training or strategy selection computed.'}
raw=canonical(proof);out='docs/may-evidence-source-proof-'+sha(raw)[:16]+'.json';Path(out).write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');Path('docs/may-evidence-source-latest.json').write_text(json.dumps({'path':out,'sha256':sha(Path(out).read_bytes())},indent=2)+'\n',encoding='utf-8');print(json.dumps({'path':out,'markets':len(files),'bars':rows_checked,'pages':pages_checked,'networkRequestsReserved':state['networkRequestsReserved']}))
