import unittest,copy,math,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('aggressor',Path(__file__).with_name('fit-aggressor-ridge.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def req():return dict(version=m.VERSION,dataScope='a'*64,availabilityDomain='modeled-historical-bar-close-v1',folds=[dict(trainedAt=300000,rows=[dict(pair='BTC/EUR',decisionAt=i*1000,labelEnd=i*1000+1,x=[math.sin(i/(j+2)) for j in range(9)],y=.01*math.sin(i/7)) for i in range(220)],queryX=[None,[0]*9])])
class Tests(unittest.TestCase):
    def test_unknown_queries_remain_unknown_and_query_poisoning_cannot_change_fits(self):
        r=req();a=m.fit(r);r['folds'][0]['queryX']=[None,[100]*8+[1]];b=m.fit(r)
        for d in ('8','9'):self.assertEqual(a['folds'][0][d]['model'],b['folds'][0][d]['model']);self.assertIsNone(b['folds'][0][d]['rawPredictions'][0])
    def test_bad_domain_future_duplicate_and_feature_are_rejected(self):
        for kind in ('domain','future','duplicate','feature'):
            r=req();f=r['folds'][0]
            if kind=='domain':r['availabilityDomain']='actual-capture'
            if kind=='future':f['rows'][0]['labelEnd']=f['trainedAt']
            if kind=='duplicate':f['rows'][1]=copy.deepcopy(f['rows'][0])
            if kind=='feature':f['rows'][0]['x'][8]=2
            with self.assertRaises(ValueError):m.fit(r)
    def test_200_gate_and_no_extra_query_labels(self):
        r=req();r['folds'][0]['rows']=r['folds'][0]['rows'][:199]
        with self.assertRaises(ValueError):m.fit(r)
        r=req();r['folds'][0]['queryY']=[1]
        with self.assertRaises(ValueError):m.fit(r)
if __name__=='__main__':unittest.main()
