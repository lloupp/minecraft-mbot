"""Audit recorded real-server preflight/control/TOCTOU captures."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
checks = []
def verify(name, condition):
    checks.append({'check': name, 'ok': bool(condition)})

captures = {}
for name in ['baseline', 'verification', 'hunger-control', 'hunger-verification']:
    folder = ROOT / name
    events = [json.loads(line) for line in (folder / 'timeline.jsonl').read_text().splitlines()]
    results = json.loads((folder / 'results.json').read_text())
    captures[name] = (events, {r['scenario']: r for r in results})
    verify(f'{name}: continuous recorder', [e['seq'] for e in events] == list(range(1, len(events) + 1)) and events[-1]['bufferMissing'] == [])
    verify(f'{name}: no overlap of instrumented physical operations', all(e.get('active', 0) <= 1 for e in events if e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start']))
    for r in results:
        if 'harnessError' in r:
            verify(f'{name}/{r["scenario"]}: known fixture failure preserved', r['scenario'] == 'hunger' and name in ['verification', 'hunger-control'] and 'HARNESS_SETUP_TIMEOUT' in r['harnessError'])
            continue
        es = [e for e in events if e['scenario'] == r['scenario']]
        pre = next(e for e in es if e['event'] == 'preflight_observed')
        after = [e for e in es if e['seq'] > pre['seq']]
        if r['proposal'] is None:
            verify(f'{name}/{r["mode"]}: refused proposal never executed', not any(e['event'] in ['task_requested', 'dig_start', 'craft_start', 'equip_start', 'placeBlock_start', 'goto_start'] for e in after))
        else:
            verify(f'{name}/{r["mode"]}: explicit owned proposal', r['proposal']['objective']['type'] == 'explorar' and bool(r['proposal']['allowedTargets']) and r['proposal']['type'] == 'preparar_combate_deterministico')
        allowed = {(t['x'], t['y'], t['z']) for t in r['diagnostics']}
        verify(f'{name}/{r["mode"]}: all digs allowlisted', all(tuple(e['target'][k] for k in ['x', 'y', 'z']) in allowed for e in es if e['event'] == 'dig_start'))
        if r['mode'] == 'valid':
            verify(f'{name}: valid preparation completes', r['preflight']['ok'] and r['execution']['ok'] and r['final']['held'] == 'stone_sword' and r['final']['inventory'].get('stone_sword') == 1 and r['final']['candidates'] == ['continue_objective'])
            verify(f'{name}: minimal real gathering', len([e for e in es if e['event'] == 'dig_start']) == 2 and any(s['task'] == 'gather' and s['requested'] == 2 and s['inventoryConfirmed'] for s in r['execution']['steps']))
        if r['mode'].endswith('_after'):
            expected = {'table_after': 'NEARBY_TABLE_REQUIRED', 'tool_after': 'MINING_PICKAXE_REQUIRED', 'target_after': 'APPROVED_TARGETS_INSUFFICIENT', 'threat_after': 'THREAT'}[r['mode']]
            verify(f'{name}/{r["mode"]}: decision passed then execution refused', r['preflight']['ok'] and r['proposal'] is not None and r['execution']['code'] == expected)
            mutation = next(e for e in es if e['event'] == 'mutation_after_preflight')
            verify(f'{name}/{r["mode"]}: no physical stage after mutation', not any(e['seq'] > mutation['seq'] and e['event'] in ['dig_start', 'craft_start', 'equip_start', 'placeBlock_start', 'goto_start'] for e in es))
            verify(f'{name}/{r["mode"]}: no invented material progress', r['final']['inventory'].get('cobblestone', 0) == 0)

for mode, code in [('no_table','NEARBY_TABLE_REQUIRED'),('distant_table','NEARBY_TABLE_REQUIRED'),('no_tool','MINING_PICKAXE_REQUIRED'),('insufficient','APPROVED_TARGETS_INSUFFICIENT')]:
    r = captures['baseline'][1][mode]
    verify(f'baseline/{mode}: specific refusal', r['proposal'] is None and r['preflight']['code'] == code)
for mode in ['blocked', 'falling']:
    before = captures['baseline'][1][mode]
    after = captures['verification'][1][mode]
    verify(f'{mode}: original false-positive preserved', before['preflight']['ok'] and before['proposal'] is not None and not before['execution']['ok'] and before['final']['inventory'].get('cobblestone', 0) == 0)
    verify(f'{mode}: real diagnostic matches cause', all(d['canDig'] and d['exposed'] and (not d['canSee'] if mode == 'blocked' else d['fallingAbove']) for d in before['diagnostics']))
    verify(f'{mode}: corrected preflight refuses before task creation', not after['preflight']['ok'] and after['proposal'] is None and after['execution'] is None)
for mode in ['threat', 'cancelled']:
    r = captures['baseline'][1][mode]
    verify(f'{mode}: safety precedence', r['proposal'] is None and (bool(r['snapshot']['threat']) if mode == 'threat' else r['snapshot']['cancellationRequested']))
r = captures['verification'][1]['silk_tool']
verify('silk touch only: no preparation proposal', r['proposal'] is None and r['preflight']['code'] == 'MINING_PICKAXE_REQUIRED')
r = captures['hunger-verification'][1]['hunger']
verify('critical hunger: live food and nearby food, find_food precedence', r['snapshot']['food'] <= 5 and r['snapshot']['nearby']['food'] and not r['snapshot']['threat'] and r['preflight']['choice'] == 'find_food' and r['proposal'] is None)
verify('final validation commands pass', all(t['exitCode'] == 0 for t in json.loads((ROOT / 'tests.json').read_text())))
report = {'passed': sum(c['ok'] for c in checks), 'total': len(checks), 'checks': checks}
(ROOT / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
print(f"{report['passed']}/{report['total']} evidence checks passed")
for c in checks:
    if not c['ok']: print('FAILED:', c['check'])
raise SystemExit(0 if report['passed'] == report['total'] else 1)
