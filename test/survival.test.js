const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const equipment = require('../lib/equipment')
const night = require('../lib/night')
const { Autonomy, FIRST_RETRY_MS } = require('../lib/autonomy')
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

test('abrigo não escolhe tronco nem folhas como superfície', () => {
  const treeBlocks = {
    [new Vec3(0, 63, 0).toString()]: 'birch_leaves',
    [new Vec3(0, 62, 0).toString()]: 'birch_log',
    [new Vec3(0, 61, 0).toString()]: 'air',
    [new Vec3(0, 60, 0).toString()]: 'dirt',
    [new Vec3(0, 59, 0).toString()]: 'dirt',
    [new Vec3(0, 58, 0).toString()]: 'dirt'
  }
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) treeBlocks[new Vec3(x, 64, z).toString()] = 'air'
  }
  const bot = fakeBot({ blocks: treeBlocks })
  bot.entity = { position: new Vec3(0, 64, 0) }
  const spot = night.findShelterSpot(bot)

  assert.ok(spot)
  assert.equal(spot.toString(), new Vec3(0, 60, 0).toString())
  assert.ok(['dirt', 'stone', 'cobblestone', 'grass_block'].includes(bot.blockAt(spot).name))
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

test('abrigo espera a terra cavada entrar no inventário antes de desistir', async () => {
  const items = []
  const bot = { inventory: { items: () => items } }
  setTimeout(() => items.push({ name: 'dirt', count: 3 }), 300) // pega o drop depois
  const item = await night.waitForCoverItem(bot, 2000)
  assert.equal(item?.name, 'dirt')
  assert.equal(await night.waitForCoverItem({ inventory: { items: () => [] } }, 200), null)
})

test('autonomia aumenta backoff progressivamente e zera após sucesso', () => {
  const bot = fakeBot({ items: [['stone_pickaxe'], ['stone_sword'], ['stone_axe'], ['furnace']], food: 20 })
  const autonomy = new Autonomy(bot)
  const goal = autonomy.next()
  const before = Date.now()

  autonomy.failed(goal)
  const firstUntil = autonomy.blockedUntil.get(goal.name)
  assert.ok(firstUntil >= before + FIRST_RETRY_MS - 1000)

  autonomy.failed(goal)
  const secondUntil = autonomy.blockedUntil.get(goal.name)
  assert.ok(secondUntil > firstUntil)
  assert.equal(autonomy.failures.get(goal.name), 2)

  autonomy.succeeded(goal)
  assert.equal(autonomy.failures.has(goal.name), false)
  assert.equal(autonomy.blockedUntil.has(goal.name), false)
})

test('abrigo só onde dá para tampar: pedra exige picareta, terra/grama saem com a mão', () => {
  const air = {}
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) for (let y = 64; y <= 66; y++) air[new Vec3(x, y, z).toString()] = 'air'
  const at = (extra, items) => { const b = fakeBot({ blocks: { ...air, ...extra }, items }); b.entity = { position: new Vec3(0, 64, 0) }; return b }
  assert.equal(night.findShelterSpot(at({}, [])), null)                                   // só pedra, sem picareta
  assert.ok(night.findShelterSpot(at({}, [['wooden_pickaxe']])))                          // com picareta
  assert.ok(night.findShelterSpot(at({}, [['dirt', 3]])))                                 // já tem a tampa
  const grass = {}
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) grass[new Vec3(x, 63, z).toString()] = 'grass_block'
  assert.equal(night.findShelterSpot(at(grass, [])), null)                               // grama sobre pedra: 1 bloco, não sai
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) for (const y of [61, 62]) grass[new Vec3(x, y, z).toString()] = 'dirt'
  assert.ok(night.findShelterSpot(at(grass, [])))                                         // grama+terra+terra: tampa e saída com a mão
  assert.equal(night.findShelterSpot(at({}, [['dirt', 2]])), null)                        // 2 blocos na mão + pedra: não sai
  assert.ok(night.findShelterSpot(at({}, [['dirt', 3]])))
})

test('sair do abrigo: espera a tampa cavada entrar no inventário antes de subir empilhando', async () => {
  const items = [{ name: 'dirt', count: 2 }]
  const lid = new Vec3(0, 70, 0), surface = new Vec3(0, 71, 0)
  let lidPresent = true
  const countsAtClimb = []
  const bot = {
    entity: { position: new Vec3(0.5, 68, 0.5) },
    inventory: { items: () => items },
    blockAt: (p) => {
      if (p.equals(lid)) return { name: lidPresent ? 'dirt' : 'air', boundingBox: lidPresent ? 'block' : 'empty', position: p }
      if (p.y <= 70) return { name: 'dirt', boundingBox: 'block', position: p }
      return { name: 'air', boundingBox: 'empty', position: p }
    },
    dig: async () => { lidPresent = false; setTimeout(() => { items[0].count++ }, 300) },
    pathfinder: { goto: async () => { countsAtClimb.push(items[0].count); bot.entity.position = new Vec3(1.5, 71, 0.5) }, setGoal: () => {} }
  }
  assert.equal(await night.leaveShelter(bot, lid, surface), true)
  assert.deepEqual(countsAtClimb, [3])
})

