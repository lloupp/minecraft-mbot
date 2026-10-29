const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
function harness({ autonomous = true, mode = 'tarefa', resume = 'seguir' } = {}) {
  let death
  let tick
  let production = 0
  let retreats = 0
  const context = vm.createContext({
    autonomous, mode, taskResumeMode: resume, taskName: 'coletar',
    taskId: 0, sheltered: true, lastHealth: 3, fleeingUntil: 0,
    followMoves: {}, console: { log() {} },
    bot: { health: 20, entity: {}, pathfinder: { setGoal() {} }, on(event, callback) { death = callback } },
    cancelTask() { context.taskId++; context.taskName = null },
    setInterval(callback) { tick = callback },
    nearestHostile: () => null,
    combat: { decide: () => 'fugir' },
    FLEE_DISTANCE: 12,
    flee() { retreats++ },
    Date
  })
  const deathStart = source.indexOf("  bot.on('death', () => {")
  const loopComment = source.indexOf('  // Laço principal:', deathStart)
  assert.ok(deathStart >= 0 && loopComment > deathStart)
  vm.runInContext(source.slice(deathStart, loopComment), context)
  // Exercise the actual loop's admission/flee guards only. Production is a spy;
  // no networking, combat engine, inventory, night logic or real timers run.
  const tickStart = source.indexOf('  setInterval(() => {', loopComment)
  const defence = source.indexOf('    // Defesa:', tickStart)
  context.production = () => production++
  vm.runInContext(`${source.slice(tickStart, defence)} production(); }, 500)`, context)
  return { context, death: () => death(), tick: () => tick(), production: () => production, retreats: () => retreats }
}

test('death releases task mode so autonomous respawn can resume', () => {
  const h = harness()
  h.death()
  assert.equal(h.context.mode, 'seguir')
  assert.equal(h.context.autonomous, true)
  assert.equal(h.context.taskName, null)
  assert.equal(h.context.taskId, 1)
  assert.equal(h.context.fleeingUntil, 0)
})

test('death preserves ficar when a manual task was interrupted', () => {
  const h = harness({ autonomous: false, resume: 'ficar' })
  h.death()
  assert.equal(h.context.mode, 'ficar')
})

test('death preserves idle ficar without enabling autonomy', () => {
  const h = harness({ autonomous: false, mode: 'ficar' })
  h.death()
  assert.equal(h.context.mode, 'ficar')
  assert.equal(h.context.autonomous, false)
})

test('dead main cannot dispatch production before respawn', () => {
  const h = harness()
  h.context.bot.health = 0
  h.tick()
  assert.equal(h.production(), 0)
})

test('expired flee timer cannot resume production while unsafe threat remains', () => {
  const h = harness()
  h.context.fleeingUntil = Date.now() - 1
  h.context.nearestHostile = () => ({ name: 'skeleton' })
  h.tick()
  assert.equal(h.retreats(), 1)
  assert.equal(h.production(), 0)
})

test('active flee keeps its path instead of resetting it every 500ms', () => {
  const h = harness()
  h.context.fleeingUntil = Date.now() + 60000
  h.context.nearestHostile = () => ({ name: 'skeleton' })
  h.tick()
  h.tick()
  assert.equal(h.retreats(), 0)
  assert.equal(h.production(), 0)
})

test('follow and flee movements avoid digging, parkour and deep drops', () => {
  const start = source.indexOf('    followMoves = new Movements(bot)')
  const end = source.indexOf('    if (!restoredWorkers)', start)
  const h = vm.createContext({
    bot: { pathfinder: {} },
    Movements: class { constructor() { this.canDig = true; this.maxDropDown = 4; this.allowParkour = true } }
  })
  vm.runInContext(source.slice(start, end), h)
  assert.equal(h.followMoves.canDig, false)
  assert.equal(h.followMoves.allow1by1towers, false)
  assert.equal(h.followMoves.maxDropDown, 1)
  assert.equal(h.followMoves.allowParkour, false)
})

test('expired flee timer permits work again when threat is gone', () => {
  const h = harness()
  h.context.fleeingUntil = Date.now() - 1
  h.tick()
  assert.equal(h.production(), 1)
})
