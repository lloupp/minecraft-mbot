import json,sys,collections,datetime
D=sys.argv[1]
P=[json.loads(l) for l in open(f'{D}/probe-dispatch.jsonl')]
S=[json.loads(l) for l in open(f'{D}/julia-shadow.jsonl')]; S=[x for x in S if x['type']=='julia_shadow_decision']
PL=[json.loads(l) for l in open(f'{D}/julia-payloads.jsonl')]
FOODS=('bread','cooked_beef','beef','apple','cooked_porkchop','porkchop','carrot','baked_potato','cooked_chicken','chicken','mutton','cooked_mutton','rabbit')
def t(x): return datetime.datetime.fromisoformat(x['decidedAt'].replace('Z','+00:00')).timestamp()
sh=[(t(x),x) for x in S]; used=set()
def find(p):
    best=None
    for i,(ts,x) in enumerate(sh):
        if i in used or abs(ts-p['ts']/1000)>2.5 or x['candidates']!=p['candidates'] or x['state']['food']!=p['state']['food']: continue
        if best is None or abs(ts-p['ts']/1000)<abs(sh[best][0]-p['ts']/1000): best=i
    if best is not None: used.add(best); return sh[best][1]
def cond(s):  # condições de hunger crítico do teste (sem a ameaça)
    n=s['nearby']; fd=n.get('foodDistance'); bd=s.get('baseDistance')
    return s['food']<=5 and not any(k in s['inventory'] for k in FOODS) and bool(n.get('food')) and isinstance(fd,(int,float)) and fd<=8 and (bd is None or fd<bd)
rows=[]
for p in P:
    s=p['state']; rows.append({'p':p,'sh':find(p) if len(p['candidates'])>1 else None,'cond':cond(s),'threat':bool(s['threat'])})
G=collections.defaultdict(list)
for r in rows:
    if r['cond']: G['A ameaça presente' if r['threat'] else 'B sem ameaça'].append(r)
out={'dispatches':len(P),'shadow_rows':len(S),'payloads':len(PL)}
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))] if v else None
for k in sorted(G):
    v=G[k]; con=[r for r in v if r['sh']]
    lat=[r['sh']['latencyMs'] for r in con]
    out[k]={'n':len(v),'candidate_sets':dict(collections.Counter(','.join(r['p']['candidates']) for r in v)),
     'find_food_forced(single [find_food])':sum(r['p']['candidates']==['find_food'] for r in v),
     'find_food_in_any_candidates':sum('find_food' in r['p']['candidates'] for r in v),
     'immediateSafety':dict(collections.Counter(str(r['p']['immediateSafety']) for r in v)),
     'julia_consulted':len(con),'julia_choices':dict(collections.Counter(r['sh']['juliaChoice'] for r in con)),
     'choice_outside_candidates':sum(r['sh']['juliaChoice'] not in r['p']['candidates'] for r in con if r['sh']['juliaChoice']),
     'errors':sum(bool(r['sh']['juliaError']) for r in con),'timeouts':sum(r['sh']['juliaError']=='timeout' for r in con),
     'safety_violations':sum(r['sh'].get('wouldViolateSafety') is True for r in con),
     'authority':dict(collections.Counter(r['sh'].get('executionAuthority') for r in con)),
     'lat_p50':pct(lat,.5),'lat_p95':pct(lat,.95),'lat_max':max(lat) if lat else None,
     'food':[min(r['p']['state']['food'] for r in v),max(r['p']['state']['food'] for r in v)],
     'foodDistance':[min(r['p']['state']['nearby']['foodDistance'] for r in v),max(r['p']['state']['nearby']['foodDistance'] for r in v)],
     'baseDistance':[round(min(r['p']['state']['baseDistance'] for r in v),1),round(max(r['p']['state']['baseDistance'] for r in v),1)],
     'threat_distance':sorted({r['p']['state']['threat']['distance'] for r in v if r['threat']}),
     'equippedWeapon/inv_sword':dict(collections.Counter(str(any(k.endswith('_sword') for k in r['p']['state']['inventory'])) for r in v))}
out['multi_candidate_without_shadow_row']=sum(1 for r in rows if len(r['p']['candidates'])>1 and not r['sh'])
out['forced_and_consulted(should be 0)']=sum(1 for r in rows if r['p']['forced'] and r['sh'])
# payloads que contenham estado de hunger crítico com 1 candidato
out['payloads_with_single_candidate']=sum(1 for x in PL if x['request'] and len(x['request'].get('candidates',[]))==1)
out['payload_candidate_sets']=dict(collections.Counter(','.join(c['id'] for c in x['request']['candidates']) for x in PL if x['request']))
json.dump(out,open(f'{D}/prec-analysis.json','w'),indent=1,ensure_ascii=False); print(json.dumps(out,indent=1,ensure_ascii=False))
