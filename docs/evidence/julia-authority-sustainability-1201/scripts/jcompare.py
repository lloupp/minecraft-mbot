import json,sys,re,datetime,collections
SO='/tmp/claude-0/-home-user-minecraft-mbot/4d2cb92a-aa12-51e5-a40c-f847bb8ae3e8/scratchpad'
EDIBLE={'beef','porkchop','chicken','mutton','rabbit','cooked_beef','cooked_porkchop','cooked_chicken','apple','bread','rotten_flesh','carrot','potato','sweet_berries','cod','salmon','melon_slice'}
import gzip,glob,os
LOGS=[]
for f in sorted(glob.glob(SO+'/mcserver/logs/*.log.gz')):
    d=datetime.date.fromisoformat(os.path.basename(f)[:10]); LOGS.append((d,gzip.open(f,'rt',errors='replace').read().splitlines()))
LOGS.append((datetime.datetime.fromtimestamp(os.path.getmtime(SO+'/mcserver/logs/latest.log'),datetime.timezone.utc).date(),open(SO+'/mcserver/logs/latest.log',errors='replace').read().splitlines()))
iso=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
def run(d):
    rows=[json.loads(l) for l in open(d+'/julia-authority.jsonl')]
    dec=[r for r in rows if r['type']=='julia_authority_decision']
    t0=iso(dec[0]['decidedAt']); t1=max(iso(r.get('settledAt') or r['decidedAt']) for r in rows)
    # mortes com data
    deaths=[]
    for day,lines in LOGS:
        for l in lines:
            m=re.match(r'\[(\d\d):(\d\d):(\d\d)\] .*explorador_01 (was |drowned|died|fell|tried|burned|blew|hit|starved|suffocated)',l)
            if not m: continue
            t=datetime.datetime(day.year,day.month,day.day,int(m[1]),int(m[2]),int(m[3]),tzinfo=datetime.timezone.utc)
            if t0<=t<=t1: deaths.append(t)
    deaths=sorted(set(deaths))
    # noites: trechos contíguos de decisões com time=night
    nights=[]; cur=None
    for r in dec:
        t=iso(r['decidedAt']); n=r['state'].get('time')=='night'
        if n and cur is None: cur=[t,t]
        elif n: cur[1]=t
        elif cur is not None: nights.append((cur[0],cur[1],True)); cur=None
    if cur: nights.append((cur[0],cur[1],False))   # noite em aberto no fim
    full=[x for x in nights if x[2]]
    survived=sum(1 for a,b,_ in full if not any(a<=dt<=b+datetime.timedelta(seconds=10) for dt in deaths))
    night_deaths=sum(1 for dt in deaths if any(a<=dt<=b+datetime.timedelta(seconds=10) for a,b,_ in nights))
    # comida comida: queda de item comestível entre estados consecutivos, sem perda total do inventário (morte)
    eaten=collections.Counter(); prev=None
    for r in dec:
        inv=r['state'].get('inventory') or {}
        if prev is not None and inv:
            for k in EDIBLE:
                drop=prev.get(k,0)-inv.get(k,0)
                if drop>0: eaten[k]+=drop
        prev=inv
    f=json.load(open(d+'/final.json'))
    errs=f.get('erros_texto',{})
    nav=sum(v for k,v in errs.items() if k.startswith(('caminho demorou','No path','Took to long','servidor rejeitou')))
    infra=[x for x in f.get('infra',[]) if 'restart' in x]
    return {'duracao_min':f['duracao_min'],'decisoes':f['decisoes'],'julia':f['julia_validas'],'forcadas':f['forcadas_candidato_unico'],
      'fallbacks':sum(f['fallbacks'].values()),'invalidas':f['julia_invalidas_ou_rejeitadas'],'timeouts_julia':f['julia_timeouts'],
      'divergiu':f['julia_divergiu_da_deterministica'],'latencia':f.get('latencia_ms'),
      'mortes':len(deaths),'mortes_por_hora':round(len(deaths)/(f['duracao_min']/60),1),'mortes_causas':f['mortes_causas'],
      'noites_completas':len(full),'noites_sobrevividas_sem_morte':survived,'mortes_de_noite':night_deaths,
      'comida_obtida':{k:v for k,v in f['itens_ganhos'].items() if k in EDIBLE},'comida_comida':dict(eaten),
      'crafts':f['crafts'],'coleta':{k:f['itens_ganhos'].get(k,0) for k in ('oak_log','cobblestone','dirt','sand','gravel','string','leather')},
      'acoes_fisicas':f['acoes_fisicas'],'combate_reflexo':f['combates_reflexo'],'fugas_loop':f['acoes'].get('threat:escape_danger:fugi',0),
      'falhas_navegacao':nav,'erros':errs,'repeticoes':f['repeticoes_>=10_ciclos_identicos'],'reinicios_codigo_infra':len(infra)}
out={'r3':run('/tmp/run/jruns/r3-final'),'r4':run('/tmp/run/jruns/r4-final')}
print(json.dumps(out,ensure_ascii=False,indent=1))
