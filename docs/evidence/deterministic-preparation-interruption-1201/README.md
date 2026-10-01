# Deterministic preparation interruptions — Minecraft Java 1.20.1

Reference: `7f1f5a00a7935bdcf8b2f1b1a2788a207a792343`, branch `experiment/julia-laya-andy-player-loop-v2`, PR #78. Measurements: 2026-10-01 UTC. Final code is the commit containing this folder; runtime metadata labels the modified working tree before publication.

## Result

Real physical interruption and partial resume are proved through `WorkerController.run`, task `preparar_combate_deterministico`, objective `{type: "explorar"}`, explicit block positions and `MBOT_DETERMINISTIC_PREPARATION=1`. Nothing dispatches preparation automatically. Julia remains shadow, never authorizes an action.

| Scenario | Observed interruption / first result | Inventory preserved | Resume / final result |
|---|---|---|---|
| New order after first pickup | `CANCELLED`; real `ir_local` replaces ownership | 1 cobblestone, 1 stick, pickaxe | Collect only 1 additional authorized stone; craft/equip sword; `[continue_objective]` |
| Nearby real zombie during pickup | `THREAT`; monitor calls pathfinder stop | 1 cobblestone, 1 stick, pickaxe | Remove zombie, wait for actual day/no-threat snapshot; collect only 1; sword equipped; `[continue_objective]` |
| Cancel while log craft is in flight | `CANCELLED`, craft continues | 4 oak_planks, 2 cobblestone | Convert sticks, craft/equip sword; no log recollection |
| Cancel while sword craft is in flight | `CANCELLED`, craft continues | 1 stone_sword | Equip existing sword only; no gathering or crafting again |
| Two preparations, same worker | First `CANCELLED`, second `OK` | No duplicate items observed | Ownership changes immediately; second starts physical work only after first settles |
| Preparations in workers A and B | Both gather steps `OK` | 2 cobblestone each before craft | Both craft/equip swords; separate bots do not share the busy lock |
| Table blocks second target | `TARGET_BLOCKED`, bounded refusal | 1 cobblestone | With a fresh explicit allowlist, refuse blocked original and use visible alternative; collect only 1; equip sword |

`summary.json` is derived by `summarize.py`, which asserts real inventories, required quantities, ownership, authorized dig positions and absence of new physical actions from the interrupted owner. There are 0 unauthorized digs, no overlapping dig/craft calls on the same bot, no extra gathers after recipe inputs suffice, and no bot/harness errors in the accepted captures. Intentional cancellation yields a dig interruption in the concurrency case; `TARGET_BLOCKED` is an expected refusal, not a successful first attempt. No timeout in accepted executions. This does not claim the whole cycle was failure-free.

## Observed bugs and small fixes

1. **Partial pickup evidence contradicted inventory.** Baseline `gather` had delta=1 but `itemConfirmed=false` and `collected=0` after cancellation. Confirmation now reflects the actual delivered item while retaining the interruption code; task completion still remains false. Updated gather/worker tests preserve no-deposit/no-success on cancellation.
2. **Sparse perception lost the remaining stone after pickup.** Baseline new-order resume returned `NO_PREPARATION_INTENT`. Only the opt-in preparation snapshot is refined using live, nearby, explicitly authorized sources. No global perception scan or invented target.
3. **New owner could start before the old craft settled.** Preparation promises now drain before any new owned physical dispatch. Ownership invalidates immediately; stale queued tasks return `CANCELLED`. An already submitted craft may finish, and its inventory result is recorded before interruption checks.
4. **A sword produced after cancellation could not be resumed.** The specific bridge now supports the existing deterministic `equip_best_weapon` choice for a carried stone_sword; remaining material plan is zero. No generic executor or second craft.
5. **Blocked table route waited for pathfinding timeout.** Only this opt-in gather requires visible physical reach, refuses `TARGET_BLOCKED` and can try all explicitly approved alternatives without increasing requested quantity. Generic gather defaults/pathfinder remain intact. No obstacle or table was dug to open a route.
6. **Shadow saw the wrapper objective.** Preparation shadow now observes its real `objective` (`explore`) rather than the wrapper task type. Final + verification captures contain 9 real Julia predictions, 0 sidecar errors. Their outputs never enter dispatch.

