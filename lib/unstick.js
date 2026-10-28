// lib/unstick.js
// Sair da água: sobe nadando (jump) até a cabeça ficar em ar e depois procura
// terra seca por perto. Antes disso o bot podia ficar parado submerso, sem
// pathfinding útil (a água quebra o caminho).

const WATER = /^(water|flowing_water|bubble_column)$/

const isWater = (block) => Boolean(block && WATER.test(block.name || ''))

function inWater(bot) {
  const pos = bot?.entity?.position
  if (!pos || typeof bot.blockAt !== 'function') return false
  return isWater(bot.blockAt(pos)) || isWater(bot.blockAt(pos.offset(0, 1, 0)))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Sobe até sair da água. Devolve quantos ciclos precisou e se saiu.
async function swimUp(bot, { isCancelled = () => false, maxCycles = 60, cycleMs = 250 } = {}) {
  let cycles = 0
  try {
    while (cycles < maxCycles && !isCancelled() && inWater(bot)) {
      bot.setControlState('jump', true)
      await sleep(cycleMs)
      cycles++
    }
  } finally {
    try { bot.setControlState('jump', false) } catch { /* já parado */ }
  }
  return { ok: !inWater(bot), cycles }
}

// Anda até uma posição seca próxima (uma por vez), tentando não voltar à água.
async function stepToDry(bot, { isCancelled = () => false, tries = 6, goTo = null } = {}) {
  const pos = bot?.entity?.position
  if (!pos) return { ok: false, tries: 0 }
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
  let used = 0
  for (const [dx, dz] of offsets) {
    if (used >= tries || isCancelled()) break
    const target = { x: Math.floor(pos.x) + dx, y: Math.floor(pos.y), z: Math.floor(pos.z) + dz }
    const block = bot.blockAt?.(target)
    const below = bot.blockAt?.({ x: target.x, y: target.y - 1, z: target.z })
    if (isWater(block) || isWater(below) || !below || below.boundingBox !== 'block') continue
    used++
    if (typeof goTo === 'function') await goTo(target).catch(() => {})
  }
  return { ok: !inWater(bot), tries: used }
}

module.exports = { swimUp, stepToDry, inWater, isWater }
