import json,sys,collections
D=sys.argv[1]
P=[json.loads(l) for l in open(f'{D}/probe-dispatch.jsonl')]
S=[json.loads(l) for l in open(f'{D}/julia-shadow.jsonl')]; S=[x for x in S if x['type']=='julia_shadow_decision']
PL=[json.loads(l) for l in open(f'{D}/julia-payloads.jsonl')]
# junta dispatch <-> linha do shadow (mesmo worker, mesmos candidatos e food; o mais próximo no tempo à frente)
import datetime
def t(x): return datetime.datetime.fromisoformat(x['decidedAt'].replace('Z','+00:00')).timestamp()
shadow_by=[(t(x),x) for x in S]
used=set()
def find(p):
    best=None
    for i,(ts,x) in enumerate(shadow_by):
        if i in used: continue
        if abs(ts-p['ts']/1000)<2.5 and x['candidates']==p['candidates'] and x['state']['food']==p['state']['food']:
            if best is None or abs(ts-p['ts']/1000)<abs(shadow_by[best][0]-p['ts']/1000): best=i
    if best is not None: used.add(best); return shadow_by[best][1]
def expected_forced(s):
    n=s['nearby']; fd=n.get('foodDistance'); bd=s.get('baseDistance')
    return (s['food']<=5 and not p_hasfood(s) and bool(n.get('food')) and isinstance(fd,(int,float)) and fd<=8 and (bd is None or fd<bd))
def p_hasfood(s): return any(k in s['inventory'] for k in ('bread','cooked_beef','beef','apple','cooked_porkchop','porkchop','carrot','baked_potato','cooked_chicken','chicken','mutton','cooked_mutton','rabbit'))
rows=[]
for p in P:
    s=p['state']; sh=find(p) if len(p['candidates'])>1 else None
    rows.append({'p':p,'shadow':sh,'expected_forced':expected_forced(s),'has_threat':bool(s['threat'])})
def scen(r):
    s=r['p']['state']; n=s['nearby']; f=s['food']; fd=n.get('foodDistance'); bd=s['baseDistance']
    if r['has_threat']: return 'X hunger+threat'
    if not n.get('food'): return 'S4 comida além de 8 (nearby.food=false)' if f<=8 else None
    if f<=5 and fd is not None and fd<bd: return 'S1 food<=5, comida perto e mais perto que a base'
    if f<=5 and fd is not None and fd>=bd: return 'S3 food<=5, base mais perto que a comida'
    if 6<=f<=8: return 'S2 food 6-8, comida perto'
    return None
G=collections.defaultdict(list)
for r in rows:
    k=scen(r)
    if k: G[k].append(r)
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))] if v else None
out={'dispatches':len(P),'shadow_rows':len(S),'payloads_to_sidecar':len(PL)}
for k in sorted(G):
    v=G[k]; cs=collections.Counter(','.join(r['p']['candidates']) for r in v)
    forced=sum(r['p']['forced'] for r in v); consulted=[r for r in v if r['shadow'] is not None]
    ch=collections.Counter(r['shadow']['juliaChoice'] for r in consulted)
    lat=[r['shadow']['latencyMs'] for r in consulted]
    out[k]={'n':len(v),'candidate_sets':dict(cs),'forced(single candidate)':forced,
      'forced_find_food':sum(r['p']['candidates']==['find_food'] for r in v),
      'matches_expected_guardrail':sum(r['p']['forced'] and r['p']['candidates']==['find_food']==([ 'find_food'] if r['expected_forced'] else None) or (not r['expected_forced'] and r['p']['candidates']!=['find_food']) for r in v),
      'julia_consulted':len(consulted),'julia_choices':dict(ch),'julia_conf_min':min([r['shadow']['juliaConfidence'] for r in consulted if r['shadow']['juliaConfidence'] is not None] or [None]) if consulted else None,
      'latency_p50':pct(lat,.5),'latency_p95':pct(lat,.95),
      'errors':sum(bool(r['shadow']['juliaError']) for r in consulted),'timeouts':sum(r['shadow']['juliaError']=='timeout' for r in consulted),
      'invalid_choices':sum(r['shadow']['juliaError']=='invalid_choice' for r in consulted),
      'safety_violations':sum(r['shadow'].get('wouldViolateSafety') is True for r in consulted),'abandonments':sum(bool(r['shadow'].get('wouldAbandonObjective')) for r in consulted),
      'food_range':[min(r['p']['state']['food'] for r in v),max(r['p']['state']['food'] for r in v)],
      'foodDistance_range':[round(min([r['p']['state']['nearby']['foodDistance'] for r in v if r['p']['state']['nearby'].get('foodDistance') is not None] or [-1]),1),round(max([r['p']['state']['nearby']['foodDistance'] for r in v if r['p']['state']['nearby'].get('foodDistance') is not None] or [-1]),1)],
      'baseDistance_range':[round(min(r['p']['state']['baseDistance'] for r in v),1),round(max(r['p']['state']['baseDistance'] for r in v),1)]}
# invariante global: forced <=> expected
mism=[r for r in rows if (r['p']['candidates']==['find_food']) != r['expected_forced']]
out['guardrail_mismatches(candidates==[find_food] xor rule)']=len(mism)
out['forced_and_consulted(should be 0)']=sum(1 for r in rows if r['p']['forced'] and r['shadow'] is not None)
out['multi_candidate_without_shadow_row']=sum(1 for r in rows if len(r['p']['candidates'])>1 and r['shadow'] is None)
json.dump(out,open(f'{D}/guard-analysis.json','w'),indent=1,ensure_ascii=False)
print(json.dumps(out,indent=1,ensure_ascii=False))
