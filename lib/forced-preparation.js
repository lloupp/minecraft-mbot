// Explicit opt-in preparation bridge, independent of all model outputs.
// One bounded step per call. No automatic retry, task dispatch or world-wide scan.
const { Vec3 } = require('vec3')
const gather = require('./gather')
const { realStateSnapshot } = require('./real-state')
const { candidateIntents, deterministicPlayerPolicy, immediateSafety } = require('./player-loop')

const busy = new WeakSet()
const count = (state, name) => Number(state.inventory?.[name] || 0)
const logName = name => name.endsWith('_log') // stems/stripped variants deliberately unsupported here

function preparationPlan(state) {
  const missing = { stick: Math.max(0, 1 - count(state, 'stick')), cobblestone: Math.max(0, 2 - count(state, 'cobblestone')) }
  const planks = Object.entries(state.inventory || {}).filter(([n]) => n.endsWith('_planks')).reduce((s, [, c]) => s + c, 0)
  const logs = Object.entries(state.inventory || {}).filter(([n]) => logName(n)).reduce((s, [, c]) => s + c, 0)
  return { weapon: 'stone_sword', missing,
    collect: { logs: missing.stick && planks < 2 && logs < 1 ? 1 : 0, cobblestone: missing.cobblestone },
    conversions: missing.stick ? ['planks_if_needed', 'stick_one_recipe_batch'] : [],
    reason: 'stone sword requires 2 cobblestone and 1 stick; one log yields 4 planks, 2 planks yield 4 sticks' }
}

