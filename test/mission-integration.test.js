const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MissionStore } = require('../core/MissionStore')
const { MissionRunner } = require('../core/MissionRunner')
const { createExecutors } = require('../core/mission-executors')
const missionSpec = require('../lib/mission-spec')
const { VERIFIERS } = require('../lib/verifiers')

test('pegar e guardar percorre spec, grafo, executores e verificadores', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbot-mission-e2e-'))
  const store = new MissionStore(path.join(dir, 'missions.json'))
  const items = []
  const chest = {}
  const bot = {
    inventory: { items: () => items.filter((item) => item.count > 0) },
    registry: { blocksArray: [{ name: 'coal_ore', drops: [1] }], blocksByName: {}, items: { 1: { name: 'coal' } } }
  }
  const storage = {
    configured: () => true,
    depositMany: async (_bot, counts) => {
      for (const [name, count] of Object.entries(counts)) chest[name] = (chest[name] || 0) + count
      return { ...counts }
    },
    summary: async () => ({ ...chest })
  }
  const executors = createExecutors({
    bot,
    storage,
    gather: { mineBlocks: async (_bot, _predicate, count) => { items.push({ name: 'coal', count }); return count } },
    craft: { craftItem: async () => {}, smeltItem: async () => {} },
    handover: { DELIVERY_CHEST: { x: 0, y: 0, z: 0 }, deliverTo: async () => ({ ok: true, delivered: 0 }), depositAtChest: async () => ({ ok: true, deposited: 0 }) },
    goals: { GoalNear: class GoalNear {} },
    logger: { log: () => {} }
  })
  const runner = new MissionRunner({
    store,
    bot,
    storage,
    executors,
    verifiers: VERIFIERS,
    eventLog: { log: () => {} },
    sleep: async () => {},
    maxAttempts: 1
  })

  const spec = { verb: 'pegar', item: 'coal', quantity: 4, delivery: 'chest' }
  const mission = store.create({ id: 'e2e', spec, graph: missionSpec.graphForSpec(spec) })
  const result = await runner.run(mission.id)

  assert.equal(result.status, 'completed')
  assert.deepEqual(chest, { coal: 4 })
  assert.equal(store.get('e2e').status, 'completed')
  assert.equal(store.get('e2e').evidence.length, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})
