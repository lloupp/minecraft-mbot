const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadStateMachine() {
  try {
    return require('mineflayer-statemachine')
  } catch {
    return null
  }
}

function state(name, hooks = {}) {
  return {
    stateName: name,
    active: false,
    onStateEntered: hooks.onStateEntered,
    update: hooks.update,
    onStateExited: hooks.onStateExited
  }
}

async function runExploreStateMachine({
  target,
  move,
  isCancelled = () => false,
  pollMs = 50,
  timeoutMs = 45000,
  logger = console
}) {
  const api = loadStateMachine()
  if (!api) return { ok: false, fallback: true, reason: 'statemachine_indisponivel' }

  const { StateTransition, NestedStateMachine } = api
  let moving = false
  let moved = false
  let error = null
  let cancelled = false

  const prepare = state('prepare')
  const navigate = state('navigate', {
    onStateEntered() {
      if (moving) return
      moving = true
      Promise.resolve(move(target))
        .then(() => { moved = true })
        .catch((err) => { error = err })
    }
  })
  const verify = state('verify')
  const done = state('done')
  const failed = state('failed')
  const stopped = state('cancelled')

  const transitions = [
    new StateTransition({ parent: prepare, child: navigate, shouldTransition: () => true }),
    new StateTransition({ parent: navigate, child: stopped, shouldTransition: () => cancelled || isCancelled() }),
    new StateTransition({ parent: navigate, child: failed, shouldTransition: () => Boolean(error) }),
    new StateTransition({ parent: navigate, child: verify, shouldTransition: () => moved }),
    new StateTransition({ parent: verify, child: done, shouldTransition: () => true })
  ]

  const root = new NestedStateMachine(transitions, prepare, done)
  root.active = true
  root.onStateEntered()

  const deadline = Date.now() + timeoutMs
  while (!root.isFinished() && root.activeState !== failed && root.activeState !== stopped) {
    if (isCancelled()) cancelled = true
    if (Date.now() > deadline) {
      error = new Error('state machine de exploração excedeu o tempo limite')
    }
    root.update()
    await sleep(pollMs)
  }

  const terminal = root.activeState
  root.onStateExited()

  if (terminal === stopped || cancelled || isCancelled()) {
    return { ok: false, cancelled: true, stateMachine: true }
  }
  if (error || terminal === failed) {
    logger.log?.(`[statemachine] exploração falhou: ${error?.message || 'erro desconhecido'}`)
    return { ok: false, stateMachine: true, error: error?.message || 'falha' }
  }
  return { ok: terminal === done, stateMachine: true }
}

module.exports = { loadStateMachine, runExploreStateMachine }
