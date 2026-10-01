"""Build/assert the verdict from real server captures; never synthesize physical success."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
load=lambda folder:{r['scenario']:r for r in json.loads((ROOT/folder/'results.json').read_text())}
first,verified=load('final'),load('verification')
rows={**first,**verified}
events={f:[json.loads(s) for s in (ROOT/f/'timeline.jsonl').read_text().splitlines()] for f in ['baseline','final','verification']}
summary={'reference_head':'7286200d7b1bee0e239fc76568af5727b23c8006','minecraft':'1.20.1','opt_in':True,'automatic_dispatch':False,'julia_authority':'none','scenarios':{},'reconnect':{'executed':False,'reason':'safety/craft race revealed real bugs; cycle stays on correction/revalidation per priority'}}
policy=verified['policy'];assert len(policy['tests'])==8 and all(t['passed'] for t in policy['tests'])
summary['dispatch']={'passed':8,'total':8,'source':'verification/results.json','cancel_case':'controlled cancellation flag on frozen real snapshot; other cases real live snapshots','construction_only':True}
for scene in ['moving','attack_gather']:
 r=rows[scene];assert r['partial']['cobblestone']==1
 assert r['interrupted']['remainingPlan']['collect']['cobblestone']==1
 assert r['resume']['results'][0]['steps'][0]['requested']==1
 assert r['resume']['results'][0]['steps'][0]['collected']==1
 assert r['resume']['held']=='stone_sword' and r['resume']['candidates']==['continue_objective']
 assert r['interrupted']['code']==('THREAT' if scene=='moving' else 'CANCELLED')
 summary['scenarios'][scene]={'code':r['interrupted']['code'],'confirmed_cobblestone':1,'resumed_collection':1,'final_held':'stone_sword','source':'final/results.json'}
scene_events=lambda folder,scene:[e for e in events[folder] if e['scenario']==scene]
es=scene_events('final','moving')
spawn=next(e for e in es if e['event']=='zombie_summon_requested');assert spawn['distance']>16 and spawn['aiEnabled'] and 'NoAI' not in spawn['command']
samples=[e for e in es if e['event']=='perception' and e['zombies']]
assert any(e['zombies'][0]['distance']>16 for e in samples)
perceived=next(e for e in es if e['event']=='first_threat_perception')
assert perceived['zombies'][0]['distance']<=16
assert not any(e['event']=='contact_requested' for e in es)
stop=next(e for e in es if e['event']=='task_returned')
last_action=next(e for e in reversed(es[:es.index(perceived)]) if e['event'] in ['dig_start','craft_start','equip_start'])
summary['scenarios']['moving'].update({'spawn_distance':spawn['distance'],'radius':16,'first_perception':perceived,'interruption_at':{'seq':stop['seq'],'at':stop['at'],'mono_ms':stop['mono_ms']},'perception_to_return_ms':round(stop['mono_ms']-perceived['mono_ms'],3),'last_action_before_perception':last_action,'dig_in_flight_cancelled':any(e['event']=='dig_error' for e in es)})
es=scene_events('final','attack_gather')
hurt=next(e for e in es if e['event']=='health' and e['after']<e['before'])
dig=next(e for e in reversed(es[:es.index(hurt)]) if e['event']=='dig_start')
end=next(e for e in es if e['seq']>hurt['seq'] and e['event']=='dig_error')
assert dig['seq']<hurt['seq']<end['seq']
summary['scenarios']['attack_gather'].update({'health_before':hurt['before'],'health_after':hurt['after'],'damage_during_dig':True,'damage_at':hurt,'setup':'AI-active zombie primed outside radius with movement_speed=0, then server teleport to contact while second dig is already in flight; no NoAI'})
r=verified['attack_craft'];assert r['healthBefore']==20 and r['healthAfter']==17
assert r['partial']['stone_sword']==1 and r['resume']['held']=='stone_sword'
es=scene_events('verification','attack_craft')
hurt=next(e for e in es if e['event']=='health' and e['after']<e['before'])
start=next(e for e in es if e['event']=='craft_start')
end=next(e for e in es if e['event']=='craft_end')
internal_end=next(e for e in es if e['event']=='craft_internal_end')
assert start['seq']<hurt['seq']<end['seq']<internal_end['seq'] and hurt['internalActive']
summary['scenarios']['attack_craft']={'code':r['interrupted']['code'],'health_before':20,'health_after':17,'damage_during_bot_craft_and_craftInternal':True,'craft_start_ms':start['mono_ms'],'damage_ms':hurt['mono_ms'],'craft_end_ms':end['mono_ms'],'internal_end_ms':internal_end['mono_ms'],'sword_produced_despite_interruption':1,'stable_inventory':r['partial'],'inventory_during_defense':r.get('partialDuringDefense'),'final_held':'stone_sword','source':'verification/results.json','setup':'AI-active primed zombie teleported to contact after bot.craft starts; player initially looks away, supplied table remains within 4 blocks; real turn/craft latency, no fake craft or promise-delay output'}
r=verified['safety_craft_race'];assert r['interrupted']['code']=='THREAT' and r['partial']=={'cobblestone':2,'stick':1}
es=scene_events('verification','safety_craft_race');gate=next(e for e in es if e['event']=='race_gate_observed_threat');returned=next(e for e in es if e['event']=='task_returned')
assert not any(e['event'] in ['dig_start','craft_start','equip_start'] and gate['seq']<e['seq']<returned['seq'] for e in es)
assert r['resume']['held']=='stone_sword'
summary['scenarios']['safety_craft_race']={'code':'THREAT','new_physical_starts_after_gate':0,'inventory_unchanged':r['partial'],'final_held':'stone_sword','source':'verification/results.json','probe':'scheduling gate at real ensureCraftingTable await; waits for real entity perception; no fake model/state/physical result'}
r=first['table_removed'];assert r['failed']['code']=='NEARBY_TABLE_REQUIRED' and r['partial']['cobblestone']==2 and r['resume']['held']=='stone_sword'
assert not any(e['event']=='placeBlock_start' for e in scene_events('final','table_removed'))
summary['scenarios']['table_removed']={'code':'NEARBY_TABLE_REQUIRED','replacement_table_placed_by_bot':0,'material_preserved':r['partial'],'restored_table_resume':'stone_sword','source':'final/results.json'}
r=verified['remove_cobblestone'];assert r['changed']['code']=='RECIPE_INPUTS_CHANGED' and r['partial']['cobblestone']==1
assert r['resume']['results'][0]['steps'][0]['requested']==1 and r['resume']['held']=='stone_sword'
summary['scenarios']['remove_cobblestone']={'code':'RECIPE_INPUTS_CHANGED','confirmed_remaining':1,'resumed_collection':1,'final_held':'stone_sword','source':'verification/results.json'}
r=verified['add_sword'];assert r['changed']['ok'] and r['partial']['stone_sword']==1 and r['partial']['cobblestone']==2
assert r['changed']['steps'][0]['result']['skipped'] and r['resume']['held']=='stone_sword'
assert not any(e['event']=='craft_start' for e in scene_events('verification','add_sword'))
summary['scenarios']['add_sword']={'code':'OK','physical_crafts':0,'stone_swords':1,'inputs_unspent':r['partial'],'final_held':'stone_sword','source':'verification/results.json'}
r=first['remove_pickaxe'];assert r['changed']['code']=='MINING_PICKAXE_REQUIRED' and r['partial']['cobblestone']==1
assert r['changed']['remainingPlan']['collect']['cobblestone']==1 and r['resume']['held']=='stone_sword'
summary['scenarios']['remove_pickaxe']={'code':'MINING_PICKAXE_REQUIRED','confirmed_partial':1,'resumed_collection':1,'final_held':'stone_sword','source':'final/results.json'}

# Audit all accepted sessions, including failed intermediate resumes (retained).
audit={}
for folder in ['final','verification']:
 active=None;peak=0;authorized=0;after_safety=[];safety_seq=None
 for e in events[folder]:
  if e['event']=='owned_task_entry' and e['method']=='runDeterministicPreparation':
   active=e; safety_seq=None
  if active and e['event']=='worker_log' and e['message'].startswith('[deterministic-preparation] '):
   payload=json.loads(e['message'].split('] ',1)[1])
   if payload['event']=='safety_detected':safety_seq=e['seq']
  if e['event'] in ['dig_start','craft_start','equip_start','placeBlock_start']:
   peak=max(peak,e['active'])
   if active and e['taskVersion']==active['taskVersion']:
    if e['event']=='dig_start':
     pos=tuple(e['target'][k] for k in ['x','y','z']);allow={tuple(t[k] for k in ['x','y','z']) for t in active['currentTask']['allowedTargets']}
     assert pos in allow,e;authorized+=1
    assert not e['threat'],e
    assert e['event']!='placeBlock_start',e
    if safety_seq is not None:after_safety.append(e)
  if e['event']=='task_returned':active=None;safety_seq=None
 assert peak<=1 and not after_safety
 assert not any(e['event'] in ['fatal','scenario_error','bot_error'] for e in events[folder])
 audit[folder]={'authorized_digs':authorized,'unauthorized_digs':0,'maximum_concurrent_physical_calls_on_bot':peak,'new_preparation_actions_after_safety':0,'unexpected_harness_or_bot_errors':0}
summary['audit']=audit
summary['failures_preserved']=['baseline craft starts after real threat gate; table recreated/placed; duplicate stone_sword=2','baseline damage arrives only after preparation stops; not accepted as in-flight attack proof','first-fix craft attack likewise too late; transient inventory during defense captured','first-fix remove_cobblestone resume collected remaining but table became out of local range; fixture target corrected','first-fix WEAPON_ALREADY_AVAILABLE overwritten by later recipe input error; fixed/retested']
summary['tests']={'initial_focused':16,'final_focused':39,'full':462,'python':2,'check':'passed'}
summary['initial_ci']={'CI':'success','StateMachine compatibility spike':'success','head':summary['reference_head']}
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['dispatch','audit','tests']},indent=2))
