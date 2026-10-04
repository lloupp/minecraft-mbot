import json,collections
n=int(open('/tmp/run/ar.N').read()); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
marks=[l.split() for l in open('/tmp/run/soak.marks')]
resets=[(int(m[3]),int(m[1])) for m in marks if m[2]=='reset']+[(10**15,99)]
zom={int(m[1]) for m in marks if m[2]=='zombie'}
workers=sorted({r.get('w') for r in rows if r.get('w') and r['ev']=='run.start'})
for i,(t,rd) in enumerate(resets[:-1]):
    t1=resets[i+1][0]; line=[]
    for w in workers:
        seg=[r for r in rows if t<=r['t']<t1 and r.get('w')==w]
        ok=any(r['ev']=='xpl.end' and any(s['intent']=='prepare_combat' and s['ok'] for s in (r.get('steps') or [])) for r in seg)
        codes=collections.Counter((r.get('code') or (r.get('skipped') or {}).get('code')) for r in seg if r['ev']=='xpl.end' and not r.get('ok') or (r['ev']=='xpl.end' and r.get('skipped')))
        line.append(f"{w[-2:]}:{'ARMED' if ok else 'no'}{dict(codes) if codes else ''}")
    print(f"round {rd} zombie={'y' if rd in zom else 'n'}  "+'  '.join(line))
c=collections.Counter(r['ev'] for r in rows)
print({k:v for k,v in c.items() if k in('run.reject','staging.start')})
mx=max([ms for r in rows if r['ev']=='orch.tick' for _,ms in r['backoff']]+[0]); print('max backoff ms',mx)
rej=[r for r in rows if r['ev']=='run.reject']; print('rejects',collections.Counter(r.get('err') for r in rej))
