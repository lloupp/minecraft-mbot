const test = require('node:test')
const assert = require('node:assert/strict')
const { preparationPlan, executePreparationStep } = require('../lib/forced-preparation')
const gather = require('../lib/gather')
const { Vec3 } = require('vec3')

test('planner collects exactly the missing recipe inputs, accounting for conversion batches', () => {
  assert.deepEqual(preparationPlan({ inventory: { stick: 1 } }).collect, { logs: 0, cobblestone: 2 })
  assert.deepEqual(preparationPlan({ inventory: { cobblestone: 2 } }).collect, { logs: 1, cobblestone: 0 })
  assert.deepEqual(preparationPlan({ inventory: { oak_planks: 2, cobblestone: 1 } }).collect, { logs: 0, cobblestone: 1 })
  assert.deepEqual(preparationPlan({ inventory: { oak_log: 1, cobblestone: 2 } }).collect, { logs: 0, cobblestone: 0 })
  assert.deepEqual(preparationPlan({ inventory: { stick: 1, cobblestone: 1 } }).collect, { logs: 0, cobblestone: 1 })
})

test('bridge has no effect unless explicitly enabled', async () => {
  const bot = new Proxy({}, { get() { throw new Error('bot should not be touched') } })
  assert.deepEqual(await executePreparationStep({ bot }), { ok: false, code: 'DISABLED' })
})

function unarmedBot() {
  const position = new Vec3(0, 64, 0)
  return { health: 20, food: 20, time: { timeOfDay: 1000 }, entity: { position },
    entities: {}, nearestEntity: () => null, inventory: { items: () => [], slots: [] },
    blockAt: p => ({ name: p.y === 64 && p.x === -2 && p.z === 0 ? 'oak_log'
      : p.y === 64 && (p.x === 2 && p.z === 0 || p.x === 0 && p.z === 2) ? 'stone' : 'air', position: p }) }
}

test('preflight refuses missing table and unauthorized material sources before digging', async () => {
  const bot = unarmedBot()
  bot.dig = () => { throw new Error('must not dig') }
  const args = { enabled: true, bot, task: { type: 'explorar' }, production: { cachedCraftingTable: () => null } }
  assert.equal((await executePreparationStep(args)).code, 'NEARBY_TABLE_REQUIRED')
  args.production.cachedCraftingTable = () => ({ position: new Vec3(1, 64, 1) })
  assert.equal((await executePreparationStep(args)).code, 'APPROVED_TARGETS_INSUFFICIENT')
  args.allowedTargets = [{ x: -2, y: 64, z: 0, name: 'oak_log' }, { x: 2, y: 64, z: 0, name: 'stone' }, { x: 0, y: 64, z: 2, name: 'stone' }]
  assert.equal((await executePreparationStep(args)).code, 'MINING_PICKAXE_REQUIRED')
  args.allowedTargets[2] = args.allowedTargets[1]
  assert.equal((await executePreparationStep(args)).code, 'APPROVED_TARGETS_INSUFFICIENT')
  args.production.storage = { configured: () => true }
  assert.equal((await executePreparationStep(args)).code, 'LOCAL_PRODUCTION_REQUIRED')
})

test('cancel and critical food preempt physical preparation', async () => {
  const bot = unarmedBot()
  const cancelled = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, isCancelled: () => true })
  assert.equal(cancelled.code, 'CANCELLED')
  assert.equal(cancelled.interrupted, true)

  bot.food = 5
  bot.entities = { cow: { name: 'cow', position: new Vec3(1, 64, 0) } }
  const hungry = await executePreparationStep({ enabled: true, bot, task: { type: 'explorar' }, homeProvider: () => new Vec3(100, 64, 0) })
  assert.equal(hungry.code, 'SAFETY_FIND_FOOD')
  assert.equal(hungry.interrupted, true)
})

test('authorized gathering never selects a closer unapproved block', async () => {
  const unapproved = new Vec3(1, 64, 0), approved = new Vec3(2, 64, 0)
  let present = true
  const items = [], dug = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] }, inventory: { items: () => items }, entities: {},
    findBlocks: () => present ? [unapproved, approved] : [unapproved],
    blockAt: p => ({ name: p.y === 64 && p.z === 0 && (p.x === 1 || p.x === 2) ? 'oak_log' : 'air', position: p }),
    pathfinder: { goto: async () => {}, bestHarvestTool: () => null },
    equip: async () => {}, dig: async block => { dug.push(block.position); present = false; items.push({ name: 'oak_log', count: 1 }) }
  }
  const n = await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false, { allowedPositions: new Set([approved.toString()]) })
  assert.equal(n, 1)
  assert.deepEqual(dug, [approved])
})

test('visible approved block in physical reach does not require a navigation goal', async () => {
  const pos = new Vec3(2, 64, 0), items = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] }, inventory: { items: () => items }, entities: {},
    findBlocks: () => [pos], blockAt: p => ({ name: p.equals(pos) ? 'oak_log' : 'air', position: p }),
    canDigBlock: () => true, lookAt: async () => {}, blockAtCursor: () => ({ position: pos }),
    pathfinder: { goto: () => { throw new Error('should not navigate') }, bestHarvestTool: () => null },
    dig: async () => items.push({ name: 'oak_log', count: 1 })
  }
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false,
    { allowedPositions: new Set([pos.toString()]), preferInReach: true, onAttempt: a => attempts.push(a) }), 1)
  assert.equal(attempts[0].navigation, 'visible_in_reach')
})
