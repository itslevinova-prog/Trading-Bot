import json
import runpy
from decimal import Decimal as D
from pathlib import Path

baseline = runpy.run_path('scripts/verify_may_breadth_timing.py')
report = json.loads(Path('docs/may-breadth-stress-4c665bbcbccd59ff.json').read_bytes())
bars = baseline['bars']
for scenario in report['results']:
    m = D(scenario['costMultiplier'])
    half_spread, slip, fee = D('.0005') * m, D('.0008') * m, D('.001') * m
    sums = dict.fromkeys(scenario['policies'], D(0))
    for original, row in zip(baseline['result']['rows'], scenario['rows'], strict=True):
        assert row['actions'] == original['actions'] and row['pair'] == original['selectedPair']
        assert row['entryAt'] == original['entryAt'] + 900000 * scenario['extraDelayBars']
        path = [bars[row['pair']][row['entryAt'] + i * 900000] for i in range(32)]
        entry = path[0][0] * (1 + half_spread) * (1 + slip)
        basis = entry * (1 + fee)
        stop, target = basis * D('.98'), entry * D('1.04')
        price, kind, idx = path[-1][3], 'timeout', 31
        for i, (op, high, low, _) in enumerate(path):
            if op <= stop:
                price, kind = op, 'stop'
            elif op >= target:
                price, kind = target, 'target'
            elif low <= stop and high >= target:
                price, kind = None, 'ambiguous'
            elif low <= stop:
                price, kind = stop, 'stop'
            elif high >= target:
                price, kind = target, 'target'
            else:
                continue
            idx = i
            break
        saved = row['outcome']
        assert kind == saved['outcome'] and row['entryAt'] + 900000 * idx == saved['eventBarTs']
        assert price is not None
        net = price * (1-half_spread) * (1-slip) * (1-fee) / basis - 1
        assert abs(net-D(str(saved['netReturn']))) < D('1e-12')
        for name, enter in row['actions'].items():
            if enter:
                sums[name] += net
    for name, total in sums.items():
        assert abs(total/20 - D(str(scenario['policies'][name]['meanPerClock']))) < D('1e-12')
print('Verified 100 cost/delay paths across 5 scenarios')
