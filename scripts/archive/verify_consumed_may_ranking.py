import json,pathlib,hashlib,fractions,math,datetime
F=fractions.Fraction
root=pathlib.Path('.')
p=json.loads((root/'docs/consumed-may-discrimination-latest.json').read_text()); raw=(root/p['path']).read_bytes(); report=json.loads(raw)
checks={}
for period,result in report['periods'].items():
 source=root/result['source']['path']; data=source.read_bytes(); assert hashlib.sha256(data).hexdigest()==result['sourceFileSha256']; src=json.loads(data)
 groups={}
 for row in src['rows']:groups.setdefault(row['decisionAt'],[]).append(row)
 checks[period]={}
 for name,audit in result['models'].items():
  means=[]; clocks=[]
  for clock,rows in sorted(groups.items()):
   known=[r for r in rows if r['predictions'][name] is not None and r['netReturn'] is not None]
   c=d=t=l=0
   for i,a in enumerate(known):
    for b in known[i+1:]:
     dy=F(a['netReturn'])-F(b['netReturn']); dx=F(a['predictions'][name])-F(b['predictions'][name])
     if not dy:l+=1
     elif not dx:t+=1
     elif (dy>0)==(dx>0):c+=1
     else:d+=1
   mean=F(2*c+t,2*(c+d+t)) if c+d+t else None
   if mean is not None:means.append(mean)
   actual=next(x for x in audit['clocks'] if x['decisionAt']==clock)
   for key,value in [('concordant',c),('discordant',d),('predictionTies',t),('labelTies',l)]:assert actual[key]==value
   assert actual['concordance'] is None if mean is None else math.isclose(actual['concordance'],float(mean),abs_tol=1e-14)
   eligible=[r for r in rows if r['predictions'][name] is not None]
   top=sorted(eligible,key=lambda r:(-r['predictions'][name],r['pair']))[0] if eligible else None
   assert actual['descriptiveTop'] is None if top is None else actual['descriptiveTop']=={'pair':top['pair'],'forecast':top['predictions'][name],'netReturn':top['netReturn'],'aboveUnchangedMargin':top['predictions'][name]>.005}
   assert actual['hindsightPositiveLabelRows']==sum(r['netReturn'] is not None and r['netReturn']>.005 for r in rows)
  exact=sum(means,F())/len(means) if means else None
  assert math.isclose(audit['equalClockMeanConcordance'],float(exact),abs_tol=1e-14)
  checks[period][name]={'clocks':len(groups),'exactEqualClockConcordance':str(exact),'verified':True}
facts={'version':'consumed-may-discrimination-independent-v1','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'report':p['path'],'reportFileSha256':hashlib.sha256(raw).hexdigest(),'method':'Independent Python exact Fraction pair signs, tie counts, equal-clock means, top ranks and fixed-margin hindsight counts against sealed consumed rows. Verifies arithmetic, not unseen performance.','checks':checks,'newLabelsRead':False,'profitabilityEstablished':False}
encoded=(json.dumps(facts,indent=2)+'\n').encode(); sha=hashlib.sha256(encoded).hexdigest(); dest=root/f'docs/consumed-may-discrimination-independent-{sha[:16]}.json'; dest.write_bytes(encoded)
(root/'docs/consumed-may-discrimination-independent-latest.json').write_text(json.dumps({'path':str(dest),'sha256':sha},indent=2)+'\n')
print(json.dumps({'path':str(dest),'checks':checks}))
