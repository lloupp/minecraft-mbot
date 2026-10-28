// lib/path-guard.js
// mineflayer-pathfinder derruba o processo com
// `TypeError: Cannot read properties of undefined (reading 'clearCollisionIndex')`
// quando setMovements recebe undefined — o que acontece se um comando chega
// antes do spawn definir os Movements. Estes wrappers nunca deixam o erro
// subir: devolvem false e o chamador decide o que fazer.

function safeSetMovements(bot, movements) {
  const pathfinder = bot?.pathfinder
  if (!pathfinder || typeof pathfinder.setMovements !== 'function') return false
  if (!movements) return false
  try {
    pathfinder.setMovements(movements)
    return true
  } catch {
    return false
  }
}

function safeSetGoal(bot, goal, dynamic = false) {
  const pathfinder = bot?.pathfinder
  if (!pathfinder || typeof pathfinder.setGoal !== 'function') return false
  try {
    pathfinder.setGoal(goal, dynamic)
    return true
  } catch {
    return false
  }
}

// Parar o caminho é sempre seguro, inclusive antes do spawn.
function safeStop(bot) {
  return safeSetGoal(bot, null)
}

// Pronto para andar: tem entidade e pathfinder.
function ready(bot) {
  return Boolean(bot?.entity && bot?.pathfinder && typeof bot.pathfinder.setGoal === 'function')
}

module.exports = { safeSetMovements, safeSetGoal, safeStop, ready }
