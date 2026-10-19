const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { WorldMemory, STATUS } = require('../lib/world-memory')
const { observeSurroundings, verifyPlace, resourceKindForBlock } = require('../lib/world-observer')

const NAMES = ['air', 'cave_air', 'oak_log', 'stone', 'iron_ore', 'crafting_table', 'lava', 'dirt']
const registry = { blocksArray: NAMES.map((name, id) => ({ name, id })), blocksByName: Object.fromEntries(NAMES.map((name, id) => [name, { id }])) }

// Mundo fake: Map "x,y,z" -> nome; ausente = ar; chunk "unloaded" devolve null.
function fakeBot(pos = { x: 0, y: 64, z: 0 }, dimension = 'minecraft:overworld') {
  const world = new Map()
  const unloaded = new Set()
  const bot = {
    registry, game: { dimension }, entity: { position: new Vec3(pos.x, pos.y, pos.z) },
    set(x, y, z, name) { if (name) world.set(`${x},${y},${z}`, name); else world.delete(`${x},${y},${z}`) },
    unload(cx, cz) { unloaded.add(`${cx},${cz}`) },
    blockAt(p) {
      if (unloaded.has(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`)) return null
      return { name: world.get(`${p.x},${p.y},${p.z}`) || 'air', position: p }
    },
    findBlocks({ matching, maxDistance, count, point }) {
      const ids = new Set([].concat(matching)); const origin = point || bot.entity.position
      const out = []
      for (const [k, name] of world) {
        const [x, y, z] = k.split(',').map(Number); const p = new Vec3(x, y, z)
        if (ids.has(registry.blocksByName[name].id) && p.distanceTo(origin) <= maxDistance) out.push(p)
      }
      return out.sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin)).slice(0, count)
    }
  }
  return bot
}

test('tipo de recurso por bloco', () => {
  assert.equal(resourceKindForBlock('oak_log'), 'wood')
  assert.equal(resourceKindForBlock('deepslate_iron_ore'), 'iron')
  assert.equal(resourceKindForBlock('dirt'), null)
})

test('resume floresta em UMA região, pedra só exposta, mesa e cobertura', () => {
  const bot = fakeBot(); const wm = new WorldMemory()
  for (let i = 0; i < 12; i++) bot.set(5 + (i % 3), 64 + Math.floor(i / 3), 5, 'oak_log') // 12 toras no mesmo chunk
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) bot.set(-4 + x, 64, -4 + z, 'stone') // exposta
  bot.set(8, 64, 8, 'crafting_table')
  const s = observeSurroundings(bot, wm, { by: 'w1' })
  assert.equal(s.found.wood, 1)
  assert.equal(s.found.stone, 1)
  assert.equal(s.found.crafting_table, 1)
  assert.equal([...wm.places.values()].filter((p) => p.kind === 'wood').length, 1) // não 12
  assert.equal(wm.exploredRecently('overworld', { x: 0, y: 64, z: 0 }), true)
})

test('mesa removida: a lembrança é invalidada ao reobservar', () => {
  const bot = fakeBot(); const wm = new WorldMemory()
  bot.set(3, 64, 3, 'crafting_table')
  observeSurroundings(bot, wm)
  const table = wm.find('crafting_table', 'overworld', { x: 3, y: 64, z: 3 })
  assert.equal(table.status, STATUS.CONFIRMED)
  bot.set(3, 64, 3, null) // ar
  const s = observeSurroundings(bot, wm)
  assert.equal(s.reconciled.invalidated, 1)
  assert.equal(wm.find('crafting_table', 'overworld', { x: 3, y: 64, z: 3 }).status, STATUS.INVALIDATED)
})

test('árvore cortada: região de madeira invalidada; árvore vizinha mantém a região', () => {
  const bot = fakeBot(); const wm = new WorldMemory()
  bot.set(4, 64, 4, 'oak_log'); bot.set(4, 65, 4, 'oak_log')
  observeSurroundings(bot, wm)
  const wood = () => [...wm.places.values()].find((p) => p.kind === 'wood')
  assert.equal(wood().status, STATUS.CONFIRMED)
  bot.set(4, 64, 4, null) // âncora cortada, mas ainda há tronco a 1 bloco
  observeSurroundings(bot, wm)
  assert.equal(wood().status, STATUS.CONFIRMED)
  bot.set(4, 65, 4, null)
  observeSurroundings(bot, wm)
  assert.equal(wood().status, STATUS.INVALIDATED)
})

test('chunk não carregado é inconclusivo: nunca invalida', () => {
  const bot = fakeBot({ x: 0, y: 64, z: 0 }); const wm = new WorldMemory()
  bot.set(3, 64, 3, 'crafting_table')
  observeSurroundings(bot, wm)
  bot.unload(0, 0)
  const place = [...wm.places.values()].find((p) => p.kind === 'crafting_table')
  assert.equal(verifyPlace(bot, wm, place), false)
  assert.equal(place.status, STATUS.CONFIRMED)
})

test('dimensões: observação no Nether não toca o Overworld', () => {
  const ow = fakeBot(); const nether = fakeBot({ x: 0, y: 64, z: 0 }, 'minecraft:the_nether'); const wm = new WorldMemory()
  ow.set(3, 64, 3, 'crafting_table')
  observeSurroundings(ow, wm)
  const s = observeSurroundings(nether, wm) // nada no Nether na mesma coordenada
  assert.equal(s.reconciled.invalidated, 0)
  assert.equal(wm.find('crafting_table', 'overworld', { x: 3, y: 64, z: 3 }).status, STATUS.CONFIRMED)
})

test('lava vira hazard e caverna vira mine_entry', () => {
  const bot = fakeBot(); const wm = new WorldMemory()
  bot.set(6, 60, 0, 'lava')
  for (let i = 0; i < 10; i++) bot.set(4 + i, 62, 0, 'cave_air')
  const s = observeSurroundings(bot, wm)
  assert.equal(s.found.lava, 1)
  assert.equal(s.found.mine_entry, 1)
})
