const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const animalProducts = require('../lib/animalProducts')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')

const silent = { log: () => {} }

test('animalProducts normaliza aliases em português', () => {
  assert.equal(animalProducts.normalizeProduct('lã'), 'wool')
  assert.equal(animalProducts.normalizeProduct('la'), 'wool')
  assert.equal(animalProducts.normalizeProduct('leite'), 'milk')
  assert.equal(animalProducts.normalizeProduct('ovos'), 'eggs')
  assert.equal(animalProducts.normalizeProduct('carne'), null)
})

test('milkCows transforma baldes vazios em baldes de leite', async () => {
  const items = [
    { name: 'bucket', count: 2, type: 1 }
  ]
  const cow = {
    id: 1,
    name: 'cow',
    isValid: true,
    metadata: { 16: false },
    position: new Vec3(1, 64, 0)
  }

  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: { 1: cow },
    inventory: {
      items: () => items.filter((item) => item.count > 0)
    },
    equip: async () => {},
    activateEntity: async () => {
      const bucket = items.find((item) => item.name === 'bucket')
      bucket.count--
      let milk = items.find((item) => item.name === 'milk_bucket')
      if (!milk) {
        milk = { name: 'milk_bucket', count: 0, type: 2 }
        items.push(milk)
      }
      milk.count++
    }
  }

  const result = await animalProducts.milkCows(bot, 2)

  assert.equal(result.ok, true)
  assert.equal(result.produced, 2)
  assert.equal(animalProducts.itemCount(bot, 'bucket'), 0)
  assert.equal(animalProducts.itemCount(bot, 'milk_bucket'), 2)
})

test('milkCows ignora filhotes', async () => {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      1: {
        id: 1,
        name: 'cow',
        isValid: true,
        metadata: { 16: true },
        position: new Vec3(1, 64, 0)
      }
    },
    inventory: { items: () => [{ name: 'bucket', count: 1, type: 1 }] }
  }

  const result = await animalProducts.milkCows(bot, 1)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sem_vacas_adultas')
})

test('woolCount soma todas as cores de lã', () => {
  const bot = {
    inventory: {
      items: () => [
        { name: 'white_wool', count: 3 },
        { name: 'black_wool', count: 2 },
        { name: 'wheat', count: 20 }
      ]
    }
  }
  assert.equal(animalProducts.woolCount(bot), 5)
})

test('ColonyOrchestrator delega produto animal ao fazendeiro', async () => {
  const tasks = []
  const controller = {
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push(task); return { ok: true } }
  }
  const worker = {
    name: 'fazendeiro_01',
    role: 'fazendeiro',
    bot: { colonyController: controller }
  }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  const result = await colony.collectAnimalProduct('milk', 3)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.name, 'fazendeiro_01')
  assert.deepEqual(tasks[0], {
    type: 'produto_animal',
    product: 'milk',
    count: 3
  })
})


test('ColonyOrchestrator limita leite e ignora quantidade em ovos', async () => {
  const tasks = []
  const controller = {
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push(task); return { ok: true } }
  }
  const worker = {
    name: 'fazendeiro_01',
    role: 'fazendeiro',
    bot: { colonyController: controller }
  }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  const milk = await colony.collectAnimalProduct('milk', 99)
  const eggs = await colony.collectAnimalProduct('eggs', 99)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(milk.count, 16)
  assert.equal(eggs.count, 1)
  assert.equal(tasks[0].count, 16)
  assert.equal(tasks[1].count, 1)
})
