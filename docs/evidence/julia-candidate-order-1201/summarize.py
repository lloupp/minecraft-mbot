"""Compare A/B using recorded real-engine inputs and outputs, never model mocks."""
import csv
import json
import os
import pathlib
import statistics

HERE = pathlib.Path(os.environ.get('ORDER_OUTPUT_DIR', str(pathlib.Path(__file__).resolve().parent)))
TOLERANCE = 1e-7


def read(name):
    return [json.loads(line) for line in (HERE / name).read_text().splitlines() if line.strip()]


requests = read('requests.jsonl')
traces = {r['trace_id']: r for r in read('sidecar-traces.jsonl')}
expected = {(phase, objective, pair) for phase, n in [('live', 5), ('offline', 6)]
            for objective in ['explore', 'mine_iron'] for pair in range(1, n + 1)}
groups = {}
for row in requests:
    groups.setdefault((row['phase'], row['objective'], row['pair']), {})[row['label']] = row
assert set(groups) == expected, 'Incomplete phase/objective coverage'
pairs = []
flat = []
for (phase, objective, index), group in groups.items():
    assert set(group) == {'A', 'B'}, 'Missing upstream order'
    a, b = [traces[group[label]['trace_id']] for label in ['A', 'B']]
    assert a['received_order'] == ['gather_materials', 'continue_objective']
    assert b['received_order'] == ['continue_objective', 'gather_materials']
    assert a['request']['state'] == b['request']['state']
    assert sorted(a['request']['candidates'], key=lambda c: c['id']) == sorted(b['request']['candidates'], key=lambda c: c['id'])
    assert all(group[label]['response']['http'] == 200 for label in ['A', 'B'])
    assert not a['error'] and not b['error']
    ra, rb = a['response'], b['response']
    pa, pb = ra['probabilities'], rb['probabilities']
    assert set(pa) == set(pb) == {'gather_materials', 'continue_objective'}
    delta = max(abs(pa[k] - pb[k]) for k in pa)
    same_payload = a['normalized_sha256'] == b['normalized_sha256'] and a['normalized_payload'] == b['normalized_payload']
    same_order = a['normalized_order'] == b['normalized_order'] == ['continue_objective', 'gather_materials']
    passed = same_payload and same_order and ra['choice'] == rb['choice'] and delta <= TOLERANCE
    pairs.append({'phase': phase, 'objective': objective, 'pair': index,
                  'same_normalized_payload': same_payload, 'same_normalized_order': same_order,
                  'same_choice': ra['choice'] == rb['choice'], 'probability_max_abs_delta': delta,
                  'raw_julia_output_equal': a['raw_julia_output'] == b['raw_julia_output'],
                  'passed': passed, 'A_trace': a['trace_id'], 'B_trace': b['trace_id']})
    for label, trace in [('A', a), ('B', b)]:
        response = trace['response']
        flat.append({'phase': phase, 'objective': objective, 'pair': index, 'label': label,
                     'state': json.dumps(trace['request']['state'], sort_keys=True),
                     'received_order': ','.join(trace['received_order']),
                     'normalized_order': ','.join(trace['normalized_order']),
                     'normalized_sha256': trace['normalized_sha256'],
                     'probabilities': json.dumps(response['probabilities']), 'choice': response['choice'],
                     'confidence': response['confidence'], 'latency_ms': response['latency_ms'],
                     'wall_latency_ms': group[label]['response']['wall_latency_ms'],
                     'http': group[label]['response']['http'], 'error': trace['error'], 'timeout': False})
summary = {'measured_head': '43804aba48bce37fad5c23e39e403ef195dc946b',
           'model_revision': 'a85b127321d580d65176c89ced8273f305745d85',
           'probability_abs_tolerance': TOLERANCE, 'pairs': pairs,
           'upstream_order_differences': sum(not p['passed'] for p in pairs),
           'max_probability_abs_delta': max(p['probability_max_abs_delta'] for p in pairs),
           'http_errors': sum(row['response']['http'] != 200 for row in requests),
           'timeouts': sum(bool(row['response'].get('timeout')) for row in requests),
           'executionAuthority': 'none'}
for phase in ['live', 'offline']:
    selected = [p for p in pairs if p['phase'] == phase]
    summary[phase] = {'pairs': len(selected), 'calls': 2 * len(selected),
                      'passed_pairs': sum(p['passed'] for p in selected),
                      'upstream_order_differences': sum(not p['passed'] for p in selected)}
summary['behavioral_frequency_separate'] = {}
for objective in ['explore', 'mine_iron']:
    by_phase = {}
    for phase in ['live', 'offline']:
        selected = [r for r in requests if r['objective'] == objective and r['phase'] == phase]
        counts = {label: sum(r['response']['body']['choice'] == 'gather_materials' for r in selected if r['label'] == label)
                  for label in ['A', 'B']}
        by_phase[phase] = {'gather_calls': sum(counts.values()), 'valid_calls': len(selected),
                           'gather_pairs': counts['A'], 'unique_states': len(selected) // 2,
                           'by_upstream_order': counts}
    summary['behavioral_frequency_separate'][objective] = by_phase
latencies = sorted(r['response']['body']['latency_ms'] for r in requests)
summary['latency_ms'] = {'min': min(latencies), 'median': statistics.median(latencies),
                         'p95_nearest_rank': latencies[int(len(latencies) * .95 + .999999) - 1],
                         'max': max(latencies)}
(HERE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
with (HERE / 'pairs.csv').open('w') as f:
    writer = csv.DictWriter(f, fieldnames=list(flat[0]))
    writer.writeheader()
    writer.writerows(flat)
print(json.dumps({k: v for k, v in summary.items() if k != 'pairs'}, indent=2))
assert summary['upstream_order_differences'] == 0, 'Order neutralization gate failed; inspect normalized payload and raw output'
