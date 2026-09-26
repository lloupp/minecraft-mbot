const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')

const { WorkerController, protectPenBlocks } = require('../core/WorkerController')
const { animalPenPlan, pointInsidePen } = require('../core/AnimalPen')
const { StorageManager } = require('../core/StorageManager')

const silent = { log: () => {} }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Bot falso com o mínimo que WorkerController, gather e combat usam.
function fakeBot({ blocks = {}, entities = {} } = {}) {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 64, 0) }
  bot.health = 20
  bot.food = 20
  bot.entities = entities
  bot.inventory = { items: () => [] }
  bot.registry = {
    blocksArray: [{ id: 1, name: 'iron_ore' }, { id: 2, name: 'deepslate_iron_ore' }],
    blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } }
  }
  bot.blockAt = (pos) => ({ name: blocks[pos.toString()] || 'air', position: pos })
  bot.findBlocks = () => Object.entries(blocks)
    .filter(([, name]) => name !== 'air')
    .map(([key]) => new Vec3(...key.slice(1, -1).split(',').map(Number)))
  bot.nearestEntity = (match) => Object.values(bot.entities).find(match) || null
  bot.dig = async (block) => { blocks[block.position.toString()] = 'air' }
  bot.equip = async () => {}
  bot.pathfinder = {
    goal: null,
    goals: [],
    setMovements: () => {},
    setGoal (goal) { this.goal = goal; if (goal) this.goals.push(goal) },
    goto: async () => {},
    bestHarvestTool: () => null
  }
  return bot
}

function readyWorker(bot, extra = {}) {
  const worker = new WorkerController({ bot, name: 'minerador_01', role: 'minerador', logger: silent, ...extra })
  worker.workMoves = {}
  worker.state = 'ocioso'
  return worker
}

test('WorkerController pula bloco inalcançável e minera o próximo', async () => {
  const unreachable = new Vec3(10, 60, 0)
  const reachable = new Vec3(3, 63, 0)
  const bot = fakeBot({
    blocks: { [unreachable.toString()]: 'iron_ore', [reachable.toString()]: 'iron_ore' }
  })
  bot.pathfinder.goto = async (goal) => {
    if (goal.x === unreachable.x) throw new Error('sem caminho')
  }
  const worker = readyWorker(bot)

  const result = await worker.run({ type: 'coletar_blocos', resource: 'ferro', count: 1 })
  assert.equal(result.gathered, 1)
  assert.equal(bot.blockAt(reachable).name, 'air')
  assert.equal(bot.blockAt(unreachable).name, 'iron_ore')
})

test('WorkerController interrompe a tarefa e foge ao apanhar de creeper', async () => {
  const creeper = { name: 'creeper', type: 'hostile', isValid: true, position: new Vec3(2, 64, 0) }
  const bot = fakeBot({ entities: { 1: creeper } })
  const worker = readyWorker(bot)
  worker.currentTask = { type: 'coletar_blocos' }
  worker.state = 'trabalhando'

  bot.emit('health')
  bot.health = 15
  bot.emit('entityHurt', bot.entity, creeper)
  bot.emit('health')

  assert.equal(worker.state, 'defendendo')
  assert.equal(worker.currentTask, null)
  assert.equal(worker.isIdle(), false)
  await sleep(10)
  assert.equal(bot.pathfinder.goal?.constructor?.name, 'GoalInvert')

  worker.cancel() // encerra a fuga sem esperar os 4s
  await sleep(250)
  assert.equal(worker.defending, false)
  assert.equal(worker.state, 'ocioso')
})

test('WorkerController come quando tem fome', async () => {
  const bot = fakeBot()
  bot.food = 10
  bot.registry.foodsByName = { bread: { effectiveQuality: 10 } }
  bot.inventory = { items: () => [{ name: 'bread' }] }
  let eaten = 0
  bot.consume = async () => { eaten++ }
  const worker = readyWorker(bot)

  worker.survivalTick()
  worker.survivalTick() // já está comendo: não come duas vezes ao mesmo tempo
  await sleep(0)
  assert.equal(eaten, 1)
})

