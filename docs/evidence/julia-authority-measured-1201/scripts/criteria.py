# Verifica os critérios de "funcionando" para cada execução (diretórios de run1.sh). uso: criteria.py DIR...
import json,subprocess,sys,gzip,os,datetime
def fopen(p): return gzip.open(p,'rt',errors='replace') if p.endswith('.gz') else open(p,errors='replace')
ok_all=True
for d in sys.argv[1:]:
    m=json.loads(subprocess.check_output(['python3','/tmp/run/m/mstats.py',d]))
    bl=d+'/bot.log.gz' if os.path.exists(d+'/bot.log.gz') else d+'/bot.log'
    log=fopen(bl).read()
    beds=log.count('cama colocada na base')
    nights=m['noite_resultados']; good=sum(v for k,v in nights.items() if k in('night:abrigo','night:dormi')); tot=sum(nights.values())
    rows=[json.loads(l) for l in open(d+'/julia-authority.jsonl')]
    dec=[r.get('data',r) for r in rows if r['type']=='julia_authority_decision']
    starve=0; cur=None
    for r in dec:
        t=datetime.datetime.fromisoformat(r['decidedAt'].replace('Z','+00:00')).timestamp()
        if r['state']['food']==0: cur=cur or t; starve=max(starve,t-cur)
        else: cur=None
    c={
     'cama colocada': beds>=1,
     'abrigo >=80%': tot>0 and good/tot>=0.8,
     # noite dormida na cama é pulada (não aparece como noite completa): conta como noite sem morte
     '>=2 de 3 noites sem morte': m['noites_sem_morte']+nights.get('night:dormi',0)>=2,
     'parada de dia <=5 min': m['maior_parada_dia_min']<=5,
     'fome 0 < 3 min seguidos': starve<180,
     '0 fallbacks e 0 quedas': not m['fallbacks'] and not m['infra'],
    }
    ok=all(c.values()); ok_all&=ok
    print(f"{os.path.basename(d)} {'PASSA' if ok else 'FALHA'} | mortes {m['mortes']} (noite {m['mortes_de_noite']}) noites_sem_morte {m['noites_sem_morte']}/{m['noites_completas']} | camas {beds} | abrigo {good}/{tot} {nights} | parada dia {m['maior_parada_dia_min']} (total {m['maior_parada_min']}) | fome0 {round(starve)}s | fallbacks {m['fallbacks']} infra {m['infra']} | comida {m['comida_obtida']}")
    for k,v in c.items():
        if not v: print('   x',k)
print('TODOS PASSAM' if ok_all else 'AINDA FALHA')
