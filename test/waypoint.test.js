const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  WaypointManager,
  normalizeWaypointName
} = require('../core/WaypointManager')
const { StateStore } = require('../core/StateStore')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')

const silent = { log: () => {} }

test('WaypointManager normaliza nomes e persiste dimensão', () => {
  const manager = new WaypointManager()
  const saved = manager.save('Mina de Ferro', { x: 10.8, y: 63, z: -4.2 }, 'overworld')
  assert.equal(saved.name, 'mina-de-ferro')
  assert.equal(normalizeWaypointName('Árvore Grande'), 'arvore-grande')
  assert.deepEqual(manager.get('mina-de-ferro').position, { x: 10.8, y: 63, z: -4.2 })
  assert.equal(manager.get('mina-de-ferro').dimension, 'overworld')
})

test('WaypointManager exporta, restaura e remove locais', () => {
  const manager = new WaypointManager()
  manager.save('fazenda', { x: 1, y: 64, z: 2 }, 'overworld')
  manager.save('mina', { x: 8, y: 20, z: -5 }, 'overworld')

  const restored = new WaypointManager(manager.exportState())
  assert.deepEqual(restored.list().map((entry) => entry.name), ['fazenda', 'mina'])
  assert.equal(restored.sameDimension(restored.get('mina'), 'overworld'), true)
  assert.equal(restored.sameDimension(restored.get('mina'), 'the_nether'), false)
  assert.equal(restored.remove('mina'), true)
  assert.equal(restored.get('mina'), null)
})

test('StateStore persiste waypoints junto com estado da colônia', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'minecraft-mbot-waypoints-'))
  const file = path.join(dir, 'state.json')
  const store = new StateStore(file)

  await store.save({
    waypoints: {
      mina: {
        position: { x: 10, y: 20, z: -3 },
        dimension: 'overworld'
      }
    }
  })

  const loaded = await store.load()
  assert.equal(loaded.waypoints.mina.dimension, 'overworld')
  assert.deepEqual(loaded.waypoints.mina.position, { x: 10, y: 20, z: -3 })

  await fs.promises.rm(dir, { recursive: true, force: true })
})

test('ColonyOrchestrator envia worker a um local', async () => {
  const tasks = []
  const controller = {
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push(task); return { ok: true } }
  }
  const worker = { name: 'minerador_01', role: 'minerador', bot: { colonyController: controller } }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role,
    get: (name) => name === worker.name ? worker : null
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  await colony.sendTo('minerador_01', { x: 12, y: 64, z: 9 })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(tasks[0], {
    type: 'ir_local',
    position: { x: 12, y: 64, z: 9 }
  })
})

test('ColonyOrchestrator direciona explorador ao redor de um waypoint', async () => {
  const tasks = []
  const controller = {
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push(task); return { ok: true } }
  }
  const worker = { name: 'explorador_01', role: 'explorador', bot: { colonyController: controller } }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  const result = await colony.exploreAt({ x: 100, y: 70, z: 100 }, 90)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.name, 'explorador_01')
  assert.equal(result.radius, 90)
  assert.deepEqual(tasks[0], {
    type: 'explorar',
    center: { x: 100, y: 70, z: 100 },
    radius: 90
  })
})


test('StateStore persiste a dimensão da base', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'minecraft-mbot-base-dim-'))
  const file = path.join(dir, 'state.json')
  const store = new StateStore(file)

  await store.save({
    home: { x: 0, y: 64, z: 0 },
    homeDimension: 'overworld'
  })

  const loaded = await store.load()
  assert.equal(loaded.homeDimension, 'overworld')
  await fs.promises.rm(dir, { recursive: true, force: true })
})
