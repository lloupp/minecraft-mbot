const test = require('node:test')
const assert = require('node:assert/strict')

const mission = require('../lib/ore-mission')

function fakeBot(counts = {}) {
  const items = Object.entries(counts).map(([name, count], index) => ({ type: index + 1, name, count }))
  return { inventory: { items: () => items } }
}

test('a missão cobre todos os minérios do jogo', () => {
  const keys = mission.ORE_FAMILIES.map((family) => family.key)
  for (const key of ['carvao', 'ferro', 'cobre', 'lapis', 'ouro', 'redstone', 'diamante', 'esmeralda']) {
    assert.ok(keys.includes(key), key)
  }
})

test('conta progresso pelo item, limitado à meta', () => {
  const bot = fakeBot({ coal: 100, raw_iron: 12, diamond: 0 })
  const progress = mission.progressOf(bot, 64)
  assert.equal(progress.carvao, 64)
  assert.equal(progress.ferro, 12)
  assert.equal(progress.diamante, 0)
})

test('não minera família que já está completa', async () => {
  const bot = fakeBot({ coal: 64 })
  const mined = []
  await mission.mineMission(bot, {
    target: 64,
    mine: async (family, need) => { mined.push([family.key, need]) }
  })
  assert.equal(mined.some(([key]) => key === 'carvao'), false)
})

test('minera só o que falta em cada família', async () => {
  const bot = fakeBot({ coal: 60, raw_iron: 0 })
  const mined = []
  await mission.mineMission(bot, {
    target: 64,
    mine: async (family, need) => { mined.push([family.key, need]) }
  })
  assert.deepEqual(mined[0], ['carvao', 4])
  assert.deepEqual(mined[1], ['ferro', 64])
})

test('para quando o dono cancela', async () => {
  const bot = fakeBot({})
  let calls = 0
  let cancel = false
  const result = await mission.mineMission(bot, {
    target: 64,
    isCancelled: () => cancel,
    mine: async () => { calls++; cancel = true }
  })
  assert.equal(calls, 1)
  assert.equal(result.cancelled, true)
  assert.equal(result.ok, false)
})

test('prepara a ferramenta antes de minerar família difícil', async () => {
  const bot = fakeBot({})
  const tools = []
  await mission.mineMission(bot, {
    target: 1,
    ensureTool: async (family) => { tools.push(family.key) },
    mine: async () => {}
  })
  assert.ok(tools.includes('diamante'))
  assert.ok(tools.includes('esmeralda'))
})

test('relata meta cumprida quando todos chegam ao alvo', async () => {
  const full = { coal: 64, raw_iron: 64, raw_copper: 64, lapis_lazuli: 64, raw_gold: 64, redstone: 64, diamond: 64, emerald: 64 }
  const result = await mission.mineMission(fakeBot(full), { target: 64, mine: async () => {} })
  assert.equal(result.ok, true)
  assert.equal(mission.complete(result.progress, 64), true)
})
