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
  const inventoryItems = []
  bot.inventory = { items: () => inventoryItems }
  bot.registry = {
    blocksArray: [{ id: 1, name: 'iron_ore' }, { id: 2, name: 'deepslate_iron_ore' }],
    blocksByName: { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } }
  }
  bot.blockAt = (pos) => ({ name: blocks[pos.toString()] || 'air', position: pos })
  bot.findBlocks = () => Object.entries(blocks)
    .filter(([, name]) => name !== 'air')
    .map(([key]) => new Vec3(...key.slice(1, -1).split(',').map(Number)))
  bot.nearestEntity = (match) => Object.values(bot.entities).find(match) || null
  bot.dig = async (block) => {
    blocks[block.position.toString()] = 'air'
    inventoryItems.push({ name: block.name, count: 1 })
  }
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
  const move = (goal) => {
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
  bot.pathfinder.goto = async (goal) => move(goal)
  bot.pathfinder.setGoal = (goal) => {
    bot.pathfinder.goal = goal
    if (goal) try { move(goal) } catch {}
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

// Vaca fora do curral que segue o bot enquanto ele segura ração e está perto.
function temptedCow(bot, position, { follows = true } = {}) {
  const cow = { id: 50, name: 'cow', isValid: true, following: false, spot: position }
  let holdingFeed = true
  const equip = bot.equip
  bot.equip = async (...args) => { holdingFeed = true; return equip?.(...args) }
  Object.defineProperty(cow, 'position', {
    get () {
      if (!cow.following && follows && holdingFeed && cow.spot.distanceTo(bot.entity.position) <= 3.5) cow.following = true
      return cow.following ? bot.entity.position.offset(0, 0, -1) : cow.spot
    }
  })
  bot.unequip = async () => { // largou a ração: a vaca para onde está
    holdingFeed = false
    if (cow.following) cow.spot = cow.position
    cow.following = false
  }
  bot.entities[cow.id] = cow
  return cow
}

test('WorkerController atrai o animal sem correr e só abre o portão com ele perto', async () => {
  const { home, plan, gate, bot } = penWorld({ items: [{ name: 'wheat', count: 1 }], cows: 0 })
  const cow = temptedCow(bot, new Vec3(plan.gate.x + 0.5, 64, plan.gate.z - 8.5))
  const sprint = []
  bot.setControlState = (control, state) => sprint.push([control, state])
  const worker = readyWorker(bot, { role: 'fazendeiro', homeProvider: () => home })
  worker.lure = { ...worker.lure, pollMs: 5 }

  const result = await worker.run({ type: 'capturar_animais', species: 'cow', count: 1 })

  assert.deepEqual(sprint, [['sprint', false]])
  assert.equal(result.captured, 1)
  assert.equal(result.inside, 1)
  assert.equal(pointInsidePen(cow.position, plan), true)
  assert.equal(pointInsidePen(bot.entity.position, plan), false)
  assert.equal(gate.open, false)
})

test('WorkerController não abre o portão se o animal não acompanha', async () => {
  const { home, plan, gate, bot } = penWorld({ items: [{ name: 'wheat', count: 1 }], cows: 0 })
  temptedCow(bot, new Vec3(plan.gate.x + 0.5, 64, plan.gate.z - 8.5), { follows: false })
  let toggles = 0
  bot.activateBlock = async (block) => { toggles++; block.open = !block.open }
  const worker = readyWorker(bot, { role: 'fazendeiro', homeProvider: () => home })
  worker.lure = { ...worker.lure, pollMs: 5, waitMs: 30 }

  const result = await worker.run({ type: 'capturar_animais', species: 'cow', count: 1 })

  assert.equal(result.captured, 0)
  assert.equal(toggles, 0)
  assert.equal(gate.open, false)
})

test('WorkerController recoloca portão virado de lado, olhando de fora do curral', async () => {
  const plan = animalPenPlan({ x: 0, y: 64, z: 0 }, 'cow')
  const gatePos = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z)
  const blocks = new Map()
  const gateBlock = (facing) => ({ name: 'oak_fence_gate', boundingBox: 'block', position: gatePos, getProperties: () => ({ facing, open: false }) })
  blocks.set(gatePos.toString(), gateBlock('east'))

  const bot = fakeBot()
  bot.entity.position = new Vec3(plan.gate.x + 3.5, 64, plan.gate.z + 0.5) // ao lado do portão
  bot.inventory = { items: () => [{ name: 'oak_fence_gate', count: 1 }] }
  bot.blockAt = (pos) => blocks.get(pos.toString()) ||
    (pos.y < 64 ? { name: 'grass_block', boundingBox: 'block', position: pos } : { name: 'air', boundingBox: 'empty', position: pos })
  const dug = []
  bot.dig = async (block) => { dug.push(block.position.toString()); blocks.delete(block.position.toString()) }
  bot.pathfinder.goto = async (goal) => {
    if (goal.isEnd?.(bot.entity.position.floored())) return
    bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
  }
  // Como no jogo: o portão fica virado para onde o bot está olhando.
  bot.placeBlock = async (ref, face) => {
    const pos = ref.position.plus(face)
    const dx = pos.x + 0.5 - bot.entity.position.x
    const dz = pos.z + 0.5 - bot.entity.position.z
    const facing = Math.abs(dz) >= Math.abs(dx) ? (dz > 0 ? 'south' : 'north') : (dx > 0 ? 'east' : 'west')
    blocks.set(pos.toString(), gateBlock(facing))
  }
  const worker = readyWorker(bot, { role: 'fazendeiro' })

  const ok = await worker.placePenGate(plan, 'oak_fence_gate', () => false)

  assert.equal(ok, true)
  assert.deepEqual(dug, [gatePos.toString()])
  assert.equal(bot.blockAt(gatePos).getProperties().facing, 'south')
})

test('WorkerController soterrado cava para sair em vez de fugir', async () => {
  const zombie = { name: 'zombie', type: 'hostile', isValid: true, position: new Vec3(6, 64, 0) }
  const bot = fakeBot({ entities: { 1: zombie } })
  const head = new Vec3(0, 65, 0)
  let sand = true
  bot.blockAt = (pos) => sand && pos.floored().equals(head)
    ? { name: 'sand', boundingBox: 'block', diggable: true, position: head }
    : { name: 'air', boundingBox: 'empty', position: pos.floored() }
  const dug = []
  bot.dig = async (block) => { dug.push(block.name); sand = false }
  const worker = readyWorker(bot)

  bot.emit('health')
  bot.health = 19
  bot.emit('health') // dano de sufocamento: sem atacante

  await sleep(200)
  assert.deepEqual(dug, ['sand'])
  assert.notEqual(worker.state, 'defendendo')
  assert.equal(worker.defending, false)
})

test('WorkerController encerra o túnel da mina ao achar cascalho no teto', async () => {
  const blocks = {
    [new Vec3(10, 64, 0).toString()]: 'stone',
    [new Vec3(11, 64, 0).toString()]: 'stone',
    [new Vec3(11, 65, 0).toString()]: 'stone',
    [new Vec3(11, 66, 0).toString()]: 'gravel'
  }
  const bot = fakeBot({ blocks })
  bot.registry.blocksByName.stone = { id: 3 }
  bot.findBlock = () => ({ position: new Vec3(10, 64, 0) })
  const worker = readyWorker(bot, { homeProvider: () => ({ x: 0, y: 64, z: 0 }) })

  const result = await worker.run({ type: 'construir_mina', length: 6 })

  assert.equal(result.blockedBy, 'areia_cascalho')
  assert.equal(result.dug, 1)
  assert.equal(bot.blockAt(new Vec3(11, 64, 0)).name, 'stone')
  assert.equal(bot.blockAt(new Vec3(11, 65, 0)).name, 'stone')
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

test('WorkerController tira degrau posto dentro do curral durante a obra, antes do portão', async () => {
  const home = { x: 0, y: 64, z: 0 }
  const plan = animalPenPlan(home, 'cow')
  const inside = new Vec3(plan.origin.x + 4, plan.origin.y, plan.origin.z + 1) // encostado na cerca
  const blocks = {}
  const bot = fakeBot()
  bot.blockAt = (pos) => {
    const name = blocks[pos.toString()] || 'air'
    return { name, position: pos, boundingBox: name === 'air' ? 'empty' : 'block' }
  }
  bot.dig = async (block) => { blocks[block.position.toString()] = 'air' }
  const worker = readyWorker(bot, { role: 'construtor', homeProvider: () => home })
  worker.ensurePenKit = async () => ({ fence: 'oak_fence', gate: 'oak_fence_gate' })
  worker.placeGroundItem = async () => { blocks[inside.toString()] = 'dirt'; return true } // andaime do pathfinder
  let stepAtGate = null
  worker.placePenGate = async () => { stepAtGate = blocks[inside.toString()]; return true }

  const result = await worker.buildAnimalPen(() => false, 'cow')
  assert.equal(stepAtGate, 'air')
  assert.equal(result.leveled, 1)
  assert.equal(result.ok, true)
})

test('WorkerController cava terreno natural na linha da cerca, mas não blocos construídos', async () => {
  const blocks = { '(1, 64, 0)': 'grass_block', '(2, 64, 0)': 'oak_planks' }
  const bot = fakeBot()
  bot.blockAt = (pos) => {
    const name = blocks[pos.toString()] || (pos.y < 64 ? 'dirt' : 'air')
    return { name, position: pos, boundingBox: name === 'air' ? 'empty' : 'block' }
  }
  bot.dig = async (block) => { blocks[block.position.toString()] = 'air' }
  bot.inventory = { items: () => [{ name: 'oak_fence', count: 2 }] }
  bot.placeBlock = async (below) => { blocks[below.position.offset(0, 1, 0).toString()] = 'oak_fence' }
  const worker = readyWorker(bot)

  assert.equal(await worker.placeGroundItem({ x: 1, y: 64, z: 0 }, 'oak_fence', () => false), true)
  assert.equal(blocks['(1, 64, 0)'], 'oak_fence')
  assert.equal(await worker.placeGroundItem({ x: 2, y: 64, z: 0 }, 'oak_fence', () => false), false)
  assert.equal(blocks['(2, 64, 0)'], 'oak_planks')
})

test('WorkerController nivela a entrada do portão antes de colocá-lo', async () => {
  const home = { x: 0, y: 64, z: 0 }
  const plan = animalPenPlan(home, 'cow')
  const approach = new Vec3(plan.gate.x, plan.gate.y, plan.gate.z - 1)
  const blocks = { [approach.toString()]: 'grass_block' } // terreno de fora 1 bloco mais alto
  const bot = fakeBot()
  bot.blockAt = (pos) => {
    const name = blocks[pos.toString()] || 'air'
    return { name, position: pos, boundingBox: name === 'air' ? 'empty' : 'block' }
  }
  bot.dig = async (block) => { blocks[block.position.toString()] = 'air' }
  const worker = readyWorker(bot, { role: 'construtor', homeProvider: () => home })
  worker.ensurePenKit = async () => ({ fence: 'oak_fence', gate: 'oak_fence_gate' })
  worker.placeGroundItem = async () => true
  let approachAtGate = null
  worker.placePenGate = async () => { approachAtGate = blocks[approach.toString()]; return true }

  const result = await worker.buildAnimalPen(() => false, 'cow')
  assert.equal(approachAtGate, 'air')
  assert.equal(result.ok, true)
})

test('caçar comida poupa os animais do curral', async () => {
  const food = require('../lib/food')
  const { home, plan, bot } = penWorld({ cows: 3 }) // 3 vacas dentro: acima do mínimo poupado
  bot.food = 20
  bot.findBlock = () => null
  const outside = { id: 99, name: 'cow', isValid: true, position: new Vec3(plan.gate.x + 0.5, 64, plan.gate.z - 6.5) }
  const worker = readyWorker(bot, { role: 'fazendeiro', homeProvider: () => home })

  let options = null
  const original = food.gatherFood
  food.gatherFood = async (_bot, _isCancelled, opts) => { options = opts; return null }
  try {
    await worker.run({ type: 'fazenda', count: 1 })
  } finally {
    food.gatherFood = original
  }
  assert.equal(typeof options?.spare, 'function')
  assert.equal(options.spare(bot.entities[1]), true)
  assert.equal(options.spare(outside), false)

  // Só vacas do curral por perto: nenhuma fonte de comida.
  assert.equal(food.findFoodSource(bot, options), null)
  assert.equal(food.findFoodSource(bot)?.entity?.name, 'cow') // sem poupar, caçaria uma delas
})
