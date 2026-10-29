const test = require('node:test')
const assert = require('node:assert/strict')

const guard = require('../lib/path-guard')

function botWith(pathfinder) {
  return { entity: { position: { x: 0, y: 64, z: 0 } }, pathfinder }
}

test('não explode quando setMovements recebe undefined', () => {
  let called = false
  const bot = botWith({ setMovements: () => { called = true }, setGoal: () => {} })
  assert.equal(guard.safeSetMovements(bot, undefined), false)
  assert.equal(called, false)
})

test('não explode sem pathfinder nem sem bot', () => {
  assert.equal(guard.safeSetMovements(null, {}), false)
  assert.equal(guard.safeSetMovements({}, {}), false)
  assert.equal(guard.safeSetGoal({}, null), false)
  assert.equal(guard.safeStop(undefined), false)
})

test('aplica movements e goal quando existem', () => {
  const applied = []
  const bot = botWith({
    setMovements: (movements) => applied.push(['movements', movements]),
    setGoal: (goal, dynamic) => applied.push(['goal', goal, dynamic])
  })
  const movements = { name: 'work' }
  assert.equal(guard.safeSetMovements(bot, movements), true)
  assert.equal(guard.safeSetGoal(bot, null, true), true)
  assert.deepEqual(applied, [['movements', movements], ['goal', null, true]])
})

test('erro do pathfinder não escapa', () => {
  const bot = botWith({
    setMovements: () => { throw new TypeError("Cannot read properties of undefined (reading 'clearCollisionIndex')") },
    setGoal: () => { throw new Error('boom') }
  })
  assert.equal(guard.safeSetMovements(bot, {}), false)
  assert.equal(guard.safeSetGoal(bot, null), false)
})

test('ready exige entidade e pathfinder utilizável', () => {
  assert.equal(guard.ready(botWith({ setGoal: () => {} })), true)
  assert.equal(guard.ready({ pathfinder: { setGoal: () => {} } }), false)
  assert.equal(guard.ready(botWith({})), false)
  assert.equal(guard.ready(null), false)
})