async function executePreparationStep({ enabled = false, bot, task, production,
  allowedTargets = [], homeProvider, isCancelled = () => false, timeoutMs = 20000 }) {
  if (!enabled) return { ok: false, code: 'DISABLED' }
  if (busy.has(bot)) return { ok: false, code: 'BUSY' }
  busy.add(bot)
  const steps = []
  const deadline = Date.now() + timeoutMs
  let aborted = false
  const snapshot = () => {
    const state = realStateSnapshot(bot, task, { homeProvider })
    state.cancellationRequested = isCancelled()
    return state
  }
  const stopped = () => {
    const state = snapshot()
    return aborted || Date.now() >= deadline || isCancelled() || Boolean(state.threat) || Boolean(immediateSafety(state))
  }
  const check = () => { if (stopped()) throw new Error(Date.now() >= deadline ? 'TIMEOUT' : 'SAFETY_OR_CANCELLED') }
  let initial, intent, plan
  const monitor = setInterval(() => {
    try {
      if (stopped()) {
        aborted = true
        bot.pathfinder?.stop?.()
        bot.stopDigging?.()
      }
    } catch { aborted = true }
  }, 250)
  try {
    initial = snapshot()
    const candidates = candidateIntents(initial)
    intent = deterministicPlayerPolicy(initial, candidates)
    check()
    if (intent !== 'gather_materials' && intent !== 'prepare_combat') return { ok: false, code: 'NO_PREPARATION_INTENT', initial, candidates }
    if (intent === 'gather_materials' && (candidates.length !== 1 || candidates[0].id !== intent)) return { ok: false, code: 'NOT_FORCED' }
    // Caller must explicitly supply a live nearby table. Do not place blocks or access storage.
    if (production.storage?.configured?.()) return { ok: false, code: 'LOCAL_PRODUCTION_REQUIRED', initial }
    const table = production.cachedCraftingTable(bot)
    if (!table || bot.entity.position.distanceTo(table.position) > 4) return { ok: false, code: 'NEARBY_TABLE_REQUIRED', initial }
    const craft = async (name, quantity) => {
      check()
      const before = snapshot().inventory
      const result = await production.craftInternal(bot, name, quantity)
      check()
      const after = snapshot().inventory
      if (Number(after[name] || 0) <= Number(before[name] || 0)) throw new Error('CRAFT_ITEM_NOT_CONFIRMED')
      steps.push({ task: 'craft', item: name, requested: quantity, before, after, result, inventoryConfirmed: true })
    }
    if (intent === 'prepare_combat') {
      // This is still a rules choice, even when prepare/continue is multi-candidate.
      if (count(initial, 'stone_sword') < 1) {
        if (!initial.craftable.includes('stone_sword')) return { ok: false, code: 'STONE_SWORD_NOT_CRAFTABLE', initial }
        await craft('stone_sword', 1)
      }
      check()
      await bot.equip(bot.inventory.items().find(i => i.name === 'stone_sword'), 'hand')
      check()
      if (bot.heldItem?.name !== 'stone_sword') throw new Error('EQUIP_NOT_CONFIRMED')
      steps.push({ task: 'equip', item: 'stone_sword', inventoryConfirmed: true })
    } else {
      plan = preparationPlan(initial)
      // Preflight all physical prerequisites before breaking anything.
      const targets = [...new Map(allowedTargets.map(t => [JSON.stringify([t.x, t.y, t.z]), t])).values()]
        .map(t => ({ position: new Vec3(t.x, t.y, t.z), name: t.name }))
        .filter(t => Number.isInteger(t.position.x) && Number.isInteger(t.position.y) && Number.isInteger(t.position.z) &&
          typeof t.name === 'string' && bot.entity.position.distanceTo(t.position) <= 4 && bot.blockAt(t.position)?.name === t.name)
      const wood = targets.filter(t => logName(t.name) && gather.isExposed(bot, t.position))
      const stone = targets.filter(t => ['stone', 'cobblestone'].includes(t.name) && gather.isExposed(bot, t.position))
      if (wood.length < plan.collect.logs || stone.length < plan.collect.cobblestone) return { ok: false, code: 'APPROVED_TARGETS_INSUFFICIENT', initial, plan }
      if (plan.collect.cobblestone && !bot.inventory.items().some(i => i.name.endsWith('_pickaxe') && !i.enchants?.some(e => e.name === 'silk_touch'))) {
        return { ok: false, code: 'MINING_PICKAXE_REQUIRED', initial, plan }
      }
      if (stone.slice(0, plan.collect.cobblestone).some(t =>
        !gather.expectedDrops(bot, bot.blockAt(t.position), bot.pathfinder.bestHarvestTool(bot.blockAt(t.position))).has('cobblestone'))) {
        return { ok: false, code: 'COBBLESTONE_DROP_REQUIRED', initial, plan }
      }
      const collect = async (targets, quantity, resource) => {
        if (!quantity) return
        check()
        const allowed = new Set(targets.slice(0, quantity).map(t => t.position.toString()))
        const names = new Set(targets.slice(0, quantity).map(t => t.name))
        const before = snapshot().inventory
        const attempts = []
        const collected = await gather.mineBlocks(bot, n => names.has(n), quantity, stopped,
          { allowedPositions: allowed, preferInReach: true, onAttempt: a => attempts.push(a) })
        steps.push({ task: 'gather', resource, requested: quantity, collected, before,
          after: snapshot().inventory, attempts, approvedPositions: [...allowed], inventoryConfirmed: collected === quantity })
        check()
        if (collected !== quantity) throw new Error('GATHER_ITEM_NOT_CONFIRMED')
      }
      await collect(wood, plan.collect.logs, 'log')
      if (plan.missing.stick) {
        let state = snapshot()
        let plank = Object.entries(state.inventory).find(([n, c]) => n.endsWith('_planks') && c >= 2)
        if (!plank) {
          const log = Object.entries(state.inventory).find(([n, c]) => logName(n) && c >= 1)
          if (!log) throw new Error('STICK_SOURCE_NOT_USABLE')
          await craft(log[0].replace(/_log$/, '_planks'), 2)
        }
        await craft('stick', 1)
      }
      await collect(stone, plan.collect.cobblestone, 'cobblestone')
      if (count(snapshot(), 'stick') < 1 || count(snapshot(), 'cobblestone') < 2) throw new Error('RECIPE_INPUTS_NOT_CONFIRMED')
    }
    const final = snapshot()
    return { ok: true, initial, intent, plan, steps, final, nextCandidates: candidateIntents(final),
      executionAuthority: 'deterministic_opt_in', juliaExecutionAuthority: 'none' }
  } catch (error) {
    return { ok: false, code: error.message, initial, intent, plan, steps, final: snapshot(), juliaExecutionAuthority: 'none' }
  } finally {
    clearInterval(monitor)
    busy.delete(bot)
  }
}

module.exports = { preparationPlan, executePreparationStep }
