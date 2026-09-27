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
