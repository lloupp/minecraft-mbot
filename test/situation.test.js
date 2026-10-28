const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const perception = require('../lib/perception')
const { whereAmI, describeSituation, classify, layerOf } = require('../lib/situation')

const NAMES = ['air', 'cave_air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'oak_leaves', 'oak_log', 'lava', 'water',
  'iron_ore', 'chest', 'glass', 'oak_door', 'crafting_table']
const registry = {
  blocksArray: NAMES.map((name, id) => ({ name, id })),
  blocksByName: Object.fromEntries(NAMES.map((name, id) => [name, { id, name }]))
}

// Mundo fake: Map "x,y,z" -> nome; ausente = `fill` (ar por padrão).
function fakeBot({ pos = { x: 0.5, y: 64, z: 0.5 }, dimension = 'minecraft:overworld', fill = 'air', time = 6000, biome = 'plains' } = {}) {
  const world = new Map()
  const bot = {
    registry,
    game: { dimension, minY: -64, height: 384 },
    time: { timeOfDay: time },
    entities: {},
    entity: { position: new Vec3(pos.x, pos.y, pos.z), yaw: 0 },
    set(x, y, z, name) { world.set(`${x},${y},${z}`, name) },
    box(x1, y1, z1, x2, y2, z2, name) {
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) bot.set(x, y, z, name)
    },
    blockAt(p) {
      const name = world.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) ?? fill
      return { name, position: p, light: name === 'air' || name === 'cave_air' ? bot.light : 0, skyLight: bot.sky, biome: { name: biome } }
    },
    blockAtCursor() { return null },
    findBlocks({ matching, maxDistance, count }) {
      const ids = new Set([].concat(matching))
      const origin = bot.entity.position
      const out = []
      for (const [k, name] of world) {
        const [x, y, z] = k.split(',').map(Number)
        const p = new Vec3(x, y, z)
        if (ids.has(registry.blocksByName[name].id) && p.distanceTo(origin) <= maxDistance) out.push(p)
      }
      return out.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin)).slice(0, count)
    },
    light: 15,
    sky: 15
  }
  return bot
}

function addEntity(bot, id, props) {
  bot.entities[id] = { id, ...props, position: new Vec3(props.position.x, props.position.y, props.position.z) }
}

// ---------- perception ----------

test('direção cardeal segue o Minecraft (norte = -Z, leste = +X)', () => {
  const o = { x: 0, z: 0 }
  assert.equal(perception.direction(o, { x: 0, z: -10 }), 'N')
  assert.equal(perception.direction(o, { x: 10, z: 0 }), 'L')
  assert.equal(perception.direction(o, { x: 0, z: 10 }), 'S')
  assert.equal(perception.direction(o, { x: -10, z: 0 }), 'O')
  assert.equal(perception.direction(o, { x: 7, z: -7 }), 'NE')
  assert.equal(perception.direction(o, { x: 0.1, z: 0.1 }), 'aqui')
})

test('facing usa o yaw do mineflayer', () => {
  const bot = fakeBot()
  bot.entity.yaw = 0
  assert.equal(perception.facing(bot), 'N')
  bot.entity.yaw = Math.PI / 2
  assert.equal(perception.facing(bot), 'O')
  bot.entity.yaw = Math.PI
  assert.equal(perception.facing(bot), 'S')
})

test('blocos notáveis trazem contagem, mais próximo e direção', () => {
  const bot = fakeBot()
  bot.set(5, 64, 0, 'oak_log')
  bot.set(3, 64, 0, 'oak_log')
  bot.set(0, 64, -4, 'chest')
  bot.set(0, 63, 0, 'dirt')
  const d = perception.nearbyBlockDetails(bot)
  assert.equal(d.oak_log.count, 2)
  assert.equal(d.oak_log.direction, 'L')
  assert.equal(d.chest.direction, 'N')
  assert.equal(d.dirt, undefined)
  assert.deepEqual(perception.nearbyBlocks(bot), { oak_log: 2, chest: 1 })
})

test('ameaças urgentes vêm primeiro e creeper conta mesmo mais longe', () => {
  const bot = fakeBot()
  addEntity(bot, 1, { type: 'hostile', name: 'zombie', position: { x: 20, y: 64, z: 0 } })
  addEntity(bot, 2, { type: 'hostile', name: 'creeper', position: { x: 0, y: 64, z: 12 } })
  addEntity(bot, 3, { type: 'animal', name: 'cow', position: { x: 2, y: 64, z: 0 } })
  const t = perception.threats(bot)
  assert.equal(t[0].name, 'creeper')
  assert.equal(t[0].urgent, true)
  assert.equal(t[1].urgent, false)
  assert.deepEqual(perception.nearbyEntities(bot).animal, { cow: 1 })
})

test('describe cabe no chat e avisa ameaça urgente', () => {
  const bot = fakeBot()
  bot.set(0, 63, 0, 'grass_block')
  addEntity(bot, 1, { type: 'hostile', name: 'zombie', position: { x: 3, y: 64, z: 0 } })
  addEntity(bot, 2, { type: 'player', username: 'Eduardo', position: { x: -2, y: 64, z: 0 } })
  const lines = perception.describe(bot)
  assert.match(lines[0], /Pisando em: grass_block/)
  assert.match(lines[0], /virado para N/)
  assert.ok(lines.some((l) => /Jogadores: Eduardo/.test(l)))
  assert.ok(lines.some((l) => /Atenção: zombie a 3 \(L\)/.test(l)))
  for (const l of lines) assert.ok(l.length <= 256)
})

test('describe sem entidade não quebra', () => {
  assert.deepEqual(perception.describe({}), ['Ainda não estou no mundo.'])
})

