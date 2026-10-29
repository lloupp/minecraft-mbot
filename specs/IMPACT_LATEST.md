## Target
Inventory retention and cargo-storage policy for the main bot and colony workers, centered on `StorageManager.depositCargo`, `WorkerController` task lifecycle, and the main bot's task/pickup lifecycle in `index.js`.

## Dependents (high fan-in)
- `core/StorageManager.js`: shared inventory classification, central container transactions, and cargo deposit behavior.
- `core/WorkerController.js`: worker collection, crafting, building, food/equipment, task completion, explicit deposit, and storage synchronization.
- `core/ColonyOrchestrator.js`: schedules deposit/sync/withdraw and gives workers assignments.
- `core/ProductionManager.js`: crafting and product delivery to shared storage.
- `index.js`: main bot inventory, iron mining/deposit, autonomous task loop, base/stock setup, and dashboard commands.
- `lib/autonomy.js`: main bot's food, iron, and supply decisions.
- Tool and preparation layers: workers need local materials/tools transiently and may need food/torches for survival and navigation.

## Affected Stories
- No `specs/release-plan.yaml` or epic capsules found in this checkout.
- The change affects existing base/colony/storage behavior implemented on the feature branch.

## Test Coverage
- `test/core.test.js`: added checks that StorageManager creates/registers a chest through its callback and reserves tools + up to eight food items while depositing torches and materials.
- `test/worker.test.js`: added a task-lifecycle check that cargo is deposited after work and tools/food remain.
- `test/physical-interaction-regression.test.js`: safe container interaction and deposit mechanics.
- `test/worker-navigation.test.js`, `test/worker-route.test.js`, `test/colony-tool-ownership.test.js`, `test/forced-preparation-worker.test.js`, `test/forced-preparation.test.js`: task lifecycle, navigation, tool retention and preparation.
- Remaining gap: live verification of chest placement when storage is unconfigured, and behavior when a configured chest is full or unreachable.

## Risk: High
This changes shared inventory semantics for every bot and intersects survival, combat, mining, construction, crafting, pathfinding, and storage concurrency; an auto-deposit failure must not discard task results or lose cargo.

## Recommended action
Implemented an idle-after-task deposit policy for the main bot and colony workers. Keep tools/equipment and up to eight food items; deposit other cargo, including torches, after tasks. Workers discover a nearby container or craft/place a chest when no storage position exists. Verify in-game before treating the live behavior as confirmed.
