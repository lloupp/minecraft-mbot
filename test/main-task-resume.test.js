const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Exercise the actual closure without loading index.js (which connects to Minecraft).
function harness(initialMode = 'ficar', cargo = []) {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const start = source.indexOf('  async function runTask(')
  const end = source.indexOf('  function autonomyStep()', start)
  const goals = []
  const context = vm.createContext({
    mode: initialMode, taskId: 0, taskName: null, taskResumeMode: 'seguir', autonomous: false,
    workMoves: {}, followed: 0, goals, console,
    pathGuard: require('../lib/path-guard'),
    bot: {
      entity: {},
      inventory: { items: () => cargo }, chat: () => {},
      pathfinder: { setMovements: () => {}, setGoal: (goal) => goals.push(goal) }
    },
    storage: { reserveFor: () => 0, configured: () => true, depositCargo: async () => ({}) },
    autoStorage: async () => {}
  })
  vm.runInContext(`function cancelTask() { taskId++; taskName = null; bot.pathfinder.setGoal(null) }
    function follow() { followed++ }
    ${source.slice(start, end)}`, context)
  return context
}

function startupMode(env) {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const declaration = source.split('\n').find((line) => line.trim().startsWith('let mode ='))
  assert.ok(declaration, 'main mode declaration must exist')
  return vm.runInNewContext(`${declaration}\nmode`, { process: { env } })
}

test('main starts in ficar before any command when MBOT_START_MODE=ficar', () => {
  assert.equal(startupMode({ MBOT_START_MODE: 'ficar' }), 'ficar')
})

test('main keeps legacy seguir startup when no override is supplied', () => {
  assert.equal(startupMode({}), 'seguir')
})

test('main supports explicit seguir startup without persisting an override', () => {
  assert.equal(startupMode({ MBOT_START_MODE: 'seguir' }), 'seguir')
  assert.equal(startupMode({ MBOT_START_MODE: 'ficar' }), 'ficar')
  assert.equal(startupMode({}), 'seguir')
})

test('main task preserves !ficar after success, without following', async () => {
  const h = harness()
  await h.runTask('buscar comida', async () => {})
  assert.equal(h.mode, 'ficar')
  assert.equal(h.followed, 0)
  assert.equal(h.taskName, null)
})

test('main task preserves !ficar after executor failure', async () => {
  const h = harness()
  await h.runTask('buscar comida', async () => { throw new Error('sem fonte') })
  assert.equal(h.mode, 'ficar')
  assert.equal(h.followed, 0)
})

test('main task preserves !ficar after cargo deposit', async () => {
  const h = harness('ficar', [{ name: 'coal', count: 1 }])
  let deposits = 0
  h.storage.depositCargo = async () => { deposits++; return { coal: 1 } }
  await h.runTask('buscar comida', async () => {})
  assert.equal(deposits, 1)
  assert.equal(h.mode, 'ficar')
})

test('main task still resumes following when started in seguir', async () => {
  const h = harness('seguir')
  await h.runTask('coletar', async () => {})
  assert.equal(h.mode, 'seguir')
  assert.equal(h.followed, 1)
})

test('main task respects explicit resume override', async () => {
  const h = harness()
  await h.runTask('coletar', async () => {}, { resume: 'seguir' })
  assert.equal(h.mode, 'seguir')
  assert.equal(h.followed, 1)
})

test('cancelled main task cannot overwrite newer !ficar', async () => {
  const h = harness('seguir')
  await h.runTask('coletar', async () => { h.cancelTask(); h.mode = 'ficar' })
  assert.equal(h.mode, 'ficar')
  assert.equal(h.followed, 0)
})

test('replacement main task inherits paused !ficar instead of enabling follow', async () => {
  const h = harness()
  await h.runTask('primeira', async () => { await h.runTask('segunda', async () => {}) })
  assert.equal(h.mode, 'ficar')
  assert.equal(h.followed, 0)
})
