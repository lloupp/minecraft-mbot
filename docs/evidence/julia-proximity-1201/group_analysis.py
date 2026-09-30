import json,sys,collections
D=sys.argv[1]
rows=[json.loads(l) for l in open(f'{D}/decisions.jsonl')]
rows=[r for r in rows if r['type']=='julia_shadow_decision']
def valid(r):
    s=r['state']; n=s['nearby']; c=r['candidates']
    return ('find_food' in c and 'return_base' in c and n.get('food') is True and isinstance(n.get('foodDistance'),(int,float))
            and isinstance(s.get('baseDistance'),(int,float)) and 1<=s['food']<=8 and s['health']>=18 and r['juliaChoice'] is not None)
def group(r):
    s=r['state']; fd=s['nearby']['foodDistance']; bd=s['baseDistance']
    fn = 'near' if fd<=3.5 else ('far' if 5<=fd<=8 else None)
    bn = 'near' if 4<=bd<=16 else ('far' if bd>=40 else None)
    return (fn,bn)
V=[r for r in rows if valid(r)]
print('rows',len(rows),'valid',len(V),'invalid',len(rows)-len(V))
inv=collections.Counter()
for r in rows:
    if not valid(r):
        s=r['state']; inv[('food=%s'%s['food'] if not 1<=s['food']<=8 else 'other')]+=1
print('invalid reasons',dict(inv))
G=collections.defaultdict(list)
for r in V:
    g=group(r)
    if None in g: continue
    G[g].append(r)
names={('near','far'):'G1 comida perto / base longe',('far','near'):'G2 comida longe / base perto',('near','near'):'G3 comida perto / base perto',('far','far'):'G4 (controle) comida longe / base longe'}
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))] if v else None
out={}
for g in [('near','far'),('far','near'),('near','near'),('far','far')]:
    v=G.get(g,[]); ff=sum(r['juliaChoice']=='find_food' for r in v); rb=sum(r['juliaChoice']=='return_base' for r in v)
    conf=[r['juliaConfidence'] for r in v if r['juliaConfidence'] is not None]; lat=[r['latencyMs'] for r in v]
    out[names[g]]={'decisions':len(v),'find_food':ff,'return_base':rb,'other':len(v)-ff-rb,
      'find_food_rate':round(ff/len(v),3) if v else None,
      'confidence_mean':round(sum(conf)/len(conf),4) if conf else None,'confidence_min':round(min(conf),4) if conf else None,
      'latency_p50':pct(lat,.5),'latency_p95':pct(lat,.95),
      'food_levels':sorted(collections.Counter(r['state']['food'] for r in v).items()),
      'foodDistance_range':[round(min(r['state']['nearby']['foodDistance'] for r in v),1),round(max(r['state']['nearby']['foodDistance'] for r in v),1)] if v else None,
      'baseDistance_range':[round(min(r['state']['baseDistance'] for r in v),1),round(max(r['state']['baseDistance'] for r in v),1)] if v else None,
      'errors':sum(bool(r['juliaError']) for r in v),'timeouts':sum(r['juliaError']=='timeout' for r in v),
      'invalid_choices':sum(r['juliaError']=='invalid_choice' for r in v),
      'safety_violations':sum(r.get('wouldViolateSafety') is True for r in v),'abandonments':sum(bool(r.get('wouldAbandonObjective')) for r in v),
      'health_min':min(r['state']['health'] for r in v) if v else None,'inventory_set':sorted({json.dumps(r['state']['inventory'],sort_keys=True) for r in v}),
      'objective_set':sorted({(r['state'].get('objective') or {}).get('type') for r in v})}
allr=[r for r in rows]
out['_all_rows']={'errors':sum(bool(r['juliaError']) for r in allr),'timeouts':sum(r['juliaError']=='timeout' for r in allr),'error_kinds':dict(collections.Counter(r['juliaError'] for r in allr if r['juliaError']))}
json.dump(out,open(f"{D}/group-analysis.json","w"),indent=1,ensure_ascii=False)
print(json.dumps(out,indent=1,ensure_ascii=False))
