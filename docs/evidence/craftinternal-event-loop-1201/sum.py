import json,sys
n0=int(sys.argv[1]); f=sys.argv[2]; E=[json.loads(l) for l in open(f)][n0:]
sc=[e for e in E if e['ev']=='table_scan']; ch=[e for e in E if e['ev']=='table_cache']; lag=[e['ms'] for e in E if e['ev']=='lag']
print('scans',len(sc),'total ms',round(sum(e['ms'] for e in sc)),'found',sum(e['found'] for e in sc),'| cache calls',len(ch),'hits',sum(e['hit'] for e in ch),'| lag>500 events',len(lag),'max',max(lag) if lag else 0)
print([{k:e.get(k) for k in ('worker','ms','kind','ok','code','gathered')} for e in E if e['ev']=='task_end'])
