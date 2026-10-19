import json,sys,collections,re,datetime,os
SO='/tmp/claude-0/-home-user-minecraft-mbot/4d2cb92a-aa12-51e5-a40c-f847bb8ae3e8/scratchpad'
d=sys.argv[1]
rows=[json.loads(l) for l in open(d+'/julia-authority.jsonl')]
iso=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
dec=[r for r in rows if r['type']=='julia_authority_decision']; cyc=[r for r in rows if r['type']=='julia_authority_cycle']
t0=iso(dec[0]['decidedAt']); t1=max(iso(r.get('settledAt') or r['decidedAt']) for r in rows)
out={}
out['inicio']=t0.strftime('%H:%M:%S'); out['fim']=t1.strftime('%H:%M:%S'); out['duracao_min']=round((t1-t0).total_seconds()/60,1)
src=collections.Counter(r['source'] for r in dec)
out['decisoes']=len(dec); out['ciclos']=len(cyc); out['forcadas_candidato_unico']=src['forced']; out['julia_validas']=src['julia']
out['fallbacks']=dict(collections.Counter(r.get('fallbackReason') for r in dec if r['source']=='fallback'))
out['julia_invalidas_ou_rejeitadas']=sum(1 for r in dec if r.get('fallbackReason') in('invalid_choice','safety_violation'))
out['julia_timeouts']=sum(1 for r in dec if r.get('fallbackReason')=='timeout')
out['julia_erros_sidecar']=sum(1 for r in dec if (r.get('fallbackReason') or '').startswith(('offline','http','malformed','breaker')))
out['canceladas_durante_consulta']=sum(r['type']=='julia_authority_cancelled' for r in rows)
jul=[r for r in dec if r['source']=='julia']
out['julia_escolhas']={f"{','.join(k[0])} -> {k[1]}":v for k,v in collections.Counter((tuple(r['candidates']),r['choice']) for r in jul).most_common()}
out['julia_divergiu_da_deterministica']=sum(1 for r in jul if not r.get('agreesWithDeterministic'))
lat=sorted(r['latencyMs'] for r in dec if r.get('latencyMs') is not None)
if lat: out['latencia_ms']={'mediana':lat[len(lat)//2],'p90':lat[int(len(lat)*.9)],'max':lat[-1]}
out['acoes']=dict(collections.Counter(re.sub(r':(got|none).*','',str(r.get('action'))) for r in cyc).most_common())
codes=collections.Counter()
for r in cyc:
    res=r.get('result') or {}; codes[res.get('code') or (res.get('preparationSkipped') or {}).get('code') or ('ok' if res.get('ok') else 'none')]+=1
out['resultados']=dict(codes.most_common())
out['erros_texto']=dict(collections.Counter(((r.get('result') or {}).get('error') or '')[:45] for r in cyc if (r.get('result') or {}).get('error')).most_common())
gain=collections.Counter()
for r in cyc:
    a=(r.get('state') or {}).get('inventory') or {}; b=(r.get('nextState') or {}).get('inventory') or {}
    for k in set(a)|set(b):
        x=b.get(k,0)-a.get(k,0)
        if x>0: gain[k]+=x
out['itens_ganhos']=dict(gain.most_common())
streaks=[]; streak=1; prev=None
for r in cyc:
    key=(tuple(r['candidates']),r['choice'],(r.get('result') or {}).get('code'),json.dumps((r.get('nextState') or {}).get('inventory'),sort_keys=True))
    if key==prev: streak+=1
    else:
        if prev and streak>=10: streaks.append((streak,prev[1],prev[2]))
        streak=1
    prev=key
if prev and streak>=10: streaks.append((streak,prev[1],prev[2]))
out['repeticoes_>=10_ciclos_identicos']=[f"{n}x {c} -> {res}" for n,c,res in sorted(streaks,reverse=True)]
# server log no intervalo (com virada de dia)
lines=open(SO+'/mcserver/server.log',errors='replace').read().splitlines()
def tsec(h): hh,mm,ss=map(int,h.split(':')); return hh*3600+mm*60+ss
a,b=tsec(t0.strftime('%H:%M:%S')),tsec(t1.strftime('%H:%M:%S'))
inside=lambda s: (a<=s<=b) if a<=b else (s>=a or s<=b)
ev=collections.Counter(); deaths=[]
for l in lines:
    m=re.match(r'\[(\d\d:\d\d:\d\d)\]',l)
    if not m or 'explorador_01' not in l or not inside(tsec(m.group(1))): continue
    msg=l.split('explorador_01',1)[1].strip()
    if re.match(r'(was |drowned|died|fell|tried|burned|blew|hit|starved|suffocated|withered)',msg): deaths.append(m.group(1)+' '+msg[:40])
    elif msg.startswith('joined'): ev['conexoes']+=1
    elif msg.startswith('lost connection'): ev['desconexoes']+=1
out['mortes']=len(deaths); out['mortes_causas']=dict(collections.Counter(re.sub(r'^\S+ ','',x) for x in deaths)); out['conexoes']=dict(ev)
bl=open(d+'/bot.log',errors='replace').read().splitlines()
phys=collections.Counter(); crafts=collections.Counter(); wm=collections.Counter(); combat=collections.Counter()
for l in bl:
    if 'before_physical_action' in l and 'explorador_01' in l:
        op=(re.search(r'"operation":"(\w+)"',l) or [None,'?'])[1]; phys[op]+=1
        if op=='craft':
            it=re.search(r'"item":"(\w+)"',l) or re.search(r'"name":"(\w+)"',l)
            if it: crafts[it.group(1)]+=1
    m=re.match(r'\[world-memory\] (\w+)',l)
    if m: wm[m.group(1) if m.group(1)!='explorador_01' else (l.split()[2] if len(l.split())>2 else '?')]+=1
    m=re.match(r'\[colônia\] explorador_01 (\w+): (\w+)',l)
    if m and m.group(1) not in ('falhou','terminou','conectado','sem'): combat[m.group(2)]+=1
out['acoes_fisicas']=dict(phys.most_common()); out['crafts']=dict(crafts.most_common()); out['combates_reflexo']=dict(combat)
out['worldmemory']=dict(wm.most_common(8))
infra=open(d+'/infra.log').read().split('\n') if os.path.exists(d+'/infra.log') else []
out['infra']= [x for x in infra if x]
print(json.dumps(out,ensure_ascii=False,indent=1))
