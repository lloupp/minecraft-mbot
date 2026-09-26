const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { CommandRouter } = require('../core/CommandRouter')
const { MinecraftKnowledge } = require('../core/MinecraftKnowledge')
const { Planner } = require('../core/Planner')
const { BotManager } = require('../core/BotManager')
const { ColonyOrchestrator } = require('../core/ColonyOrchestrator')
const { resolveBlockNames } = require('../core/resources')
const { StorageManager, aggregateItems, isEquipment } = require('../core/StorageManager')
const { ProductionManager, normalizeItemName, recipeIngredients, SMELT_INPUTS } = require('../core/ProductionManager')
const { DemandPlanner, stockMetrics, deficits } = require('../core/DemandPlanner')
const { ProjectManager, PROJECT_DEFINITIONS } = require('../core/ProjectManager')

test('CommandRouter interpreta e despacha comandos', async () => {
  const router = new CommandRouter()
  let received = null
  router.register(['bot', 'bots'], async (_context, args) => { received = args })

  assert.deepEqual(router.parse('!bot criar minerador 2'), {
    command: 'bot',
    args: ['criar', 'minerador', '2']
  })
  assert.equal(await router.dispatch({}, '!bot criar minerador 2'), true)
  assert.deepEqual(received, ['criar', 'minerador', '2'])
  assert.equal(await router.dispatch({}, 'texto comum'), false)
})

test('MinecraftKnowledge encontra itens exatos e parciais', () => {
  const bot = {
    registry: {
      itemsByName: {
        iron_ingot: { id: 1, name: 'iron_ingot', stackSize: 64 },
        iron_pickaxe: { id: 2, name: 'iron_pickaxe', stackSize: 1 }
      },
      blocksByName: {
        iron_ore: { id: 3, name: 'iron_ore' }
      },
      foodsByName: {}
    }
  }
  const knowledge = new MinecraftKnowledge(bot)
  assert.equal(knowledge.resolve('iron ingot').name, 'iron_ingot')
  assert.equal(knowledge.find('pick')[0].name, 'iron_pickaxe')
  assert.equal(knowledge.describe('iron_ore').isBlock, true)
})

test('Planner informa materiais ausentes', () => {
  const bot = {
    registry: {
      itemsByName: { iron_pickaxe: { id: 10, name: 'iron_pickaxe' } },
      blocksByName: {},
      foodsByName: {},
      items: {
        1: { id: 1, name: 'iron_ingot' },
        2: { id: 2, name: 'stick' }
      }
    },
    inventory: {
      items: () => [
        { type: 1, count: 2 },
        { type: 2, count: 2 }
      ]
    },
    recipesAll: () => [{
      result: { id: 10, count: 1 },
      requiresTable: true,
      delta: [
        { id: 1, count: -3 },
        { id: 2, count: -2 },
        { id: 10, count: 1 }
      ]
    }]
  }
  const knowledge = new MinecraftKnowledge(bot)
  const planner = new Planner(bot, knowledge)
  const plan = planner.craftPlan('iron_pickaxe', 1)

  assert.equal(plan.ok, true)
  assert.equal(plan.craftable, false)
  assert.deepEqual(plan.missing, [{ name: 'iron_ingot', needed: 1 }])
  assert.equal(plan.requiresTable, true)
})

test('BotManager respeita o limite total da colônia', async () => {
  const created = []
  const manager = new BotManager({
    maxBots: 3,
    createBot: async ({ name, role }) => {
      const bot = new EventEmitter()
      bot.quit = () => bot.emit('end')
      created.push({ name, role, bot })
      return bot
    }
  })

  const workers = await manager.create('minerador', 5)
  assert.equal(workers.length, 2)
  assert.equal(manager.list().length, 2)
  await assert.rejects(() => manager.create('lenhador', 1), /limite da colônia/)
  assert.equal(manager.remove(workers[0].name), true)
  assert.equal(manager.list().length, 1)
})


test('BotManager aceita nomes plurais das profissões', () => {
  const manager = new BotManager({ createBot: async () => new EventEmitter() })
  assert.equal(manager.normalizeRole('mineradores'), 'minerador')
  assert.equal(manager.normalizeRole('lenhadores'), 'lenhador')
  assert.equal(manager.normalizeRole('construtores'), 'construtor')
})

