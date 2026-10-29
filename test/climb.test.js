const test = require('node:test')
const assert = require('node:assert/strict')
const { climbOut, needsClimb } = require('../lib/climb')

// Bot fake: cada goto(GoalY) sobe até o alvo, ou até `ceiling` (teto que não cede).
function fakeBot(y, { ceiling = Infinity } = {}) {
  const goals = []
  const moves = []
  const bot = {
    entity: { position: { x: 0, y, z: 0 } },
    registry: { blocksByName: {}, itemsByName: {}, blocksArray: [] },
    pathfinder: {
      movements: 'trabalho',
      setMovements: (m) => moves.push(m),
      setGoal: () => {},
      goto: async (goal) => { goals.push(goal.y); bot.entity.position.y = Math.min(goal.y, ceiling) }
    }
  }
  return { bot, goals, moves }
}

test('só sobe quando o destino está bem acima', () => {
  assert.equal(needsClimb({ entity: { position: { y: 60 } } }, 65), false)
  assert.equal(needsClimb({ entity: { position: { y: -26 } } }, 65), true)
})

test('sobe em trechos de 12 até perto do destino e devolve os movimentos de antes', async () => {
  const { bot, goals, moves } = fakeBot(-26)
  const r = await climbOut(bot, 65, { movements: 'escalada' })
  assert.equal(r.ok, true)
  assert.deepEqual(goals, [-14, -2, 10, 22, 34, 46, 58])
  assert.ok(bot.entity.position.y >= 55)
  assert.deepEqual(moves, ['escalada', 'trabalho'])
})

test('para depois de empacar sem subir', async () => {
  const { bot, goals } = fakeBot(-26, { ceiling: -20 })
  const r = await climbOut(bot, 65, { movements: 'escalada', maxStalls: 2 })
  assert.equal(r.ok, false)
  assert.equal(r.climbed, 6)
  assert.equal(goals.length, 3)
})

test('respeita cancelamento', async () => {
  const { bot, goals } = fakeBot(-26)
  let n = 0
  await climbOut(bot, 65, { movements: 'escalada', isCancelled: () => n++ >= 1 })
  assert.equal(goals.length, 1)
})
