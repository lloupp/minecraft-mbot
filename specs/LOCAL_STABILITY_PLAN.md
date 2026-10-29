# Local stability review — baseline and plan

## Safety checkpoint
- Baseline: 9329e13dbf578376f92bdb575a2fd4c068df3742; clean tree on feat/supervised-bot-base.
- Safety branch: safety/local-before-pr-review-20261028.
- Working branch: feat/local-stability-pr-review.
- Private ZIP outside repo: ../local-backups/minecraft-mbot-before-pr-review-20261028-101716.zip (1070 files; includes .env/state/logs; never publish).
- At inspection no matching Node bot/supervisor process and no response on viewer 3007. Historical logs show repeated configured-container-unavailable errors and a death/respawn.
- Preserve .env, launchers, Forge handshake, viewer/keyboard, dashboard commands, food/tools retention, base/project and workers. No server restart/main merge. Models remain without execution authority.

## Impact and selected scope
Shared storage recovery affects main bot, workers, crafting, gathering and task scheduling. Queue ownership/persistence affects manual orders, automatic colony and diagnostics. High risk: test first, then bounded physical smoke. No external dependency added.

## PR comparison (remote heads captured in logs/pr-review-metadata.json)
- #89 ac629e0: offline embedding corpus/benchmark; its documented gate is NEUTRAL. Do not copy historical datasets or connect model to runtime. Existing spatial memory preserved.
- #93 81869ac: adopt plugin ONLY/SKIP isolation and export probe, adapting to six local plugins and preserving current AutoEat behavior. No new movement/panorama dependency promoted.
- #95 a8047eb: local baseline is its ancestor; selectively adopt newer injured-worker feeding, automatic iron idle gate, truthful fence validation and validated connection settings. Keep local tool/food-only cargo policy rather than reintroducing raw-iron reserves that contradict it. Adopt bounded/cross-platform test tooling, not duplicate historical evidence.
- #96 12fdcbd: adopt missing mineral aliases/catalog and tests; do not blindly import draft priority scheduler that can conflict with local RequestQueue or count collection as delivery. Pending future priority work remains explicit.
- #97 3f4b6ce: inspect opt-in API and reservation safeguards; do not start a second dispatcher lacking global arbitration with queue/automatic work. Use ownership recheck for existing queue. Existing loopback dashboard and tool API preserved.

## Implementation slices
1. Establish automated baseline with Node 24, bounded concurrency/timeouts; add cross-platform syntax check and explicit unit discovery excluding live scripts. Verify npm run check / npm test.
2. Apply reviewed source-level fixes from #93/#95 and mineral catalog from #96 without overwriting local functionality. Verify plugin, connection, iron idle, fence, worker and resource tests.
3. Repair configured stock recovery on confirmed missing chest; never replace remote/unloaded stock with arbitrary local chest. Keep confirmed new position and persist. Verify storage regressions and bounded live container inspection.
4. Harden RequestQueue durability, validation and ownership. Prove serialization, failed save rollback, cancellation, independent worker parallelism, restart interruption and exclusion from auto tasks. Do not claim all chat commands are queued.
5. Start using unchanged launcher command with non-authoritative session environment; run read-only smoke then small explicit collection/deposit. Capture actual results, failures and limitations. Never claim mining/build success solely from API acceptance.
6. Record PR matrix, test commands/results, real evidence and remaining risks. Commit reviewed changes on working branch; no main merge/push unless requested.