test('resources resolve madeira e minérios conhecidos', () => {
  const bot = {
    registry: {
      blocksArray: [
        { name: 'oak_log' },
        { name: 'spruce_log' },
        { name: 'stone' },
        { name: 'iron_ore' },
        { name: 'deepslate_iron_ore' }
      ],
      blocksByName: {
        oak_log: { id: 1 },
        spruce_log: { id: 2 },
        stone: { id: 3 },
        iron_ore: { id: 4 },
        deepslate_iron_ore: { id: 5 }
      }
    }
  }
  assert.deepEqual(resolveBlockNames(bot, 'madeira', 'lenhador'), ['oak_log', 'spruce_log'])
  assert.deepEqual(resolveBlockNames(bot, 'ferro', 'minerador'), ['iron_ore', 'deepslate_iron_ore'])
})

test('ColonyOrchestrator divide uma ordem entre trabalhadores da profissão', async () => {
  const received = []
  const fakeController = (name) => ({
    state: 'ocioso',
    currentTask: null,
    isIdle: () => true,
    cancel: () => {},
    run: async (task) => { received.push({ name, task }); return { ok: true } }
  })
  const workers = new Map([
    ['minerador_01', { name: 'minerador_01', role: 'minerador', bot: { colonyController: fakeController('minerador_01') } }],
    ['minerador_02', { name: 'minerador_02', role: 'minerador', bot: { colonyController: fakeController('minerador_02') } }]
  ])
  const manager = {
    workers,
    normalizeRole: (role) => role.startsWith('minerador') ? 'minerador' : null
  }
  const colony = new ColonyOrchestrator({ botManager: manager, homeProvider: () => null, ownerProvider: () => null })
  const assigned = await colony.assign('mineradores', 'ferro', 5)

  assert.equal(assigned.length, 2)
  assert.equal(assigned[0].task.count + assigned[1].task.count, 5)
  assert.equal(assigned.every((entry) => entry.task.type === 'coletar_blocos'), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(received.length, 2)
})

test('DemandPlanner mede estoque e prioriza necessidades', () => {
  const metrics = stockMetrics({
    bread: 10,
    oak_log: 20,
    coal: 4,
    raw_iron: 5,
    iron_ingot: 2,
    cobblestone: 30
  })
  assert.equal(metrics.food, 10)
  assert.equal(metrics.wood, 20)
  assert.equal(metrics.fuel, 4)
  assert.equal(metrics.ironTotal, 7)

  const missing = deficits(metrics)
  assert.equal(missing.food, 22)
  assert.equal(missing.wood, 44)
  assert.equal(missing.fuel, 20)
})

test('DemandPlanner distribui trabalho conforme falta no estoque', () => {
  const planner = new DemandPlanner()
  const controller = () => ({ isIdle: () => true })
  const workers = [
    { worker: { name: 'minerador_01', role: 'minerador' }, controller: controller() },
    { worker: { name: 'lenhador_01', role: 'lenhador' }, controller: controller() },
    { worker: { name: 'fazendeiro_01', role: 'fazendeiro' }, controller: controller() }
  ]

  const result = planner.buildPlan(workers, {})
  assert.equal(result.plan.length, 3)
  assert.equal(result.plan.find((x) => x.worker.role === 'minerador').task.resource, 'carvao')
  assert.equal(result.plan.find((x) => x.worker.role === 'lenhador').task.resource, 'madeira')
  assert.equal(result.plan.find((x) => x.worker.role === 'fazendeiro').task.resource, 'comida')
})

test('DemandPlanner manda artesao converter ferro bruto quando necessário', () => {
  const planner = new DemandPlanner()
  const workers = [{
    worker: { name: 'artesao_01', role: 'artesao' },
    controller: { isIdle: () => true }
  }]
  const { plan } = planner.buildPlan(workers, {
    raw_iron: 8,
    coal: 24,
    oak_log: 64,
    bread: 32,
    cobblestone: 64
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].task.type, 'fabricar')
  assert.equal(plan[0].task.item, 'iron_ingot')
})

test('ColonyOrchestrator exige base, estoque e planejador para auto', () => {
  const manager = { workers: new Map(), normalizeRole: (role) => role }
  const colony = new ColonyOrchestrator({
    botManager: manager,
    homeProvider: () => null,
    storage: { configured: () => false },
    demandPlanner: null
  })
  assert.deepEqual(colony.autoReadiness(), {
    ready: false,
    missing: ['base', 'estoque', 'planejador']
  })
})

test('ColonyOrchestrator automático usa plano de demanda com snapshot fresco', async () => {
  const tasks = []
  const worker = {
    name: 'lenhador_01',
    role: 'lenhador',
    bot: {
      colonyController: {
        state: 'ocioso',
        currentTask: null,
        isIdle: () => true,
        run: async (task) => { tasks.push(task); return { ok: true } }
      }
    }
  }
  const manager = {
    workers: new Map([[worker.name, worker]]),
    normalizeRole: (role) => role
  }
  const storage = {
    configured: () => true,
    snapshotFresh: () => true,
    cachedSummary: () => ({})
  }
  const planner = new DemandPlanner()
  const colony = new ColonyOrchestrator({
    botManager: manager,
    homeProvider: () => ({ x: 0, y: 64, z: 0 }),
    storage,
    demandPlanner: planner
  })
  colony.setAuto(true)
  await colony.tick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].resource, 'madeira')
})

