// Política única de depósito de ferro: respeita a reserva usada pelo bot para ferramentas.
const RAW_IRON = new Set(['raw_iron', 'iron_ore', 'deepslate_iron_ore'])
const STORAGE_IRON = new Set([...RAW_IRON, 'iron_ingot', 'iron_block', 'iron_nugget'])

function reserve(envValue, fallback) {
  if (envValue == null || envValue === '') return fallback
  const value = Number(envValue)
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function ironDepositPlan(bot, { keepRaw = reserve(process.env.MBOT_IRON_KEEP_RAW, 16), keepIngot = reserve(process.env.MBOT_IRON_KEEP_INGOT, 8) } = {}) {
  const items = (bot.inventory?.items?.() || []).filter((item) => STORAGE_IRON.has(item.name) && item.count > 0)
  const plan = {}
  let rawExcess = Math.max(0, items.filter((item) => RAW_IRON.has(item.name)).reduce((sum, item) => sum + item.count, 0) - Math.max(0, keepRaw))
  for (const item of items) {
    if (rawExcess <= 0 || !RAW_IRON.has(item.name)) continue
    const take = Math.min(item.count, rawExcess)
    plan[item.name] = (plan[item.name] || 0) + take
    rawExcess -= take
  }
  const ingots = items.filter((item) => item.name === 'iron_ingot').reduce((sum, item) => sum + item.count, 0)
  if (ingots > keepIngot) plan.iron_ingot = ingots - keepIngot
  for (const item of items) {
    if (item.name === 'iron_block' || item.name === 'iron_nugget') {
      plan[item.name] = (plan[item.name] || 0) + item.count
    }
  }
  return plan
}

// O timer nunca pode substituir um runTask de mineração, combate ou crafting.
// O objetivo de seguir o dono pode ser retomado depois do depósito, quando o bot está parado.
function canAutomaticIronDeposit({ mode, taskName, pausedFollowing = 0, fleeingUntil = 0, now = Date.now(), eating = false, checkingGear = false, isMoving = false } = {}) {
  return (mode === 'seguir' || mode === 'ficar') &&
    taskName == null && pausedFollowing === 0 &&
    fleeingUntil <= now && !eating && !checkingGear && !isMoving
}

module.exports = { RAW_IRON, STORAGE_IRON, ironDepositPlan, canAutomaticIronDeposit }
