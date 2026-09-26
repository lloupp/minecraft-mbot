const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const equipment = require('../lib/equipment')
const night = require('../lib/night')
const { Autonomy } = require('../lib/autonomy')
const { detectProfile, normalizeVersion, PROFILE_IDS } = require('../lib/serverProfile')

function fakeBot({ items = [], armor = {}, blocks = {}, food = 20, time = 1000, copper = false } = {}) {
  const slots = []
  const armorSlots = { head: 5, torso: 6, legs: 7, feet: 8 }
  for (const [dest, name] of Object.entries(armor)) slots[armorSlots[dest]] = { name }

  const itemNames = [
    'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe',
    'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword',
    'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe',
    'furnace', 'torch', 'shield',
    'iron_chestplate', 'iron_leggings', 'iron_helmet', 'iron_boots'
  ]
  if (copper) itemNames.push('copper_pickaxe', 'copper_sword', 'copper_axe')

  const itemsByName = Object.fromEntries(itemNames.map((name, id) => [name, { id: id + 1, name }]))
  const inv = items.map(([name, count = 1]) => {
    if (!itemsByName[name]) itemsByName[name] = { id: Object.keys(itemsByName).length + 1, name }
    return { name, count, type: itemsByName[name].id }
  })

  const equipped = []
  return {
    food,
    time: { timeOfDay: time },
    equipped,
    registry: {
      itemsByName,
      blocksByName: { coal_ore: { id: 1 }, iron_ore: { id: 2 } },
      foodsByName: { cooked_beef: { effectiveQuality: 20 } }
    },
    inventory: { items: () => inv, slots },
    recipesAll: () => [],
    equip: async (item, dest) => { equipped.push([item.name, dest]) },
    blockAt: (pos) => {
      const name = blocks[pos.toString()] ?? 'stone'
      return {
        name,
        position: pos,
        boundingBox: ['air', 'cave_air', 'water', 'lava'].includes(name) ? 'empty' : 'block'
      }
    }
  }
}

test('perfil detecta servidor 1.20.1 sem patches Forge 26.3', () => {
  const profile = detectProfile('Paper 1.20.1')
  assert.equal(profile.id, PROFILE_IDS.VANILLA_1201)
  assert.equal(profile.useForge, false)
  assert.equal(profile.useProtocolPatches, false)
  assert.equal(normalizeVersion('Paper 1.20.1'), '1.20.1')
})

test('perfil 26.3 mantém Forge e patches de protocolo', () => {
  const profile = detectProfile('26.3')
  assert.equal(profile.id, PROFILE_IDS.FORGE_263)
  assert.equal(profile.useForge, true)
  assert.equal(profile.useProtocolPatches, true)
})

test('perfil pode ser forçado para 1.20.1', () => {
  const profile = detectProfile('qualquer', 'vanilla1201')
  assert.equal(profile.version, '1.20.1')
  assert.equal(profile.useProtocolPatches, false)
})

test('equipamento ignora tier cobre quando a versão não possui cobre', () => {
  const bot = fakeBot({ items: [['stone_pickaxe']] })
  const tiers = equipment.availableToolTiers(bot, 'pickaxe').map((entry) => entry.tier)
  assert.deepEqual(tiers, ['diamond', 'iron', 'stone', 'wooden'])
})

test('veste a melhor armadura e não troca por pior', async () => {
  const bot = fakeBot({
    items: [['leather_helmet'], ['iron_helmet'], ['golden_chestplate'], ['leather_boots']],
    armor: { torso: 'diamond_chestplate' }
  })
  const worn = await equipment.equipBestArmor(bot)
  assert.deepEqual(worn.sort(), ['iron_helmet', 'leather_boots'])
  assert.equal(bot.equipped.some(([name]) => name === 'golden_chestplate'), false)
})

test('noite reconhece janela de sono', () => {
  assert.equal(night.isNight(fakeBot({ time: 6000 })), false)
  assert.equal(night.isNight(fakeBot({ time: 13000 })), true)
  assert.equal(night.isNight(fakeBot({ time: 23500 })), false)
})

test('abrigo evita caverna e água lateral', () => {
  const ground = new Vec3(0, 63, 0)
  assert.equal(night.safeToDig(fakeBot(), ground), true)
  const cave = fakeBot({ blocks: { [new Vec3(0, 60, 0).toString()]: 'air' } })
  assert.equal(night.safeToDig(cave, ground), false)
  const water = fakeBot({ blocks: { [new Vec3(1, 62, 0).toString()]: 'water' } })
  assert.equal(night.safeToDig(water, ground), false)
})

test('autonomia pula metas já cumpridas e respeita cooldown de falha', () => {
  const bot = fakeBot({ items: [['stone_pickaxe'], ['stone_sword'], ['stone_axe'], ['furnace']], food: 20 })
  const autonomy = new Autonomy(bot)
  const first = autonomy.next()
  assert.equal(first.name, 'carvão')
  autonomy.failed(first)
  assert.notEqual(autonomy.next()?.name, first.name)
})


test('Forge 1.20.1 usa camada Forge sem patches exclusivos do 26.3', () => {
  const profile = detectProfile('Forge 1.20.1')
  assert.equal(profile.id, PROFILE_IDS.FORGE)
  assert.equal(profile.useForge, true)
  assert.equal(profile.useProtocolPatches, false)
})
