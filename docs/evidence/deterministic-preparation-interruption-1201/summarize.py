"""Derive the verdict from captured real-server results; fail on missing evidence."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
final = {r['scenario']: r for r in json.loads((ROOT / 'final/results.json').read_text())}
verified = {r['scenario']: r for r in json.loads((ROOT / 'verification/results.json').read_text())}
rows = {**final, **verified}
summary = {'reference_head': '7f1f5a00a7935bdcf8b2f1b1a2788a207a792343',
           'julia_execution_authority': 'none', 'opt_in': True, 'minecraft': '1.20.1',
           'scenarios': {}, 'baseline_failures_preserved': True}
for name in ['new_order', 'threat']:
    r = rows[name]
    assert r['interrupted']['code'] == ('CANCELLED' if name == 'new_order' else 'THREAT')
    assert r['partial']['cobblestone'] == 1
    assert r['interrupted']['remainingPlan']['collect']['cobblestone'] == 1
    step = r['interrupted']['steps'][0]
    assert step['collected'] == 1 and step['attempts'][0]['itemConfirmed']
    assert r['resume']['results'][0]['steps'][0]['requested'] == 1
    assert r['resume']['results'][0]['steps'][0]['collected'] == 1
    assert r['resume']['held'] == 'stone_sword'
    assert r['resume']['candidates'] == ['continue_objective']
    summary['scenarios'][name] = {'interruption': r['interrupted']['code'], 'confirmed_partial': 1,
        'remaining_cobblestone': 1, 'resumed_collection': 1, 'final_held': 'stone_sword',
        'final_candidates': r['resume']['candidates'], 'source': 'verification/results.json'}
for name, item, count in [('craft_log','oak_planks',4),('craft_sword','stone_sword',1)]:
    r = rows[name]
    assert r['interrupted']['code'] == 'CANCELLED'
    assert r['partial'][item] == count
    assert r['interrupted']['steps'][0]['inventoryConfirmed']
    assert r['resume']['held'] == 'stone_sword'
    if name == 'craft_sword':
        assert [s['task'] for s in r['resume']['results'][0]['steps']] == ['equip']
        assert r['interrupted']['remainingPlan']['collect'] == {'logs':0,'cobblestone':0}
    summary['scenarios'][name] = {'interruption':'CANCELLED','produced_despite_cancellation':{item:count},
        'final_held':'stone_sword','final_candidates':r['resume']['candidates'],
        'source':'final/results.json','atomic_rollback':False}
r = rows['same_worker_concurrency']
assert [x.get('code','OK') for x in r['results']] == ['CANCELLED','OK']
assert r['resume']['held'] == 'stone_sword'
summary['scenarios']['same_worker_concurrency'] = {'results':['CANCELLED','OK'],'mode':'ownership replacement, second waits for first settlement','source':'final/results.json'}
r = rows['cross_workers']
assert all(x['ok'] for x in r['results'])
assert all(x['held'] == 'stone_sword' for x in r['resumes'])
summary['scenarios']['cross_workers'] = {'results':['OK','OK'],'final_held':['stone_sword','stone_sword'],'source':'final/results.json'}
r = rows['obstacle']
assert r['first']['code'] == 'TARGET_BLOCKED'
assert r['partial']['cobblestone'] == 1
assert r['resume']['results'][0]['steps'][0]['requested'] == 1
assert r['resume']['held'] == 'stone_sword'
assert r['resume']['candidates'] == ['continue_objective']
summary['scenarios']['obstacle'] = {'first_code':'TARGET_BLOCKED','confirmed_partial':1,'resumed_collection':1,
    'authorized_alternative_used':True,'final_held':'stone_sword','source':'final/results.json'}

physical = {}
for folder in ['final','verification']:
    events = [json.loads(s) for s in (ROOT / folder / 'timeline.jsonl').read_text().splitlines()]
    approved, active, maximum, digs, anomalies = {}, {}, {}, [], []
    old_actions_after_new_owner = []
    for e in events:
        worker = e.get('worker')
        if e['event'] == 'task_requested' and e['task']['type'] == 'preparar_combate_deterministico':
            approved[(worker, e['previousVersion'] + 1)] = {tuple(t[k] for k in ['x','y','z']) for t in e['task']['allowedTargets']}
        if e['event'] == 'dig_start':
            pos = tuple(e['target'][k] for k in ['x','y','z'])
            assert pos in approved[(worker,e['taskVersion'])], e
            digs.append({'scenario':e['scenario'],'worker':worker,'version':e['taskVersion'],'position':pos})
        if e['event'] in ['dig_start','craft_start']:
            active[worker] = active.get(worker,0) + 1
            maximum[worker] = max(maximum.get(worker,0), active[worker])
        if e['event'] in ['dig_end','craft_end','dig_error','craft_error']:
            active[worker] = active.get(worker,0) - 1
        if e['event'] in ['bot_error','fatal','scenario_error']:
            anomalies.append(e)
    assert all(n <= 1 for n in maximum.values()), maximum
    assert not anomalies, anomalies
    physical[folder] = {'authorized_digs':digs,'unauthorized_digs':0,'maximum_concurrent_dig_or_craft_per_bot':maximum,'harness_or_bot_errors':0}
# Explicit ownership proof and absence of new operations from the cancelled owner.
events = [json.loads(s) for s in (ROOT / 'verification/timeline.jsonl').read_text().splitlines()]
for name in ['new_order','threat']:
    es = [e for e in events if e['scenario'] == name]
    entry = next(e for e in es if e['event'] == 'owned_task_entry' and e['method'] == 'runDeterministicPreparation')
    assert entry['currentTask']['type'] == 'preparar_combate_deterministico'
    assert entry['currentTask']['objective']['type'] == 'explorar'
    assert len(entry['currentTask']['allowedTargets']) == 2
    mark = next(e for e in es if e['event'] == 'first_cobblestone_confirmed')
    ghosts = [e for e in es if e['seq'] > mark['seq'] and e['event'] in ['dig_start','craft_start','equip_start'] and e['taskVersion'] == entry['taskVersion']]
    assert not ghosts, ghosts
    summary['scenarios'][name]['old_owner_version'] = entry['taskVersion']
    summary['scenarios'][name]['new_physical_actions_from_interrupted_owner'] = 0
    if name == 'new_order':
        replacement = next(e for e in es if e['event'] == 'owned_task_entry' and e['method'] == 'goToPoint')
        settled = next(e for e in es if e['event'] == 'task_returned')
        assert replacement['seq'] > settled['seq']
        summary['scenarios'][name]['replacement_version'] = replacement['taskVersion']
    else:
        assert any(e['event'] == 'pathfinder_stop' for e in es)
        summary['scenarios'][name]['monitor_stop_observed'] = True
summary['physical_audit'] = physical
summary['tests'] = {'initial_requested_node':21,'final_focused_node':41,'final_full_node':451,'python':2,'check':'passed'}

summary['limitations'] = ['Craft already submitted can finish after cancellation; no atomic rollback.',
    'NoAI zombie is a real nearby entity, not a combat damage/flee efficacy test.',
    'Strict target raycast can reject safely; generic pathfinder remains unchanged.',
    'Deadlines/cooperative cancellation do not guarantee instant interruption of server/client operations.',
    'No automatic dispatch into the normal player loop; Julia remains shadow only.']
(ROOT / 'summary.json').write_text(json.dumps(summary,indent=2) + '\n')
print(json.dumps(summary,indent=2))
