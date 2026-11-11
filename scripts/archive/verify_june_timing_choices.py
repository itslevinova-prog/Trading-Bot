import hashlib
import json
import gzip
from pathlib import Path
from decimal import Decimal as D, getcontext

getcontext().prec = 60
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda path: json.loads(Path(path).read_bytes())
protocol = Path('docs/june-timing-holdout-protocol-v1.json')
choice_file = Path('docs/june-timing-frozen-choices-v1.json')
frozen = read(choice_file)
assert sha(choice_file.read_bytes()) == '510b53842aef38d4b555469b87342d80cd605c9f542d1528c404f7f366858df6'
assert sha(protocol.read_bytes()) == frozen['protocolSha']
root = Path('data/historical-june-timing-holdout-v1') / frozen['protocolSha']
maps = {}
pages = 0
for pair in read(protocol)['symbols']:
    doc = json.loads(gzip.decompress((root/'2026-06'/(pair.replace('/','-')+'.json.gz')).read_bytes()))
    candles = {}
    for ref in doc['pages']:
        raw = json.loads(gzip.decompress((root/ref['relativePath']).read_bytes()))['raw']
        assert sha(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()) == ref['canonicalRawHash']
        pages += 1
        for r in raw:
            assert r[0] not in candles
            candles[r[0]] = D(r[4])
    assert len(candles) == 3648
    maps[pair] = candles
assert pages == 80
step = 900000
def change(pair, clock, edges):
    closes = [maps[pair][clock - (edges + 1 - i)*step] for i in range(edges+1)]
    return closes[-1]/closes[0]-1
for i, r in enumerate(frozen['rows']):
    clock = 1780272000000 + i * 48 * step
    assert r['decisionAt'] == clock and r['entryAt'] == clock + step
    btc4, btc24 = change('BTC/EUR',clock,16), change('BTC/EUR',clock,96)
    alts = [pair for pair in maps if pair != 'BTC/EUR']
    ranked = sorted((-ret,pair) for pair in alts if (ret:=change(pair,clock,16))>max(D(0),btc4))
    pair = ranked[0][1] if ranked else None
    advancing = sum(change(p,clock,96)>0 for p in alts)
    assert r['valid'] and r['selectedPair']==pair and r['advancing']==advancing
    assert abs(btc24-D(str(r['btc24h'])))<D('1e-12')
    assert r['actions']=={'ungated':bool(pair),'btc':bool(pair) and btc24>0,'breadth':bool(pair) and btc24>0 and advancing>=10,'cash':False}
assert len(frozen['rows']) == 60
print(json.dumps({'verifiedPages':pages,'verifiedClocks':60}))
