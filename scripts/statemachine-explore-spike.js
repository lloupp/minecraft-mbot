const assert = require('node:assert/strict')
const { runExploreStateMachine } = require('../lib/stateMachineExplore')

async function main() {
  const target = { x: 16, y: 64, z: 0, radius: 16 }
  const calls = []

  const ok = await runExploreStateMachine({
    target,
    move: async (point) => {
      calls.push({ ...point })
    },
    pollMs: 1,
    timeoutMs: 1000
  })

  assert.equal(ok.ok, true)
  assert.equal(ok.stateMachine, true)
  assert.deepEqual(calls, [target])

  let cancelled = false
  const pending = runExploreStateMachine({
    target,
    move: async () => new Promise((resolve) => setTimeout(resolve, 100)),
    isCancelled: () => cancelled,
    pollMs: 1,
    timeoutMs: 1000
  })
  setTimeout(() => { cancelled = true }, 10)
  const stopped = await pending

  assert.equal(stopped.ok, false)
  assert.equal(stopped.cancelled, true)
  assert.equal(stopped.stateMachine, true)

  const failed = await runExploreStateMachine({
    target,
    move: async () => { throw new Error('sem caminho') },
    pollMs: 1,
    timeoutMs: 1000,
    logger: { log: () => {} }
  })

  assert.equal(failed.ok, false)
  assert.equal(failed.stateMachine, true)
  assert.match(failed.error, /sem caminho/)

  console.log(JSON.stringify({
    ok: true,
    flow: 'explore',
    success: ok,
    cancelled: stopped,
    failure: failed
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
