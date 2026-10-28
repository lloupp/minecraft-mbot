const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { EventEmitter } = require('node:events')
const { WorkerController } = require('../core/WorkerController')

function fixture(visible) {
  const pos = new Vec3(2, 64, 0)
  const items = []
  let present = true
  let paths = 0
  let digs = 0
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: new Vec3(0, 64, 0) }, health: 20,
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }], blocksByName: { oak_log: { id: 1 } } },
    inventory: { items: () => items }, entities: {},
    findBlocks: () => present ? [pos] : [],
    blockAt: p => ({ name: present && p.equals(pos) ? 'oak_log' : 'air', position: p }),
    canDigBlock: () => true,
    lookAt: async () => {},
    blockAtCursor: () => ({ name: visible ? 'oak_log' : 'stone', position: visible ? pos : new Vec3(1, 64, 0) }),
    pathfinder: { bestHarvestTool: () => null, goto: async () => { paths++; throw new Error('No path') } },
    dig: async () => { digs++; present = false; items.push({ name: 'oak_log', count: 1 }) }
  })
  const worker = new WorkerController({ bot, name: 'lenhador_01', role: 'lenhador', logger: { log() {} } })
  worker.ensureRoleTool = async () => {}
  return { worker, stats: () => ({ paths, digs }) }
}

test('worker can collect visible reachable wood without forcing an adjacent path goal', async () => {
  const { worker, stats } = fixture(true)
  const result = await worker.gatherBlocks('madeira', 1, () => false)
  assert.equal(result.gathered, 1)
  assert.equal(result.verified, true)
  assert.equal(result.evidence[0].navigation, 'visible_in_reach')
  assert.deepEqual(stats(), { paths: 0, digs: 1 })
})

test('occluded wood still requires navigation and never authorizes blind digging', async () => {
  const { worker, stats } = fixture(false)
  const result = await worker.gatherBlocks('madeira', 1, () => false)
  assert.equal(result.gathered, 0)
  assert.equal(result.verified, false)
  assert.equal(result.code, 'PATH_FAILED')
  assert.deepEqual(stats(), { paths: 1, digs: 0 })
})
