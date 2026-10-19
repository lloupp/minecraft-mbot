const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { resolveBlockNames } = require('../core/resources')
const { mineBlocks, COLLECTION_FAILURE } = require('../lib/gather')

const registry = {
  blocksArray: [
    { id: 1, name: 'dark_oak_log', drops: [10] },
    { id: 2, name: 'oak_log', drops: [11] },
    { id: 3, name: 'mushroom_stem', drops: [] },
    { id: 4, name: 'crimson_stem', drops: [12] },
    { id: 5, name: 'warped_stem', drops: [13] },
    { id: 6, name: 'crimson_hyphae', drops: [14] }
  ],
  items: { 10: { name: 'dark_oak_log' }, 11: { name: 'oak_log' }, 12: { name: 'crimson_stem' }, 13: { name: 'warped_stem' } },
  blocksByName: {}
}
for (const item of registry.blocksArray) registry.blocksByName[item.name] = item

test('generic lumber excludes mushroom_stem but retains both nether wood stems', () => {
  const bot = { registry }
  for (const resource of ['madeira', 'tronco', 'wood', 'logs']) {
    const names = resolveBlockNames(bot, resource, 'lenhador')
    assert.deepEqual(names, ['dark_oak_log', 'oak_log', 'crimson_stem', 'warped_stem'])
    assert.ok(!names.includes('mushroom_stem'))
  }
  assert.deepEqual(resolveBlockNames(bot, 'mushroom_stem', 'lenhador'), ['mushroom_stem'],
    'explicit non-wood request remains possible, but it must still satisfy drop verification')
})

test('zero-drop resources cannot be destroyed or counted as successful mining', async () => {
  let digs = 0
  const pos = new Vec3(2, 65, 2)
  const attempts = []
  const bot = {
    registry,
    inventory: { items: () => [] },
    entities: {},
    findBlocks: () => [pos],
    blockAt: (p) => p.equals(pos) ? { name: 'mushroom_stem', position: pos } : { name: 'air', position: p },
    pathfinder: { bestHarvestTool: () => null, goto: async () => assert.fail('do not move toward a zero-drop block') },
    dig: async () => { digs++ }
  }
  assert.equal(await mineBlocks(bot, n => n === 'mushroom_stem', 1, () => false, { onAttempt: e => attempts.push(e) }), 0)
  assert.equal(digs, 0)
  assert.equal(attempts[0].code, COLLECTION_FAILURE.NO_EXPECTED_DROPS)
  assert.deepEqual(attempts[0].expectedItems, [])
})