test('StorageManager agrega estoque e preserva equipamento', () => {
  assert.deepEqual(aggregateItems([
    { name: 'raw_iron', count: 3 },
    { name: 'raw_iron', count: 2 },
    { name: 'coal', count: 4 }
  ]), { raw_iron: 5, coal: 4 })
  assert.equal(isEquipment('iron_pickaxe'), true)
  assert.equal(isEquipment('oak_log'), false)
})

test('StorageManager guarda e recupera posição do estoque', () => {
  const storage = new StorageManager()
  assert.equal(storage.configured(), false)
  storage.setPosition({ x: 10.9, y: 64.2, z: -4.1 })
  assert.deepEqual(storage.getPosition(), { x: 10, y: 64, z: -5 })
  assert.equal(storage.configured(), true)
})

test('ProductionManager normaliza aliases e ingredientes', () => {
  assert.equal(normalizeItemName('picareta ferro'), 'iron_pickaxe')
  assert.equal(normalizeItemName('baú'), 'chest')
  assert.deepEqual(recipeIngredients({
    delta: [
      { id: 1, count: -3 },
      { id: 2, count: -2 },
      { id: 10, count: 1 }
    ]
  }, 2), [
    { id: 1, metadata: null, count: 6 },
    { id: 2, metadata: null, count: 4 }
  ])
  assert.deepEqual(SMELT_INPUTS.iron_ingot.slice(0, 1), ['raw_iron'])
})

test('BotManager aceita papel artesao', () => {
  const manager = new BotManager({ createBot: async () => new EventEmitter() })
  assert.equal(manager.normalizeRole('artesao'), 'artesao')
  assert.equal(manager.normalizeRole('artesaos'), 'artesao')
})

test('ColonyOrchestrator cria tarefa de fabricação para artesao', () => {
  const manager = {
    workers: new Map(),
    normalizeRole: (role) => role === 'artesao' ? 'artesao' : null
  }
  const colony = new ColonyOrchestrator({ botManager: manager })
  assert.deepEqual(colony.taskFor('artesao', 'iron_pickaxe', 2), {
    type: 'fabricar',
    item: 'iron_pickaxe',
    count: 2
  })
})

test('ProductionManager conta inventário por id', () => {
  const production = new ProductionManager({ storage: null })
  const bot = {
    inventory: {
      items: () => [
        { type: 1, metadata: 0, count: 2 },
        { type: 1, metadata: 0, count: 3 },
        { type: 2, metadata: 0, count: 9 }
      ]
    }
  }
  assert.equal(production.inventoryCount(bot, 1, null), 5)
  assert.equal(production.inventoryCount(bot, 2, null), 9)
})


test('StorageManager snapshot cache pode ser atualizado sem abrir container', () => {
  const storage = new StorageManager()
  storage.updateSnapshot([
    { name: 'coal', count: 3 },
    { name: 'coal', count: 2 },
    { name: 'oak_log', count: 7 }
  ])
  assert.deepEqual(storage.cachedSummary(), { coal: 5, oak_log: 7 })
  assert.equal(storage.snapshotFresh(1000), true)
})


