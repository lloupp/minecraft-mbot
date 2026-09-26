const test = require('node:test')
const assert = require('node:assert/strict')

const { animalPenPlan, SPECIES_OFFSETS } = require('../core/AnimalPen')
const husbandry = require('../lib/husbandry')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')

const silent = { log: () => {} }

test('animalPenPlan cria curral 7x7 com 23 cercas e um portão', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  assert.equal(plan.size, 7)
  assert.equal(plan.fenceCount, 23)
  assert.equal(plan.gateCount, 1)
  assert.equal(plan.fences.length, 23)
  assert.deepEqual(plan.gate, { x: 15, y: 64, z: 8 })
  assert.deepEqual(plan.center, { x: 15, y: 64, z: 11 })
})

test('animalPenPlan separa espécies em offsets diferentes', () => {
  const home = { x: 100, y: 70, z: -20 }
  const cow = animalPenPlan(home, 'cow')
  const sheep = animalPenPlan(home, 'sheep')
  const pig = animalPenPlan(home, 'pig')

  assert.notDeepEqual(cow.origin, sheep.origin)
  assert.notDeepEqual(cow.origin, pig.origin)
  assert.deepEqual(cow.offset, SPECIES_OFFSETS.cow)
  assert.deepEqual(sheep.offset, SPECIES_OFFSETS.sheep)
})

test('populationPlan não reproduz quando meta já foi alcançada', () => {
  assert.deepEqual(husbandry.populationPlan(8, 6, 8), {
    current: 8,
    target: 6,
    deficit: 0,
    pairs: 0
  })
})

test('populationPlan limita pares pela população disponível e pelo déficit', () => {
  assert.deepEqual(husbandry.populationPlan(4, 8, 4), {
    current: 4,
    target: 8,
    deficit: 4,
    pairs: 2
  })
  assert.deepEqual(husbandry.populationPlan(10, 20, 10), {
    current: 10,
    target: 20,
    deficit: 10,
    pairs: 5
  })
})

test('ColonyOrchestrator delega curral ao construtor e manejo ao fazendeiro', async () => {
  const tasks = []
  const controller = (name) => ({
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    run: async (task) => { tasks.push({ name, task }); return { ok: true } }
  })

  const builder = {
    name: 'construtor_01',
    role: 'construtor',
    bot: { colonyController: controller('construtor_01') }
  }
  const farmer = {
    name: 'fazendeiro_01',
    role: 'fazendeiro',
    bot: { colonyController: controller('fazendeiro_01') }
  }
  const workers = new Map([[builder.name, builder], [farmer.name, farmer]])
  const manager = {
    workers,
    normalizeRole: (role) => role
  }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })

  const pen = await colony.buildAnimalPen('cow')
  const population = await colony.manageAnimalPopulation('cow', 8)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(pen.name, 'construtor_01')
  assert.equal(population.name, 'fazendeiro_01')
  assert.deepEqual(tasks[0].task, { type: 'construir_curral', species: 'cow', offset: null })
  assert.deepEqual(tasks[1].task, { type: 'manejar_populacao', species: 'cow', target: 8 })
})
