const test = require('node:test')
const assert = require('node:assert/strict')

const { Vec3 } = require('vec3')
const { animalPenPlan, SPECIES_OFFSETS, pointInsidePen, inspectAnimalPen } = require('../core/AnimalPen')
const husbandry = require('../lib/husbandry')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')

const silent = { log: () => {} }

test('animalPenPlan cria curral 7x7 com 23 cercas e um portão', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  assert.equal(plan.size, 7)
  assert.equal(plan.fenceCount, 23)
  assert.equal(plan.gateCount, 1)
  assert.equal(plan.fences.length, 23)
  assert.deepEqual(plan.gate, { x: 23, y: 64, z: 8 })
  assert.deepEqual(plan.center, { x: 23, y: 64, z: 11 })
})

test('animalPenPlan deixa livre o acesso ao portão de todos os currais', () => {
  const home = { x: 0, y: 64, z: 0 }
  const plans = Object.keys(SPECIES_OFFSETS).map((species) => animalPenPlan(home, species))
  const fences = new Set(plans.flatMap((plan) => [...plan.fences, plan.gate].map((p) => `${p.x},${p.z}`)))
  for (const plan of plans) {
    // Os dois blocos entre o portão e o ponto de espera (e ele mesmo) ficam vazios.
    for (let dz = 1; dz <= 2; dz++) {
      assert.equal(fences.has(`${plan.gate.x},${plan.gate.z - dz}`), false, `${plan.species} dz=${dz}`)
    }
  }
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


test('pointInsidePen distingue interior, borda e exterior', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  assert.equal(pointInsidePen(new Vec3(23, 64, 11), plan), true)
  assert.equal(pointInsidePen(new Vec3(20, 64, 8), plan), false)
  assert.equal(pointInsidePen(new Vec3(30, 64, 30), plan), false)
})

test('pointInsidePen tem limites simétricos e confere a altura', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow') // origem x=20, z=8
  assert.equal(pointInsidePen(new Vec3(20.5, 64, 11.5), plan), false) // cerca oeste
  assert.equal(pointInsidePen(new Vec3(26.5, 64, 11.5), plan), false) // cerca leste
  assert.equal(pointInsidePen(new Vec3(23.5, 64, 8.5), plan), false) // portão
  assert.equal(pointInsidePen(new Vec3(21.3, 64, 11.5), plan), true)
  assert.equal(pointInsidePen(new Vec3(25.7, 64, 11.5), plan), true)
  assert.equal(pointInsidePen(new Vec3(23.5, 58, 11.5), plan), false) // túnel embaixo
})

test('inspectAnimalPen trata chunk não carregado como desconhecido', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  const status = inspectAnimalPen({ blockAt: () => null }, plan)
  assert.equal(status.unknown, true)
  assert.equal(status.built, false)

  const farmer = {
    name: 'fazendeiro_01',
    role: 'fazendeiro',
    bot: { colonyController: { isIdle: () => true, penPopulation: () => ({ built: false, inside: 0, status }) } }
  }
  const colony = new ColonyOrchestrator({
    botManager: { workers: new Map([[farmer.name, farmer]]), normalizeRole: (role) => role },
    logger: silent
  })
  colony.setAnimalTarget('cow', 6)
  assert.deepEqual(colony.buildAnimalPlan(colony.controllers()), [])
})

test('ColonyOrchestrator dobra a espera a cada falha seguida no manejo', async () => {
  let outcome = { ok: false }
  const farmer = {
    name: 'fazendeiro_01',
    role: 'fazendeiro',
    bot: { colonyController: { run: async () => outcome } }
  }
  const colony = new ColonyOrchestrator({
    botManager: { workers: new Map([[farmer.name, farmer]]), normalizeRole: (role) => role },
    logger: silent
  })
  const task = { type: 'capturar_animais', species: 'cow', count: 1 }
  const waitFor = async () => {
    const before = Date.now()
    colony.runAuto(farmer, farmer.bot.colonyController, task)
    await new Promise((resolve) => setImmediate(resolve))
    return Math.round((colony.animalBackoff.get('cow') - before) / 1000)
  }

  assert.equal(await waitFor(), 30)
  assert.equal(await waitFor(), 60)
  assert.equal(await waitFor(), 120)
  outcome = { ok: true }
  await waitFor()
  assert.equal(colony.animalFailures.has('cow'), false)
})

