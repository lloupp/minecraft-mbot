// Explicit opt-in preparation bridge, independent of all model outputs.
// One bounded step per call. No automatic retry, task dispatch or world-wide scan.
const { Vec3 } = require('vec3')
const gather = require('./gather')
const { realStateSnapshot } = require('./real-state')
const { candidateIntents, deterministicPlayerPolicy, immediateSafety, bestWeapon } = require('./player-loop')

const busy = new WeakSet()
const count = (state, name) => Number(state.inventory?.[name] || 0)
const logName = name => name.endsWith('_log') // stems/stripped variants deliberately unsupported here

function preparationDispatchTask({ enabled = false, state, objective, allowedTargets = [], timeoutMs = 20000 } = {}) {
  if (!enabled || !state || !objective || typeof objective !== 'object' || !objective.type) return null

  const candidates = candidateIntents(state)
  const choice = deterministicPlayerPolicy(state, candidates)
  const eligible = choice === 'gather_materials' || choice === 'prepare_combat' || choice === 'equip_best_weapon'
  if (!eligible) return null
  if (state.threat || immediateSafety(state)) return null
  if (choice === 'prepare_combat' && !state.craftable?.includes('stone_sword')) return null
  if (choice === 'equip_best_weapon' && bestWeapon(state).name !== 'stone_sword') return null

  // Gathering is only auto-eligible when the player-loop itself made it a
  // forced singleton and the caller provides an explicit physical allowlist.
  if (choice === 'gather_materials') {
    if (candidates.length !== 1 || candidates[0]?.id !== 'gather_materials') return null
    if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) return null
  }

  return {
    type: 'preparar_combate_deterministico',
    objective: { ...objective },
    allowedTargets: Array.isArray(allowedTargets) ? allowedTargets.map((target) => ({ ...target })) : [],
    timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : 20000,
    deterministicIntent: choice
  }
}

function preparationPlan(state) {
  if (count(state, 'stone_sword') >= 1) return { weapon: 'stone_sword', missing: { stick: 0, cobblestone: 0 }, collect: { logs: 0, cobblestone: 0 }, conversions: [], reason: 'stone sword already carried; only equip/re-evaluation remains' }
  const missing = { stick: Math.max(0, 1 - count(state, 'stick')), cobblestone: Math.max(0, 2 - count(state, 'cobblestone')) }
  const planks = Object.entries(state.inventory || {}).filter(([n]) => n.endsWith('_planks')).reduce((s, [, c]) => s + c, 0)
  const logs = Object.entries(state.inventory || {}).filter(([n]) => logName(n)).reduce((s, [, c]) => s + c, 0)
  return { weapon: 'stone_sword', missing,
    collect: { logs: missing.stick && planks < 2 && logs < 1 ? 1 : 0, cobblestone: missing.cobblestone },
    conversions: missing.stick ? ['planks_if_needed', 'stick_one_recipe_batch'] : [],
    reason: 'stone sword requires 2 cobblestone and 1 stick; one log yields 4 planks, 2 planks yield 4 sticks' }
}

function preparationStateSnapshot(bot, task, { homeProvider, allowedTargets = [], isCancelled = () => false } = {}) {
  const state = realStateSnapshot(bot, task, { homeProvider })
  // Sparse shadow perception can miss the remaining approved block after pickup.
  // Refine only this opt-in task from live, nearby, explicitly approved sources.
  for (const t of allowedTargets.slice(0, 64)) {
    if (![t.x, t.y, t.z].every(Number.isInteger)) continue
    const p = new Vec3(t.x, t.y, t.z)
    const distance = bot.entity.position.distanceTo(p)
    if (distance > 4 || bot.blockAt(p)?.name !== t.name) continue
    const resource = logName(t.name) ? 'wood' : ['stone', 'cobblestone'].includes(t.name) ? 'stone' : null
    if (resource) {
      state.nearby[resource] = true
      state.nearby[`${resource}Distance`] = Math.min(state.nearby[`${resource}Distance`] ?? Infinity, distance)
    }
  }
  state.cancellationRequested = isCancelled()
  return state
}

