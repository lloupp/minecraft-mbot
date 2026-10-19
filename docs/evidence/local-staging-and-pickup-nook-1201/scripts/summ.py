import json,sys
n=int(open('/tmp/run/ar.N').read()); rows=[json.loads(l) for l in open('/tmp/run/xp.jsonl')][n:]
t0=None; first=None
for r in rows:
    if r['ev']=='run.start' and r.get('task')=='explorar' and t0 is None: t0=r['t']; first=r
stg=[r for r in rows if r['ev']=='staging.start']; 
end=[r for r in rows if r['ev']=='xpl.end']
tm=[r for r in rows if r['ev']=='table.search']
gt=[r for r in rows if r['ev']=='mineBlocks' and r.get('phase')=='attempt']
print('staging:',len(stg),'table.search:',len(tm),'attempts:',[(a.get('code') or 'ok') for a in gt])
for e in end[:3]:
    print(' xpl.end', round((e['t']-t0)/1000,1), e.get('ok'), e.get('code'), [(s['intent'],s['ok'],s['code']) for s in e.get('steps',[])], e['inv'][:90])
print(' storage calls during first task:',[r['ev'] for r in rows if r['ev'].startswith('storage.') and end and r['t']<end[0]['t']])