test('restoreAnimalTargets guarda só espécies válidas, no nome canônico', () => {
  const colony = new ColonyOrchestrator({ botManager: { workers: new Map() }, logger: silent })
  const restored = colony.restoreAnimalTargets({ vaca: 6, dragao: 4, Ovelhas: '3' })
  assert.deepEqual(restored, { cow: 6, sheep: 3 })
})

test('inspectAnimalPen exige todas as cercas e um portão', () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  const blocks = new Map()
  for (const point of plan.fences) {
    blocks.set(new Vec3(point.x, point.y, point.z).toString(), {
      name: 'oak_fence',
      getProperties: () => ({})
    })
  }
  blocks.set(new Vec3(plan.gate.x, plan.gate.y, plan.gate.z).toString(), {
    name: 'oak_fence_gate',
    getProperties: () => ({ open: false })
  })
  const bot = { blockAt: (pos) => blocks.get(pos.toString()) || { name: 'air' } }

  const complete = inspectAnimalPen(bot, plan)
  assert.equal(complete.built, true)
  assert.equal(complete.gateOpen, false)

  blocks.delete(new Vec3(plan.fences[0].x, plan.fences[0].y, plan.fences[0].z).toString())
  const incomplete = inspectAnimalPen(bot, plan)
  assert.equal(incomplete.built, false)
  assert.equal(incomplete.fencesPresent, plan.fenceCount - 1)
})

test('ColonyOrchestrator delega captura ao fazendeiro', async () => {
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

  const result = await colony.captureAnimals('cow', 3)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.name, 'fazendeiro_01')
  assert.equal(result.count, 3)
  assert.deepEqual(tasks[0], { type: 'capturar_animais', species: 'cow', count: 3 })
})

test('curral usa o chão do local, não a altura da base', () => {
  const { penGroundY, animalPenPlan } = require('../core/AnimalPen')
  const home = { x: 0, y: 96, z: 0 } // base 1 bloco acima do chão do curral
  const fences = new Set()
  const blockAt = (p) => {
    if (fences.has(`${p.x},${p.y},${p.z}`)) return { name: 'oak_fence', boundingBox: 'block' }
    if (p.y === 99 && p.x === 13) return { name: 'oak_leaves', boundingBox: 'block' } // copa de árvore
    return p.y <= 94 ? { name: 'grass_block', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
  }
  assert.equal(penGroundY(blockAt, home, 'cow'), 95)

  // Com as cercas já no lugar, o nível continua o mesmo (inspeção e portão batem).
  for (const f of animalPenPlan({ ...home, y: 95 }, 'cow').fences) fences.add(`${f.x},${f.y},${f.z}`)
  assert.equal(penGroundY(blockAt, home, 'cow'), 95)
})

test('ColonyOrchestrator não manda dois fazendeiros para a mesma espécie', async () => {
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const farmer = (name) => ({
    name,
    role: 'fazendeiro',
    bot: {
      colonyController: {
        isIdle: () => true,
        penPopulation: () => ({ built: true, inside: 4 }),
        run: () => pending
      }
    }
  })
  const a = farmer('fazendeiro_01')
  const b = farmer('fazendeiro_02')
  const manager = { workers: new Map([[a.name, a], [b.name, b]]), normalizeRole: (role) => role }
  const colony = new ColonyOrchestrator({ botManager: manager, logger: silent })
  colony.setAnimalTarget('cow', 8)

  const first = colony.buildAnimalPlan(colony.controllers())
  assert.equal(first.length, 1)
  colony.runAuto(first[0].worker, first[0].controller, first[0].task)

  // Tick seguinte, antes da tarefa terminar: o outro fazendeiro não pega vaca.
  const eligible = colony.controllers().filter(({ worker }) => worker.name !== first[0].worker.name)
  assert.deepEqual(colony.buildAnimalPlan(eligible), [])

  finish({ ok: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(colony.animalInFlight.has('cow'), false)
  assert.equal(colony.animalBackoff.has('cow'), true)
})
