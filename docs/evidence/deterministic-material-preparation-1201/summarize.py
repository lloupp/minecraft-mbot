import json
import pathlib

root = pathlib.Path(__file__).resolve().parent
rows = json.loads((root / 'rows.json').read_text())
expected = {
    'wood_stone': 'gather_materials', 'stick_stone': 'gather_materials',
    'cobble_wood': 'gather_materials', 'wood_only': 'continue_objective',
    'stone_only': 'continue_objective', 'iron_only': 'continue_objective',
    'iron_stone_no_stick': 'continue_objective', 'one_plank_stone': 'continue_objective',
    'threat': 'escape_danger', 'critical_hunger': 'find_food', 'cancel': 'stop_task'
}
assert len(rows) == 22
for name, intent in expected.items():
    selected = [r for r in rows if r['scenario'] == name]
    assert len(selected) == 2
    for row in selected:
        assert row['candidate_ids'] == [intent]
        assert row['sidecar']['http'] == 200
        assert row['sidecar']['body']['model_calls'] == 0
        assert row['shadow']['http_calls_delta'] == 0
        assert not row['projected_offline_result']['result']['safetyViolation']
traces = [json.loads(line) for line in (root / 'sidecar-traces.jsonl').read_text().splitlines()]
assert len(traces) == 22 and all(t['engine_predict_calls'] == 0 for t in traces)
folder = root / 'physical-confirmed'
assert not (folder / 'failure.json').exists()
runs = json.loads((folder / 'physical.json').read_text())
assert len(runs) == 2
physical = []
for run in runs:
    assert [c['intent'] for c in run['cycles']] == ['gather_materials', 'prepare_combat']
    assert all(c['ok'] for c in run['cycles'])
    assert run['loops'] == 0 and run['timeouts'] == 0 and not run['errors']
    assert run['final']['equippedWeapon'] == 'stone_sword'
    assert run['final']['health'] == 20 and run['final']['threat'] is None
    assert [c['id'] for c in run['nextCandidates']] == ['continue_objective']
    gathered, prepared = run['cycles']
    assert gathered['final']['inventory']['stick'] >= 1
    assert gathered['final']['inventory']['cobblestone'] == 2
    assert 'stone_sword' in gathered['final']['craftable']
    assert not any(c['id'] == 'gather_materials' for c in gathered['nextCandidates'])
    tasks = [t for cycle in run['cycles'] for t in cycle['steps']]
    collections = [t for t in tasks if t['task'] == 'gather']
    for collection in collections:
        assert collection['collected'] == collection['requested']
        assert collection['inventoryConfirmed']
        for attempt in collection['attempts']:
            p = attempt['targetPosition']
            assert f"({p['x']}, {p['y']}, {p['z']})" in collection['approvedPositions']
            assert attempt['itemConfirmed'] and not attempt.get('code')
    physical.append({'route': run['route'], 'cycles': 2,
                     'collected': [{'resource': t['resource'], 'quantity': t['collected']} for t in collections],
                     'final_inventory': run['final']['inventory'], 'equipped': run['final']['equippedWeapon'],
                     'next_candidates': ['continue_objective'], 'loops': 0, 'errors': 0, 'timeouts': 0,
                     'unauthorized_digs': 0, 'juliaExecutionAuthority': 'none'})
shadow = json.loads((folder / 'shadow-stats.json').read_text())
assert shadow['stats']['completed'] == 2 and shadow['stats']['failed'] == 0
assert shadow['stats']['invalidChoice'] == 0
assert all(e['data']['executionAuthority'] == 'none' for e in shadow['events'])
failed_attempts = []
for label, location in [('initial', root), ('with_reach_optimization_obstructed_table', root / 'physical-final')]:
    cases = json.loads((location / 'physical.json').read_text())
    failures = [c for r in cases for c in r['cycles'] if not c['ok']]
    assert len(failures) == 1 and failures[0]['code'] == 'TIMEOUT'
    failed_attempts.append({'attempt': label, 'code': 'TIMEOUT',
                           'cobblestone_confirmed': failures[0]['final']['inventory'].get('cobblestone', 0),
                           'preparation_completed': False})
summary = {'reference_head': '180e7c9d87a893f9103cf6f81775ce52c76f7c9d',
           'guardrail_real_snapshots_passed': 22,
           'guardrail_forced_inference_calls': 0,
           'guardrail_results': expected, 'final_physical_runs': physical,
           'final_physical_passed': 2, 'final_physical_errors': 0,
           'final_physical_timeouts': 0, 'final_physical_loops': 0,
           'final_controlled_safety_violations': 0,
           'shadow_observations_during_prepare': 2,
           'juliaExecutionAuthority': 'none',
           'preserved_failed_attempts': failed_attempts,
           'historical_physical_timeouts': 2,
           'navigation_obstacle_limitation_remains': True}
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
