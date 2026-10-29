const test = require('node:test')
const assert = require('node:assert/strict')
const { StorageManager } = require('../core/StorageManager')

// Mundo fake: baús por posição, cada um com capacidade em itens.
function world(capacity) {
  const chests = new Map()
  const inv = []
  const bot = { username: 'minerador_01', registry: { foodsByName: {} }, inventory: { items: () => inv.filter((i) => i.count > 0) } }
  const give = (name, type, count) => inv.push({ name, type, count })
  const chest = (key) => {
    if (!chests.has(key)) chests.set(key, [])
    return chests.get(key)
  }
  const container = (key) => {
    const items = chest(key)
    const used = () => items.reduce((s, i) => s + i.count, 0)
    return {
      containerItems: () => items.filter((i) => i.count > 0),
      deposit: async (type, _m, amount) => {
        const src = inv.find((i) => i.type === type && i.count > 0)
        const fits = Math.min(amount, capacity - used(), src.count)
        if (fits > 0) {
          src.count -= fits
          const slot = items.find((i) => i.type === type)
          if (slot) slot.count += fits
          else items.push({ name: src.name, type, count: fits })
        }
        if (fits < amount) throw new Error('destination full')
      },
      withdraw: async (type, _m, amount) => {
        const slot = items.find((i) => i.type === type)
        slot.count -= amount
        const mine = inv.find((i) => i.type === type)
        if (mine) mine.count += amount
        else inv.push({ name: slot.name, type, count: amount })
      }
    }
  }
  return { chests, bot, give, container }
}

function storageFor(w, { expand = true } = {}) {
  const storage = new StorageManager()
  storage.setPosition({ x: 0, y: 64, z: 0 })
  storage.withContainer = async (_bot, fn, { at } = {}) => {
    const p = at || storage.position
    const key = `${p.x},${p.y},${p.z}`
    if (!w.chests.has(key) && key !== '0,64,0') throw new Error('o container configurado para o estoque não está disponível')
    return fn(w.container(key))
  }
  const created = []
  if (expand) {
    storage.expandContainer = async (_bot, anchor) => {
      const position = { x: anchor.x + 1, y: anchor.y, z: anchor.z }
      w.chests.set(`${position.x},${position.y},${position.z}`, [])
      created.push(position)
      return { name: 'chest', position }
    }
  }
  return { storage, created }
}

test('baú cheio: coloca outro ao lado e guarda o resto nele', async () => {
  const w = world(100)
  w.give('raw_iron', 1, 64); w.give('diamond', 2, 41); w.give('coal', 3, 30)
  const { storage, created } = storageFor(w)
  const got = await storage.depositCargo(w.bot)
  assert.deepEqual(got, { raw_iron: 64, diamond: 41, coal: 30 })
  assert.equal(created.length, 1)
  assert.deepEqual(storage.getExtras(), [{ x: 1, y: 64, z: 0 }])
  assert.equal(w.bot.inventory.items().length, 0)
  assert.deepEqual(storage.cachedSummary(), { raw_iron: 64, diamond: 41, coal: 30 })
})

test('com espaço no extra não cria outro baú', async () => {
  const w = world(100)
  const { storage, created } = storageFor(w)
  storage.setExtras([{ x: 1, y: 64, z: 0 }])
  w.chests.set('1,64,0', [])
  w.give('raw_gold', 1, 150)
  await storage.depositMany(w.bot, { raw_gold: 150 })
  assert.equal(created.length, 0)
  assert.equal(w.chests.get('0,64,0')[0].count, 100)
  assert.equal(w.chests.get('1,64,0')[0].count, 50)
})

test('sem como criar baú, guarda o que cabe e mantém o resto na mochila', async () => {
  const w = world(10)
  w.give('lapis_lazuli', 1, 25)
  const { storage } = storageFor(w, { expand: false })
  const got = await storage.depositCargo(w.bot)
  assert.deepEqual(got, { lapis_lazuli: 10 })
  assert.equal(w.bot.inventory.items()[0].count, 15)
})

test('retirada procura em todos os baús e extra sumido sai da lista', async () => {
  const w = world(100)
  const { storage } = storageFor(w)
  storage.setExtras([{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }])
  w.chests.set('1,64,0', [{ name: 'iron_pickaxe', type: 9, count: 1 }])
  const got = await storage.withdraw(w.bot, 'iron_pickaxe', 1)
  assert.equal(got, 1)
  await storage.summary(w.bot)
  assert.deepEqual(storage.getExtras(), [{ x: 1, y: 64, z: 0 }])
})

test('estoque redefinido longe descarta os extras antigos', () => {
  const storage = new StorageManager()
  storage.setPosition({ x: 0, y: 64, z: 0 })
  storage.setExtras([{ x: 1, y: 64, z: 0 }])
  storage.setPosition({ x: 2, y: 64, z: 0 })
  assert.deepEqual(storage.getExtras(), [{ x: 1, y: 64, z: 0 }])
  storage.setPosition({ x: 200, y: 64, z: 0 })
  assert.deepEqual(storage.getExtras(), [])
})

test('quem está fazendo o baú não trava guardando a madeira no meio', async () => {
  const w = world(10)
  w.give('granite', 1, 30)
  const { storage } = storageFor(w, { expand: false })
  storage.expandContainer = async (bot, anchor) => {
    // A coleta de madeira termina com depositCargo: não pode esperar o próprio baú.
    w.give('oak_log', 2, 3)
    const during = await storage.depositCargo(bot)
    assert.deepEqual(during, {})
    const position = { x: anchor.x + 1, y: anchor.y, z: anchor.z }
    w.chests.set('1,64,0', [])
    return { name: 'chest', position }
  }
  const got = await storage.depositMany(w.bot, { granite: 30 })
  assert.equal(got.granite, 20)
  assert.equal(w.bot.inventory.items().find((i) => i.name === 'oak_log').count, 3)
})
