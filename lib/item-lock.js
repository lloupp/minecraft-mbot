// lib/item-lock.js
// Um uso exclusivo do inventário/item na mão por vez (fabricar, fundir, comer).
// O AutoEat troca o item da mão sozinho; se ele agir no meio de um craft ou de
// uma refeição, o servidor rejeita os cliques e o inventário local
// dessincroniza. Visto no 1.20.1: "Eating timed out with a time of 3000" e
// "Item switched early to: undefined" durante a fabricação de ferramentas.

const WAIT_EATING_MS = 4000 // teto para a refeição em andamento terminar

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Estado por bot: fila (tail), profundidade do uso atual e nada além disso.
const states = new WeakMap()

function stateOf(bot) {
  let state = states.get(bot)
  if (!state) {
    state = { tail: Promise.resolve(), depth: 0, paused: 0 }
    states.set(bot, state)
  }
  return state
}

// Espera a refeição em andamento terminar antes de tirar o item da mão:
// cancelar no meio desperdiça comida e ainda mexe no inventário. Depois desliga
// o automático, que recria os cliques por conta própria.
async function pauseAutoEat(bot) {
  const autoEat = bot?.autoEat
  if (!autoEat) return false
  const deadline = Date.now() + WAIT_EATING_MS
  while (autoEat.isEating && Date.now() < deadline) await sleep(100)
  if (typeof autoEat.disableAuto === 'function') autoEat.disableAuto()
  return Boolean(autoEat.enabled === false)
}

function resumeAutoEat(bot) {
  const autoEat = bot?.autoEat
  if (!autoEat || typeof autoEat.enableAuto !== 'function') return false
  autoEat.enableAuto()
  return true
}

function isItemLocked(bot) {
  return stateOf(bot).depth > 0
}

// Executa `fn` com o item e o inventário exclusivos. Chamadas aninhadas (o craft
// chama a si mesmo para ingredientes) entram direto; chamadas concorrentes
// esperam a anterior. O AutoEat volta a ficar ativo ao final, mesmo com erro,
// desde que estivesse ativo antes.
async function withItemLock(bot, fn) {
  const state = stateOf(bot)
  if (state.depth > 0) {
    state.depth++
    try {
      return await fn()
    } finally {
      state.depth--
    }
  }
  const run = state.tail.then(async () => {
    const wasEnabled = Boolean(bot?.autoEat?.enabled)
    state.depth++
    try {
      if (wasEnabled) await pauseAutoEat(bot)
      state.paused++
      return await fn()
    } finally {
      state.paused--
      state.depth--
      if (wasEnabled && state.paused === 0) resumeAutoEat(bot)
    }
  })
  state.tail = run.then(() => {}, () => {})
  return run
}

module.exports = { withItemLock, isItemLocked, pauseAutoEat, resumeAutoEat, WAIT_EATING_MS }