test('tampa recusada pelo servidor (bot ainda caindo) é tentada de novo depois de pousar', async () => {
  const ground = new Vec3(0, 70, 0)
  const dug = new Set()
  let attempts = 0
  const bot = {
    entity: { position: new Vec3(0.5, 71, 0.5), onGround: true },
    inventory: { items: () => (dug.size ? [{ name: 'dirt', count: dug.size }] : []) },
    blockAt: (p) => {
      const solid = p.y < 71 && !dug.has(p.toString())
      return { name: solid ? 'dirt' : 'air', boundingBox: solid ? 'block' : 'empty', position: p }
    },
    pathfinder: { bestHarvestTool: () => null },
    equip: async () => {},
    dig: async (block) => { dug.add(block.position.toString()); bot.entity.position = new Vec3(0.5, block.position.y, 0.5) },
    placeBlock: async () => { attempts++; if (attempts === 1) throw new Error('Server refused to place dirt: the block is still air') }
  }
  assert.equal(String(await night.digShelter(bot, ground, () => false)), String(ground))
  assert.equal(attempts, 2)
})

test('abrigo: sem chegar em cima do buraco (pathfinder resolveu sem mover) não cava', async () => {
  let digs = 0
  const bot = {
    entity: { position: new Vec3(5.5, 75, 0.5), onGround: true },
    inventory: { items: () => [] },
    blockAt: (p) => ({ name: p.y < 71 ? 'dirt' : 'air', boundingBox: p.y < 71 ? 'block' : 'empty', position: p }),
    pathfinder: { goto: async () => {}, setGoal: () => {}, bestHarvestTool: () => null },
    dig: async () => { digs++ }
  }
  await assert.rejects(night.digShelter(bot, new Vec3(0, 70, 0), () => false), /não cheguei/)
  assert.equal(digs, 0)
})

test('abrigo: sem picareta e só pedra até 8 blocos, acha terra até 16 (spawn do mundo novo)', () => {
  const blocks = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) for (let y = 64; y <= 66; y++) blocks[new Vec3(x, y, z).toString()] = 'air'
  for (let y = 61; y <= 63; y++) blocks[new Vec3(12, y, 3).toString()] = 'dirt'
  const bot = fakeBot({ blocks })
  bot.entity = { position: new Vec3(0, 64, 0) }
  const spots = night.findShelterSpots(bot)
  assert.equal(spots.length, 1)
  assert.equal(spots[0].toString(), new Vec3(12, 63, 3).toString())
})

test('abrigo: sem chegar ao primeiro lugar, tenta o próximo e passa a noite', async () => {
  const blocks = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) for (let y = 64; y <= 70; y++) blocks[new Vec3(x, y, z).toString()] = 'air'
  for (const x of [3, 9]) for (let y = 61; y <= 63; y++) blocks[new Vec3(x, y, 0).toString()] = 'dirt'
  const bot = fakeBot({ blocks, time: 1000 })
  bot.entity = { position: new Vec3(0.5, 64, 0.5), onGround: true }
  const items = []
  bot.inventory.items = () => items
  bot.findBlock = () => null
  bot.registry.blocksArray = []
  bot.pathfinder = {
    bestHarvestTool: () => null, setGoal: () => {},
    goto: async (goal) => { if (goal.x === 9) bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5) } // o primeiro (x=3) não alcança
  }
  bot.dig = async (block) => {
    blocks[block.position.toString()] = 'air'
    const d = items.find((i) => i.name === 'dirt'); if (d) d.count++; else items.push({ name: 'dirt', count: 1 })
    if (block.position.x === 9 && block.position.y < bot.entity.position.y) bot.entity.position = new Vec3(9.5, block.position.y, 0.5)
  }
  bot.placeBlock = async (_ref, _face) => {}
  const how = await night.spendNight(bot, () => false)
  assert.equal(how, 'abrigo')
})

test('sair do abrigo: sem conseguir subir empilhando, sai cavando uma escada', async () => {
  const pathfinderLib = require('mineflayer-pathfinder')
  const original = pathfinderLib.Movements
  const used = []
  pathfinderLib.Movements = function () { this.fake = true }
  try {
    const lid = new Vec3(0, 70, 0), surface = new Vec3(0, 71, 0)
    const bot = {
      entity: { position: new Vec3(0.5, 68, 0.5) },
      inventory: { items: () => [] },
      blockAt: (p) => ({ name: p.y <= 70 && !p.equals(lid) ? 'stone' : 'air', boundingBox: p.y <= 70 && !p.equals(lid) ? 'block' : 'empty', position: p }),
      dig: async () => {},
      pathfinder: {
        movements: { work: true },
        setMovements: (m) => { used.push(m) },
        setGoal: () => {},
        goto: async () => { if (used.length && used[used.length - 1].fake && used[used.length - 1].canDig) bot.entity.position = new Vec3(2.5, 71, 0.5) }
      }
    }
    assert.equal(await night.leaveShelter(bot, lid, surface), true)
    assert.equal(used[0].canDig, true)
    assert.deepEqual(used[used.length - 1], { work: true })   // movimentos de trabalho restaurados
  } finally { pathfinderLib.Movements = original }
})

test('abrigo: acha terra em morro mais alto que o bot (spawn junto à água)', () => {
  const blocks = {}
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) for (let y = 64; y <= 75; y++) blocks[new Vec3(x, y, z).toString()] = 'air'
  for (let x = 10; x <= 12; x++) for (let z = -5; z <= -3; z++) for (let y = 64; y <= 67; y++) blocks[new Vec3(x, y, z).toString()] = 'dirt' // morro 3x3, topo y=67
  const bot = fakeBot({ blocks })
  bot.entity = { position: new Vec3(0, 64, 0) }
  assert.equal(String(night.findShelterSpot(bot)), String(new Vec3(11, 67, -4)))
})
