"""Audit stored real-server captures; never generate simulated runtime evidence."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
load = lambda cap: json.loads((ROOT / cap / 'results.json').read_text())
timeline = lambda cap: [json.loads(x) for x in (ROOT / cap / 'timeline.jsonl').read_text().splitlines()]
handoff = load('final-handoff-table-in-range')[0]
orders = load('baseline-real')[1]
threat, hunger = load('verification')
confirmed, unconfirmed, sword_failure = load('reconnect')
sword = load('reconnect-sword-verification')[0]
checks = {}
def check(name, condition):
    checks[name] = bool(condition)
check('handoff_partial_inventory_1', handoff['partial']['cobblestone'] == 1)
check('handoff_real_interrupt', handoff['interrupted']['code'] == 'CANCELLED' and handoff['interrupted']['final']['health'] < handoff['interrupted']['initial']['health'])
check('candidate_original_objective_and_allowlist', all(handoff['candidate'][k] == handoff['original'][k] for k in ['objective', 'allowedTargets']))
check('manual_exact_task', next(x['task'] for x in timeline('final-handoff-table-in-range') if x['event'] == 'manual_exact_resume') == handoff['candidate'])
check('manual_collects_only_remaining_1', handoff['manual']['ok'] and handoff['manual']['plan']['collect']['cobblestone'] == 1 and handoff['manual']['steps'][0]['collected'] == 1)
check('handoff_sword_and_continue', handoff['resume']['held'] == 'stone_sword' and handoff['resume']['inventory']['stone_sword'] == 1 and handoff['resume']['candidates'] == ['continue_objective'])
check('new_order_invalidates_pending', bool(orders['candidate']) and orders['replacement']['ok'] and orders['pendingAfter'] is None)
check('threat_blocks_then_explicit_reevaluation', threat['candidate'] is None and threat['snapshots'][0]['state']['threat'] and threat['reevaluated']['deterministicIntent'] == 'gather_materials')
check('critical_food_precedence', hunger['candidate'] is None and hunger['snapshots'][0]['candidates'] == ['find_food'])
fields = ['threat', 'health', 'food', 'inventory', 'equippedWeapon', 'equippedTool', 'nearby']
snaps = handoff['snapshots']
check('post_defense_snapshots_stable', all(all(s['state'][f] == snaps[0]['state'][f] for f in fields) and s['heldItem'] == snaps[0]['heldItem'] and s['candidates'] == snaps[0]['candidates'] and s['resume'] == snaps[0]['resume'] for s in snaps))
check('snapshot_timestamps', all(abs(s['offset_ms']-t) < 25 for s,t in zip(snaps,[0,250,500,1000])))
check('confirmed_reconnect_remaining_1', confirmed['inventoryAfterReconnect'].get('cobblestone') == 1 and confirmed['plan']['collect']['cobblestone'] == 1 and confirmed['manual']['ok'] and confirmed['resume']['held'] == 'stone_sword')
check('unconfirmed_reconnect_no_dig_credit', unconfirmed['inventoryAfterReconnect'].get('cobblestone',0) == 0 and unconfirmed['plan']['collect']['cobblestone'] == 2 and unconfirmed['liveTargets'][0]['actual'] == 'air' and unconfirmed['manual']['code'] == 'APPROVED_TARGETS_INSUFFICIENT')
check('sword_disconnect_refuses_next_equip', sword['settled']['code'] == 'DISCONNECTED' and sword['settled']['final']['inventory']['stone_sword'] == 1)
check('sword_reconnect_only_equips', sword['inventoryAfterReconnect']['stone_sword'] == 1 and sword['manual']['intent'] == 'equip_best_weapon' and [s['task'] for s in sword['manual']['steps']] == ['equip'] and sword['resume']['held'] == 'stone_sword')
checks['no_automatic_preparation'] = True
checks['zero_unauthorized_digs'] = True
checks['zero_preparation_overlap'] = True
checks['no_old_session_actions_after_end'] = True
physical_events = {'dig_start','craft_start','equip_start','placeBlock_start'}
for cap in ['baseline-real','baseline-affected','verification','final-handoff','final-handoff-table-in-range','reconnect','reconnect-sword-verification']:
    rows = timeline(cap)
    for scenario in {x['scenario'] for x in rows}:
        r = [x for x in rows if x['scenario'] == scenario]
        end = next((x['seq'] for x in r if x['event'] == 'defense_end'),None)
        manual = next((x['seq'] for x in r if x['event']=='manual_exact_resume'), float('inf'))
        if end:
            checks['no_automatic_preparation'] &= not any(end < x['seq'] < manual and x['event'] in physical_events and x.get('authority') == 'owned_preparation' for x in r)
        initial = next((x for x in r if x['event']=='initial_state'),None)
        if initial:
            allowed = {(t['x'],t['y'],t['z']) for t in initial['targets']}
            checks['zero_unauthorized_digs'] &= all(tuple(x['target'][k] for k in ['x','y','z']) in allowed for x in r if x['event']=='dig_start')
    ends = {x.get('session',0):x['seq'] for x in rows if x['event']=='session_end'}
    checks['no_old_session_actions_after_end'] &= not any(x['event'] in physical_events and x['seq'] > ends.get(x.get('session',0),float('inf')) for x in rows)
    checks['zero_preparation_overlap'] &= not any(x.get('active',0) > 1 for x in rows if x['event'] in physical_events and x.get('authority')=='owned_preparation')
# Stronger than end: verify no new physical step after the closing stream request.
rows = timeline('reconnect-sword-verification')
request = next(x for x in rows if x['event']=='disconnect_requested')
check('no_physical_after_quit_fixed_session', not any(x['seq'] > request['seq'] and x['event'] in physical_events and x.get('session') == request['session'] for x in rows))
report = {'checks':checks,'passed':sum(checks.values()),'total':len(checks),'snapshot_offsets_ms':[s['offset_ms'] for s in snaps], 'known_refusals':{'out_of_reach_table':'NEARBY_TABLE_REQUIRED','pickup_unconfirmed':'APPROVED_TARGETS_INSUFFICIENT','hunger_resolved_but_remaining_target_outside_4m':hunger['reevaluated']}, 'preserved_failures':['baseline/ environment startup','baseline-real/threat sparse source lost','baseline-affected/threat sparse source lost','final-handoff/ table beyond reach','reconnect/reconnect_sword equip after quit before end'], 'julia_execution_authority':'none','automatic_resume':False}
(ROOT/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert all(checks.values())
