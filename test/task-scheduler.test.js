const test = require('node:test')
const assert = require('node:assert/strict')
const { TaskGraph } = require('../core/TaskGraph')
const { TaskScheduler } = require('../core/TaskScheduler')

function worker(id, role, actions, handler = async decision => ({ success: true, decision })) {
  return {
    id, role,
    layer: {
      availableActions: () => actions,
      state: () => ({ busy: false }),
      execute: handler
    }
  }
}

test('task graph releases nodes only after dependencies complete', () => {
  const graph = new TaskGraph([
    { id: 'wood', action: 'gather' },
    { id: 'craft', action: 'craft', dependsOn: ['wood'] }
  ])
  assert.deepEqual(graph.ready().map(x => x.id), ['wood'])
  graph.start('wood', 'w1')
  graph.complete('wood', { success: true })
  assert.deepEqual(graph.ready().map(x => x.id), ['craft'])
})

test('task graph rejects cycles and missing dependencies', () => {
  assert.throws(() => new TaskGraph([{ id: 'a', action: 'gather', dependsOn: ['missing'] }]), /dependência inexistente/)
  assert.throws(() => new TaskGraph([
    { id: 'a', action: 'gather', dependsOn: ['b'] },
    { id: 'b', action: 'craft', dependsOn: ['a'] }
  ]), /ciclo/)
})

test('failed dependency blocks dependent work', () => {
  const graph = new TaskGraph([
    { id: 'wood', action: 'gather' },
    { id: 'craft', action: 'craft', dependsOn: ['wood'] }
  ])
  graph.start('wood', 'w1')
  graph.fail('wood', { success: false })
  assert.equal(graph.get('craft').status, 'blocked')
  assert.equal(graph.done(), true)
})

test('scheduler assigns by capability and role without cross-worker leakage', async () => {
  const seen = []
  const graph = new TaskGraph([
    { id: 'wood', action: 'gather', args: { resource: 'oak_log', quantity: 2 }, role: 'lenhador' },
    { id: 'stone', action: 'gather', args: { resource: 'stone', quantity: 2 }, role: 'minerador' }
  ])
  const scheduler = new TaskScheduler({
    graph,
    logger: { log() {} },
    workers: [
      worker('wood-1', 'lenhador', ['gather'], async d => { seen.push(d); return { success: true } }),
      worker('mine-1', 'minerador', ['gather'], async d => { seen.push(d); return { success: true } })
    ]
  })
  const assigned = await scheduler.tick()
  assert.equal(assigned.length, 2)
  await Promise.all([...scheduler.inFlight.values()].map(x => x.promise))
  assert.deepEqual(seen.map(x => [x.worker, x.task_id]).sort(), [['mine-1', 'stone'], ['wood-1', 'wood']])
})

test('scheduler does not assign unavailable action', async () => {
  const graph = new TaskGraph([{ id: 'craft', action: 'craft' }])
  const scheduler = new TaskScheduler({ graph, workers: [worker('w1', 'lenhador', ['gather'])] })
  assert.deepEqual(await scheduler.tick(), [])
  assert.equal(graph.get('craft').status, 'pending')
})