// ---------- situation ----------

test('camada de altura no overworld', () => {
  assert.equal(layerOf('overworld', -20), 'deepslate')
  assert.equal(layerOf('overworld', 30), 'subsolo')
  assert.equal(layerOf('overworld', 70), 'superficie')
  assert.equal(layerOf('overworld', 150), 'montanha')
  assert.equal(layerOf('the_nether', 70), null)
})

test('classify cobre os casos básicos', () => {
  const around = { artificial: 0, underground: 0, air: 0 }
  assert.equal(classify({ inLava: true, around }), 'lava')
  assert.equal(classify({ inWater: true, around }), 'agua')
  assert.equal(classify({ roof: null, around }), 'ar_livre')
  assert.equal(classify({ roof: { distance: 5, name: 'oak_leaves' }, walls: 0, around }), 'sob_arvore')
  assert.equal(classify({ roof: { distance: 3, name: 'oak_planks' }, walls: 4, around: { artificial: 20, underground: 0, air: 30 } }), 'construcao')
  assert.equal(classify({ roof: { distance: 3, name: 'stone' }, walls: 4, around: { artificial: 0, underground: 100, air: 60 } }), 'caverna')
  assert.equal(classify({ roof: { distance: 2, name: 'stone' }, walls: 4, around: { artificial: 0, underground: 150, air: 10 } }), 'tunel')
})

test('céu aberto na superfície: ar livre, de dia, sem perigo', () => {
  const bot = fakeBot()
  bot.box(-6, 63, -6, 6, 63, 6, 'grass_block')
  const s = whereAmI(bot)
  assert.equal(s.env, 'ar_livre')
  assert.equal(s.openSky, true)
  assert.equal(s.biome, 'plains')
  assert.equal(s.layer, 'superficie')
  assert.equal(s.dim, 'overworld')
  assert.equal(s.night, false)
  assert.deepEqual(s.dangers, [])
  const lines = describeSituation(s)
  assert.match(lines[0], /ao ar livre/)
  assert.match(lines.at(-1), /Sem perigo/)
})

test('dentro de casa de tábuas: construção', () => {
  const bot = fakeBot()
  bot.box(-3, 63, -3, 3, 63, 3, 'oak_planks') // piso
  bot.box(-3, 67, -3, 3, 67, 3, 'oak_planks') // teto
  for (let y = 64; y <= 66; y++) {
    bot.box(-3, y, -3, 3, y, -3, 'oak_planks'); bot.box(-3, y, 3, 3, y, 3, 'oak_planks')
    bot.box(-3, y, -3, -3, y, 3, 'oak_planks'); bot.box(3, y, -3, 3, y, 3, 'oak_planks')
  }
  bot.set(2, 64, 2, 'chest')
  bot.sky = 0
  const s = whereAmI(bot)
  assert.equal(s.env, 'construcao')
  assert.equal(s.roof.distance, 3)
  assert.equal(s.walls, 4)
})

test('caverna escura: subterrâneo, perigo de mob e lava perto', () => {
  const bot = fakeBot({ pos: { x: 0.5, y: 20, z: 0.5 }, fill: 'stone' })
  bot.box(-4, 20, -4, 4, 24, 4, 'cave_air')
  bot.set(3, 20, 0, 'lava')
  bot.light = 0
  bot.sky = 0
  const s = whereAmI(bot)
  assert.equal(s.env, 'caverna')
  assert.equal(s.layer, 'subsolo')
  assert.equal(s.openSky, false)
  assert.ok(s.dangers.some((d) => /lava a 3 \(L\)/.test(d)))
  assert.ok(s.dangers.some((d) => /mobs podem nascer/.test(d)))
})

test('túnel estreito: subterrâneo sem muito ar', () => {
  const bot = fakeBot({ pos: { x: 0.5, y: 10, z: 0.5 }, fill: 'stone' })
  bot.box(0, 10, -5, 0, 11, 5, 'air')
  const s = whereAmI(bot)
  assert.equal(s.env, 'tunel')
})

test('queda grande sob os pés vira perigo', () => {
  const bot = fakeBot()
  const s = whereAmI(bot)
  assert.ok(s.dangers.some((d) => /queda de 6\+ blocos/.test(d)))
})

test('waypoint mais perto na mesma dimensão e visitas da memória', () => {
  const bot = fakeBot()
  bot.box(-6, 63, -6, 6, 63, 6, 'grass_block')
  const waypoints = { list: () => [
    { name: 'base', position: { x: 40, y: 64, z: -40 }, dimension: 'overworld' },
    { name: 'mina', position: { x: 10, y: 64, z: 0 }, dimension: 'the_nether' }
  ] }
  const worldMemory = { exploredInfo: () => ({ n: 3 }) }
  const s = whereAmI(bot, { waypoints, worldMemory })
  assert.equal(s.nearest.name, 'base')
  assert.equal(s.nearest.direction, 'NE')
  assert.equal(s.visits, 3)
  const lines = describeSituation(s)
  assert.ok(lines.some((l) => /Mais perto: base a 57 blocos \(NE\); já passei aqui 3x/.test(l)))
  for (const l of lines) assert.ok(l.length <= 256)
})

test('na água e à noite', () => {
  const bot = fakeBot({ time: 18000 })
  bot.entity.isInWater = true
  const s = whereAmI(bot)
  assert.equal(s.env, 'agua')
  assert.equal(s.night, true)
})

test('sem entidade devolve null e texto amigável', () => {
  assert.equal(whereAmI({}), null)
  assert.deepEqual(describeSituation(null), ['Ainda não estou no mundo.'])
})
