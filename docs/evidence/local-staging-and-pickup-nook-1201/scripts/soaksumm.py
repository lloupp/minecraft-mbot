import json,collections,re
n=int(open('/tmp/run/ar.N').read()); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
marks=[l.split() for l in open('/tmp/run/soak.marks')]
resets=[(int(m[3]),int(m[1])) for m in marks if m[2]=='reset']
zom={int(m[1]):int(m[3]) for m in marks if m[2]=='zombie'}
resets.append((10**15,99))
c=collections.Counter(r['ev'] for r in rows)
print({k:v for k,v in c.items() if k in('staging.start','storage.summary','storage.withdraw','storage.deposit','storage.withdrawFirst','run.reject')})
w1=[r for r in rows if r.get('w') in (None,'explorador_01')]
for i,(t,rd) in enumerate(resets[:-1]):
    t1=resets[i+1][0]
    seg=[r for r in w1 if t<=r['t']<t1]
    armed=any(r['ev']=='xpl.end' and 'stone_sword' in r.get('inv','') for r in seg)
    ends=[(round((r['t']-t)/1000),r.get('ok'),r.get('code'),[s['intent'] for s in (r.get('steps') or [])]) for r in seg if r['ev']=='xpl.end' and (r.get('steps') or not r.get('ok'))]
    crafts=sum(1 for r in seg if r['ev']=='prep.start')
    stg=sum(1 for r in seg if r['ev']=='staging.start')
    print(f"round {rd} zombie={'y' if rd in zom else 'n'} armed_after={armed} staging={stg} prep_steps={crafts} notable={ends[:4]}")
L0=int(open('/tmp/run/long.L0').read())
log=open('/tmp/run/bot-current.log',errors='replace').read().splitlines()[L0:]
print('crafts:',collections.Counter(re.search(r'"item":"([a-z_]+)"',l).group(1) for l in log if '"operation":"craft"' in l))
mx=0
for r in rows:
    if r['ev']=='orch.tick':
        for _,ms in r['backoff']: mx=max(mx,ms)
print('max backoff ms',mx)
