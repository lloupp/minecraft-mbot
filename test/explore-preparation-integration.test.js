const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { WorkerController } = require('../core/WorkerController')

function integrationWorker() {
  const worker = Object.create(WorkerController.prototype)
  worker.name = 'explorer-test'
  worker.taskVersion = 7
  worker.homeProvider = () => new Vec3(0, 64, 0)
  worker.logger = { log() {} }
  worker._preparationDrain = null

  const stones = [new Vec3(1, 64, 0), new Vec3(0, 64, 1)]
  const table = new Vec3(-1, 64, 0)
  const items = [
    { name: 'stick', count: 1 },
    { name: 'stone_pickaxe', count: 1 }
  ]

  worker.bot = {
    health: 20,
    food: 20,
    time: { timeOfDay: 1000 },
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    heldItem: null,
    nearestEntity: () => null,
    inventory: {
      items: () => items,
      slots: []
    },
    registry: {
      blocksArray: [
        { id: 1, name: 'stone', drops: [2] },
        { id: 3, name: 'crafting_table' }
      ],
      blocksByName: {
        stone: { id: 1, name: 'stone', drops: [2] },
        crafting_table: { id: 3, name: 'crafting_table' }
      },
      items: {
        2: { name: 'cobblestone' }
      }
    },
    findBlocks: () => stones,
    blockAt: (position) => {
      if (position.equals(table)) return { name: 'crafting_table', position }
      if (stones.some((stone) => stone.equals(position))) return { name: 'stone', position }
      return { name: 'air', position }
    },
    canDigBlock: () => true,
    canSeeBlock: () => true,
    pathfinder: {
      bestHarvestTool: () => items.find((item) => item.name === 'stone_pickaxe') || null
    }
  }

  worker.production = {
    storage: { configured: () => false },
    cachedCraftingTable: () => ({ position: table })
  }

  return { worker, items }
}

test('explore preparation integration is completely bypassed unless explicitly enabled', async () => {
  const { worker } = integrationWorker()
  const previous = process.env.MBOT_EXPLORE_PREPARATION
  delete process.env.MBOT_EXPLORE_PREPARATION
  let explored = 0
  worker.explore = async () => { explored++; return { ok: true, legacy: true } }
  worker.runDeterministicPreparation = async () => assert.fail('preparation must stay disabled')
  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true)
    assert.equal(result.legacy, true)
    assert.equal(explored, 1)
  } finally {
    if (previous === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previous
  }
})

test('opt-in explore performs bounded owned preparation stages before physical exploration', async () => {
  const { worker, items } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'

  const intents = []
  let explored = 0
  worker.runDeterministicPreparation = async (task, isCancelled) => {
    assert.equal(isCancelled(), false)
    intents.push(task.deterministicIntent)
    if (task.deterministicIntent === 'gather_materials') {
      items.push({ name: 'cobblestone', count: 2 })
      return { ok: true }
    }
    if (task.deterministicIntent === 'prepare_combat') {
      const sword = { name: 'stone_sword', count: 1 }
      items.push(sword)
      worker.bot.heldItem = sword
      return { ok: true }
    }
    assert.fail(`unexpected preparation intent: ${task.deterministicIntent}`)
  }
  worker.explore = async () => {
    explored++
    return { ok: true, x: 16, y: 64, z: 0 }
  }

  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true)
    assert.equal(result.playerLoopPreparation, true)
    assert.deepEqual(intents, ['gather_materials', 'prepare_combat'])
    assert.equal(result.preparationSteps.length, 2)
    assert.equal(explored, 1)
  } finally {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
})

test('opt-in explore fails closed when physical preparation preflight refuses', async () => {
  const { worker } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  worker.production.storage.configured = () => true
  worker.explore = async () => assert.fail('explore must not start after refused preparation preflight')
  worker.runDeterministicPreparation = async () => assert.fail('executor must not run after refused preflight')

  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'LOCAL_PRODUCTION_REQUIRED')
    assert.equal(result.intent, 'gather_materials')
  } finally {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
})

test('nearby preparation allowlist never expands beyond the bounded local scan', () => {
  const { worker } = integrationWorker()
  let requested
  worker.bot.findBlocks = (options) => {
    requested = options
    return [new Vec3(1, 64, 0), new Vec3(0, 64, 1)]
  }
  const targets = worker.nearbyPreparationAllowlist()
  assert.equal(requested.maxDistance, 4)
  assert.equal(requested.count, 32)
  assert.deepEqual(targets.map((target) => target.name), ['stone', 'stone'])
})


test('new owned task cancels opt-in explore preparation and waits for its physical drain', async () => {
  const { worker } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'

  worker.state = 'ocioso'
  worker.currentTask = null
  worker.workMoves = {}
  worker.waitReady = async () => {}
  worker.useMoves = () => {}
  worker.leaveLeftoverPen = async () => {}
  worker._observeShadow = () => {}
  worker.bot.pathfinder.setGoal = () => {}
  worker.bot.pathfinder.setMovements = () => {}

  let release
  let startedResolve
  const started = new Promise((resolve) => { startedResolve = resolve })
  const events = []
  worker.runDeterministicPreparation = async (_task, isCancelled) => {
    events.push('preparation_start')
    startedResolve(isCancelled)
    await new Promise((resolve) => { release = resolve })
    events.push('preparation_settled')
    return { ok: false, code: isCancelled() ? 'CANCELLED' : 'NOT_CANCELLED' }
  }
  worker.goToPoint = async () => {
    events.push('new_owner_physical')
    return { ok: true }
  }

  try {
    const first = worker.run({ type: 'explorar', radius: 32 })
    const firstCancelled = await started
    assert.equal(firstCancelled(), false)

    const second = worker.run({ type: 'ir_local', position: { x: 3, y: 64, z: 0 } })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(firstCancelled(), true)
    assert.deepEqual(events, ['preparation_start'])

    release()
    const firstResult = await first
    const secondResult = await second

    assert.equal(firstResult.code, 'CANCELLED')
    assert.equal(secondResult.ok, true)
    assert.deepEqual(events, ['preparation_start', 'preparation_settled', 'new_owner_physical'])
  } finally {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
})