test('DemandPlanner não fabrica ferramenta com apenas uma tábua', () => {
  const planner = new DemandPlanner()
  const workers = [{
    worker: { name: 'artesao_01', role: 'artesao' },
    controller: { isIdle: () => true }
  }]
  const { plan } = planner.buildPlan(workers, {
    bread: 32,
    coal: 24,
    iron_ingot: 12,
    cobblestone: 64,
    oak_planks: 1
  })
  assert.equal(plan.length, 0)
})

test('DemandPlanner contabiliza alimentos crus utilizáveis', () => {
  const metrics = stockMetrics({ beef: 6, porkchop: 4, carrot: 2 })
  assert.equal(metrics.food, 12)
})


test('DemandPlanner aplica metas adicionais de projeto', () => {
  const planner = new DemandPlanner()
  const report = planner.report({ bread: 40 }, { food: 100, wood: 200 })
  assert.equal(report.targets.food, 100)
  assert.equal(report.targets.wood, 200)
  assert.equal(report.deficits.food, 60)
  assert.equal(report.deficits.wood, 200)
})

test('ProjectManager exige base e estoque', () => {
  const manager = new ProjectManager({
    storage: { configured: () => false },
    homeProvider: () => null
  })
  assert.throws(() => manager.start('casa'), /defina a base/)
})

test('ProjectManager inicia vila com workforce e ações previstas', () => {
  const manager = new ProjectManager({
    storage: { configured: () => true },
    homeProvider: () => ({ x: 0, y: 64, z: 0 })
  })
  const status = manager.start('vila')
  assert.equal(status.type, 'vila')
  assert.equal(status.status, 'ativo')
  assert.equal(status.actions.length, 3)
  assert.equal(status.requiredRoles.minerador, 2)
  assert.equal(status.requiredRoles.construtor, 1)
  assert.equal(PROJECT_DEFINITIONS.vila.targets.building, 256)
})

test('ProjectManager agenda construção apenas após metas atendidas', () => {
  const manager = new ProjectManager({
    storage: { configured: () => true },
    homeProvider: () => ({ x: 0, y: 64, z: 0 })
  })
  manager.start('casa')

  const worker = {
    worker: { name: 'construtor_01', role: 'construtor' },
    controller: { isIdle: () => true }
  }

  assert.deepEqual(manager.planActions([worker], {
    deficits: { food: 1 }
  }), [])

  const plan = manager.planActions([worker], {
    deficits: {
      food: 0, wood: 0, fuel: 0, ironTotal: 0, ironIngot: 0,
      building: 0, ironPickaxe: 0, ironAxe: 0, ironSword: 0
    }
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].task.type, 'construir_casa')
  assert.deepEqual(plan[0].task.offset, { x: 5, z: 2 })
})

test('ProjectManager conclui projeto após obra e metas', () => {
  const manager = new ProjectManager({
    storage: { configured: () => true },
    homeProvider: () => ({ x: 0, y: 64, z: 0 })
  })
  manager.start('casa')
  const worker = {
    worker: { name: 'construtor_01', role: 'construtor' },
    controller: { isIdle: () => true }
  }
  const report = {
    deficits: {
      food: 0, wood: 0, fuel: 0, ironTotal: 0, ironIngot: 0,
      building: 0, ironPickaxe: 0, ironAxe: 0, ironSword: 0
    }
  }
  const plan = manager.planActions([worker], report)
  manager.completeAction(plan[0].task.projectActionId, { ok: true })
  assert.equal(manager.maybeComplete(report), true)
  assert.equal(manager.status().status, 'concluido')
  assert.deepEqual(manager.targets(), {})
})

test('StorageManager retira materiais de construção mistos', async () => {
  const storage = new StorageManager()
  const items = [
    { name: 'cobblestone', type: 1, count: 10 },
    { name: 'oak_planks', type: 2, count: 13 }
  ]
  const container = {
    containerItems: () => items.filter((item) => item.count > 0),
    withdraw: async (type, _metadata, amount) => {
      const item = items.find((entry) => entry.type === type)
      item.count -= amount
    }
  }
  storage.withContainer = async (_bot, fn) => fn(container)

  const result = await storage.withdrawBuildingMaterial({}, 23)
  assert.equal(result.complete, true)
  assert.equal(result.withdrawn, 23)
  assert.deepEqual(result.items, { cobblestone: 10, oak_planks: 13 })
})
