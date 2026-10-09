# Métricas de uma execução medida (diretório de run1.sh). Saída: JSON.
import json,sys,collections,re,gzip,datetime,os,math
d=sys.argv[1]
op=lambda p: gzip.open(p,'rt',errors='replace') if p.endswith('.gz') else open(p,errors='replace')
def f(name):
    for p in (f'{d}/{name}.gz',f'{d}/{name}'):
        if os.path.exists(p): return p
infra=[l.split() for l in open(f'{d}/infra.log') if l.strip()]
t_start=next(int(x[0]) for x in infra if x[1]=='explorer_created')
t_end=next((int(x[0]) for x in infra if x[1]=='end'),None)
out={'run':os.path.basename(d.rstrip('/')),'arm':next(x[2].split('=')[1] for x in infra if x[1]=='start'),
     'head':next(x[4].split('=')[1] for x in infra if x[1]=='start')}
pos=[]
for l in open(f'{d}/positions.log'):
    p=l.split(None,2)
    if len(p)<3 or not p[1].isdigit(): continue
    m=re.findall(r'-?\d+\.?\d*',p[2].split('data:')[-1])
    if len(m)>=3: pos.append((int(p[0]),int(p[1]),float(m[0]),float(m[1]),float(m[2])))
t_end=t_end or (pos[-1][0] if pos else t_start)
out['duracao_min']=round((t_end-t_start)/60,1)
# mortes (server.log, horas UTC do mesmo dia do início)
day0=datetime.datetime.utcfromtimestamp(t_start).date()
deaths=[]
inst=next(x[3].split('=')[1] for x in infra if x[1]=='start')
for l in op(f('server.log') or f'/tmp/run/m/srv-{inst}/server.log'):
    m=re.match(r'\[(\d\d):(\d\d):(\d\d)\] \[Server thread/INFO\]: explorador_01 (.*)',l)
    if not m: continue
    msg=m.group(4)
    if re.match(r'(was |drowned|died|fell|tried|burned|blew|hit|starved|suffocated|withered|went up|walked into)',msg):
        t=datetime.datetime.combine(day0,datetime.time(int(m[1]),int(m[2]),int(m[3])),tzinfo=datetime.timezone.utc).timestamp()
        if t<t_start-3600: t+=86400
        if t_start<=t<=t_end: deaths.append((int(t),re.sub(r'explorador_01|using.*','',msg).strip()))
def daytime_at(t):
    best=min(pos,key=lambda p:abs(p[0]-t)) if pos else None
    return best[1]%24000 if best else None
isnight=lambda dt: dt is not None and 13000<=dt<23000
out['mortes_epoch']=[t for t,_ in deaths]; out['mortes']=len(deaths); out['mortes_por_hora']=round(len(deaths)/max(1e-9,(t_end-t_start)/3600),1)
out['mortes_de_noite']=sum(isnight(daytime_at(t)) for t,_ in deaths)
out['causas']=dict(collections.Counter(re.sub(r'\s+',' ',c) for _,c in deaths).most_common())
marks=[t_start]+[t for t,_ in deaths]+[t_end]
lives=[(b-a)/60 for a,b in zip(marks,marks[1:])]
out['maior_vida_min']=round(max(lives),1); out['vida_mediana_min']=round(sorted(lives)[len(lives)//2],1)
out['primeira_morte_min']=round(lives[0],1) if deaths else None
# noites: intervalos contínuos com daytime em [13000,23000)
nights=[]; cur=None
for p in pos:
    if isnight(p[1]%24000):
        cur=[p[0],p[0]] if cur is None else [cur[0],p[0]]
    elif cur: nights.append(tuple(cur)); cur=None
complete=[n for n in nights if n[1]-n[0]>=400]
out['noites_completas']=len(complete)
out['noites_sem_morte']=sum(1 for a,b in complete if not any(a<=t<=b for t,_ in deaths))
# paradas: maior intervalo com deslocamento < 2 blocos
best=0;i=0
for j in range(len(pos)):
    while i<j and math.dist(pos[i][2:],pos[j][2:])>=2: i+=1
    best=max(best,pos[j][0]-pos[i][0])
out['maior_parada_min']=round(best/60,1)
# parada de dia (abrigado/dormindo à noite é parado de propósito)
best=0;i=0;day=[p for p in pos if not isnight(p[1]%24000)]
for j in range(len(day)):
    if j and day[j][0]-day[j-1][0]>60: i=j
    while i<j and math.dist(day[i][2:],day[j][2:])>=2: i+=1
    best=max(best,day[j][0]-day[i][0])
out['maior_parada_dia_min']=round(best/60,1)
# decisões
rows=[json.loads(l) for l in open(f'{d}/julia-authority.jsonl')] if os.path.exists(f'{d}/julia-authority.jsonl') else []
dec=[r['data'] if 'data' in r else r for r in rows if r['type']=='julia_authority_decision']
cyc=[r['data'] if 'data' in r else r for r in rows if r['type']=='julia_authority_cycle']
src=collections.Counter(r['source'] for r in dec)
out['decisoes']=len(dec); out['fontes']=dict(src)
out['fallbacks']=dict(collections.Counter(r.get('fallbackReason') for r in dec if r['source']=='fallback'))
multi=[r for r in dec if r['source']!='forced']
out['escolhas_multicandidato']={f"{','.join(k[0])} -> {k[1]}":v for k,v in collections.Counter((tuple(r['candidates']),r['choice']) for r in multi).most_common(12)}
out['acoes']=dict(collections.Counter(re.sub(r':(got|none).*|:\w+:\w+$','',str(r.get('action'))) for r in cyc).most_common(12))
FOOD={'beef','porkchop','chicken','mutton','rabbit','cod','salmon','apple','bread','carrot','potato','sweet_berries','glow_berries','melon_slice','rotten_flesh','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton','cooked_rabbit','cooked_cod','cooked_salmon','baked_potato','beetroot','spider_eye'}
gain=collections.Counter()
for r in cyc:
    a=(r.get('state') or {}).get('inventory') or {}; b=(r.get('nextState') or {}).get('inventory') or {}
    for k in set(a)|set(b):
        x=b.get(k,0)-a.get(k,0)
        if x>0: gain[k]+=x
out['comida_obtida']=sum(v for k,v in gain.items() if k in FOOD); out['comida_itens']={k:v for k,v in gain.items() if k in FOOD}
out['comeu_ciclos']=sum(1 for r in cyc if (r.get('result') or {}).get('ate'))
out['noite_resultados']=dict(collections.Counter(str(r.get('action')) for r in cyc if str(r.get('action')).startswith('night')))
out['itens_ganhos_top']=dict(gain.most_common(10))
bl=list(op(f('bot.log'))) if f('bot.log') else []
out['pernas_falhas']=sum('perna falhou' in l for l in bl)
out['caminho_demorou']=sum('caminho demorou demais' in l for l in bl)
crafts=collections.Counter()
for l in bl:
    if 'before_physical_action' in l and '"operation":"craft"' in l:
        it=re.search(r'"item":"(\w+)"',l) or re.search(r'"name":"(\w+)"',l)
        if it: crafts[it.group(1)]+=1
out['crafts']=dict(crafts.most_common())
out['infra']=[' '.join(x[1:]) for x in infra if x[1] not in('start','explorer_created','end')]
print(json.dumps(out,ensure_ascii=False))
