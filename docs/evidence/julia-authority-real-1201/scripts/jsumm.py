import json,sys,collections,re
f=sys.argv[1] if len(sys.argv)>1 else '/tmp/run/jauth/julia-authority.jsonl'
rows=[json.loads(l) for l in open(f)]
dec=[r for r in rows if r['type']=='julia_authority_decision']
cyc=[r for r in rows if r['type']=='julia_authority_cycle']
print('decisions',len(dec),'cycles',len(cyc),'cancelled',sum(r['type']=='julia_authority_cancelled' for r in rows))
print('source',dict(collections.Counter(r['source'] for r in dec)))
print('fallbackReason',dict(collections.Counter(r.get('fallbackReason') for r in dec if r['source']=='fallback')))
print('candidate sets',dict(collections.Counter(','.join(r['candidates']) for r in dec)))
jul=[r for r in dec if r['source']=='julia']
print('julia choices',dict(collections.Counter((','.join(r['candidates']),r['choice']) for r in jul)))
print('julia agrees det',sum(r.get('agreesWithDeterministic') for r in jul),'/',len(jul))
lat=sorted(r['latencyMs'] for r in dec if r.get('latencyMs') is not None)
if lat: print('latency ms median',lat[len(lat)//2],'max',lat[-1])
print('actions',dict(collections.Counter(r.get('action') for r in cyc)))
print('result codes',dict(collections.Counter((r.get('result') or {}).get('code') or ((r.get('result') or {}).get('preparationSkipped') or {}).get('code') or 'ok' for r in cyc)))
inv=collections.Counter()
for r in cyc:
    a=(r.get('state') or {}).get('inventory') or {}; b=(r.get('nextState') or {}).get('inventory') or {}
    for k in set(a)|set(b):
        d=b.get(k,0)-a.get(k,0)
        if d>0: inv[k]+=d
print('inventory gains (sum over cycles)',dict(inv))
if dec: print('span',dec[0]['decidedAt'][11:19],'->',dec[-1]['decidedAt'][11:19])
