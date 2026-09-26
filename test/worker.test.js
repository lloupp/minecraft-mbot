const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')

const { WorkerController } = require('../core/WorkerController')
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

test('StorageManager serializa operações do mesmo bot (não troca o objetivo no meio)', async () => {
  const storage = new StorageManager()
  storage.setPosition({ x: 0, y: 64, z: 0 })
  const chest = { name: 'chest', position: new Vec3(0, 64, 0) }
  // Como o pathfinder real: um goto novo rejeita o que estava em andamento.
  let current = null
  const bot = {
    blockAt: () => chest,
    pathfinder: {
      setGoal: () => {},
      goto: () => {
        current?.reject(new Error('The goal was changed before it could be completed!'))
        return new Promise((resolve, reject) => {
          const entry = { reject }
          current = entry
          setTimeout(() => { if (current === entry) current = null; resolve() }, 20)
        })
      }
    },
    openContainer: async () => ({ containerItems: () => [{ name: 'coal', count: 3 }], close: () => {} })
  }

  const results = await Promise.all([storage.summary(bot), storage.summary(bot), storage.count(bot, 'coal')])
  assert.deepEqual(results, [{ coal: 3 }, { coal: 3 }, 3])
})

test('WorkerController dá tempo proporcional à distância para voltar à base', async () => {
  const bot = fakeBot()
  const home = new Vec3(170, 64, 0) // 170 blocos
  const worker = readyWorker(bot, { homeProvider: () => home })
  let timeout = null
  worker.goTo = async (_goal, ms) => { timeout = ms }
  await worker.run({ type: 'voltar' })
  assert.equal(timeout, 119000)

  bot.entity.position = new Vec3(165, 64, 0) // perto: mantém o mínimo de 30 s
  await worker.run({ type: 'voltar' })
  assert.equal(timeout, 30000)
})

test('waitUntil espera a condição ou desiste no tempo limite', async () => {
  const { waitUntil } = require('../core/WorkerController')
  let ok = false
  setTimeout(() => { ok = true }, 60)
  assert.equal(await waitUntil(() => ok, 1000, 20), true)
  assert.equal(await waitUntil(() => false, 50, 20), false)
})
