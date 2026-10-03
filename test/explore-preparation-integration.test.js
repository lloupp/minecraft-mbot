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

test('configured colony storage does not block the local-only explore preparation bridge', async () => {
  const { worker, items } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  worker.production.storage = {
    configured: () => true,
    withdraw: async () => assert.fail('local-only preparation must not withdraw from storage'),
    withdrawFirst: async () => assert.fail('local-only preparation must not withdraw from storage'),
    deposit: async () => assert.fail('local-only preparation must not deposit to storage')
  }

  const intents = []
  worker.runDeterministicPreparation = async (task) => {
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
  worker.explore = async () => ({ ok: true, storageConfigured: true })

  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true)
    assert.equal(result.storageConfigured, true)
    assert.deepEqual(intents, ['gather_materials', 'prepare_combat'])
  } finally {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
})

test('opt-in explore falls back to classic exploration when the physical preflight cannot prepare here', async () => {
  const { worker } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  worker.production.cachedCraftingTable = () => null
  worker.production.findCraftingTable = () => null
  let explored = 0
  worker.explore = async () => { explored++; return { ok: true, x: 16, y: 64, z: 0 } }
  worker.runDeterministicPreparation = async () => assert.fail('executor must not run after refused preflight')

  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.equal(result.ok, true)
    assert.equal(explored, 1)
    assert.deepEqual(result.preparationSkipped, { code: 'NEARBY_TABLE_REQUIRED', intent: 'gather_materials' })
    assert.deepEqual(result.preparationSteps, [])
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

test('opt-in explore registers a live crafting table within 4 blocks before the preflight', async () => {
  const { worker } = integrationWorker()
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'

  const table = { name: 'crafting_table', position: new Vec3(-1, 64, 0) }
  let remembered = null
  const searched = []
  worker.production.cachedCraftingTable = () => remembered
  worker.production.findCraftingTable = (_bot, distance) => { searched.push(distance); return table }
  worker.production.rememberCraftingTable = (_bot, block) => { remembered = block; return block }
  let started = 0
  worker.runDeterministicPreparation = async () => { started++; return { ok: false, code: 'STOP_AFTER_FIRST' } }
  worker.explore = async () => assert.fail('explore must not run after a failed preparation step')

  try {
    const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
    assert.deepEqual(searched, [4])
    assert.equal(remembered, table)
    assert.equal(started, 1)
    assert.equal(result.code, 'STOP_AFTER_FIRST')
  } finally {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
})

function withPreparationFlags(fn) {
  const previousExplore = process.env.MBOT_EXPLORE_PREPARATION
  const previousPrep = process.env.MBOT_DETERMINISTIC_PREPARATION
  process.env.MBOT_EXPLORE_PREPARATION = '1'
  process.env.MBOT_DETERMINISTIC_PREPARATION = '1'
  const restore = () => {
    if (previousExplore === undefined) delete process.env.MBOT_EXPLORE_PREPARATION
    else process.env.MBOT_EXPLORE_PREPARATION = previousExplore
    if (previousPrep === undefined) delete process.env.MBOT_DETERMINISTIC_PREPARATION
    else process.env.MBOT_DETERMINISTIC_PREPARATION = previousPrep
  }
  return Promise.resolve().then(fn).finally(restore)
}

test('threat-interrupted preparation returns once to its validated site on the next explore', () => withPreparationFlags(async () => {
  const { worker } = integrationWorker()
  const goals = []
  worker.goTo = async (goal) => { goals.push([goal.x, goal.y, goal.z]) }
  worker.explore = async () => ({ ok: true })
  worker.runDeterministicPreparation = async () => ({ ok: false, code: 'THREAT' })

  const first = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(first.code, 'THREAT')
  assert.deepEqual(worker._preparationSite.position, new Vec3(0, 64, 0))

  worker.bot.entity.position = new Vec3(9, 64, 0) // deslocado pela defesa
  worker.runDeterministicPreparation = async () => ({ ok: false, code: 'GATHER_ITEM_NOT_CONFIRMED' })
  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.deepEqual(goals, [[0, 64, 0]]) // GoalBlock do local validado
  assert.equal(worker._preparationSite, null) // uma tentativa só

  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(goals.length, 1)
}))

test('preparation site is not revisited while a threat persists, when stale, or after a non-threat failure', () => withPreparationFlags(async () => {
  const { worker } = integrationWorker()
  const goals = []
  worker.goTo = async (goal) => { goals.push(goal) }
  worker.explore = async () => ({ ok: true })
  worker.runDeterministicPreparation = async () => ({ ok: false, code: 'CANCELLED' })
  worker.bot.entity.position = new Vec3(9, 64, 0)

  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(worker._preparationSite ?? null, null) // nova ordem/cancelamento não cria local de retomada

  worker._preparationSite = { position: new Vec3(0, 64, 0), at: Date.now() - 91000 }
  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  worker._preparationSite = { position: new Vec3(0, 64, 0), at: Date.now() }
  worker.bot.nearestEntity = () => ({ name: 'zombie', type: 'hostile', position: new Vec3(11, 64, 0), health: 20 })
  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.deepEqual(goals, [])
  assert.ok(worker._preparationSite) // ameaça presente: local preservado até o TTL
}))


test('local preparation staging approaches only one existing table within eight blocks', async () => {
  const { worker } = integrationWorker()
  const tablePos = new Vec3(6, 64, 0)
  let searchedDistance = null
  let remembered = null
  let moves = 0

  worker.production.findCraftingTable = (_bot, maxDistance) => {
    searchedDistance = maxDistance
    return { name: 'crafting_table', position: tablePos }
  }
  worker.production.rememberCraftingTable = (_bot, block) => {
    remembered = block
    return block
  }
  worker.bot.blockAt = position => ({
    name: position.equals(tablePos) ? 'crafting_table' : 'air',
    position
  })
  worker.goTo = async goal => {
    moves++
    assert.equal(goal.x, 6)
    assert.equal(goal.y, 64)
    assert.equal(goal.z, 0)
    worker.bot.entity.position = new Vec3(5, 64, 0)
  }

  const staged = await worker.tryLocalPreparationStaging(() => false)
  assert.equal(staged, true)
  assert.equal(searchedDistance, 8)
  assert.equal(remembered.name, 'crafting_table')
  assert.equal(moves, 1)

  worker.bot.entity.position = new Vec3(0, 64, 0)
  worker.production.findCraftingTable = () => ({ name: 'crafting_table', position: new Vec3(9, 64, 0) })
  moves = 0
  assert.equal(await worker.tryLocalPreparationStaging(() => false), false)
  assert.equal(moves, 0)
})

test('local preparation staging respects ownership cancellation before movement', async () => {
  const { worker } = integrationWorker()
  let searched = 0
  let moved = 0
  worker.production.findCraftingTable = () => { searched++; return { name: 'crafting_table', position: new Vec3(6, 64, 0) } }
  worker.goTo = async () => { moved++ }

  assert.equal(await worker.tryLocalPreparationStaging(() => true), false)
  assert.equal(searched, 0)
  assert.equal(moved, 0)
})

test('opt-in explore can stage once near a local table, then prepare and continue exploring', () => withPreparationFlags(async () => {
  const { worker, items } = integrationWorker()
  const tablePos = new Vec3(6, 64, 0)
  // Recursos ≤4 do ponto inicial (o snapshot só os vê ali) e ≤4 do ponto de staging; a mesa é que está longe.
  const stones = [new Vec3(2, 64, 2), new Vec3(2, 64, -2)]
  let remembered = null
  let stagingMoves = 0
  const intents = []

  worker.bot.registry.blocksArray = [
    { id: 1, name: 'stone', drops: [2] },
    { id: 3, name: 'crafting_table' }
  ]
  worker.bot.findBlocks = () => stones
  worker.bot.blockAt = position => {
    if (position.equals(tablePos)) return { name: 'crafting_table', position }
    if (stones.some(stone => stone.equals(position))) return { name: 'stone', position }
    return { name: 'air', position }
  }
  worker.production.cachedCraftingTable = () => remembered
  worker.production.findCraftingTable = (_bot, maxDistance) =>
    maxDistance >= 6 ? { name: 'crafting_table', position: tablePos } : null
  worker.production.rememberCraftingTable = (_bot, block) => { remembered = block; return block }
  worker.goTo = async goal => {
    stagingMoves++
    worker.bot.entity.position = new Vec3(goal.x - 1, goal.y, goal.z)
  }

  worker.runDeterministicPreparation = async task => {
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

  let explored = 0
  worker.explore = async () => { explored++; return { ok: true, staged: true } }

  const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(result.ok, true)
  assert.equal(result.staged, true)
  assert.equal(stagingMoves, 1)
  assert.deepEqual(intents, ['gather_materials', 'prepare_combat'])
  assert.equal(result.preparationSteps.length, 2)
  assert.equal(explored, 1)
}))

test('threat before preparation remembers the site only when unarmed with resources nearby', () => withPreparationFlags(async () => {
  const { worker } = integrationWorker()
  worker.explore = async () => assert.fail('must not explore while the threat preempts the loop')
  worker.bot.nearestEntity = () => ({ name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0), health: 20 })

  const result = await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(result.code, 'PLAYER_LOOP_PREEMPTED')
  assert.deepEqual(worker._preparationSite.position, new Vec3(0, 64, 0))

  worker._preparationSite = null
  worker.bot.findBlocks = () => [] // sem recursos ao alcance: nada a retomar
  await worker.runExplorePlayerLoop({ type: 'explorar', radius: 32 }, () => false)
  assert.equal(worker._preparationSite, null)
}))

test('defense remembers the preparation site only when unarmed with resources nearby and the flag on', () => withPreparationFlags(async () => {
  const { worker } = integrationWorker()
  const threat = { name: 'zombie', type: 'hostile', position: new Vec3(6, 64, 0), isValid: true }
  worker.bot.health = 5
  worker.bot.entities = { z: threat }
  worker.bot.nearestEntity = () => threat
  worker.flee = async () => {}
  worker.bot.pathfinder.setGoal = () => {}
  worker.currentTask = null

  await worker.defend(threat)
  assert.deepEqual(worker._preparationSite.position, new Vec3(0, 64, 0))

  worker._preparationSite = null
  const sword = { name: 'stone_sword', count: 1 }
  worker.bot.inventory.items().push(sword)
  worker.bot.heldItem = sword
  await worker.defend(threat)
  assert.equal(worker._preparationSite, null) // armado: nada a preparar

  worker.bot.inventory.items().pop(); worker.bot.heldItem = null
  delete process.env.MBOT_EXPLORE_PREPARATION
  await worker.defend(threat)
  assert.equal(worker._preparationSite, null) // flag desligada: comportamento clássico
}))


test('local staging refuses to move when a hostile is already inside the defense radius', async () => {
  const { worker } = integrationWorker()
  const tablePos = new Vec3(6, 64, 0)
  const threat = { name: 'zombie', type: 'hostile', position: new Vec3(4, 64, 0), isValid: true }
  let moved = 0
  let defended = null
  let cancelled = false

  worker.production.findCraftingTable = () => ({ name: 'crafting_table', position: tablePos })
  worker.bot.blockAt = position => ({ name: position.equals(tablePos) ? 'crafting_table' : 'air', position })
  worker.bot.nearestEntity = predicate => predicate(threat) ? threat : null
  worker.bot.pathfinder.setGoal = () => {}
  worker.goTo = async () => { moved++ }
  worker.defend = async hostile => {
    defended = hostile
    cancelled = true
    return 'fugi'
  }

  const staged = await worker.tryLocalPreparationStaging(() => cancelled)

  assert.equal(staged, false)
  assert.equal(moved, 0)
  assert.equal(defended, threat)
})

test('hostile appearing during local staging stops navigation and hands control to defense', async () => {
  const { worker } = integrationWorker()
  const tablePos = new Vec3(6, 64, 0)
  const threat = { name: 'zombie', type: 'hostile', position: new Vec3(5, 64, 0), isValid: true }
  let threatVisible = false
  let cancelled = false
  let defended = null
  let stopped = 0
  let releaseMovement

  worker.production.findCraftingTable = () => ({ name: 'crafting_table', position: tablePos })
  worker.bot.blockAt = position => ({ name: position.equals(tablePos) ? 'crafting_table' : 'air', position })
  worker.bot.nearestEntity = predicate => threatVisible && predicate(threat) ? threat : null
  worker.bot.pathfinder.setGoal = goal => {
    if (goal === null) {
      stopped++
      releaseMovement?.()
    }
  }
  worker.goTo = async () => new Promise(resolve => {
    releaseMovement = resolve
    setTimeout(() => { threatVisible = true }, 20)
  })
  worker.defend = async hostile => {
    defended = hostile
    cancelled = true
    return 'fugi'
  }

  const staged = await worker.tryLocalPreparationStaging(() => cancelled)

  assert.equal(staged, false)
  assert.equal(defended, threat)
  assert.ok(stopped >= 1)
  assert.equal(cancelled, true)
})
