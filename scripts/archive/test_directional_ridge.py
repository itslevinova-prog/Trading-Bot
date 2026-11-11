import unittest,copy,importlib.util,math
from pathlib import Path
spec=importlib.util.spec_from_file_location('directional',Path(__file__).with_name('fit-directional-ridge.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def request():
    rows=[dict(pair='ETH/EUR',decisionAt=i*900000,labelEnd=i*900000+1,x=[math.sin(i/(j+2)) for j in range(8)]+[(i%31)/30,(i%21)/10-1],y=math.sin(i/7)*.01) for i in range(220)]
    return dict(version=m.VERSION,targetHash='a'*64,folds=[dict(trainedAt=300*900000,rows=rows,queryX=[rows[0]['x']])])
class Tests(unittest.TestCase):
    def test_query_cannot_fit_or_change_model(self):
        r=request();before=copy.deepcopy(r);a=m.fit(r);r['folds'][0]['queryX']=[[100]*8+[0,-1]];b=m.fit(r)
        for d in ('8','10'):self.assertEqual(a['folds'][0][d]['model'],b['folds'][0][d]['model'])
        self.assertEqual(before['folds'][0]['rows'],r['folds'][0]['rows'])
    def test_unavailable_duplicate_or_nonfinite_labels_fail(self):
        for kind in ('maturity','duplicate','nan'):
            r=request();f=r['folds'][0]
            if kind=='maturity':f['rows'][0]['labelEnd']=f['trainedAt']
            if kind=='duplicate':f['rows'][1]=copy.deepcopy(f['rows'][0])
            if kind=='nan':f['rows'][0]['y']=float('nan')
            with self.assertRaises(ValueError):m.fit(r)
    def test_feature_domain_and_extra_query_label_fail(self):
        for kind in ('adx','balance','dim','extra'):
            r=request();f=r['folds'][0]
            if kind=='adx':f['rows'][0]['x'][8]=1.01
            if kind=='balance':f['queryX'][0][9]=-1.01
            if kind=='dim':f['rows'][0]['x'].pop()
            if kind=='extra':f['queryY']=[100]
            with self.assertRaises(ValueError):m.fit(r)
    def test_constant_columns_have_unit_scale_and_finite_solutions(self):
        r=request()
        for row in r['folds'][0]['rows']:row['x']=[0]*10
        r['folds'][0]['queryX']=[[0]*10];a=m.fit(r)
        for d in ('8','10'):
            model=a['folds'][0][d]['model'];self.assertEqual(model['stds'],[1]*int(d));self.assertEqual(model['weights'],[0]*int(d))
if __name__=='__main__':unittest.main()
