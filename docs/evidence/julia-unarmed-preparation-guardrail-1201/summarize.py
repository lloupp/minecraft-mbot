import csv
import json
import os
import pathlib

root = pathlib.Path(os.environ.get('ORDER_OUTPUT_DIR', str(pathlib.Path(__file__).resolve().parent)))
rows = json.loads((root / 'rows.json').read_text())
traces = [json.loads(line) for line in (root / 'sidecar-traces.jsonl').read_text().splitlines()]
by_id = {trace['trace_id']: trace for trace in traces}
expected = {'explore': (3, ['gather_materials']), 'mine_iron': (3, ['gather_materials']),
            'no_materials': (2, ['continue_objective']), 'threat': (2, ['escape_danger']),
            'critical_hunger': (2, ['find_food'])}
assert len(rows) == len(traces) == 12
assert len(by_id) == 12
assert not (root / 'failure.json').exists()
summary = {'measured_head': '63010a24b5e394dc0d93786ef925f228c4f41aee',
           'model_revision': 'a85b127321d580d65176c89ced8273f305745d85',
           'scenarios': {}, 'executionAuthority': 'none'}
flat = []
for scenario, (count, ids) in expected.items():
    selected = [row for row in rows if row['scenario'] == scenario]
    assert len(selected) == count
    assert {row['repetition'] for row in selected} == set(range(1, count + 1))
    for row in selected:
        trace = by_id[row['trace_id']]
        assert row['candidate_ids'] == ids
        assert row['forced']
        assert row['sidecar']['http'] == 200
        assert row['sidecar']['body']['choice'] == ids[0]
        assert row['sidecar']['body']['model_calls'] == trace['engine_predict_calls'] == 0
        assert not trace['error'] and not row['sidecar']['error'] and not row['sidecar']['timeout']
        assert row['sidecar']['body']['source'] == 'forced_single_candidate'
        assert row['shadow']['http_calls_delta'] == 0
        assert row['projected_offline_result']['result']['ok']
        assert not row['projected_offline_result']['result']['safetyViolation']
        flat.append({'scenario': scenario, 'repetition': row['repetition'],
                     'objective': row['state']['objective']['type'], 'food': row['state']['food'],
                     'equipped_tool': row['state']['equippedTool'],
                     'threat': json.dumps(row['state']['threat']), 'nearby': json.dumps(row['state']['nearby']),
                     'candidates': ','.join(ids), 'forced': True, 'choice': ids[0],
                     'model_calls': 0, 'engine_predict_calls': 0, 'shadow_http_calls': 0,
                     'http': 200, 'latency_ms': row['sidecar']['body']['latency_ms'],
                     'wall_latency_ms': row['sidecar']['wall_latency_ms'], 'errors': 0,
                     'timeouts': 0, 'invalid_choices': 0, 'offline_projected_safety_violations': 0,
                     'executionAuthority': 'none'})
    summary['scenarios'][scenario] = {'passed': len(selected), 'expected': count, 'candidates': ids}
transitions = json.loads((root / 'offline-transitions.json').read_text())
assert {t['objective'] for t in transitions} == {'explore', 'mine_iron'}
for transition in transitions:
    assert not transition['second_gather_forced']
    assert 'stone_sword' in transition['gathered']['state']['craftable']
    assert not any(c['id'] == 'gather_materials' for c in transition['next_candidates'])
    assert transition['preparation_choice'] == 'prepare_combat'
    assert transition['prepared']['state']['equippedWeapon'] == 'stone_sword'
    assert [c['id'] for c in transition['final_candidates']] == ['continue_objective']
shadow = json.loads((root / 'shadow-stats.json').read_text())
assert shadow['shadowHttpCalls'] == 0
summary.update({'passed_real_snapshots': 12, 'diagnostic_sidecar_http_requests': 12,
                'julia_model_calls': 0, 'engine_predict_calls': 0, 'shadow_http_calls': 0,
                'errors': 0, 'timeouts': 0, 'invalid_choices': 0,
                'offline_projected_safety_violations': 0,
                'normal_progress_under_threat': 0,
                'offline_transitions_passed': len(transitions),
                'second_gather_forced': 0, 'approved': True})
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
with (root / 'rows.csv').open('w') as file:
    writer = csv.DictWriter(file, fieldnames=list(flat[0]), lineterminator='\n')
    writer.writeheader(); writer.writerows(flat)
print(json.dumps(summary, indent=2))
