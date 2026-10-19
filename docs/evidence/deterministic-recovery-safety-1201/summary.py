"""Audit recorded real-server events; does not generate or infer runtime events."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
checks = []

def verify(name, condition):
    checks.append({'check': name, 'ok': bool(condition)})

for capture in ['baseline', 'verification']:
    folder = ROOT / capture
    events = [json.loads(line) for line in (folder / 'timeline.jsonl').read_text().splitlines()]
    results = json.loads((folder / 'results.json').read_text())
    verify(f'{capture}: continuous recorder', [e['seq'] for e in events] == list(range(1, len(events) + 1)) and events[-1]['bufferMissing'] == [])
    verify(f'{capture}: no harness failures', all('harnessError' not in r for r in results))
    verify(f'{capture}: opt-in / Julia shadow', json.loads((folder / 'metadata.json').read_text())['optIn'] == '1' and json.loads((folder / 'metadata.json').read_text())['juliaExecutionAuthority'] == 'none')
    for r in results:
        name = r['mode']
        es = [e for e in events if e['scenario'] == name]
        restored = r['beforeMutation']
        verify(f'{capture}/{name}: reconnect reads inventory and destroyed target', restored['inventory'].get('cobblestone', 0) == 0 and [t['actual'] for t in restored['targets']] == ['air', 'stone'] and any(d['name'] == 'cobblestone' for d in restored['drops']))
        verify(f'{capture}/{name}: old session settled and owner invalidated', r['settled']['code'] == 'DISCONNECTED' and r['oldTask'] is None and r['oldVersionFinal'] == r['oldVersion'])
        cut = next(e['seq'] for e in es if e['event'] == 'disconnect_requested')
        verify(f'{capture}/{name}: no old-session action after disconnect', not any(e['seq'] > cut and e.get('session') == r['oldSession'] and e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start', 'goto_start'] for e in es))
        allowed = {(t['x'], t['y'], t['z']) for t in restored['targets']}
        digs = [e for e in es if e['event'] == 'dig_start']
        verify(f'{capture}/{name}: only allowlisted digs', all(tuple(e['target'][k] for k in ['x', 'y', 'z']) in allowed for e in digs))
        verify(f'{capture}/{name}: no repeated destroyed-target dig', not any(e.get('session') == r['newSession'] and e['target'] == {'x': 0, 'y': 200, 'z': 2} for e in digs))
        verify(f'{capture}/{name}: no overlapping preparation operations', all(e.get('active', 0) <= 1 for e in es if e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start']))
        intervention = next(e for e in es if e['event'] == 'intervention_requested')
        verify(f'{capture}/{name}: intervention after actual goto submission', any(e['event'] == 'goto_start' and e['seq'] < intervention['seq'] and e.get('session') == r['newSession'] for e in es))
        if name in ['threat', 'new_order']:
            expected = 'THREAT' if name == 'threat' else 'CANCELLED'
            verify(f'{capture}/{name}: correct interruption', r['result']['code'] == expected)
            safety = next(e for e in es if e['event'] == 'worker_log' and 'safety_detected' in e['message'] and f'"code":"{expected}"' in e['message'])
            returned = next(e for e in es if e['event'] == 'task_returned' and e.get('result', {}).get('code') == expected)
            verify(f'{capture}/{name}: no new physical step after safety', not any(safety['seq'] < e['seq'] < returned['seq'] and e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start', 'goto_start'] for e in es))
            verify(f'{capture}/{name}: manual resume succeeds', r['final']['held'] == 'stone_sword' and r['final']['candidates'] == ['continue_objective'] and r['after']['inventory'].get('stone_sword') == 1)
            resumed_gathers = [s for result in r['final']['results'] for s in result.get('steps', []) if s['task'] == 'gather']
            verify(f'{capture}/{name}: only one remaining stone collected', len(resumed_gathers) == 1 and resumed_gathers[0]['requested'] == 1 and resumed_gathers[0]['inventoryConfirmed'])
        elif capture == 'baseline':
            verify('baseline/replacement: preserved misattribution failure', r['result']['ok'] and r['result']['steps'][0]['delta'] == 1 and r['result']['steps'][0]['selectedDropId'] != next(e for e in es if e['event'] == 'replacement_observed')['drops'][0]['id'])
        else:
            step = r['result']['steps'][0]
            verify('verification/replacement: specific refusal / no invented pickup', r['result']['code'] == 'RECOVERY_DROP_CHANGED' and step['delta'] == 0 and not step['inventoryConfirmed'] and not step['pickupObserved'] and r['result']['remainingPlan']['collect']['cobblestone'] == 2)
            verify('verification/replacement: no further action after removal', not any(e['seq'] > next(e for e in es if e['event'] == 'worker_log' and 'recovery_drop_changed' in e['message'])['seq'] and e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start', 'goto_start'] for e in es))
    traces = [json.loads(line) for line in (folder / 'sidecar-traces.jsonl').read_text().splitlines()]
    verify(f'{capture}: real shadow inference without sidecar errors', len(traces) == 2 and all(t['engine_predict_calls'] == 1 and t['error'] is None for t in traces))

verify('final validation commands pass', all(t['exitCode'] == 0 for t in json.loads((ROOT / 'tests.json').read_text())))
report = {'passed': sum(c['ok'] for c in checks), 'total': len(checks), 'checks': checks}
(ROOT / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
print(f"{report['passed']}/{report['total']} evidence checks passed")
for c in checks:
    if not c['ok']:
        print('FAILED:', c['check'])
raise SystemExit(0 if report['passed'] == report['total'] else 1)
