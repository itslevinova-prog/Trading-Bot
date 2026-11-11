"""Independent60digit Decimal current/prior20ratio on source-verified audit vectors."""
import json,hashlib,math
from decimal import Decimal as D,getcontext
from pathlib import Path
getcontext().prec=60
pointer=json.loads(Path('docs/volume-clock-audit-latest.json').read_text());report=json.loads(Path(pointer['path']).read_text());raw_proof=json.loads(Path('docs/volume-clock-verification.json').read_text());assert raw_proof['factsHash']==report['factsHash']==pointer['hash']
checked=0;unknown=0;max_error=0
for row in report['observations']:
    values=[D(str(v)) for v in row['volumes']];assert len(values)==21
    denominator=sum(values[:20]);actual=row['descriptor']['relativeVolume']
    if not denominator:assert actual is None;unknown+=1;continue
    reference=values[20]*20/denominator;assert actual is not None and math.isfinite(actual)
    assert math.isclose(actual,float(reference),rel_tol=1e-12,abs_tol=1e-12)
    max_error=max(max_error,abs(actual-float(reference)));checked+=1
proof=dict(version='volume-clock-decimal-proof-v1',reportHash=pointer['hash'],reportFileSha256=hashlib.sha256(Path(pointer['path']).read_bytes()).hexdigest(),rawVerifierSha256=hashlib.sha256(Path('scripts/verify-volume-clocks.mjs').read_bytes()).hexdigest(),referenceScriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),precisionDigits=60,knownRatiosChecked=checked,explicitUndefinedReferences=unknown,maximumAbsoluteDifference=max_error,relativeTolerance=1e-12,absoluteTolerance=1e-12,newModelFitted=False,profitabilityEstablished=False)
Path('docs/volume-clock-decimal-proof.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))
