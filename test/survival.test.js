const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const equipment = require('../lib/equipment')
const night = require('../lib/night')
const { Autonomy } = require('../lib/autonomy')

function fakeBot({ items = [], armor = {}, blocks = {}, food = 20, time = 1000 } = {}) {
  const slots = []
  const armorSlots = { head: 5, torso: 6, legs: 7, feet: 8 }
  for (const [dest, name] of Object.entries(armor)) slots[armorSlots[dest]] = { name }
  const inv = items.map(([name, count = 1]) => ({ name, count, type: name }))
  const equipped = []
  return {
    food,
    time: { timeOfDay: time },
    equipped,
    registry: {
      itemsByName: new Proxy({}, { get: (_t, name) => ({ id: name, name }) }),
      foodsByName: { cooked_beef: { effectiveQuality: 20 } }
    },
    inventory: { items: () => inv, slots },
    recipesAll: () => [],
    equip: async (item, dest) => { equipped.push([item.name, dest]) },
    blockAt: (pos) => {
      const name = blocks[pos.toString()] ?? 'stone'
      return { name, position: pos, boundingBox: ['air', 'cave_air', 'water', 'lava'].includes(name) ? 'empty' : 'block' }
    }
  }
}

test('veste a melhor armadura e não troca por pior', async () => {
  const bot = fakeBot({
    items: [['leather_helmet'], ['iron_helmet'], ['golden_chestplate'], ['leather_boots']],
    armor: { torso: 'diamond_chestplate' }
  })
  const worn = await equipment.equipBestArmor(bot)
  assert.deepEqual(worn.sort(), ['iron_helmet', 'leather_boots'])
  assert.ok(!bot.equipped.some(([name]) => name === 'golden_chestplate'))
})

test('noite: horário em que dá para dormir', () => {
  assert.equal(night.isNight(fakeBot({ time: 6000 })), false)
  assert.equal(night.isNight(fakeBot({ time: 13000 })), true)
  assert.equal(night.isNight(fakeBot({ time: 23500 })), false)
})

test('abrigo: não cava sobre caverna nem ao lado de água', () => {
  const ground = new Vec3(0, 63, 0)
  assert.equal(night.safeToDig(fakeBot(), ground), true)
  const cave = fakeBot({ blocks: { [new Vec3(0, 60, 0).toString()]: 'air' } })
  assert.equal(night.safeToDig(cave, ground), false)
  const water = fakeBot({ blocks: { [new Vec3(1, 62, 0).toString()]: 'water' } })
  assert.equal(night.safeToDig(water, ground), false)
})

test('autônomo: começa pela picareta e pula metas cumpridas', () => {
  const start = new Autonomy(fakeBot())
  assert.equal(start.next().name, 'picareta de madeira')
  const stone = new Autonomy(fakeBot({ items: [['stone_pickaxe'], ['stone_sword']] }))
  assert.equal(stone.next().name, 'machado de pedra')
})

test('autônomo: meta que falhou fica em espera', () => {
  const autonomy = new Autonomy(fakeBot())
  const first = autonomy.next()
  autonomy.failed(first)
  assert.notEqual(autonomy.next().name, first.name)
})
