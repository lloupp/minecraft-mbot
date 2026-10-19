import json,collections,re
n=int(open('/tmp/run/ar.N').read()); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=rows[0]['t']
c=collections.Counter()
runs=[]
for r in rows:
    if r['ev']=='run.start': runs.append([round((r['t']-t0)/1000),r['task'],r.get('src')])
    if r['ev'] in('run.end','run.reject') and runs:
        runs[-1]+= [r.get('ok'), r.get('code') or r.get('err'), [ (s['intent']) for s in (r.get('steps') or [])]]
    c[r['ev']]+=1
print({k:v for k,v in c.items() if k in('staging.start','table.search','goTo','storage.summary','storage.withdraw','storage.deposit','storage.withdrawFirst','planner.plan')})
print('runs:',len(runs), collections.Counter((x[1],x[3] if len(x)>3 else None,x[4] if len(x)>4 else None) for x in runs))
print('runs with steps:',[x for x in runs if len(x)>5 and x[5]])
mx=0
for r in rows:
    if r['ev']=='orch.tick':
        for _,ms in r['backoff']: mx=max(mx,ms)
print('max backoff ms',mx)
L0=int(open('/tmp/run/long.L0').read())
log=open('/tmp/run/bot-current.log',errors='replace').read().splitlines()[L0:]
crafts=[l for l in log if '"operation":"craft"' in l]
import re
print('crafts:',collections.Counter(re.search(r'"item":"([a-z_]+)"',l).group(1) for l in crafts))
print('digs:',collections.Counter(re.search(r'"block":\{"name":"([a-z_]+)"',l).group(1) for l in log if '"operation":"dig"' in l))
