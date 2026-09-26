const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const {
  StateTransition,
  NestedStateMachine,
  BotStateMachine
} = require('mineflayer-statemachine')

function realResolved(request, paths) {
  return fs.realpathSync(require.resolve(request, paths ? { paths } : undefined))
}

function packageDir(name) {
  return path.dirname(require.resolve(`${name}/package.json`))
}

function testSharedDependencies() {
  const stateMachineDir = packageDir('mineflayer-statemachine')
  const rootMineflayer = realResolved('mineflayer')
  const nestedMineflayer = realResolved('mineflayer', [stateMachineDir])
  const rootPathfinder = realResolved('mineflayer-pathfinder')
  const nestedPathfinder = realResolved('mineflayer-pathfinder', [stateMachineDir])

  assert.equal(
    nestedMineflayer,
    rootMineflayer,
    'mineflayer-statemachine resolveu outra instalação de mineflayer'
  )
  assert.equal(
    nestedPathfinder,
    rootPathfinder,
    'mineflayer-statemachine resolveu outra instalação de mineflayer-pathfinder'
  )

  return { rootMineflayer, rootPathfinder }
}

function state(name, events) {
  return {
    stateName: name,
    active: false,
    onStateEntered() { events.push(`enter:${name}`) },
    update() { events.push(`update:${name}`) },
    onStateExited() { events.push(`exit:${name}`) }
  }
}

function testNestedMachine() {
  const events = []
  const start = state('start', events)
  const done = state('done', events)
  const transition = new StateTransition({
    parent: start,
    child: done,
    shouldTransition: () => false,
    onTransition: () => events.push('transition:start->done')
  })
  const root = new NestedStateMachine([transition], start, done)

  root.active = true
  root.onStateEntered()
  assert.equal(root.activeState, start)
  transition.trigger()
  root.update()
  assert.equal(root.activeState, done)
  assert.equal(root.isFinished(), true)

  return events
}

function testBotStateMachineListener() {
  const events = []
  const bot = new EventEmitter()
  const start = state('idle', events)
  const done = state('done', events)
  const transition = new StateTransition({
    parent: start,
    child: done,
    shouldTransition: () => events.includes('advance')
  })
  const root = new NestedStateMachine([transition], start, done)

  const before = bot.listenerCount('physicsTick')
  const machine = new BotStateMachine(bot, root)
  const after = bot.listenerCount('physicsTick')
  assert.equal(after, before + 1, 'BotStateMachine não registrou physicsTick como esperado')

  events.push('advance')
  bot.emit('physicsTick')
  assert.equal(root.activeState, done, 'transição não ocorreu no physicsTick')

  // A versão 1.7.0 não expõe dispose(). O spike remove o listener do fake bot
  // manualmente; em runtime não criaremos uma máquina nova por tarefa.
  assert.equal(typeof machine.dispose, 'undefined')
  bot.removeAllListeners('physicsTick')

  return { listenerAdded: after - before, hasDispose: typeof machine.dispose === 'function' }
}

const deps = testSharedDependencies()
const nestedEvents = testNestedMachine()
const listener = testBotStateMachineListener()

const versions = {
  statemachine: require('mineflayer-statemachine/package.json').version,
  mineflayer: require('mineflayer/package.json').version,
  pathfinder: require('mineflayer-pathfinder/package.json').version,
  node: process.version
}

console.log(JSON.stringify({
  ok: true,
  versions,
  deps,
  nestedEvents,
  listener,
  recommendation: 'usar uma máquina reutilizável por worker ou update manual; não instanciar BotStateMachine por tarefa'
}, null, 2))
