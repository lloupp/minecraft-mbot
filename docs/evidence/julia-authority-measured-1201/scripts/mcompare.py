# Agrega execuções por grupo (TAG-ARM-*) com média, desvio e valores individuais. uso: mcompare.py TAG1 [TAG2 ...]
import json,subprocess,sys,glob,statistics as st,os
KEYS=['duracao_min','mortes','mortes_por_hora','mortes_de_noite','noites_completas','noites_sem_morte','maior_vida_min','vida_mediana_min',
      'primeira_morte_min','comida_obtida','comeu_ciclos','decisoes','pernas_falhas','caminho_demorou','maior_parada_min']
groups={}
for tag in sys.argv[1:]:
    for d in sorted(glob.glob(f'/tmp/run/m/runs/{tag}-*-[0-9]')):
        if not os.path.isdir(d): continue
        r=json.loads(subprocess.check_output(['python3','/tmp/run/m/mstats.py',d]))
        r['julia_escolhas']=r['fontes'].get('julia',0); r['fallback_n']=r['fontes'].get('fallback',0)
        groups.setdefault(f"{tag}/{r['arm']}",[]).append(r)
out={}
for g,rs in groups.items():
    row={'n':len(rs)}
    for k in KEYS+['julia_escolhas','fallback_n']:
        v=[r[k] for r in rs if r.get(k) is not None]
        row[k]={'media':round(st.mean(v),1) if v else None,'dp':round(st.stdev(v),1) if len(v)>1 else None,'valores':v}
    row['causas']={}
    for r in rs:
        for c,n in r['causas'].items(): row['causas'][c]=row['causas'].get(c,0)+n
    row['noite_resultados']={}
    for r in rs:
        for c,n in r['noite_resultados'].items(): row['noite_resultados'][c]=row['noite_resultados'].get(c,0)+n
    row['escolhas']={}
    for r in rs:
        for c,n in r['escolhas_multicandidato'].items(): row['escolhas'][c]=row['escolhas'].get(c,0)+n
    row['acoes']={}
    for r in rs:
        for c,n in r['acoes'].items(): row['acoes'][c]=row['acoes'].get(c,0)+n
    row['infra']=[x for r in rs for x in r['infra']]
    out[g]=row
print(json.dumps(out,ensure_ascii=False,indent=1))
