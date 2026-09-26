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


test('husbandry prefere alimento com quantidade suficiente entre alternativas', async () => {
  const carrot = { name: 'carrot', count: 1, type: 1 }
  const potato = { name: 'potato', count: 2, type: 2 }
  const bot = fakeBot({ species: 'pig', animalCount: 2, items: [carrot, potato] })

  const result = await husbandry.breed(bot, 'porco', 1)

  assert.equal(result.ok, true)
  assert.equal(result.feed, 'potato')
  assert.equal(bot.equipped[0][0], 'potato')
})


test('selectAnimals permite limitar por centro e filtro de curral', () => {
  const bot = fakeBot({ species: 'cow', animalCount: 0 })
  bot.entities = {
    1: { id: 1, name: 'cow', isValid: true, position: new Vec3(2, 64, 2) },
    2: { id: 2, name: 'cow', isValid: true, position: new Vec3(6, 64, 2) },
    3: { id: 3, name: 'sheep', isValid: true, position: new Vec3(2, 64, 2) }
  }
  const center = new Vec3(0, 64, 0)
  const selected = husbandry.selectAnimals(bot, 'cow', {
    center,
    range: 10,
    filter: (entity) => entity.position.x < 5
  })

  assert.deepEqual(selected.map((entry) => entry.id), [1])
})

test('managePopulation usa somente animais aprovados pelo filtro', async () => {
  const wheat = { name: 'wheat', count: 4, type: 1 }
  const bot = fakeBot({ species: 'cow', animalCount: 4, items: [wheat] })
  const result = await husbandry.managePopulation(bot, 'cow', 4, () => false, {
    center: new Vec3(0, 64, 0),
    range: 32,
    filter: (entity) => entity.id <= 2
  })

  assert.equal(result.current, 2)
  assert.equal(result.target, 4)
  assert.equal(result.plannedPairs, 1)
})

test('husbandry lê o índice do metadado baby do minecraft-data 1.20.1', () => {
  const registry = require('minecraft-data')('1.20.1')
  assert.equal(registry.entitiesByName.cow.metadataKeys.indexOf('baby'), 16)
  assert.equal(registry.entitiesByName.llama.metadataKeys.indexOf('flags'), 17)

  const bot = { registry }
  assert.equal(husbandry.isBaby(bot, { name: 'cow', metadata: { 16: true } }), true)
  assert.equal(husbandry.isBaby(bot, { name: 'cow', metadata: { 16: false } }), false)
  assert.equal(husbandry.isBaby(bot, { name: 'cow' }), false)
})

test('husbandry não alimenta filhotes e não conta filhotes como pares', async () => {
  const wheat = { name: 'wheat', count: 8, type: 1 }
  const bot = fakeBot({ species: 'cow', animalCount: 4, items: [wheat] })
  bot.entities[3].metadata = { 16: true }
  bot.entities[4].metadata = { 16: true }

  const plan = await husbandry.managePopulation(bot, 'cow', 8)
  assert.equal(plan.current, 4)
  assert.equal(plan.plannedPairs, 1)
  assert.equal(plan.fed, 2)
  assert.deepEqual(bot.activated, ['cow', 'cow'])
})

test('husbandry respeita o cooldown de 5 minutos após alimentar', async () => {
  const wheat = { name: 'wheat', count: 8, type: 1 }
  const bot = fakeBot({ species: 'cow', animalCount: 2, items: [wheat] })

  const first = await husbandry.breed(bot, 'cow', 1)
  assert.equal(first.fed, 2)

  const second = await husbandry.breed(bot, 'cow', 1)
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'poucos_animais')
  assert.equal(bot.activated.length, 2)

  const later = Date.now() + husbandry.FEED_COOLDOWN_MS + 1
  assert.equal(husbandry.canBreed(bot, bot.entities[1], later), true)
})

test('husbandry só procria lhamas domadas', async () => {
  const hay = { name: 'hay_block', count: 4, type: 1 }
  const bot = fakeBot({ species: 'llama', animalCount: 2, items: [hay] })

  const wild = await husbandry.breed(bot, 'lhama', 1)
  assert.equal(wild.ok, false)
  assert.equal(wild.reason, 'poucos_animais')

  bot.entities[1].metadata = { 17: 0x02 }
  bot.entities[2].metadata = { 17: 0x02 | 0x04 }
  const tamed = await husbandry.breed(bot, 'lhama', 1)
  assert.equal(tamed.ok, true)
  assert.equal(tamed.fed, 2)
})

test('husbandry não gasta ração com animal sem par', async () => {
  const wheat = { name: 'wheat', count: 8, type: 1 }
  const bot = fakeBot({ species: 'cow', animalCount: 3, items: [wheat] })
  const result = await husbandry.breed(bot, 'cow', 2)
  assert.equal(result.fed, 2)
})
