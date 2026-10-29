const test = require('node:test')
const assert = require('node:assert/strict')

const deepmine = require('../lib/deepmine')

function fakeBot({ at = { x: 10.5, y: 64, z: -5.5 }, blocks = {}, items = [], findBlocks = () => [] } = {}) {
  const stats = { dug: [], equip: [], gotos: 0 }
  const bot = {
    entity: { position: at },
    inventory: { items: () => items },
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (key in blocks) {
        const name = blocks[key]
        return name === 'air' ? { name, boundingBox: 'empty' } : { name, boundingBox: 'block' }
      }
      return { name: 'stone', boundingBox: 'block' }
    },
    findBlocks: () => findBlocks(),
    registry: { blocksArray: [], blocksByName: {} },
    pathfinder: {
      bestHarvestTool: () => ({ name: 'stone_pickaxe' }),
      // Como o pathfinder real: ao chegar, a posição é a do objetivo.
      goto: async (goal) => { stats.gotos++; if (goal && Number.isFinite(goal.x)) bot.entity.position = { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 } },
      setGoal: () => {}
    },
    equip: async (item) => stats.equip.push(item.name),
    dig: async (block) => stats.dug.push(block.name),
    stats
  }
  return bot
}

const base = { x: 10, y: 64, z: -5 }

 test('recusa degrau dentro de lava ou água', () => {
  const bot = fakeBot({ blocks: { '11,63,-6': 'lava' } })
  const plan = deepmine.stepPlan(bot, [1, 0])
  assert.equal(plan.ok, false)
  assert.match(plan.reason, /perigo/)
})

test('degrau já aberto com chão firme: só anda, não cava o vazio', () => {
  const bot = fakeBot({ blocks: { '11,63,-6': 'air', '11,64,-6': 'air' } })
  const plan = deepmine.stepPlan(bot, [1, 0])
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.dig, [])
})

test('recusa degrau aberto sem chão (seria queda)', () => {
  const bot = fakeBot({ blocks: { '11,63,-6': 'air', '11,62,-6': 'air' } })
  const plan = deepmine.stepPlan(bot, [1, 0])
  assert.equal(plan.ok, false)
  assert.match(plan.reason, /sem chão/)
})

test('cava também o bloco da cabeça quando está fechado', () => {
  const bot = fakeBot()
  const plan = deepmine.stepPlan(bot, [1, 0])
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.dig.map((b) => b.name), ['stone', 'stone'])
  assert.deepEqual([plan.foot.x, plan.foot.y, plan.foot.z], [11, 63, -6])
})

test('escolhe outra direção quando a primeira é insegura', () => {
  const bot = fakeBot({ blocks: { '11,63,-6': 'water' } })
  const plan = deepmine.firstViableStep(bot, 0)
  assert.equal(plan.ok, true)
  assert.equal(plan.index, 1)
})

test('escada para no fundo configurado', async () => {
  const bot = fakeBot({ at: { x: 10.5, y: -58, z: -5.5 } })
  const result = await deepmine.digStair(bot, { steps: 5, floor: -58 })
  assert.equal(result.ok, true)
  assert.equal(result.steps, 0)
  assert.equal(bot.stats.dug.length, 0)
})

test('escada desce os degraus e confirma a posição', async () => {
  const bot = fakeBot({ at: { x: 10.5, y: 64, z: -5.5 } })
  const result = await deepmine.digStair(bot, { steps: 3, floor: -58 })
  assert.equal(result.ok, true)
  assert.equal(result.steps, 3)
  assert.equal(bot.stats.gotos, 3)
  assert.ok(bot.stats.dug.includes('stone'))
})

test('escada respeita cancelamento', async () => {
  const bot = fakeBot()
  const result = await deepmine.digStair(bot, { steps: 3, isCancelled: () => true })
  assert.equal(result.steps, 0)
  assert.equal(bot.stats.dug.length, 0)
})

test('mineração profunda não desce quando o alvo já foi atingido', async () => {
  const bot = fakeBot({ items: [{ type: 501, name: 'lapis_lazuli', count: 64 }] })
  const result = await deepmine.mineDeep(bot, { names: ['lapis_ore'], item: 'lapis_lazuli', target: 64 })
  assert.equal(result.ok, true)
  assert.equal(result.steps, 0)
  assert.equal(bot.stats.gotos, 0)
})

test('sem minério por perto desce em vez de desistir', async () => {
  const bot = fakeBot()
  const result = await deepmine.mineDeep(bot, { names: ['lapis_ore'], item: 'lapis_lazuli', target: 1, maxSteps: 2, descendChunk: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.steps, 2)
  assert.match(result.reason, /limite de degraus/)
  assert.equal(bot.stats.gotos, 2)
})

test('sem descida segura, anda de lado e tenta de novo', async () => {
  // Lava sob os 4 degraus de descida a partir de (10,64,-5); de lado, em (11,64,-5), a descida para leste é livre.
  const blocks = { '11,62,-5': 'lava', '9,62,-5': 'lava', '10,62,-4': 'lava', '10,62,-6': 'lava' }
  const bot = fakeBot({ at: { x: 10.5, y: 64, z: -4.5 }, blocks })
  assert.equal(deepmine.firstViableStep(bot, 0).ok, false) // daqui não há descida
  bot.pathfinder.goto = async (goal) => { bot.entity.position = { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 } }
  const result = await deepmine.digStair(bot, { steps: 1 })
  assert.equal(result.ok, true)
  assert.equal(result.steps, 1)
  assert.notEqual(bot.entity.position.x, 10.5) // saiu do lugar
})

test('degrau inalcançável: desiste do caminho após o prazo e não fica preso', async () => {
  const bot = fakeBot()
  let stopped = 0
  bot.pathfinder.goto = () => new Promise(() => {}) // nunca chega
  bot.pathfinder.setGoal = (goal) => { if (goal === null) stopped++ }
  const result = await deepmine.digStair(bot, { steps: 2, stepTimeoutMs: 5 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /chegar ao degrau/)
  assert.equal(stopped, 4)
})

test('cercado de líquido: o pathfinder acha a descida e a escada continua', async () => {
  // Lava sob todos os degraus e nas laterais: sem degrau nem passo lateral possível.
  const blocks = {}
  for (const [x, z] of [[11, -6], [9, -6], [10, -5], [10, -7]]) { blocks[`${x},63,${z}`] = 'lava'; blocks[`${x},62,${z}`] = 'lava' }
  const bot = fakeBot({ at: { x: 10.5, y: 64, z: -5.5 }, blocks })
  let pathDown = 0
  bot.pathfinder.goto = async (goal) => {
    if (goal.constructor.name === 'GoalY') { pathDown++; bot.entity.position = { x: 30.5, y: goal.y, z: 30.5 }; return }
    bot.entity.position = { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }
  }
  const result = await deepmine.digStair(bot, { steps: 2, stepTimeoutMs: 5 })
  assert.equal(pathDown, 1)
  assert.equal(result.ok, true)
  assert.equal(result.steps, 2)
})
