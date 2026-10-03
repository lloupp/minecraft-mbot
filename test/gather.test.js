const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const gather = require('../lib/gather')

test('mineBlocks não volta a tentar na tarefa seguinte um bloco inalcançável', async () => {
  const far = new Vec3(10, 64, 0) // inalcançável
  const near = new Vec3(20, 64, 0)
  const logs = new Set([far.toString(), near.toString()])
  const tried = []
  const inventoryItems = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] },
    entities: {},
    inventory: { items: () => inventoryItems },
    findBlocks: () => [far, near].filter((p) => logs.has(p.toString())),
    blockAt: (pos) => ({ name: logs.has(pos.toString()) ? 'oak_log' : 'air', position: pos }),
    pathfinder: {
      goto: async (goal) => {
        tried.push(`${goal.x},${goal.z}`)
        if (goal.x === far.x) throw new Error('Took to long to decide path to goal!')
      },
      bestHarvestTool: () => null
    },
    equip: async () => {},
    dig: async (block) => {
      logs.delete(block.position.toString())
      inventoryItems.push({ name: block.name, count: 1 })
    }
  }
  const log = console.log
  console.log = () => {}
  try {
    assert.equal(await gather.mineBlocks(bot, (n) => n === 'oak_log', 1, () => false), 1)
    logs.add(near.toString()) // árvore nova perto
    tried.length = 0
    assert.equal(await gather.mineBlocks(bot, (n) => n === 'oak_log', 1, () => false), 1)
  } finally {
    console.log = log
  }
  assert.deepEqual(tried, ['20,0']) // não perdeu tempo com a tora inalcançável
})

// Reproduz o bug real observado em 1.20.1: perto/dentro da água o bloco quebra
// mas o drop nunca chega ao inventário (flutua, afunda ou é levado pela
// correnteza). mineBlocks não pode contar isso como coleta bem-sucedida.
test('mineBlocks não conta o bloco como coletado se o drop não entra no inventário', async () => {
  const pos = new Vec3(13, 70, 13)
  let broken = false
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'dirt' }] },
    entities: {},
    inventory: { items: () => [] }, // drop nunca entra: perdido na água
    findBlocks: () => (broken ? [] : [pos]),
    blockAt: (p) => ({ name: p.equals(pos) && !broken ? 'dirt' : 'air', position: p }),
    pathfinder: { goto: async () => {}, bestHarvestTool: () => null },
    equip: async () => {},
    dig: async () => { broken = true } // bloco quebra de verdade, mas sem drop coletado
  }
  const log = console.log
  console.log = () => {}
  let mined
  try {
    mined = await gather.mineBlocks(bot, (n) => n === 'dirt', 1, () => false)
  } finally {
    console.log = log
  }
  assert.equal(mined, 0) // sem evidência de coleta, não é sucesso
  assert.equal(broken, true) // o bloco foi mesmo destruído (não é um "pulou por inalcançável")
})

function collectionBot({ drop = 'oak_log', afterDig = () => {}, afterNavigate = () => {} } = {}) {
  const pos = new Vec3(2, 64, 2)
  let present = true
  const items = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log', drops: [10] }], items: { 10: { name: 'oak_log' } } },
    entities: {}, inventory: { items: () => items },
    findBlocks: () => present ? [pos] : [],
    blockAt: (p) => ({ name: p.equals(pos) && present ? 'oak_log' : 'air', position: p }),
    pathfinder: { goto: async () => afterNavigate(() => { present = false }), bestHarvestTool: () => null },
    dig: async () => { present = false; if (drop) items.push({ name: drop, count: 1 }); afterDig() }
  }
  return bot
}

test('coleta confirma o item esperado, não qualquer crescimento do inventário', async () => {
  assert.equal(await gather.mineBlocks(collectionBot(), n => n === 'oak_log', 1, () => false), 1)
  const attempts = []
  assert.equal(await gather.mineBlocks(collectionBot({ drop: 'oak_planks' }), n => n === 'oak_log', 1, () => false,
    { onAttempt: e => attempts.push(e) }), 0)
  assert.equal(attempts[0].code, 'ITEM_NOT_CONFIRMED')
  assert.equal(attempts[0].delta, 0)
})

test('cancelamento após dig preserva confirmação de item já adquirido', async () => {
  let cancelled = false
  const bot = collectionBot({ afterDig: () => { cancelled = true } })
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => cancelled, { onAttempt: e => attempts.push(e) }), 1)
  assert.equal(attempts[0].code, 'CANCELLED')
  assert.equal(attempts[0].itemConfirmed, true)
  assert.equal(attempts[0].delta, 1)
})

test('recurso desaparecido durante navegação não é cavado nem confirmado', async () => {
  const bot = collectionBot({ afterNavigate: remove => remove() })
  bot.dig = async () => assert.fail('não pode cavar recurso desaparecido')
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false, { onAttempt: e => attempts.push(e) }), 0)
  assert.equal(attempts[0].code, 'RESOURCE_NOT_FOUND')
})

test('dois coletores mantêm delta e cancelamento independentes', async () => {
  let cancelled = false
  const one = collectionBot({ afterDig: () => { cancelled = true } })
  const two = collectionBot()
  const results = await Promise.all([
    gather.mineBlocks(one, n => n === 'oak_log', 1, () => cancelled),
    gather.mineBlocks(two, n => n === 'oak_log', 1, () => false)
  ])
  assert.deepEqual(results, [1, 1])
})

