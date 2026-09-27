const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { EventEmitter } = require('node:events')
const { WorkerController } = require('../core/WorkerController')

function workerAt(position) {
  const bot = Object.assign(new EventEmitter(), {
    entity: { position }, game: { dimension: 'overworld' },
    pathfinder: { setGoal() {} }
  })
  return new WorkerController({ bot, name: 'lenhador_01', role: 'lenhador' })
}
const destination = { x: 18, y: 63, z: 1 }

test('ir_local reapproaches once when discrete arrival is outside physical radius', async () => {
  const worker = workerAt(new Vec3(24.5, 63, 1.5))
  const ranges = []
  worker.goTo = async goal => {
    ranges.push(goal.rangeSq)
    worker.bot.entity.position = new Vec3(ranges.length === 1 ? 20.603 : 19.5, 63, 1.5)
  }
  const result = await worker.goToPoint(destination, () => false)
  assert.deepEqual(ranges, [4, 1])
  assert.equal(result.ok, true)
  assert.equal(result.evidence.type, 'position_confirmed')
  assert.equal(result.evidence.distance, 1)
  assert.equal(result.evidence.tolerance, 2)
  assert.deepEqual(result.evidence.target, { x: 18.5, y: 63, z: 1.5 })
})

test('resolved path without arrival cannot report success and retries are bounded', async () => {
  const worker = workerAt(new Vec3(20.603, 63, 1.5))
  let calls = 0
  worker.goTo = async () => { calls++ }
  const result = await worker.goToPoint(destination, () => false)
  assert.equal(calls, 2)
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'PATH_FAILED')
  assert.equal(result.evidence, undefined)
})

test('confirmed arrival is idempotent and includes a detached position snapshot', async () => {
  const worker = workerAt(new Vec3(18.5, 63, 1.5))
  worker.goTo = async () => { assert.fail('already at destination') }
  const result = await worker.goToPoint(destination, () => false)
  worker.bot.entity.position.x = 100
  assert.equal(result.ok, true)
  assert.equal(result.evidence.position.x, 18.5)
  assert.equal(result.evidence.dimension, 'overworld')
})

test('cancellation before arrival never reports success even when already close', async () => {
  const worker = workerAt(new Vec3(18.5, 63, 1.5))
  worker.goTo = async () => { assert.fail('cancelled') }
  const result = await worker.goToPoint(destination, () => true)
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.evidence, undefined)
})

for (const rejected of [false, true]) {
  test(`cancellation during path does not reapproach (rejected=${rejected})`, async () => {
    const worker = workerAt(new Vec3(24.5, 63, 1.5))
    let cancelled = false
    let calls = 0
    worker.goTo = async () => {
      calls++
      cancelled = true
      if (rejected) throw new Error('goal changed')
    }
    const result = await worker.goToPoint(destination, () => cancelled)
    assert.equal(result.ok, false)
    assert.equal(result.cancelled, true)
    assert.equal(calls, 1)
  })
}

test('physical arrival checks vertical distance and rejects missing entity', async () => {
  for (const position of [new Vec3(18.5, 66, 1.5), null]) {
    const worker = workerAt(position)
    if (!position) worker.bot.entity = null
    worker.goTo = async () => {}
    assert.equal((await worker.goToPoint(destination, () => false)).ok, false)
  }
})

test('path failure remains an error with stable failure code', async () => {
  const worker = workerAt(new Vec3(24.5, 63, 1.5))
  worker.goTo = async () => { throw new Error('unreachable') }
  await assert.rejects(worker.goToPoint(destination, () => false), { code: 'PATH_FAILED' })
})
