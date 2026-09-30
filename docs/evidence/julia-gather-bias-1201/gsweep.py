import json, urllib.request, itertools, copy
P=[json.loads(l) for l in open('/tmp/run/julia-payloads.jsonl')]
P=[p for p in P if p['request'] and {c['id'] for c in p['request']['candidates']}=={'gather_materials','continue_objective'}]
tpl={}
for p in P:
    tpl.setdefault(p['request']['state']['objective']['type'],p['request'])
print('templates',list(tpl))
def call(state,cands):
    req=urllib.request.Request('http://127.0.0.1:8768/choose',data=json.dumps({'state':state,'candidates':cands}).encode(),headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=60))
def build(t,avail,d,order):
    s=copy.deepcopy(t['state']); n=s['nearby']
    for k in ('wood','stone','iron'):
        n[k]=k in avail; n[k+'Distance']=d if k in avail else None
    c={x['id']:x for x in t['candidates']}
    return s,[c[i] for i in order]
subsets=[('wood',),('stone',),('iron',),('wood','stone'),('wood','iron'),('stone','iron'),('wood','stone','iron')]
dists=[1,2,3,4,5.7,6.9]; orders=[('gather_materials','continue_objective'),('continue_objective','gather_materials')]
rows=[]
for obj,t in tpl.items():
    for av,d,o in itertools.product(subsets,dists,orders):
        s,c=build(t,av,d,o); r=call(s,c)
        rows.append({'obj':obj,'avail':'+'.join(av),'d':d,'order':o[0],'choice':r['choice'],'p_gather':r['probabilities'].get('gather_materials'),'conf':r['confidence']})
def summ(rs): return {'n':len(rs),'gather':sum(x['choice']=='gather_materials' for x in rs),'p_gather_min':round(min(x['p_gather'] for x in rs),4),'p_gather_max':round(max(x['p_gather'] for x in rs),4)}
out={}
for obj in tpl:
    R=[r for r in rows if r['obj']==obj]
    out[obj]={'all':summ(R),'by_distance':{d:summ([r for r in R if r['d']==d]) for d in dists},'by_avail':{a:summ([r for r in R if r['avail']==a]) for a in sorted({r['avail'] for r in R})},'by_order':{o:summ([r for r in R if r['order']==o]) for o in ('gather_materials','continue_objective')}}
# controles: sem recursos/ sem distância
for obj,t in tpl.items():
    s,c=build(t,(),1,('gather_materials','continue_objective')); r=call(s,c); out[obj]['no_resources_flags']={'choice':r['choice'],'p_gather':round(r['probabilities'].get('gather_materials'),4)}
json.dump({'summary':out,'rows':rows},open('/tmp/run/v9/gsweep.json','w'),indent=1)
print(json.dumps(out,indent=1))
