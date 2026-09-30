#!/usr/bin/env python3
"""Análise da sessão real do Julia shadow mode (usa só os arquivos de evidência)."""
import json, re, sys, collections, statistics
D = sys.argv[1]  # diretório de evidência
def rows(p): return [json.loads(l) for l in open(p) if l.strip()]
main = [x for x in rows(f'{D}/main-decisions.jsonl') if x['type'] == 'julia_shadow_decision']
hun = [x for x in rows(f'{D}/hunger-decisions.jsonl') if x['type'] == 'julia_shadow_decision']
out = {}
def pct(v, q): v = sorted(v); return v[min(len(v) - 1, int(q * len(v)))] if v else None
def lat(v): l = [x['latencyMs'] for x in v]; return {'n': len(l), 'p50': pct(l, .5), 'p95': pct(l, .95), 'p99': pct(l, .99), 'max': max(l)}
out['main_latency_ms'] = lat(main); out['hunger_latency_ms'] = lat(hun)
def cover(v):
    nb = collections.Counter(k for x in v for k, on in x['state']['nearby'].items() if on)
    return {'decisions': len(v), 'multi_candidate(>=2)': sum(len(x['candidates']) >= 2 for x in v),
            'nearby_true': dict(nb), 'taskLineageId_present': sum(bool(x.get('taskLineageId')) for x in v),
            'candidate_sets': dict(collections.Counter(','.join(x['candidates']) for x in v)),
            'julia_choices': dict(collections.Counter(x['juliaChoice'] for x in v)),
            'by_worker': dict(collections.Counter(x['worker'] for x in v))}
out['main_coverage'] = cover(main); out['hunger_coverage'] = cover(hun)
# nearby -> candidate branch (validação por sinal)
by_sig = {}
for sig in ('food', 'wood', 'stone', 'iron'):
    sub = [x for x in main + hun if x['state']['nearby'].get(sig)]
    by_sig[sig] = {'decisions': len(sub), 'candidate_sets': dict(collections.Counter(','.join(x['candidates']) for x in sub).most_common(4))}
out['nearby_by_signal'] = by_sig
# linhagem / loops
L = collections.defaultdict(list)
for x in main: L[(x['worker'], x['taskLineageId'])].append(x)
sizes = sorted((len(v) for v in L.values()), reverse=True)
def max_run(keyf):
    best = 0; who = None
    for k, v in L.items():
        run = 1
        for a, b in zip(v, v[1:]):
            run = run + 1 if keyf(a) == keyf(b) else 1
            if run > best: best, who = run, k
    return best, who
strict = max_run(lambda r: json.dumps([r['juliaChoice'], r['state'].get('threat'), r['state'].get('food'), r['state'].get('objective'), r['candidates']]))
relaxed = max_run(lambda r: (r['juliaChoice'], tuple(r['candidates']), (r['state'].get('objective') or {}).get('type')))
out['lineage'] = {'distinct': len(L), 'largest': sizes[:5], 'single_decision_lineages': sum(1 for s in sizes if s == 1),
                  'max_identical_streak_strict_key(report)': strict[0], 'max_identical_streak_relaxed_key': relaxed[0], 'relaxed_lineage': relaxed[1],
                  'resumed': sum(bool(x['resumedObjective']) for x in main), 'interrupted': sum(bool(x['interrupted']) for x in main)}
# resultado das ações reais
res = collections.Counter()
for x in main:
    r = x.get('result') or {}
    res[(x['executedChoice'], 'ok' if r.get('ok') else ('cancelled' if r.get('code') == 'CANCELLED' else 'failed'))] += 1
out['real_action_results'] = {f'{a}:{b}': n for (a, b), n in sorted(res.items())}
out['agreement'] = {'rules_agree': sum(x['agreesWithRules'] is True for x in main), 'rules_disagree': sum(x['agreesWithRules'] is False for x in main),
                    'safety_overrides': sum(bool(x['safetyOverride']) for x in main), 'safety_critical_decisions': sum(bool(x['safetyCritical']) for x in main)}
dis = collections.Counter((','.join(x['candidates']), x['rulesChoice'], x['juliaChoice']) for x in main + hun if x['agreesWithRules'] is False)
out['disagreements'] = [{'candidates': k[0], 'rules': k[1], 'julia': k[2], 'n': n} for k, n in dis.most_common()]
# lag
def lagstats(p):
    v = sorted(int(re.search(r'lag (\d+)ms', l).group(1)) for l in open(p) if 'lag' in l)
    return {'events_gt_200ms': len(v), 'gt_500ms': sum(x > 500 for x in v), 'gt_1000ms': sum(x > 1000 for x in v), 'p50': pct(v, .5), 'p95': pct(v, .95), 'p99': pct(v, .99), 'max': v[-1] if v else 0}
out['lag_main_session'] = lagstats(f'{D}/lag-main.log'); out['lag_ab_on'] = lagstats(f'{D}/ab-on/lag.log'); out['lag_ab_off'] = lagstats(f'{D}/ab-off/lag.log')
# RAM
def ram(p):
    s = []
    for l in open(p):
        m = re.search(r'julia_rss_mb=(\d+) node_rss_mb=(\d+) server_rss_mb=(\d+)', l)
        if m and int(m.group(2)) > 50: s.append(tuple(map(int, m.groups())))
    return {'samples': len(s), 'sidecar_mb': [s[0][0], max(x[0] for x in s)], 'node_mb': [s[0][1], s[-1][1], max(x[1] for x in s)], 'mc_server_mb': [s[0][2], max(x[2] for x in s)]}
out['ram_main_session'] = ram(f'{D}/rss-main.log'); out['ram_ab_off'] = ram(f'{D}/ab-off/rss.log')
print(json.dumps(out, indent=1, ensure_ascii=False))
