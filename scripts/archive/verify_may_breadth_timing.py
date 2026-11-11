import decimal
import gzip
import hashlib
import json
from pathlib import Path

decimal.getcontext().prec = 60
D = decimal.Decimal
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
read = lambda path: json.loads(Path(path).read_bytes())
step = 900000

result_path = 'docs/may-breadth-timing-result-cbed1f1786e6f1ee.json'
result = read(result_path)
frozen_path = 'docs/may-breadth-timing-frozen-choices-v1.json'
assert sha(frozen_path) == result['choicesSha256'] == '1ae9c6dd2e3d342f98b60ade96d61dc1c47b668d79a708e7c35659839294472d'
assert sha('docs/may-breadth-timing-protocol-v1.json') == result['protocolSha256']
assert sha('scripts/evaluate-may-breadth-timing.mjs') == result['runnerHash']
frozen = read(frozen_path)
assert [{k: v for k, v in row.items() if k not in ('outcome', 'net')} for row in result['rows']] == frozen['rows']

source = Path('docs/historical-evidence-post-april-protocol-v1.json')
root = Path('data/historical-evidence-post-april-v1') / sha(source)
bars = {}
for pair in read(source)['symbols']:
    descriptor = json.loads(gzip.decompress((root / '2026-05' / (pair.replace('/', '-') + '.json.gz')).read_bytes()))
    market = {}
    for ref in descriptor['pages']:
        raw = json.loads(gzip.decompress((root / ref['relativePath']).read_bytes()))['raw']
        encoded = json.dumps(raw, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        assert hashlib.sha256(encoded).hexdigest() == ref['canonicalRawHash']
        for candle in raw:
            assert candle[0] not in market
            market[candle[0]] = tuple(D(str(x)) for x in candle[1:5])
    bars[pair] = market

def close_return(market, clock, edges):
    closes = [market[clock - (edges + 1 - i) * step][3] for i in range(edges + 1)]
    return closes[-1] / closes[0] - 1

def label(market, entry):
    path = [market[entry + i * step] for i in range(32)]
    fill = path[0][0] * D('1.0005') * D('1.0008')
    basis = fill * D('1.001')
    stop, target = basis * D('.98'), fill * D('1.04')
    price, event, kind = path[-1][3], 31, 'timeout'
    for i, (op, high, low, _) in enumerate(path):
        if op <= stop:
            price, event, kind = op, i, 'stop'
        elif op >= target:
            price, event, kind = target, i, 'target'
        elif low <= stop and high >= target:
            return None, i, 'ambiguous'
        elif low <= stop:
            price, event, kind = stop, i, 'stop'
        elif high >= target:
            price, event, kind = target, i, 'target'
        else:
            continue
        break
    return price * D('.9995') * D('.9992') * D('.999') / basis - 1, event, kind

sums = dict.fromkeys(result['policies'], D(0))
counts = dict.fromkeys(sums, 0)
for row in result['rows']:
    clock = row['decisionAt']
    btc4 = close_return(bars['BTC/EUR'], clock, 16)
    btc24 = close_return(bars['BTC/EUR'], clock, 96)
    others = {pair: market for pair, market in bars.items() if pair != 'BTC/EUR'}
    advancing = sum(close_return(m, clock, 96) > 0 for m in others.values())
    ranked = sorted((-ret, pair) for pair, m in others.items() if (ret := close_return(m, clock, 16)) > max(0, btc4))
    pair = ranked[0][1]
    assert pair == row['selectedPair'] and advancing == row['advancing']
    assert abs(btc24 - D(str(row['btc24h']))) < D('1e-12')
    gates = {'ungated': True, 'btc': btc24 > 0, 'breadth': btc24 > 0 and advancing >= 10, 'cash': False}
    assert gates == row['actions']
    net, event, kind = label(bars[pair], row['entryAt'])
    assert row['outcome']['outcome'] == kind
    assert row['outcome']['eventBarTs'] == row['entryAt'] + event * step
    for name, enter in gates.items():
        counts[name] += enter
        expected = net if enter else D(0)
        assert expected is not None and abs(expected - D(str(row['net'][name]))) < D('1e-12')
        sums[name] += expected
assert len(result['rows']) == 20
for name in sums:
    assert counts[name] == result['policies'][name]['selected']
    assert abs(sums[name] / 20 - D(str(result['policies'][name]['meanPerClock']))) < D('1e-12')
print(json.dumps({'verifiedClocks': 20, 'policySlots': 80, 'candidateLabels': 20, 'counts': counts}))
