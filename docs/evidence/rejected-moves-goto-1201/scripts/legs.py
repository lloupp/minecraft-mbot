import json,sys,collections,math
d=sys.argv[1]; n=int(open(d+'/ar.N').read()); rows=[json.loads(l) for l in open(d+'/xp.jsonl').read().splitlines()[n:]]
g=[r for r in rows if r['ev']=='goTo.end']
print('goTo.end',len(g))
by=collections.defaultdict(list)
for r in g: by[(r['budget'],r['ok'],r.get('err'))].append(r['ms'])
for k,v in sorted(by.items(),key=str): print(k,len(v),'median',sorted(v)[len(v)//2],'max',max(v))
print('--- failures detail')
ex=[r for r in rows if r['ev']=='exploreTo']
for r in g:
    if not r['ok']:
        dist=math.dist([r['from'][0],r['from'][2]],[r['goal'][0],r['goal'][2]])
        e=max([x for x in ex if x['t']<=r['t'] and x['w']==r['w']] or [None],key=lambda x:x['t'] if x else 0)
        print(r['w'][-2:],r['budget'],r['ms'],r['err'][:30],'goal',r['goal'],'from',r['from'],'to',r['to'],'dxz',round(dist),'loaded',e and e['loadedAtTarget'],'upd',[ (u['s'],u['n'],u['ms']) for u in r['upd']][:4])
s=[r for r in rows if r['ev']=='surfaceAt']
print('surfaceAt',collections.Counter(json.dumps(r['r'].get('reason') if not r['r'].get('ok') else 'ok') if not r['r'].get('unknown') else 'unknown' for r in s))
pass
