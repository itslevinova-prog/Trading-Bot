import importlib.util,copy,math,unittest,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('local_tree_fit',Path(__file__).with_name('fit-barrier-tree.py'))
fit=importlib.util.module_from_spec(spec);spec.loader.exec_module(fit)

def request():
    target=dict(dataScope='a'*64,horizonBars=32,stopLossPct=.02,takeProfitPct=.04,costs=dict(feeRate=.001,spreadBps=10,slippageBps=8));rows=[];step=900000
    facts=dict(version='first-barrier-outcome-v1',**target,entry='candle-open',stopBasis='fee-inclusive',targetBasis='fill',ambiguous='unknown',gapTarget='conservative-target',maturity='full-horizon-close');canonical=json.dumps(facts,sort_keys=True,separators=(',',':'));target_hash=hashlib.sha256(canonical.encode()).hexdigest()
    for i in range(320):
        x=[(i%80)/80,(i%17)/5-1,(i%11)/4-1,math.sin(i)*2,(i%13)/4-1,(i%7)-3,.5+(i%5)/10,1+(i%3)/5];d=1767225600000+i*48*step;entry=d+step;end=entry+32*step;y=.018*(x[0]-.5)**2-.006+.002*x[1];basis=100.1
        o=dict(version='first-barrier-outcome-v1',targetHash=target_hash,entryAt=entry,availableAt=end,eventBarTs=end-step,outcome='timeout',execution='horizon-close',entryFill=100,entryBasis=basis,stopPrice=basis*.98,targetPrice=104,exitReference=basis*(1+y)/(.9995*.9992*.999),netReturn=y)
        rows.append(dict(pair='ETH/EUR',decisionAt=d,entryAt=entry,labelEnd=end,x=x,targetHash=target_hash,outcome=o))
    return dict(version='barrier-tree-fit-request-v1',featureSchema='closed-bounded750-vector8-v1',target=target,targetHash=target_hash,targetCanonicalJson=canonical,trainedAt=rows[-1]['labelEnd']+step,rows=rows,queryX=[r['x'] for r in rows[::7]])

class Boundaries(unittest.TestCase):
    def test_query_data_never_changes_fitted_model(self):
        r=request();other=copy.deepcopy(r);other['queryX']=[[v*3 for v in x] for x in r['queryX']]
        self.assertEqual(fit.fit_request(r)['modelBody'],fit.fit_request(other)['modelBody'])
    def test_mixed_contract_hash_is_rejected(self):
        r=request();r['targetCanonicalJson']='{}'
        with self.assertRaisesRegex(ValueError,'hash'):fit.fit_request(r)
    def test_future_labels_refuse_including_ambiguous(self):
        r=request();r['trainedAt']=r['rows'][-1]['labelEnd'];r['rows'][-1]['outcome'].update(outcome='ambiguous',execution='unknown-path',netReturn=None,exitReference=None)
        with self.assertRaisesRegex(ValueError,'Unavailable'):fit.fit_request(r)
    def test_gross_or_fabricated_target_is_not_costed_payoff(self):
        r=request();o=r['rows'][0]['outcome'];o['netReturn']=o['exitReference']/o['entryBasis']-1
        with self.assertRaisesRegex(ValueError,'net label'):fit.fit_request(r)
    def test_unknown_labels_stay_counted_not_zero_imputed(self):
        r=request();r['rows'][0]['outcome'].update(outcome='ambiguous',execution='unknown-path',netReturn=None,exitReference=None);result=fit.fit_request(r)
        self.assertEqual(result['modelBody']['knownLabels'],319);self.assertEqual(result['modelBody']['ambiguousLabels'],1)
    def test_duplicate_target_or_invalid_geometry_reject(self):
        for mode in ('duplicate','target','geometry'):
            r=request()
            if mode=='duplicate':r['rows'].append(copy.deepcopy(r['rows'][0]))
            if mode=='target':r['rows'][0]['targetHash']='c'*64
            if mode=='geometry':r['rows'][0]['outcome']['stopPrice']*=.99
            with self.assertRaises(ValueError):fit.fit_request(r)

if __name__=='__main__':unittest.main()