## Evidence and failed attempts

- `baseline/`: untouched reference code, first interruption captures. After threat setup, the harness failed to reset/wait for day, causing later night-safety refusals; its concurrency setup timeout is a harness failure, not a preparation result. Preserved, excluded from accepted verdict.
- `baseline-day/`: corrected day setup against reference code. Real log/sword crafts finish despite cancellation; carried sword resume fails; same-worker second returns `BUSY`; table case times out after 1 confirmed item. Preserved.
- `final/`: corrected production code, all seven cases. Threat stops correctly but its first resume still sees stale night on the client. Preserved as a failed resume, not hidden.
- `verification/`: only affected new-order/partial perception and threat scenarios repeated. Harness waits for the real client time/no-threat state; both reach sword equipped and `[continue_objective]`. Includes explicit `owned_task_entry` with objective, allowlist and taskVersion.
- Every capture has `results.json`, timestamped/ordered `timeline.jsonl`, server/sidecar logs and model runtime metadata. Timeline logs initial states, ownership versions, console fixture changes, actual dig/craft/equip calls, outbound craft packet and inventory updates. Collection attempts retain cancelled codes with item deltas; result `remainingPlan` uses real final inventory.
- `full-tests-before-expectation-fix.log` preserves the old assertion expecting zero gathered after a delivered item. The updated regression still requires `ok=false`, `CANCELLED`, and no deposit, while asserting confirmed partial progress.

Fixtures are isolated elevated platforms in a dedicated local offline server world, reset only between scenarios. Resume never clears/injects inventory or recreates the destroyed first stone. For the obstacle resume, a third stone is explicitly created and authorized, while the table and blocked original remain. `canDig=false` movements are retained. Zombie is a real server entity with NoAI at 3 blocks, permitting controlled safety detection without unbounded combat.

Craft cancellation is triggered immediately after the first actual `window_click` packet is sent within the real Mineflayer craft call. No promise gate, fake output or rollback is used. It proves cancellation overlaps a submitted craft and observes its result; it does not guarantee interruption at an arbitrary server-internal crafting phase. A cancelled craft is allowed to settle before the replacement dispatches. Cooperative deadlines are not hard real-time guarantees.

## Tests

Initial requested checks passed: `npm run check`, requested three Node files 21/21, sidecar Python 2/2. After fixes: check passed; focused preparation/player-loop/gather/recovery/shadow tests 40/40; complete `npm test` **450/450**; Python **2/2**. Raw final logs included. No long benchmark.

Reproduce on an isolated server installation with Java 17, dependencies and the pinned Julia snapshot already installed:

```sh
ORDER_OUTPUT_DIR=/absolute/fresh-output \
ORDER_SERVER_DIR=/absolute/server-install \
ORDER_PYTHON=/absolute/venv/bin/python \
JULIA_MODEL=/absolute/Julia-1-snapshot \
MBOT_DETERMINISTIC_PREPARATION=1 \
node docs/evidence/deterministic-preparation-interruption-1201/run.js
```

`SCENARIOS=new_order,threat` limits the run to affected scenarios. Output directory must be fresh. Server config uses localhost:25566 and `interruption-world`; sidecar localhost:8768. Harness commands are test fixture setup, not model execution. Servers/bots/sidecar are stopped after captures.

## Remaining limits / next step

No normal-loop automatic preparation, bootstrap tools/table, generic resource selection, atomic craft cancellation, combat efficacy, reconnect persistence or broad navigation guarantee is proved. Preparation supports a local stone-sword recipe with a supplied live table, mining tool and approved reachable sources. A threat appearing between a safety check and a packet remains a cooperative race; no new step starts after detection in these captures. The fixed drain covers replacement of an in-flight preparation, not serialization of every legacy worker operation.

Before integration, define a bounded deterministic dispatch policy and test moving/attacking threats, pending pickups across disconnects and table/inventory changes without expanding authority. Before any limited Julia authority, retain a separate deterministic executor/allowlist, safety precedence and ownership checks; these successful preparation tests alone do not justify model authority. Main unchanged, no merge.
