const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { collectDrops } = require('../lib/food')
const { StorageManager, containerInteractionSnapshot } = require('../core/StorageManager')

test('drop pickup safety probes use Vec3 on live Mineflayer blockAt', async () => {
  const drop = { name: 'item', isValid: true, position: new Vec3(3.05, 64, 2.28) }
  const controls = []
  const probes = []
  const bot = {
    entities: { 1: drop },
    entity: { position: new Vec3(4.55, 64, 2.4) },
    blockAt(pos) {
      assert.ok(pos instanceof Vec3, 'Mineflayer blockAt needs pos.floored()')
      probes.push(pos)
      return pos.y === 63
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'air', boundingBox: 'empty' }
    },
    lookAt: async () => {},
    setControlState(name, enabled) {
      controls.push([name, enabled])
      if (enabled) drop.isValid = false
    },
    pathfinder: { setGoal() {}, goto: async () => {} }
  }
  await collectDrops(bot, new Vec3(3, 64, 2), () => false, { timeoutMs: 1800 })
  assert.equal(probes.length, 8, 'four floor and four body checks')
  assert.deepEqual(controls, [['forward', true], ['forward', false]])
})

test('drop pickup keeps the lava safety guard with Vec3 probes', async () => {
  const drop = { name: 'item', isValid: true, position: new Vec3(3.05, 64, 2.28) }
  const controls = []
  const bot = {
    entities: { 1: drop },
    entity: { position: new Vec3(4.55, 64, 2.4) },
    blockAt(pos) {
      assert.ok(pos instanceof Vec3)
      return pos.y === 63
        ? { name: 'lava', boundingBox: 'block' }
        : { name: 'air', boundingBox: 'empty' }
    },
    lookAt: async () => {},
    setControlState(name, enabled) { controls.push([name, enabled]) },
    pathfinder: { setGoal() {}, goto: async () => {} }
  }
  await collectDrops(bot, new Vec3(3, 64, 2), () => false, { timeoutMs: 500 })
  assert.deepEqual(controls, [], 'never nudge across lava')
})

test('container snapshot diagnoses obstruction and reach without mutating the world', () => {
  const chest = { name: 'chest', position: new Vec3(2, 64, 0) }
  const calls = []
  const bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) },
    game: { dimension: 'overworld' },
    currentWindow: { id: 10 },
    getControlState: () => true,
    canSeeBlock: () => false,
    blockAt(pos) {
      assert.ok(pos instanceof Vec3)
      calls.push(pos.toString())
      return { name: pos.y === 65 ? 'stone' : 'air', boundingBox: pos.y === 65 ? 'block' : 'empty' }
    }
  }
  const snapshot = containerInteractionSnapshot(bot, chest)
  assert.equal(snapshot.block, 'chest')
  assert.equal(snapshot.above.name, 'stone')
  assert.equal(snapshot.currentWindow, true)
  assert.equal(snapshot.sneaking, true)
  assert.equal(snapshot.visible, false)
  assert.equal(snapshot.dimension, 'overworld')
  assert.ok(snapshot.reachDistance > 0)
  assert.equal(calls.length, 5, 'one above and four neighboring probes')
})

test('stock opening keeps original windowOpen error, snapshots and per-bot lock recovery', async () => {
  const storage = new StorageManager()
  const chest = { name: 'chest', position: new Vec3(2, 64, 0) }
  storage.setPosition(chest.position)
  storage.goNear = async () => {}
  let opens = 0
  const bot = {
    username: 'lenhador_01',
    entity: { position: new Vec3(1.5, 64, 0.5) },
    blockAt(pos) {
      assert.ok(pos instanceof Vec3)
      if (pos.equals(chest.position)) return chest
      return { name: 'air', boundingBox: 'empty' }
    },
    async openContainer() {
      opens++
      if (opens === 1) throw new Error('Event windowOpen did not fire within timeout of 20000ms')
      return { containerItems: () => [{ name: 'oak_log', count: 3 }], close() {} }
    }
  }
  await assert.rejects(storage.summary(bot), (error) => {
    assert.match(error.message, /windowOpen did not fire/)
    assert.equal(error.storageDiagnostics.worker, 'lenhador_01')
    assert.equal(error.storageDiagnostics.before.block, 'chest')
    assert.equal(error.storageDiagnostics.after.target.x, 2)
    assert.equal(error.storageDiagnostics.before.above.name, 'air')
    return true
  })
  assert.equal(opens, 1, 'never retry an open that might have completed late')
  assert.deepEqual(await storage.summary(bot), { oak_log: 3 }, 'lock released after rejection')
  assert.equal(opens, 2)
})
