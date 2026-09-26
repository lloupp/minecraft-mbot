const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const gather = require('../lib/gather')

test('mineBlocks não volta a tentar na tarefa seguinte um bloco inalcançável', async () => {
  const far = new Vec3(10, 64, 0) // inalcançável
  const near = new Vec3(20, 64, 0)
  const logs = new Set([far.toString(), near.toString()])
  const tried = []
  const bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }] },
    entities: {},
    inventory: { items: () => [] },
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
    dig: async (block) => { logs.delete(block.position.toString()) }
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