test('stone confirma cobblestone e recusa inventário cheio', async () => {
  const bot = collectionBot()
  const drops = gather.expectedDrops({ registry: { blocksByName: { stone: { drops: [22] } }, items: { 22: { name: 'cobblestone' } } } }, { name: 'stone' })
  assert.deepEqual([...drops], ['cobblestone'])
  Object.assign(bot.inventory, { inventoryStart: 9, inventoryEnd: 45, slots: Array(45).fill({ name: 'dirt', count: 64, stackSize: 64 }) })
  bot.dig = async () => assert.fail('não deve destruir com inventário cheio')
  const attempts = []
  assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false, { onAttempt: e => attempts.push(e) }), 0)
  assert.equal(attempts[0].code, 'INVENTORY_FULL')
})

test('coleta distingue erro de dig de recurso fora de alcance físico', async () => {
  for (const code of ['DIG_FAILED', 'RESOURCE_UNREACHABLE']) {
    const bot = collectionBot()
    if (code === 'DIG_FAILED') bot.dig = async () => { throw new Error('servidor rejeitou dig') }
    else bot.canDigBlock = () => false
    const attempts = []
    assert.equal(await gather.mineBlocks(bot, n => n === 'oak_log', 1, () => false, { onAttempt: e => attempts.push(e) }), 0)
    assert.equal(attempts[0].code, code)
  }
})

test('drop esperado acompanha a ferramenta escolhida com silk touch', () => {
  const bot = { registry: { blocksByName: { stone: { drops: [22] } }, items: { 22: { name: 'cobblestone' } }, itemsByName: { stone: { id: 1 } } } }
  assert.deepEqual([...gather.expectedDrops(bot, { name: 'stone' }, { enchants: [{ name: 'silk_touch' }] })], ['stone'])
})

test('collectDrops cai para uma célula adjacente quando o alvo exato do drop é inalcançável', async () => {
  const food = require('../lib/food')
  const drop = { name: 'item', isValid: true, position: new Vec3(3.05, 64, 2.28), getDroppedItem: () => ({ name: 'oak_log' }) }
  const goalsTried = []
  let picked = false
  const bot = {
    entities: { 1: drop },
    pathfinder: {
      setGoal() {},
      goto: async (goal) => {
        goalsTried.push(Math.sqrt(goal.rangeSq))
        if (goal.rangeSq < 1) throw new Error('No path to the goal!') // célula sem altura sob os troncos
        picked = true; drop.isValid = false
      }
    }
  }
  await food.collectDrops(bot, new Vec3(3, 64, 2), () => false, { timeoutMs: 3000, done: () => picked })
  assert.deepEqual(goalsTried, [0.5, 1])
  assert.equal(picked, true)
})

test('collectDrops empurra o bot ao drop quando o fallback para fora da janela de coleta e sempre solta o controle', async () => {
  const food = require('../lib/food')
  const drop = { name: 'item', isValid: true, position: new Vec3(3.23, 64, 2.28), getDroppedItem: () => ({ name: 'oak_log' }) }
  const controls = []
  const bot = {
    entities: { 1: drop },
    entity: { position: new Vec3(4.67, 64, 2.4) }, // 1,44 do item: fora da janela de 1,425
    lookAt: async () => {},
    setControlState: (name, on) => { controls.push([name, on]); if (on) setTimeout(() => { drop.isValid = false }, 120) },
    pathfinder: { setGoal() {}, goto: async (goal) => { if (goal.rangeSq < 1) throw new Error('No path to the goal!') } }
  }
  await food.collectDrops(bot, new Vec3(3, 64, 2), () => false, { timeoutMs: 3000 })
  assert.deepEqual(controls, [['forward', true], ['forward', false]])
})

test('collectDrops empurra o bot também quando o goto exato resolve sem se mover (nicho inalcançável)', async () => {
  const food = require('../lib/food')
  const drop = { name: 'item', isValid: true, position: new Vec3(3.05, 64, 2.28), getDroppedItem: () => ({ name: 'oak_log' }) }
  const goals = []
  const controls = []
  const bot = {
    entities: { 1: drop },
    entity: { position: new Vec3(4.55, 64, 2.4) }, // 1,5 do item: fora da janela de coleta (1,425)
    lookAt: async () => {},
    setControlState: (name, on) => { controls.push([name, on]); if (on) setTimeout(() => { drop.isValid = false }, 100) },
    pathfinder: { setGoal() {}, goto: async (goal) => { goals.push(Math.sqrt(goal.rangeSq)) } } // resolve sem mover
  }
  await food.collectDrops(bot, new Vec3(3, 64, 2), () => false, { timeoutMs: 3000 })
  assert.deepEqual(goals, [0.5])
  assert.deepEqual(controls, [['forward', true], ['forward', false]])
})

test('collectDrops não empurra às cegas quando o pathfinder falhou longe do drop', async () => {
  const food = require('../lib/food')
  const drop = { name: 'item', isValid: true, position: new Vec3(8, 64, 2), getDroppedItem: () => ({ name: 'oak_log' }) }
  const controls = []
  const bot = {
    entities: { 1: drop },
    entity: { position: new Vec3(3, 64, 2) }, // 5 blocos: fora do alcance do empurrão (2,5)
    lookAt: async () => {},
    setControlState: (name, on) => controls.push([name, on]),
    pathfinder: { setGoal() {}, goto: async () => { throw new Error('No path to the goal!') } }
  }
  await food.collectDrops(bot, new Vec3(8, 64, 2), () => false, { timeoutMs: 2000 })
  assert.deepEqual(controls, [])
})
