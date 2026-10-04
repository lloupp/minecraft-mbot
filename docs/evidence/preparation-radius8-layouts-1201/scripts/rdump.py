import json,sys
d,k=sys.argv[1],sys.argv[2]
n=int(open(f'/tmp/run/{d}/ar.N').read()); rows=[json.loads(l) for l in open(f'/tmp/run/{d}/xp.jsonl')][n:]
marks=[l.split() for l in open(f'/tmp/run/{d}/soak.marks')]
rs={m[1]:int(m[3]) for m in marks if m[2]=='reset'}; rs['7']=10**15
a=rs[k]
skip={'orch.tick','planner.plan','storage.summary','explore.pos+2000','explore.pos+6000'}
for r in rows:
    if a<=r['t']<rs[str(int(k)+1)] and r['ev'] not in skip and r.get('phase')!='blocked_diag':
        print((r['t']-a)//100/10, json.dumps({x:v for x,v in r.items() if x not in('t','w')})[:300])
