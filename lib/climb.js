// lib/climb.js
// Sobe em trechos curtos antes de uma viagem longa. Fundo no subsolo, o pathfinder
// desiste de rotas longas ("Took to long to decide path"); subindo de 12 em 12
// blocos (cavando e empilhando bloco se precisar) cada trecho é fácil de planejar.

const { Movements, goals } = require('mineflayer-pathfinder')

const CLIMB_STEP = 12
const STEP_TIMEOUT_MS = 30000
const MAX_STALLS = 3
const CLIMB_MARGIN = 10 // só sobe se o destino estiver mais de 10 blocos acima

function needsClimb(bot, targetY, margin = CLIMB_MARGIN) {
  const y = bot?.entity?.position?.y
  return Number.isFinite(y) && Number.isFinite(targetY) && targetY - y > margin
}

function climbMovements(bot) {
  const moves = new Movements(bot)
  moves.canDig = true
  moves.allow1by1towers = true
  moves.allowParkour = false
  return moves
}

async function stepTo(bot, y, timeoutMs) {
  let timer
  await Promise.race([
    bot.pathfinder.goto(new goals.GoalY(y)).catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(() => { bot.pathfinder.setGoal?.(null); resolve() }, timeoutMs) })
  ])
  clearTimeout(timer)
}

// Sobe até perto de `targetY`. Devolve { ok, climbed, y }; ok=false quando empacou.
async function climbOut(bot, targetY, { isCancelled = () => false, step = CLIMB_STEP, stepTimeoutMs = STEP_TIMEOUT_MS,
  maxStalls = MAX_STALLS, margin = CLIMB_MARGIN, movements = null, log = () => {} } = {}) {
  const start = bot?.entity?.position?.y
  if (!needsClimb(bot, targetY, margin) || !bot.pathfinder?.goto) return { ok: true, climbed: 0, y: start }
  const previous = bot.pathfinder.movements
  bot.pathfinder.setMovements(movements || climbMovements(bot))
  log(`[subir] de y=${Math.floor(start)} até perto de y=${Math.floor(targetY)}`)
  let stalls = 0
  try {
    while (!isCancelled() && needsClimb(bot, targetY, margin) && stalls < maxStalls) {
      const before = bot.entity.position.y
      await stepTo(bot, Math.min(Math.floor(before) + step, Math.floor(targetY)), stepTimeoutMs)
      if (bot.entity.position.y < before + 1) stalls++
      else stalls = 0
    }
  } finally {
    if (previous) bot.pathfinder.setMovements(previous)
  }
  const y = bot.entity.position.y
  return { ok: !needsClimb(bot, targetY, margin), climbed: Math.max(0, Math.round(y - start)), y }
}

module.exports = { climbOut, needsClimb, climbMovements, CLIMB_STEP, CLIMB_MARGIN }
