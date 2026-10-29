const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const handover = require('../lib/handover')

const lapis = (count, type = 501) => ({ type, name: 'lapis_lazuli', count })
const CHEST = handover.DELIVERY_CHEST

function fakeBot({ items = [], owner = null, chestAt = CHEST, chestName = 'chest', ground = 'stone', at = { x: 0, y: 64, z: 0, distanceTo: () => 1 } } = {}) {
  owner = owner || { position: { x: 0, y: 64, z: 0, distanceTo: () => 1, offset: () => ({ x: 0, y: 65, z: 0 }) } }
  const inventory = items.slice()
  const tossed = []
  const stats = { opened: 0, deposited: [], gotos: 0, closed: 0, placed: [] }
  const world = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const groundY = CHEST.y - 1
  let chestPos = chestAt ? { x: chestAt.x, y: chestAt.y, z: chestAt.z } : null
  if (chestPos) world.set(key(chestPos.x, chestPos.y, chestPos.z), chestName)
  const container = {
    slots: [],
    deposit: async (type, _meta, count) => {
      stats.deposited.push({ type, count })
      const index = inventory.findIndex((i) => i.type === type)
      if (index < 0) throw new Error('item ausente')
      const name = inventory[index].name
      inventory[index].count -= count
      if (inventory[index].count <= 0) inventory.splice(index, 1)
      container.slots.push({ type, name, count })
    },
    containerItems: () => container.slots,
    close: () => { stats.closed++ }
  }
  const blockAt = (pos) => {
    const name = world.get(key(pos.x, pos.y, pos.z)) || (pos.y === groundY ? ground : 'air')
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      position: new Vec3(pos.x, pos.y, pos.z)
    }
  }
  const bot = {
    inventory: { items: () => inventory },
    entity: { position: at },
    players: {},
    tossed,
    stats,
    world,
    pathfinder: { goto: async () => { stats.gotos++ }, setGoal: () => {} },
    lookAt: async () => {},
    toss: async (type, _meta, count) => {
      tossed.push({ type, count })
      const index = inventory.findIndex((i) => i.type === type)
      if (index < 0) throw new Error('item ausente')
      inventory[index].count -= count
      if (inventory[index].count <= 0) inventory.splice(index, 1)
    },
    blockAt,
    equip: async (item) => { stats.equipped = item.name },
    placeBlock: async (floor, offset) => {
      const x = floor.position.x + offset.x
      const y = floor.position.y + offset.y
      const z = floor.position.z + offset.z
      world.set(key(x, y, z), 'chest')
      chestPos = { x, y, z }
      stats.placed.push({ x, y, z })
    },
    openContainer: async () => { stats.opened++; return container }
  }
  return { bot, inventory, owner, container, chestPos: () => chestPos }
}

test('normaliza apelidos de item do chat', () => {
  assert.equal(handover.normalizeItem('lapis'), 'lapis_lazuli')
  assert.equal(handover.normalizeItem('Lápis'), 'lapis_lazuli')
  assert.equal(handover.normalizeItem('lapis lazuli'), 'lapis_lazuli')
  assert.equal(handover.normalizeItem('iron_ingot'), 'iron_ingot')
  assert.equal(handover.normalizeItem('bolo'), 'cake')
})

test('separa a entrega entre pilhas e informa o que falta', () => {
  const items = [lapis(32), { type: 9, name: 'dirt', count: 3 }, lapis(32)]
  const full = handover.planHandover(items, 'lapis_lazuli', 40)
  assert.deepEqual(full.plan.map((p) => p.count), [32, 8])
  assert.equal(full.missing, 0)
  const short = handover.planHandover(items, 'lapis_lazuli', 100)
  assert.equal(short.plan.reduce((s, p) => s + p.count, 0), 64)
  assert.equal(short.missing, 36)
})

test('acha o baú no ponto combinado', () => {
  const { bot } = fakeBot()
  const found = handover.findContainer(bot, CHEST)
  assert.equal(found.name, 'chest')
  assert.deepEqual([found.position.x, found.position.y, found.position.z], [CHEST.x, CHEST.y, CHEST.z])
})

test('respeita uma variante de baú posta ao lado', () => {
  const { bot } = fakeBot({ chestAt: { x: CHEST.x + 1, y: CHEST.y, z: CHEST.z }, chestName: 'barrel' })
  assert.equal(handover.findContainer(bot, CHEST).name, 'barrel')
})

test('sem baú no endereço e sem permissão de criar informa claramente', async () => {
  const { bot } = fakeBot({ items: [lapis(10)], chestAt: null })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 5, allowCreate: false })
  assert.equal(result.ok, false)
  assert.match(result.reason, /não achei baú em -241, 64, -11/)
  assert.equal(bot.stats.opened, 0)
})

test('coloca um baú no endereço quando ele não existe', async () => {
  const chestItem = { type: 900, name: 'chest', count: 1 }
  const { bot, chestPos } = fakeBot({ items: [lapis(10), chestItem], chestAt: null })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 5 })
  assert.equal(result.created, true)
  assert.equal(result.ok, true)
  assert.equal(result.deposited, 5)
  assert.equal(bot.stats.placed.length, 1)
  assert.deepEqual(chestPos(), CHEST)
})

test('prepara o baú na mochila antes de caminhar', async () => {
  const { bot, inventory } = fakeBot({ items: [] })
  const asked = []
  const ok = await handover.prepareChestItem(bot, {
    withdraw: async (name) => { asked.push(name); inventory.push({ type: 5, name: 'oak_planks', count: 8 }); return 8 },
    craftItem: async (_bot, name) => { inventory.push({ type: 900, name, count: 1 }) }
  })
  assert.equal(ok, true)
  assert.deepEqual(asked, ['oak_planks'])
})

