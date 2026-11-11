import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal as D
from pathlib import Path

sources = {
    'may': ('docs/may-frozen-portfolio-f53b0d90fa77fffc.json', 'f53b0d90fa77fffc406b9e0399c8c3920958cdf7bda42311cd51a5a71122878d'),
    'june': ('docs/june-frozen-portfolio-13ca4ea0ac9938e5.json', '13ca4ea0ac9938e59717972a4fae74a4fd7ca37d311f815ff9d15c3793f23b77'),
}
classes = {
    'intrabar target': 'target', 'gap target (conservative target fill)': 'target',
    'intrabar stop-first': 'stop', 'gap stop': 'stop', 'Fixed 32-bar timeout': 'timeout',
}

def aggregate(trades):
    return {
        'trades': len(trades),
        'wins': sum(t['netEur'] > 0 for t in trades),
        **{key: sum((t[key] for t in trades), D(0)) for key in ('grossEur', 'feesEur', 'netEur')},
        'meanNetPctOfEntry': sum((t['netEur'] / t['entryBasisEur'] * 100 for t in trades), D(0)) / len(trades) if trades else None,
    }

def group(trades, key):
    groups = defaultdict(list)
    for t in trades:
        groups[t[key]].append(t)
    return {k: aggregate(g) for k,g in sorted(groups.items())}

periods = {}
for period, (name, expected) in sources.items():
    raw = Path(name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected
    report = json.loads(raw, parse_float=D)
    result = next(x['result'] for x in report['results'] if x['name'] == 'ungated' and x['multiplier'] == 1)
    open_trade, trades = {}, []
    for fill in result['fills']:
        pair = fill['pair']
        if fill['side'] == 'buy':
            assert not open_trade
            open_trade[pair] = fill
            continue
        entry = open_trade.pop(pair)
        assert entry['qty'] == fill['qty'] and entry['barTs'] <= fill['barTs']
        gross = entry['qty'] * (fill['price'] - entry['price'])
        fees = entry['fee'] + fill['fee']
        net = gross - fees
        assert abs(net - fill['realizedPnl']) < D('1e-12')
        trades.append({
            'pair': pair, 'entryAt': entry['barTs'], 'exitAt': fill['barTs'],
            'exitClass': classes[fill['reason']], 'reason': fill['reason'],
            'grossEur': gross, 'feesEur': fees, 'netEur': net,
            'entryBasisEur': entry['qty'] * entry['price'] + entry['fee'],
        })
    assert not open_trade and len(trades) == result['closedTrades']
    total = aggregate(trades)
    assert abs(total['netEur'] - (result['finalEquity'] - result['startingBalance'])) < D('1e-10')
    assert abs(total['feesEur'] - result['fees']) < D('1e-10')
    periods[period] = {'summary': total, 'byExit': group(trades, 'exitClass'), 'byPair': group(trades, 'pair'), 'trades': trades}

facts = {
    'version': 'consumed-momentum-attribution-v1',
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'sources': sources,
    'runnerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'periods': periods,
    'scope': 'Post-hoc attribution of the two consumed ungated simulated portfolios. Gross removes paid fees only and retains modeled spread and slippage. Different periods and trade counts. No new outcome or strategy evaluation.',
    'profitabilityEstablished': False,
}
data = (json.dumps(facts, default=str, indent=2) + '\n').encode()
sha = hashlib.sha256(data).hexdigest()
out = Path('docs/momentum-attribution-' + sha[:16] + '.json')
with out.open('xb') as f:
    f.write(data)
print(json.dumps({'path': out.as_posix(), 'sha': sha, 'periods': {k: {x:v[x] for x in ('summary','byExit')} for k,v in periods.items()}}, default=str))