async function executePreparationStep({ enabled = false, bot, task, production,
  allowedTargets = [], homeProvider, isCancelled = () => false, timeoutMs = 20000, onEvent = () => {} }) {
  if (!enabled) return { ok: false, code: 'DISABLED' }
  if (busy.has(bot)) return { ok: false, code: 'BUSY' }
  busy.add(bot)
  const steps = []
  const deadline = Date.now() + timeoutMs
  let aborted = false
  let haltReason = null
  const snapshot = () => preparationStateSnapshot(bot, task, { homeProvider, allowedTargets, isCancelled })
  const stopReason = () => {
    if (haltReason) return haltReason
    const latch = code => {
      haltReason = code
      onEvent({ event: 'safety_detected', code, timestamp: Date.now(), inventory: snapshot().inventory })
      return code
    }
    if (Date.now() >= deadline) return latch('TIMEOUT')
    // client.end() closes the output stream before its asynchronous end event.
    // Ownership invalidation on end alone leaves a craft -> equip race here.
    if (bot._client?.ended || bot._client?.serializer?.writableEnded || bot._client?.socket?.destroyed) return latch('DISCONNECTED')
    if (isCancelled()) return latch('CANCELLED')
    const state = snapshot()
    if (state.threat) return latch('THREAT')
    const safety = immediateSafety(state)
    if (safety) return latch(`SAFETY_${String(safety).toUpperCase()}`)
    return aborted ? 'INTERRUPTED' : null
  }
  const stopped = () => Boolean(stopReason())
  const check = () => {
    const reason = stopReason()
    if (reason) throw new Error(reason)
  }
  const beforeAction = action => {
    check()
    if (action.operation === 'craft' && action.item === 'stone_sword' && count(snapshot(), 'stone_sword') > 0) throw new Error('WEAPON_ALREADY_AVAILABLE')
    if (((action.operation === 'dig' && ['stone', 'cobblestone'].includes(action.block?.name)) ||
      (action.operation === 'equip' && action.item?.endsWith('_pickaxe'))) &&
      !bot.inventory.items().some(i => i.name.endsWith('_pickaxe') && !i.enchants?.some(e => e.name === 'silk_touch'))) {
      throw Object.assign(new Error('MINING_PICKAXE_REQUIRED'), { code: 'MINING_PICKAXE_REQUIRED' })
    }
    onEvent({ event: 'before_physical_action', ...action, timestamp: Date.now() })
  }
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
    const equipCarriedSword = intent === 'equip_best_weapon' && bestWeapon(initial).name === 'stone_sword'
    if (intent !== 'gather_materials' && intent !== 'prepare_combat' && !equipCarriedSword) return { ok: false, code: 'NO_PREPARATION_INTENT', initial, candidates }
    if (intent === 'gather_materials' && (candidates.length !== 1 || candidates[0].id !== intent)) return { ok: false, code: 'NOT_FORCED' }
    // Caller must explicitly supply a live nearby table. Do not place blocks or access storage.
    if (production.storage?.configured?.()) return { ok: false, code: 'LOCAL_PRODUCTION_REQUIRED', initial }
    const table = equipCarriedSword ? null : production.cachedCraftingTable(bot)
    if (!equipCarriedSword && (!table || bot.entity.position.distanceTo(table.position) > 4)) return { ok: false, code: 'NEARBY_TABLE_REQUIRED', initial }
    const craft = async (name, quantity) => {
      check()
      const before = snapshot().inventory
      let result
      try { result = await production.craftInternal(bot, name, quantity, 0, new Set(), { localOnly: true, beforeAction }) }
      catch (error) {
        if (error.message === 'WEAPON_ALREADY_AVAILABLE' && name === 'stone_sword' && count(snapshot(), name) > 0) result = { skipped: true, reason: 'weapon_already_available' }
        else throw error
      }
      finally {
        const after = snapshot().inventory
        steps.push({ task: 'craft', item: name, requested: quantity, before, after, result,
          inventoryConfirmed: result?.skipped ? Number(after[name] || 0) > 0 : Number(after[name] || 0) > Number(before[name] || 0), interruption: stopReason() })
      }
      check()
      if (!steps[steps.length - 1].inventoryConfirmed) throw new Error('CRAFT_ITEM_NOT_CONFIRMED')
    }
    if (intent === 'prepare_combat' || equipCarriedSword) {
      // This is still a rules choice, even when prepare/continue is multi-candidate.
      if (count(initial, 'stone_sword') < 1) {
        if (!initial.craftable.includes('stone_sword')) return { ok: false, code: 'STONE_SWORD_NOT_CRAFTABLE', initial }
        await craft('stone_sword', 1)
      }
      beforeAction({ operation: 'equip', item: 'stone_sword' })
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
        const allowed = new Set(targets.map(t => t.position.toString()))
        const names = new Set(targets.map(t => t.name))
        const before = snapshot().inventory
        const attempts = []
        const collected = await gather.mineBlocks(bot, n => names.has(n), quantity, stopped,
          { allowedPositions: allowed, preferInReach: true, requireInReach: true, beforeAction, onAttempt: a => attempts.push(a) })
        steps.push({ task: 'gather', resource, requested: quantity, collected, before,
          after: snapshot().inventory, attempts, approvedPositions: [...allowed], inventoryConfirmed: collected === quantity })
        check()
        if (collected !== quantity) throw new Error(attempts.find(a => a.code === 'MINING_PICKAXE_REQUIRED')?.code || (attempts.some(a => a.code === 'TARGET_BLOCKED') ? 'TARGET_BLOCKED' : 'GATHER_ITEM_NOT_CONFIRMED'))
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
    const final = snapshot()
    const code = stopReason() || error.message
    return {
      ok: false,
      code,
      interrupted: ['CANCELLED', 'THREAT', 'INTERRUPTED', 'DISCONNECTED'].includes(code) || String(code).startsWith('SAFETY_'),
      initial,
      intent,
      plan,
      steps,
      final,
      remainingPlan: preparationPlan(final),
      juliaExecutionAuthority: 'none'
    }
  } finally {
    clearInterval(monitor)
    busy.delete(bot)
  }
}

module.exports = { preparationPlan, preparationDispatchTask, preparationStateSnapshot, executePreparationStep }