test('preparar baú não faz nada quando já tem um', async () => {
  const { bot } = fakeBot({ items: [{ type: 900, name: 'chest', count: 1 }] })
  let touched = false
  const ok = await handover.prepareChestItem(bot, { withdraw: async () => { touched = true; return 0 } })
  assert.equal(ok, true)
  assert.equal(touched, false)
})

test('preparar baú falha honestamente sem material', async () => {
  const { bot } = fakeBot({ items: [] })
  const ok = await handover.prepareChestItem(bot, { withdraw: async () => 0, craftItem: async () => {} })
  assert.equal(ok, false)
})

test('pega tábuas do estoque antes de fabricar o baú', async () => {
  const { bot, inventory } = fakeBot({ items: [lapis(3)], chestAt: null })
  const asked = []
  const result = await handover.depositAtChest(bot, {
    name: 'lapis',
    amount: 3,
    withdraw: async (name) => { asked.push(name); inventory.push({ type: 5, name: 'oak_planks', count: 8 }); return 8 },
    craftItem: async (_bot, name) => { inventory.push({ type: 900, name, count: 1 }) }
  })
  assert.deepEqual(asked, ['oak_planks'])
  assert.equal(result.created, true)
  assert.equal(result.ok, true)
})

test('fabrica o baú quando não há nenhum no inventário', async () => {
  const { bot, inventory } = fakeBot({ items: [lapis(4)], chestAt: null })
  const crafted = []
  const result = await handover.depositAtChest(bot, {
    name: 'lapis',
    amount: 4,
    craftItem: async (_bot, name) => { crafted.push(name); inventory.push({ type: 900, name, count: 1 }) }
  })
  assert.deepEqual(crafted, ['chest'])
  assert.equal(result.created, true)
  assert.equal(result.ok, true)
})

test('sem baú e sem material devolve motivo honesto', async () => {
  const { bot } = fakeBot({ items: [lapis(2)], chestAt: null })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 2 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /não tenho baú/)
})

test('confirma o baú mesmo quando o servidor demora a avisar', async () => {
  const chestItem = { type: 900, name: 'chest', count: 1 }
  const { bot } = fakeBot({ items: [lapis(2), chestItem], chestAt: null })
  // O primeiro placeBlock "demora": o mundo só recebe o baú depois de 2 leituras.
  const realPlace = bot.placeBlock
  let calls = 0
  bot.placeBlock = async (floor, offset) => {
    calls++
    if (calls === 1) setTimeout(() => realPlace(floor, offset), 0)
    else await realPlace(floor, offset)
    throw new Error('Event blockUpdate did not fire within timeout of 5000ms')
  }
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
})

test('não coloca baú em cima de lava', () => {
  const { bot } = fakeBot({ chestAt: null, ground: 'lava' })
  assert.equal(handover.findPlaceSpot(bot, CHEST), null)
})

test('leva o lápis até o baú, deposita e confirma nas duas pontas', async () => {
  const { bot, inventory, container } = fakeBot({ items: [lapis(40)] })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 30 })
  assert.equal(result.ok, true)
  assert.equal(result.deposited, 30)
  assert.equal(result.remaining, 10)
  assert.equal(result.inside, 30)
  assert.deepEqual(result.chest, CHEST)
  assert.equal(bot.stats.gotos, 1)
  assert.equal(baseStatsClosed(bot), 1)
  assert.equal(inventory[0].count, 10)
  assert.equal(container.slots[0].count, 30)
})

const baseStatsClosed = (bot) => bot.stats.closed

test('não abre o baú quando não tem o item', async () => {
  const { bot } = fakeBot({ items: [{ type: 9, name: 'dirt', count: 3 }] })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 5 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /não tenho lapis_lazuli/)
  assert.equal(bot.stats.opened, 0)
})

test('cancelado antes de caminhar não mexe no baú', async () => {
  const { bot } = fakeBot({ items: [lapis(10)] })
  const result = await handover.depositAtChest(bot, { name: 'lapis', amount: 5, isCancelled: () => true })
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(bot.stats.opened, 0)
})

test('derrubar no chão tira os itens da mochila', async () => {
  const { bot, inventory } = fakeBot({ items: [{ type: 900, name: 'cake', count: 5 }] })
  const result = await handover.dropItems(bot, { name: 'bolo', amount: 5 })
  assert.equal(result.dropped, 5)
  assert.equal(inventory.filter((item) => item.name === 'cake').length, 0)
  assert.deepEqual(bot.tossed, [{ type: 900, count: 5 }])
})

test('derrubar sem o item informa honestamente', async () => {
  const { bot } = fakeBot({ items: [] })
  const result = await handover.dropItems(bot, { name: 'bolo', amount: 3 })
  assert.equal(result.dropped, 0)
  assert.match(result.reason, /não tenho cake/)
})

test('entrega na mão continua funcionando', async () => {
  const { bot, owner } = fakeBot({ items: [lapis(40)] })
  const result = await handover.deliverTo(bot, { owner, name: 'lapis', amount: 30 })
  assert.equal(result.ok, true)
  assert.equal(result.delivered, 30)
  assert.deepEqual(bot.tossed, [{ type: 501, count: 30 }])
})

test('não entrega sem jogador por perto', async () => {
  const { bot } = fakeBot({ items: [lapis(10)] })
  const result = await handover.deliverTo(bot, { owner: null, name: 'lapis', amount: 5 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /não vejo você/)
})
