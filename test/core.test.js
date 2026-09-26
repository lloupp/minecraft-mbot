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

test('ColonyOrchestrator modo automático só envia tarefa para ocioso', async () => {
  const tasks = []
  const workers = new Map([
    ['lenhador_01', {
      name: 'lenhador_01',
      role: 'lenhador',
      bot: { colonyController: {
        state: 'ocioso',
        currentTask: null,
        isIdle: () => true,
        run: async (task) => { tasks.push(task); return { ok: true } }
      } }
    }],
    ['minerador_01', {
      name: 'minerador_01',
      role: 'minerador',
      bot: { colonyController: {
        state: 'trabalhando',
        currentTask: { type: 'coletar_blocos' },
        isIdle: () => false,
        run: async (task) => { tasks.push(task); return { ok: true } }
      } }
    }]
  ])
  const manager = { workers, normalizeRole: (role) => role }
  const colony = new ColonyOrchestrator({ botManager: manager })
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
