import json, urllib.request, itertools, copy, sys
P=[json.loads(l) for l in open('/tmp/run/v2/groups/payloads.jsonl')]
tpl=[p for p in P if p['request'] and {'find_food','return_base'}<={c['id'] for c in p['request']['candidates']}][0]['request']
def call(state,cands):
    req=urllib.request.Request('http://127.0.0.1:8768/choose',data=json.dumps({'state':state,'candidates':cands}).encode(),headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=60))
def build(food,fd,bd,order=('find_food','return_base'),dist_text=True):
    s=copy.deepcopy(tpl['state']); s['food']=food; s['nearby']['foodDistance']=fd; s['baseDistance']=bd
    base={c['id']:c['description'] for c in tpl['candidates']}
    ff="Find or collect food because current food reserves are not sufficient for safe progress."
    rb="Return to the known base to recover, resupply, store items, or prepare before continuing."
    if dist_text: ff+=f" Nearby food is approximately {fd:.1f} blocks away."; rb+=f" The known base is approximately {bd:.1f} blocks away."
    d={'find_food':ff,'return_base':rb}
    return s,[{'id':i,'description':d[i]} for i in order]
rows=[]
for food,fd,bd in itertools.product([1,2,4,6,8],[0.5,1,2,4,6,8],[3,10,30,60,150,500]):
    s,c=build(food,fd,bd); r=call(s,c)
    rows.append({'food':food,'fd':fd,'bd':bd,'choice':r['choice'],'p_find_food':r['probabilities'].get('find_food'),'conf':r['confidence']})
def summ(rs): return {'n':len(rs),'find_food':sum(x['choice']=='find_food' for x in rs),'max_p_find_food':max(x['p_find_food'] for x in rs),'mean_p_find_food':sum(x['p_find_food'] for x in rs)/len(rs)}
out={'grid':summ(rows)}
out['by_food_distance']={fd:summ([x for x in rows if x['fd']==fd]) for fd in (0.5,1,2,4,6,8)}
out['by_base_distance']={bd:summ([x for x in rows if x['bd']==bd]) for bd in (3,10,30,60,150,500)}
out['by_food']={f:summ([x for x in rows if x['food']==f]) for f in (1,2,4,6,8)}
# controles
ctl={}
for name,kw in {'baseline(fd=2,bd=57)':dict(food=3,fd=2,bd=57),'order_swapped':dict(food=3,fd=2,bd=57,order=('return_base','find_food')),'no_distance_text':dict(food=3,fd=2,bd=57,dist_text=False),
                'food_at_feet(fd=0.5,bd=500)':dict(food=1,fd=0.5,bd=500),'no_distance_text_order_swapped':dict(food=3,fd=2,bd=57,order=('return_base','find_food'),dist_text=False)}.items():
    s,c=build(**kw); r=call(s,c); ctl[name]={'choice':r['choice'],'conf':round(r['confidence'],4),'p':{k:round(v,6) for k,v in r['probabilities'].items()}}
# food 9-10: conjunto de candidatos real é find_food/continue_objective
s,c=build(3,2,57); s['food']=10
c=[{'id':'find_food','description':c[0]['description']},{'id':'continue_objective','description':'Continue the current objective now.'}]
r=call(s,c); ctl['food10 find_food/continue_objective']={'choice':r['choice'],'conf':round(r['confidence'],4)}
out['controls']=ctl
# variação de outro campo: baseKnown/atBase e inventário com comida
s,c=build(3,2,57); s['atBase']=True; s['baseDistance']=0; r=call(s,c); out['controls']['atBase=true,bd=0']={'choice':r['choice'],'p_find_food':r['probabilities'].get('find_food')}
json.dump({'summary':out,'rows':rows},open('/tmp/run/v2/sweep.json','w'),indent=1)
print(json.dumps(out,indent=1))