// Curral de vacas pronto em volta de home, com portão que abre/fecha e um
// pathfinder que "teletransporta" o bot para o objetivo.
function penWorld({ items = [], cows = 2 } = {}) {
  const home = { x: 0, y: 64, z: 0 }
  const plan = animalPenPlan(home, 'cow')
  const blocks = new Map()
  for (const p of plan.fences) blocks.set(new Vec3(p.x, p.y, p.z).toString(), { name: 'oak_fence', getProperties: () => ({}) })
  const gate = { name: 'oak_fence_gate', open: false, getProperties () { return { open: this.open } } }
  blocks.set(new Vec3(plan.gate.x, plan.gate.y, plan.gate.z).toString(), gate)

  const bot = fakeBot()
  bot.blockAt = (pos) => blocks.get(pos.toString()) || { name: 'air', boundingBox: 'empty', position: pos }
  bot.inventory = { items: () => items }
  bot.unequip = async () => {}
  bot.activateBlock = async (block) => { block.open = !block.open }
  bot.activated = []
  bot.activateEntity = async (entity) => { bot.activated.push(entity.id) }
  bot.pathfinder.goto = async (goal) => {
    bot.pathfinder.goals.push(goal)
    if (goal.isEnd?.(bot.entity.position.floored())) return // já está perto
    const target = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
    const toGate = goal.x === plan.gate.x && goal.z === plan.gate.z
    // Cerca fechada: não há caminho entre dentro e fora (e cavar cerca é proibido).
    if (!toGate && !gate.open && pointInsidePen(bot.entity.position, plan) !== pointInsidePen(target, plan)) {
      throw new Error('sem caminho: curral fechado')
    }
    bot.entity.position = target
  }
  for (let i = 0; i < cows; i++) {
    bot.entities[i + 1] = {
      id: i + 1,
      name: 'cow',
      isValid: true,
      position: new Vec3(plan.center.x + 0.5 + i, plan.center.y, plan.center.z + 0.5)
    }
  }
  return { home, plan, gate, bot }
}

test('protectPenBlocks impede o pathfinder de quebrar cercas e portões', () => {
  const registry = require('minecraft-data')('1.20.1')
  const moves = protectPenBlocks({ blocksCantBreak: new Set() }, registry)
  assert.equal(moves.blocksCantBreak.has(registry.blocksByName.oak_fence.id), true)
  assert.equal(moves.blocksCantBreak.has(registry.blocksByName.spruce_fence_gate.id), true)
  assert.equal(moves.blocksCantBreak.has(registry.blocksByName.oak_planks.id), false)
})

test('WorkerController busca ração no baú antes de entrar no curral', async () => {
  const items = []
  const { home, plan, gate, bot } = penWorld({ items })
  const withdrawals = []
  const storage = {
    configured: () => true,
    withdraw: async (_bot, name, count) => {
      withdrawals.push({ name, count, inside: pointInsidePen(bot.entity.position, plan), gateOpen: gate.open })
      items.push({ name, count })
      return count
    }
  }
  const worker = readyWorker(bot, { role: 'fazendeiro', storage, homeProvider: () => home })

  const result = await worker.run({ type: 'reproduzir_animais', species: 'cow', pairs: 1 })

  assert.equal(result.fed, 2)
  assert.deepEqual(withdrawals, [{ name: 'wheat', count: 2, inside: false, gateOpen: false }])
  assert.equal(pointInsidePen(bot.entity.position, plan), false)
  assert.equal(gate.open, false)
  assert.equal(worker.activePen, null)
})

test('WorkerController não entra no curral sem ração', async () => {
  const { home, plan, gate, bot } = penWorld()
  const storage = { configured: () => true, withdraw: async () => 0 }
  const worker = readyWorker(bot, { role: 'fazendeiro', storage, homeProvider: () => home })

  const result = await worker.run({ type: 'reproduzir_animais', species: 'cow', pairs: 1 })

  assert.equal(result.reason, 'sem_alimento')
  assert.equal(bot.pathfinder.goals.length, 0)
  assert.equal(gate.open, false)
  assert.equal(pointInsidePen(bot.entity.position, plan), false)
})

test('WorkerController cancelado dentro do curral: a próxima tarefa sai pelo portão', async () => {
  const { home, plan, gate, bot } = penWorld({ items: [{ name: 'wheat', count: 4 }] })
  const worker = readyWorker(bot, { role: 'fazendeiro', homeProvider: () => home })
  let back = null
  bot.activateEntity = async () => {
    // Enquanto alimenta dentro do curral, chega "!todos voltar".
    if (!back) back = worker.run({ type: 'voltar' })
  }

  await worker.run({ type: 'reproduzir_animais', species: 'cow', pairs: 1 }).catch(() => {})
  const result = await back

  assert.equal(result.ok, true)
  assert.equal(gate.open, false)
  assert.equal(pointInsidePen(bot.entity.position, plan), false)
  // A última meta foi a de casa: a tarefa antiga não mexeu mais no pathfinder.
  const last = bot.pathfinder.goals[bot.pathfinder.goals.length - 1]
  assert.deepEqual([last.x, last.z], [0, 0])
  assert.equal(worker.activePen, null)
})

test('StorageManager não segura a trava do baú enquanto o bot caminha', async () => {
  const storage = new StorageManager()
  storage.setPosition({ x: 0, y: 64, z: 0 })
  const order = []
  const chest = { name: 'chest', position: new Vec3(0, 64, 0) }
  const makeBot = (name, walkMs) => ({
    blockAt: () => chest,
    pathfinder: { goto: () => sleep(walkMs), setGoal: () => {} },
    openContainer: async () => {
      order.push(name)
      return { containerItems: () => [], close: () => {} }
    }
  })

  await Promise.all([
    storage.summary(makeBot('longe', 80)),
    storage.summary(makeBot('perto', 5))
  ])
  assert.deepEqual(order, ['perto', 'longe'])
})
