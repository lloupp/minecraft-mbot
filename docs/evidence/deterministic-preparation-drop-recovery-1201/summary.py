"""Audit captured real-server events and inventory. Does not generate runtime states."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
load = lambda cap: json.loads((ROOT/cap/'results.json').read_text())
timeline = lambda cap: [json.loads(x) for x in (ROOT/cap/'timeline.jsonl').read_text().splitlines()]
basic=load('baseline-basic')[0]
controls={r['mode']:r for r in load('baseline-controls')}
blocked=load('verification')[0]
transport={r['mode']:r for r in load('final-buffered-transport')}
pickup=load('baseline-abrupt')[1]
checks={}
def check(name,condition): checks[name]=bool(condition)
def successful(r): return r['result']['ok'] and r['after']['inventory'].get('stone_sword')==1 and r['after']['held']=='stone_sword' and r['final']['candidates']==['continue_objective']
def recovery(r): return next(s for s in r['result']['steps'] if s['task']=='recover_drop')
def gather(r): return next(s for s in r['result']['steps'] if s['task']=='gather')
check('real_reconnect_inventory_0_and_target_air',basic['beforeMutation']['inventory'].get('cobblestone',0)==0 and basic['beforeMutation']['targets'][0]['actual']=='air' and basic['beforeMutation']['targets'][1]['actual']=='stone')
check('real_drop_observed_after_reconnect',any(d['name']=='cobblestone' for d in basic['beforeMutation']['drops']))
s=recovery(basic)
check('pickup_inventory_0_to_1',s['inventoryBefore']==0 and s['inventoryAfter']==1 and s['delta']==1 and s['inventoryConfirmed'])
check('correct_approved_target',s['approvedTarget']=={'x':0,'y':200,'z':2})
check('replanned_2_to_1',basic['before']['plan']['collect']['cobblestone']==2 and basic['result']['plan']['collect']['cobblestone']==1)
check('only_1_additional_stone',gather(basic)['requested']==1 and gather(basic)['collected']==1)
check('basic_craft_equip_continue',successful(basic))
new_digs=[x['target'] for x in timeline('baseline-basic') if x['event']=='dig_start' and x.get('session')==basic['newSession']]
check('no_redig_destroyed_target',new_digs==[{'x':2,'y':200,'z':0}])
check('blocked_pickup_no_credit',blocked['after']['inventory'].get('cobblestone',0)==0 and recovery(blocked)['delta']==0 and not recovery(blocked)['inventoryConfirmed'] and blocked['result']['remainingPlan']['collect']['cobblestone']==2)
for mode in ['ambiguous','wrong','outside']:
 r=controls[mode];events=[x for x in timeline('baseline-controls') if x['scenario']==mode and x.get('session')==r['newSession']]
 check(mode+'_no_recovery_or_movement',r['result']['code']=='APPROVED_TARGETS_INSUFFICIENT' and r['after']['inventory'].get('cobblestone',0)==0 and r['after']['plan']['collect']['cobblestone']==2 and not any(x['event'] in ['goto_start','recover_drop_entry','dig_start'] for x in events))
check('ambiguity_is_two_real_entities',len([d for d in controls['ambiguous']['before']['drops'] if d['name']=='cobblestone'])==2)
check('wrong_drop_is_dirt',any(d['name']=='dirt' for d in controls['wrong']['before']['drops']))
check('outside_drop_beyond_2',all((d['position']['x']**2+(d['position']['y']-200)**2+(d['position']['z']-2)**2)**.5>2 for d in controls['outside']['before']['drops'] if d['name']=='cobblestone'))
mixed=controls['mixed'];events=[x for x in timeline('baseline-controls') if x['scenario']=='mixed' and x['event']=='recover_drop_entry']
check('mixed_only_cobblestone_candidate',events and all(d['name']=='cobblestone' for x in events for d in x['matching']) and recovery(mixed)['delta']==1 and successful(mixed))
check('out_of_range_table_refused',controls['table']['result']['code']=='NEARBY_TABLE_REQUIRED' and controls['table']['before']['inventory']==controls['table']['after']['inventory'])
for mode in ['abrupt_dig','server_crash']:
 r=transport[mode];events=[x for x in timeline('final-buffered-transport') if x['scenario']==mode];request=next(x for x in events if x['event']=='disconnect_requested')
 start=next(x for x in events if x['event']=='dig_packet' and x['packet']['status']==0 and x['session']==r['oldSession'])
 check(mode+'_cut_inside_real_dig_window',request['digInFlight'] and 75<=request['mono_ms']-start['mono_ms']<=300)
 check(mode+'_real_world_rebuilt',r['beforeMutation']['inventory'].get('cobblestone',0)==0 and all(t['actual']=='stone' for t in r['beforeMutation']['targets']) and r['before']['plan']['collect']['cobblestone']==2 and successful(r))
check('abrupt_pickup_recovery',pickup['beforeMutation']['inventory'].get('cobblestone',0)==0 and pickup['beforeMutation']['targets'][0]['actual']=='air' and recovery(pickup)['delta']==1 and gather(pickup)['requested']==1 and successful(pickup))
check('abrupt_owners_dead',all(r['settled'].get('code')=='DISCONNECTED' and r['oldTask'] is None and r['oldVersion']==r['oldVersionFinal'] for r in [*transport.values(),pickup]))
checks['zero_unauthorized_digs']=True
checks['no_old_session_new_operations']=True
checks['no_old_session_start_or_finish_packet']=True
checks['no_preparation_physical_overlap']=True
checks['authoritative_timelines_complete']=True
checks['no_cobblestone_inventory_injection']=True
caps=['baseline-basic','baseline-controls','baseline-abrupt','verification','final-buffered-transport']
physical={'dig_start','craft_start','equip_start','placeBlock_start','goto_start'}
cleanup_packets=[]
for cap in caps:
 rows=timeline(cap);seq={x['seq'] for x in rows}
 checks['no_cobblestone_inventory_injection'] &= not any(x['event']=='console' and x['command'].startswith('give ') and 'cobblestone' in x['command'] for x in rows)
 checks['authoritative_timelines_complete'] &= seq==set(range(1,max(seq)+1))
 requests={x['session']:x['seq'] for x in rows if x['event']=='disconnect_requested'}
 for x in rows:
  sid=x.get('session')
  if sid in requests and x['seq']>requests[sid]:
   if x['event'] in physical:checks['no_old_session_new_operations']=False
   if x['event']=='dig_packet':
    if x['packet']['status'] in [0,2] and cap=='final-buffered-transport':checks['no_old_session_start_or_finish_packet']=False
    elif x['packet']['status']==1:cleanup_packets.append({'capture':cap,'seq':x['seq'],'session':sid})
  if x['event'] in physical and x.get('authority')=='owned_preparation' and x.get('active',0)>1:checks['no_preparation_physical_overlap']=False
 for sc in {x['scenario'] for x in rows}:
  subset=[x for x in rows if x['scenario']==sc]
  initial=next((x for x in subset if x['event']=='initial_state'),None)
  if initial:
   allowed={(t['x'],t['y'],t['z']) for t in initial['targets']}
   checks['zero_unauthorized_digs'] &= all(tuple(x['target'][k] for k in ['x','y','z']) in allowed for x in subset if x['event']=='dig_start')
report={'checks':checks,'passed':sum(checks.values()),'total':len(checks),'authority':'deterministic_opt_in','julia_execution_authority':'none','automatic_dispatch_or_resume':False,'cleanup_abort_packet_attempts':cleanup_packets,'preserved_failures':['baseline-controls/blocked missing recovery steps in refusal result','baseline-abrupt/server_crash harness rejected ECONNRESET before observing end','transport-window-verification and final-transport-window append timeline gaps'],'limitations':['Mixed case incidentally picked dirt; only cobblestone selected and credited by recovery','Abort/cancel packet status1 may be attempted on dead transport as cleanup; no new physical application operation or start/finish packet after disconnect in final window proofs','No provenance persisted across sessions: unique nearby observable cobblestone is a bounded plausibility condition, not identity proof','Server SIGKILL tested during first dig, with a prior save-all flush; no durability guarantee for unsaved changes']}
(ROOT/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert all(checks.values())
