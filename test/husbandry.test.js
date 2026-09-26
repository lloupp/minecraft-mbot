const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const husbandry = require('../lib/husbandry')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')

const silent = { log: () => {} }

function fakeBot({ species = 'cow', animalCount = 2, items = [] } = {}) {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: {
      items: () => items
    },
    pathfinder: {
      goto: async () => {}
    },
    equipped: [],
    activated: [],
    equip: async (item, dest) => {
      bot.equipped.push([item.name, dest])
    },
    activateEntity: async (entity) => {
      bot.activated.push(entity.name)
    }
  }
  for (let i = 0; i < animalCount; i++) {
    bot.entities[i + 1] = {
      id: i + 1,
      name: species,
      isValid: true,
      position: new Vec3(i + 2, 64, 0)
    }
  }
  return bot
}

test('husbandry normaliza nomes em português', () => {
  assert.equal(husbandry.normalizeSpecies('vaca'), 'cow')
  assert.equal(husbandry.normalizeSpecies('ovelhas'), 'sheep')
  assert.equal(husbandry.normalizeSpecies('porcos'), 'pig')
  assert.equal(husbandry.normalizeSpecies('dragao'), null)
})

test('husbandry conta animais suportados próximos', () => {
  const bot = fakeBot({ species: 'cow', animalCount: 3 })
  bot.entities[10] = { id: 10, name: 'zombie', isValid: true, position: new Vec3(2, 64, 2) }
  assert.deepEqual(husbandry.counts(bot, 24), { cow: 3 })
})

test('husbandry alimenta um par de vacas com trigo', async () => {
  const wheat = { name: 'wheat', count: 2, type: 1 }
  const bot = fakeBot({ species: 'cow', animalCount: 2, items: [wheat] })

  const result = await husbandry.breed(bot, 'vaca', 1)

  assert.equal(result.ok, true)
  assert.equal(result.fed, 2)
  assert.equal(result.pairsAttempted, 1)
  assert.deepEqual(bot.activated, ['cow', 'cow'])
  assert.equal(bot.equipped.length, 2)
})

test('husbandry informa falta de alimento adequado', async () => {
  const bot = fakeBot({ species: 'pig', animalCount: 2, items: [] })
  const result = await husbandry.breed(bot, 'porco', 1)

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sem_alimento')
  assert.deepEqual(result.feed, ['carrot', 'potato', 'beetroot'])
})

test('ColonyOrchestrator delega reprodução e tosquia ao fazendeiro', async () => {
  const tasks = []
  const controller = {
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push(task); return { ok: true } }
  }
  const worker = { name: 'fazendeiro_01', role: 'fazendeiro', bot: { colonyController: controller } }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  const breed = await colony.breedAnimals('cow', 2)
  const shear = await colony.shearSheep(3)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(breed.name, 'fazendeiro_01')
  assert.equal(shear.name, 'fazendeiro_01')
  assert.deepEqual(tasks[0], { type: 'reproduzir_animais', species: 'cow', pairs: 2 })
  assert.deepEqual(tasks[1], { type: 'tosquiar', count: 3 })
})
