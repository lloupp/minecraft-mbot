import json,sys,collections,re,datetime,subprocess,os
d=sys.argv[1] if len(sys.argv)>1 else '/tmp/run/jauth'
SO='/tmp/claude-0/-home-user-minecraft-mbot/4d2cb92a-aa12-51e5-a40c-f847bb8ae3e8/scratchpad'
rows=[json.loads(l) for l in open(d+'/julia-authority.jsonl')]
dec=[r for r in rows if r['type']=='julia_authority_decision']; cyc=[r for r in rows if r['type']=='julia_authority_cycle']
t0=dec[0]['decidedAt']; t1=rows[-1].get('settledAt') or rows[-1].get('decidedAt')
print('span',t0[11:19],'->',t1[11:19])
src=collections.Counter(r['source'] for r in dec)
print('decisions',len(dec),'| julia(valid)',src['julia'],'| forced',src['forced'],'| fallback',src['fallback'],dict(collections.Counter(r.get('fallbackReason') for r in dec if r['source']=='fallback')),'| cancelled',sum(r['type']=='julia_authority_cancelled' for r in rows))
inv=sum(1 for r in dec if r.get('fallbackReason') in('invalid_choice','safety_violation'))
print('julia invalid/rejected',inv,'| timeouts',sum(1 for r in dec if r.get('fallbackReason')=='timeout'),'| errors(offline/http/malformed)',sum(1 for r in dec if (r.get('fallbackReason') or '').startswith(('offline','http','malformed'))))
jul=[r for r in dec if r['source']=='julia']
print('julia choices',dict(collections.Counter((','.join(r['candidates']),r['choice']) for r in jul)))
print('julia diverged from deterministic',sum(1 for r in jul if not r.get('agreesWithDeterministic')),'/',len(jul))
lat=sorted(r['latencyMs'] for r in dec if r.get('latencyMs') is not None)
if lat: print('latency ms median',lat[len(lat)//2],'p90',lat[int(len(lat)*.9)],'max',lat[-1])
print('actions',dict(collections.Counter(r.get('action') for r in cyc)))
codes=collections.Counter()
for r in cyc:
    res=r.get('result') or {}; codes[res.get('code') or (res.get('preparationSkipped') or {}).get('code') or ('ok' if res.get('ok') else 'none')]+=1
print('results',dict(codes))
errs=collections.Counter((r.get('result') or {}).get('error') for r in cyc if (r.get('result') or {}).get('error'))
if errs: print('errors',dict(errs))
gain=collections.Counter(); loss=collections.Counter()
for r in cyc:
    a=(r.get('state') or {}).get('inventory') or {}; b=(r.get('nextState') or {}).get('inventory') or {}
    for k in set(a)|set(b):
        x=b.get(k,0)-a.get(k,0)
        if x>0: gain[k]+=x
        elif x<0: loss[k]-=x
print('inventory gains',dict(gain)); print('inventory losses',dict(loss))
# repetição: mesma (candidatos,escolha,resultado) consecutiva
streak=best=0; prev=None
for r in cyc:
    key=(tuple(r['candidates']),r['choice'],(r.get('result') or {}).get('code'),json.dumps((r.get('nextState') or {}).get('inventory'),sort_keys=True))
    streak=streak+1 if key==prev else 1; best=max(best,streak); prev=key
print('longest identical-cycle streak',best)
log=open(SO+'/mcserver/server.log',errors='replace').read().splitlines()
def inspan(l):
    m=re.match(r'\[(\d\d:\d\d:\d\d)\]',l); return m and t0[11:19]<=m.group(1)<=t1[11:19]
ev=[l for l in log if 'explorador_01' in l and inspan(l) and re.search(r'explorador_01 (was |died|drowned|fell|tried|burned|blew|hit|starved|suffocated|joined|left|lost connection)',l)]
print('server events',collections.Counter(re.sub(r'.*explorador_01 ','',l)[:28] for l in ev))
b=open(d+'/bot.log',errors='replace').read().splitlines()
bc=collections.Counter()
for l in b:
    if 'explorador_01' not in l: continue
    if 'before_physical_action' in l: bc['physical:'+ (re.search(r'"operation":"(\w+)"',l) or [None,'?'])[1]]+=1
    if 'morreu' in l: bc['died(bot log)']+=1
    if re.search(r'explorador_01 (\w+): (recuei|morto|venci|fugi)',l) or 'defend' in l: bc['combat:'+l.split(':')[-1].strip()[:20]]+=1
print('bot log',dict(bc))
feeds=sum(1 for _ in open(d+'/feeder.log')) if os.path.exists(d+'/feeder.log') else 0
print('objective feeds',feeds,'| infra',open(d+'/infra.log').read().split() if os.path.exists(d+'/infra.log') else None)
