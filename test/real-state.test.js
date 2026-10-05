const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { realStateSnapshot, objectiveTypeFor, nearbySignals } = require('../lib/real-state')

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
  assert.equal(state.threat.count, 1)
})

test('conta todos os hostis no raio, não só o mais próximo (enxame força fuga em candidateIntents)', () => {
  const a = { name: 'zombie', type: 'hostile', position: new Vec3(3, 64, 0) }
  const b = { name: 'zombie', type: 'hostile', position: new Vec3(5, 64, 0) }
  const c = { name: 'zombie', type: 'hostile', position: new Vec3(6, 64, 0) }
  const outOfRange = { name: 'zombie', type: 'hostile', position: new Vec3(30, 64, 0) }
  const bot = fakeBot({ entities: { 1: a, 2: b, 3: c, 4: outOfRange } })
  const state = realStateSnapshot(bot, null, { fleeDistance: 16 })
  assert.equal(state.threat.type, 'zombie')
  assert.equal(state.threat.distance, 3)
  assert.equal(state.threat.count, 3)
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


test('nearbySignals detecta recursos com amostragem limitada sem findBlock/findBlocks', () => {
  const origin = new Vec3(0, 64, 0)
  let calls = 0
  const blocks = new Map([
    ['2,64,0', 'oak_log'],
    ['-2,64,0', 'stone'],
    ['0,64,2', 'iron_ore'],
    ['0,65,0', 'wheat']
  ])
  const bot = fakeBot({ position: origin })
  bot.blockAt = (pos) => {
    calls++
    const name = blocks.get(`${pos.x},${pos.y},${pos.z}`)
    return name ? { name } : { name: 'air' }
  }
  bot.findBlock = () => { throw new Error('findBlock não deve ser usado') }
  bot.findBlocks = () => { throw new Error('findBlocks não deve ser usado') }

  const nearby = nearbySignals(bot)
  assert.equal(nearby.food, true)
  assert.equal(nearby.wood, true)
  assert.equal(nearby.stone, true)
  assert.equal(nearby.iron, true)
  assert.ok(nearby.foodDistance != null)
  assert.ok(nearby.woodDistance != null)
  assert.ok(nearby.stoneDistance != null)
  assert.ok(nearby.ironDistance != null)
  assert.ok(calls <= 125)
})

test('nearbySignals usa animais carregados como sinal de comida', () => {
  const cow = { name: 'cow', type: 'animal', position: new Vec3(3, 64, 0) }
  const bot = fakeBot({ entities: { 1: cow } })
  bot.blockAt = () => ({ name: 'air' })
  assert.equal(nearbySignals(bot).food, true)
})


test('realStateSnapshot registra distância aproximada da base', () => {
  const bot = fakeBot({ position: new Vec3(0, 64, 0) })
  bot.blockAt = () => ({ name: 'air' })
  const state = realStateSnapshot(bot, null, { homeProvider: () => new Vec3(3, 64, 4) })
  assert.equal(state.baseKnown, true)
  assert.equal(state.baseDistance, 5)
})

test('nearbySignals registra distância do animal comestível mais próximo', () => {
  const near = { name: 'cow', type: 'animal', position: new Vec3(3, 64, 0) }
  const far = { name: 'pig', type: 'animal', position: new Vec3(7, 64, 0) }
  const bot = fakeBot({ entities: { 1: far, 2: near } })
  bot.blockAt = () => ({ name: 'air' })
  const nearby = nearbySignals(bot)
  assert.equal(nearby.food, true)
  assert.equal(nearby.foodDistance, 3)
})

test('nearbySignals devolve a distância mínima mesmo quando todos os sinais já foram vistos', () => {
  const { nearbySignals } = require('../lib/real-state')
  const origin = new Vec3(0, 64, 0)
  const blocks = new Map([['-4,64,-4', 'oak_log'], ['-4,64,-2', 'stone'], ['-4,64,0', 'iron_ore'], ['-4,64,2', 'wheat'], ['0,64,2', 'oak_log']])
  const bot = { entity: { position: origin }, entities: {}, blockAt: (p) => ({ name: blocks.get(`${p.x},${p.y},${p.z}`) || 'air' }) }
  const out = nearbySignals(bot)
  assert.equal(out.wood && out.stone && out.iron && out.food, true)
  assert.equal(out.woodDistance, 2) // a tora a 2 blocos, não a primeira da varredura
})

test('ameaça ignora neutros não provocados longe (aranha de dia, enderman); de noite ou perto a aranha conta', () => {
  const at = (x) => new Vec3(x, 64, 0)
  const spider = { name: 'spider', type: 'hostile', position: at(14) }
  const enderman = { name: 'enderman', type: 'hostile', position: at(8) }
  const zombie = { name: 'zombie', type: 'hostile', position: at(12) }
  const snap = (entities, timeOfDay) => realStateSnapshot(fakeBot({ entities, timeOfDay }), { type: 'explorar' }, { homeProvider: () => null }).threat
  assert.equal(snap({ spider }, 6000), null)
  assert.equal(snap({ enderman }, 6000), null)
  assert.equal(snap({ enderman }, 18000), null)
  assert.equal(snap({ spider }, 18000).type, 'spider')                       // noite: hostil
  assert.equal(snap({ spider: { ...spider, position: at(2) } }, 6000).type, 'spider')  // colada: conta
  assert.equal(snap({ spider, zombie }, 6000).type, 'zombie')                // zumbi continua ameaça
})

test('animal de comida visível a até 16 blocos conta como comida próxima', () => {
  const cow = (x) => ({ name: 'cow', type: 'passive', position: new Vec3(x, 64, 0) })
  const near = realStateSnapshot(fakeBot({ entities: { c: cow(12) } }), { type: 'explorar' }, { homeProvider: () => null })
  assert.equal(near.nearby.food, true)
  const far = realStateSnapshot(fakeBot({ entities: { c: cow(20) } }), { type: 'explorar' }, { homeProvider: () => null })
  assert.equal(far.nearby.food, false)
})
