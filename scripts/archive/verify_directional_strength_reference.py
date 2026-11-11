"""Independent60digit closed-form reference; no TA/vendor indicator implementation."""
from decimal import Decimal as D,getcontext
import json,hashlib,math
from pathlib import Path
getcontext().prec=60
fixture=Path('apps/server/test/fixtures/directional-strength-v1.json');data=json.loads(fixture.read_text());bars=[{k:D(str(b[k])) for k in ('high','low','close')} for b in data['bars']];q=D(13)/14
tr=[];pos=[];neg=[]
for a,b in zip(bars,bars[1:]):
    u=b['high']-a['high'];d=a['low']-b['low'];tr.append(max(b['high']-b['low'],abs(b['high']-a['close']),abs(b['low']-a['close'])));pos.append(u if u>0 and u>d else D(0));neg.append(d if d>0 and d>u else D(0))
def sum_state(xs,n):return sum(xs[:14])*q**(n-14)+sum((xs[j]*q**(n-1-j) for j in range(14,n)),D(0))
dx=[]
for n in range(14,len(tr)+1):
    t=sum_state(tr,n);plus=D(100)*sum_state(pos,n)/t if t else D(0);minus=D(100)*sum_state(neg,n)/t if t else D(0);dx.append(D(100)*abs(plus-minus)/(plus+minus) if plus+minus else D(0))
def mean_state(xs,n):return sum(xs[:14])/14*q**(n-14)+sum((xs[j]/14*q**(n-1-j) for j in range(14,n)),D(0))
a=mean_state(dx,len(dx));previous=mean_state(dx,len(dx)-1);expected=dict(adx=float(a),previousAdx=float(previous),adxChange=float(a-previous),plusDI=float(plus),minusDI=float(minus),movementBalance=float((plus-minus)/(plus+minus)) if plus+minus else 0)
observed_path=Path('data/directional-strength-observed-2026-11-02.json');observed=json.loads(observed_path.read_text());assert observed['result']['complete']
errors={}
for name,value in expected.items():
    assert math.isclose(value,data['expected'][name],rel_tol=1e-12,abs_tol=1e-12)
    error=abs(value-observed['result'][name]);assert error<1e-9;errors[name]=error
proof=dict(version='directional-strength-decimal-proof-v1',fixtureSha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),referenceScriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),observedSha256=hashlib.sha256(observed_path.read_bytes()).hexdigest(),sourceHash=observed['sourceHash'],buildId=observed['buildId'],precisionDigits=60,math='Independent closed-form sums, not TypeScript recurrence',expected=expected,absoluteErrors=errors,syntheticOnly=True,vendorParityClaimed=False,strategyActivated=False,profitabilityEstablished=False)
Path('docs/directional-strength-decimal-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
