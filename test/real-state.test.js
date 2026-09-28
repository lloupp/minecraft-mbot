const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { realStateSnapshot, objectiveTypeFor } = require('../lib/real-state')

function fakeBot({ health = 20, food = 20, items = [], heldItem = null, entities = {}, position = new Vec3(0, 64, 0), timeOfDay = 1000 } = {}) {
  return {
    health,
    food,
    heldItem,
    time: { timeOfDay },
    entity: { position },
    inventory: { items: () => items, slots: new Array(45) },
    entities,
    nearestEntity: (match) => Object.values(entities).find(match) || null
  }
}

test('objectiveTypeFor mapeia só os tipos conhecidos; o resto passa como está', () => {
  assert.equal(objectiveTypeFor({ type: 'coletar_blocos', resource: 'iron_ore' }), 'mine_iron')
  assert.equal(objectiveTypeFor({ type: 'coletar_blocos', resource: 'oak_log' }), 'coletar_blocos')
  assert.equal(objectiveTypeFor({ type: 'explorar' }), 'explore')
  assert.equal(objectiveTypeFor({ type: 'guardar' }), 'guard')
  assert.equal(objectiveTypeFor({ type: 'tosquiar' }), 'tosquiar')
  assert.equal(objectiveTypeFor(null), null)
})

test('realStateSnapshot lê saúde, fome e inventário do bot real', () => {
  const bot = fakeBot({ health: 14, food: 8, items: [{ name: 'stone_sword', count: 1 }, { name: 'bread', count: 2 }] })
  const state = realStateSnapshot(bot, { type: 'coletar_blocos', resource: 'oak_log' }, { homeProvider: () => null })
  assert.equal(state.health, 14)
  assert.equal(state.food, 8)
  assert.deepEqual(state.inventory, { stone_sword: 1, bread: 2 })
  assert.equal(state.objective.type, 'coletar_blocos')
})

test('detecta arma e ferramenta equipadas pelo nome do item na mão', () => {
  const withWeapon = fakeBot({ heldItem: { name: 'stone_sword' } })
  const withTool = fakeBot({ heldItem: { name: 'iron_pickaxe' } })
  const withNeither = fakeBot({ heldItem: { name: 'dirt' } })
  assert.equal(realStateSnapshot(withWeapon, null, {}).equippedWeapon, 'stone_sword')
  assert.equal(realStateSnapshot(withWeapon, null, {}).equippedTool, null)
  assert.equal(realStateSnapshot(withTool, null, {}).equippedTool, 'iron_pickaxe')
  assert.equal(realStateSnapshot(withNeither, null, {}).equippedWeapon, null)
})

test('detecta ameaça hostil dentro do raio de fuga, mas não fora dele', () => {
  const near = { name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0) }
  const far = { name: 'skeleton', type: 'hostile', position: new Vec3(30, 64, 0) }
  const bot = fakeBot({ entities: { 1: near, 2: far } })
  const state = realStateSnapshot(bot, null, { fleeDistance: 16 })
  assert.equal(state.threat.type, 'zombie')
  assert.equal(state.threat.distance, 3)
})

test('sem ameaça hostil por perto, threat fica null', () => {
  const bot = fakeBot({})
  const state = realStateSnapshot(bot, null, {})
  assert.equal(state.threat, null)
})

test('atBase depende da posição real em relação à base conhecida', () => {
  const bot = fakeBot({ position: new Vec3(0, 64, 0) })
  const close = realStateSnapshot(bot, null, { homeProvider: () => ({ x: 2, y: 64, z: 0 }) })
  const far = realStateSnapshot(bot, null, { homeProvider: () => ({ x: 200, y: 64, z: 0 }) })
  const noBase = realStateSnapshot(bot, null, { homeProvider: () => null })
  assert.equal(close.atBase, true)
  assert.equal(close.baseKnown, true)
  assert.equal(far.atBase, false)
  assert.equal(noBase.baseKnown, false)
})

test('consecutiveFailures é repassado como veio, nunca negativo', () => {
  const bot = fakeBot({})
  assert.equal(realStateSnapshot(bot, null, { consecutiveFailures: 3 }).consecutiveFailures, 3)
  assert.equal(realStateSnapshot(bot, null, { consecutiveFailures: -5 }).consecutiveFailures, 0)
})

test('craftable é derivado do inventário real pelas mesmas regras do Gauntlet', () => {
  const bot = fakeBot({ items: [{ name: 'stick', count: 2 }, { name: 'cobblestone', count: 3 }] })
  const state = realStateSnapshot(bot, null, {})
  assert.ok(state.craftable.includes('stone_sword'))
  assert.ok(state.craftable.includes('stone_pickaxe'))
})
