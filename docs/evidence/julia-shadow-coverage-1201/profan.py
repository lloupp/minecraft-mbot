import json,sys,collections
p=json.load(open(sys.argv[1]))
nodes={n['id']:n for n in p['nodes']}
parent={}
for n in p['nodes']:
    for c in n.get('children',[]): parent[c]=n['id']
selft=collections.Counter()
for s,d in zip(p['samples'],p['timeDeltas']): selft[s]+=d
tot=sum(selft.values())
idle=sum(t for i,t in selft.items() if nodes[i]['callFrame']['functionName']=='(idle)')
def name(i):
    cf=nodes[i]['callFrame']; return (cf['functionName'] or '(anon)', cf['url'].split('minecraft-mbot/')[-1].split('node_modules/')[-1][-50:], cf['lineNumber']+1)
cum=collections.Counter(); calls=collections.Counter()
for i,t in selft.items():
    seen=set(); j=i
    while j is not None:
        k=name(j)
        if k not in seen: cum[k]+=t; seen.add(k)
        j=parent.get(j)
print('profile wall %.0fs, non-idle %.0fs'%(tot/1e6,(tot-idle)/1e6))
for fn in ('nearbySignals','realStateSnapshot','observe','_observeShadow','_callLaya','_finish','blockAt'):
    m=[(k,v) for k,v in cum.items() if k[0]==fn]
    for k,v in sorted(m,key=lambda kv:-kv[1])[:2]: print('%-18s %-40s cum %.3fs (%.4f%% of non-idle)'%(k[0],k[1],v/1e6,100*v/max(1,tot-idle)))
print('--- top cumulative in repo code'); 
for k,v in cum.most_common(400):
    if 'node_modules' in k[1] or k[1].startswith('node:') or k[0] in('(root)','(program)','(idle)','(garbage collector)'): continue
    print('%.1fs'%(v/1e6),k)
    if sum(1 for _ in [0])>0 and cum.most_common(400).index((k,v))>25: break
