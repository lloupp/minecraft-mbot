#!/usr/bin/env python3
"""Junta payload (proxy) + linha shadow + journal por decisão -> runtime/rows.json e tabela por grupo."""
import json, collections
R = 'runtime/'
P = [json.loads(l) for l in open(R + 'julia-payloads.jsonl')]
S = [json.loads(l) for l in open(R + 'julia-shadow.jsonl')]
J = [l.split() for l in open(R + 'journal-ctx.log') if 'DISPATCH' in l]
S_dec = [s for s in S if s.get('type') != 'julia_shadow_skip']
skips = [s for s in S if s.get('type') == 'julia_shadow_skip']
pi = 0; rows = []
for k, s in enumerate(S_dec):
    grp = J[k][2].split('=')[1]
    err = s.get('juliaError')
    p = P[pi] if pi < len(P) else None
    pi += 1
    q = p['request']; g = next(c for c in q['candidates'] if c['id'] == 'gather_materials')
    n = {a: b for a, b in s['state']['nearby'].items() if b not in (None, False)}
    rows.append({'group': grp, 'worker': s['worker'], 'objective': s['objectiveType'], 'nearby_sent': n,
                 'candidate_order': [c['id'] for c in q['candidates']], 'gather_materials_description': g['description'],
                 'choice': s.get('juliaChoice'), 'confidence': s.get('juliaConfidence'), 'latency_ms': s.get('latencyMs'),
                 'proxy_ms': p['proxy_ms'], 'http': p['status'], 'error': err, 'response': p['response'] if p['status'] != 200 else None})
json.dump({'rows': rows, 'shadow_skips': skips}, open(R + 'rows.json', 'w'), indent=1)
agg = collections.defaultdict(lambda: collections.Counter())
for r in rows:
    agg[r['group']]['n'] += 1
    agg[r['group']][r['choice'] or ('ERR:' + str(r['error']))] += 1
for g, c in sorted(agg.items()): print(g, dict(c))
print('shadow_skips', [(s['worker'], s['reason']) for s in skips])
for g in sorted(agg):
    rs = [r for r in rows if r['group'] == g and r['confidence'] is not None]
    if rs: print(g, 'conf %.3f-%.3f' % (min(r['confidence'] for r in rs), max(r['confidence'] for r in rs)), 'lat %d-%d ms' % (min(r['latency_ms'] for r in rs), max(r['latency_ms'] for r in rs)))
