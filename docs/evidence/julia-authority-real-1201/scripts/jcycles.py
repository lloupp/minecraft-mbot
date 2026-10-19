import json,sys
rows=[json.loads(l) for l in open('/tmp/run/jauth/julia-authority.jsonl')]
start=int(sys.argv[1]) if len(sys.argv)>1 else 0
for r in rows[start:]:
    d=r.get('data',r); t=r.get('type')
    if t=='julia_authority_cycle':
        s=d.get('state') or {}; ns=d.get('nextState') or {}
        inv=lambda x:','.join(f"{k}:{v}" for k,v in (x.get('inventory') or {}).items())
        res=d.get('result') or {}
        print(d['settledAt'][11:19], d['source'][:5], '|', ','.join(d['candidates']), '->', d['choice'], '(det',d['deterministicChoice']+')' if d['source']!='forced' else ')', d.get('fallbackReason') or '', '| act',d.get('action'),'| res',res.get('code') or ('ok' if res.get('ok') else res.get('ok')), (res.get('preparationSkipped') or {}).get('code',''), '| hp',s.get('health'),'food',s.get('food'),s.get('time'),'thr',(s.get('threat') or {}).get('type'),'| inv',inv(s),'->',inv(ns))
    elif t!='julia_authority_decision':
        print(t, json.dumps(d)[:200])
