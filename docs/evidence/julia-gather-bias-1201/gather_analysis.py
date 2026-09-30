import json,sys,collections,datetime
D=sys.argv[1]
def ts(x): return datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()
start=ts(open(f'{D}/phaseA-start').read().strip())
J=[l.split() for l in open(f'{D}/journal.log') if 'DISPATCH' in l]
J=[(ts(a[0]),a[2].split('=')[1],a[3].split('=')[1]) for a in J]
P=[json.loads(l) for l in open(f'{D}/probe-dispatch.jsonl')]; P=[p for p in P if p['type']=='dispatch' and p['ts']/1000>=start-2]
S=[json.loads(l) for l in open(f'{D}/julia-shadow.jsonl')]; S=[s for s in S if s['type']=='julia_shadow_decision']
rows=[]; used=set()
for (t,grp,w) in J:
    cand=[p for p in P if p['worker']==w and abs(p['ts']/1000-t)<8]
    if not cand: rows.append({'grp':grp,'worker':w,'missing':True}); continue
    p=min(cand,key=lambda p:abs(p['ts']/1000-t)); n=p['state']['nearby']
    sh=None
    if len(p['candidates'])>1:
        for i,s in enumerate(S):
            if i in used or s['worker']!=w: continue
            if abs(datetime.datetime.fromisoformat(s['decidedAt'].replace('Z','+00:00')).timestamp()-p['ts']/1000)<3 and s['candidates']==p['candidates']: sh=s; used.add(i); break
    rows.append({'grp':grp,'worker':w,'obj':p['state']['objective']['type'],'wood':n.get('woodDistance'),'stone':n.get('stoneDistance'),'iron':n.get('ironDistance'),
      'bd':p['state'].get('baseDistance'),'food':p['state']['food'],'threat':bool(p['state']['threat']),'inv':p['state']['inventory'],'cand':p['candidates'],
      'julia':sh['juliaChoice'] if sh else None,'conf':sh['juliaConfidence'] if sh else None,'lat':sh['latencyMs'] if sh else None,'err':sh['juliaError'] if sh else None,'viol':sh.get('wouldViolateSafety') if sh else None})
json.dump(rows,open(f'{D}/gather-rows.json','w'),indent=1)
def pct(v,q): v=sorted(v); return v[min(len(v)-1,int(q*len(v)))] if v else None
for g in ['G1','G2','G3','G4','G5']:
    R=[r for r in rows if r['grp']==g and not r.get('missing')]
    multi=[r for r in R if len(r['cand'])>1]; ju=[r for r in multi if r['julia']]
    ch=collections.Counter(r['julia'] for r in ju); lat=[r['lat'] for r in ju]
    print(g,'dispatches',len(R),'multi',len(multi),'julia',len(ju),'choices',dict(ch),'single sets',dict(collections.Counter(','.join(r['cand']) for r in R if len(r['cand'])==1)),
      'conf min/max',(round(min(r['conf'] for r in ju),3),round(max(r['conf'] for r in ju),3)) if ju else None,'lat p50/p95',(pct(lat,.5),pct(lat,.95)) if lat else None,
      'err',sum(bool(r['err']) for r in ju),'viol',sum(r['viol'] is True for r in ju),
      'wood',sorted({r['wood'] for r in R if r['wood'] is not None}),'stone',sorted({r['stone'] for r in R if r['stone'] is not None}),'iron',sorted({r['iron'] for r in R if r['iron'] is not None}),'bd',sorted({round(r['bd']) for r in R if r['bd'] is not None}))
