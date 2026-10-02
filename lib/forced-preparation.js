// Explicit opt-in preparation bridge, independent of all model outputs.
// One bounded step per call. No automatic retry, task dispatch or world-wide scan.
const { Vec3 } = require('vec3')
const gather = require('./gather')
const food = require('./food')
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

function preparationIntegrationPreflight({ bot, production, state, allowedTargets = [] } = {}) {
  if (!bot?.entity?.position || !production || !state) return { ok: false, code: 'PREFLIGHT_CONTEXT_REQUIRED' }

  const candidates = candidateIntents(state)
  const choice = deterministicPlayerPolicy(state, candidates)
  if (!['gather_materials', 'prepare_combat', 'equip_best_weapon'].includes(choice)) {
    return { ok: false, code: 'NO_PREPARATION_INTENT', choice }
  }

  if (state.threat || immediateSafety(state)) return { ok: false, code: 'SAFETY_PRECEDENCE', choice }

  if (choice === 'equip_best_weapon') {
    return bestWeapon(state).name === 'stone_sword'
      ? { ok: true, choice, tableRequired: false, requiredTargets: 0, liveTargets: [] }
      : { ok: false, code: 'SUPPORTED_WEAPON_REQUIRED', choice }
  }

  const table = production.cachedCraftingTable?.(bot)
  if (!table || bot.blockAt?.(table.position)?.name !== 'crafting_table' ||
      bot.entity.position.distanceTo(table.position) > 4) {
    return { ok: false, code: 'NEARBY_TABLE_REQUIRED', choice }
  }

  if (choice === 'prepare_combat') {
    return state.craftable?.includes('stone_sword')
      ? { ok: true, choice, tableRequired: true, tablePosition: table.position }
      : { ok: false, code: 'STONE_SWORD_NOT_CRAFTABLE', choice }
  }

  if (candidates.length !== 1 || candidates[0]?.id !== 'gather_materials') {
    return { ok: false, code: 'GATHER_NOT_FORCED', choice }
  }

  const plan = preparationPlan(state)
  const unique = [...new Map((Array.isArray(allowedTargets) ? allowedTargets : [])
    .filter((target) => target && [target.x, target.y, target.z].every(Number.isInteger) && typeof target.name === 'string')
    .map((target) => [`${target.x},${target.y},${target.z}`, target])).values()]

  const liveTargets = unique.filter((target) => {
    const position = new Vec3(target.x, target.y, target.z)
    const block = bot.blockAt?.(position)
    if (!block || block.name !== target.name) return false
    if (bot.entity.position.distanceTo(position) > 4) return false
    if (!gather.isExposed(bot, position)) return false
    // Exposure and Mineflayer canDigBlock establish air adjacency/range, not
    // line of sight. Match the bounded executor's refusal to dig through an
    // obstacle or underneath a falling block, without rotating/moving the bot.
    if (gather.hasFallingAbove(bot, position)) return false
    if (typeof bot.canDigBlock !== 'function' || !bot.canDigBlock(block)) return false
    if (typeof bot.canSeeBlock !== 'function' || !bot.canSeeBlock(block)) return false
    return true
  })

  const wood = liveTargets.filter((target) => logName(target.name))
  const stone = liveTargets.filter((target) => ['stone', 'cobblestone'].includes(target.name))

  if (wood.length < plan.collect.logs || stone.length < plan.collect.cobblestone) {
    return {
      ok: false,
      code: 'APPROVED_TARGETS_INSUFFICIENT',
      choice,
      plan,
      liveTargets
    }
  }

  if (plan.collect.cobblestone > 0) {
    const pickaxe = bot.inventory?.items?.().find((item) =>
      item.name.endsWith('_pickaxe') && !item.enchants?.some((enchant) => enchant.name === 'silk_touch'))
    if (!pickaxe) return { ok: false, code: 'MINING_PICKAXE_REQUIRED', choice, plan, liveTargets }

    const badDrop = stone.slice(0, plan.collect.cobblestone).some((target) => {
      const block = bot.blockAt(new Vec3(target.x, target.y, target.z))
      const tool = bot.pathfinder?.bestHarvestTool?.(block) || pickaxe
      return !gather.expectedDrops(bot, block, tool).has('cobblestone')
    })
    if (badDrop) return { ok: false, code: 'COBBLESTONE_DROP_REQUIRED', choice, plan, liveTargets }
  }

  return {
    ok: true,
    choice,
    plan,
    tableRequired: true,
    tablePosition: table.position,
    requiredTargets: plan.collect.logs + plan.collect.cobblestone,
    liveTargets
  }
}

function preparationIntegrationTask({ enabled = false, bot, production, state, objective, allowedTargets = [], timeoutMs = 20000 } = {}) {
  if (!enabled) return null
  const task = preparationDispatchTask({ enabled, state, objective, allowedTargets, timeoutMs })
  if (!task) return null
  const preflight = preparationIntegrationPreflight({ bot, production, state, allowedTargets })
  if (!preflight.ok) return null
  return {
    ...task,
    integrationPreflight: {
      choice: preflight.choice,
      tableRequired: preflight.tableRequired,
      requiredTargets: preflight.requiredTargets ?? 0
    }
  }
}

async function recoverApprovedCobblestoneDrops({
  bot,
  allowedTargets = [],
  maxItems = 0,
  stopped = () => false,
  snapshot,
  check,
  onEvent = () => {},
  steps = []
} = {}) {
  if (maxItems <= 0 || typeof snapshot !== 'function' || typeof check !== 'function') return 0
  const air = new Set(['air', 'cave_air', 'void_air'])
  const seen = new Set()
  let recovered = 0

  for (const target of allowedTargets.slice(0, 64)) {
    if (recovered >= maxItems) break
    if (!target || !['stone', 'cobblestone'].includes(target.name)) continue
    if (![target.x, target.y, target.z].every(Number.isInteger)) continue

    const key = `${target.x},${target.y},${target.z}`
    if (seen.has(key)) continue
    seen.add(key)

    const center = new Vec3(target.x, target.y, target.z)
    if (!air.has(bot.blockAt(center)?.name)) continue

    const matchingDrops = Object.values(bot.entities || {}).filter((entity) => {
      if (entity?.name !== 'item' || entity.isValid === false || !entity.position) return false
      if (entity.position.distanceTo(center) > 2) return false
      return entity.getDroppedItem?.()?.name === 'cobblestone'
    })

    // More than one matching entity makes provenance ambiguous; refuse rather
    // than crediting arbitrary world items to this destroyed approved target.
    if (matchingDrops.length !== 1) continue

    check()
    const selectedDrop = matchingDrops[0]
    const before = count(snapshot(), 'cobblestone')
    const recoveryStep = {
      task: 'recover_drop',
      item: 'cobblestone',
      approvedTarget: { x: target.x, y: target.y, z: target.z },
      selectedDropId: selectedDrop.id ?? null,
      inventoryBefore: before,
      inventoryAfter: before,
      delta: 0,
      inventoryConfirmed: false
    }

    onEvent({
      event: 'recover_approved_drop',
      item: 'cobblestone',
      target: recoveryStep.approvedTarget,
      selectedDropId: recoveryStep.selectedDropId,
      timestamp: Date.now()
    })

    // A pinned selection is insufficient once goto is already in flight: a
    // replacement at the same coordinates could otherwise be picked up and
    // attributed to the vanished entity. Stop that movement on entity removal.
    // Mineflayer emits playerCollect before entityGone for a normal pickup.
    let dropChanged = false
    let pickedUpByBot = false
    const onCollect = (collector, collected) => {
      if (collected === selectedDrop && collector === bot.entity) pickedUpByBot = true
    }
    const onGone = entity => {
      if (entity !== selectedDrop || pickedUpByBot) return
      dropChanged = true
      onEvent({ event: 'recovery_drop_changed', selectedDropId: recoveryStep.selectedDropId, timestamp: Date.now() })
      bot.pathfinder?.setGoal(null)
    }
    bot.on?.('playerCollect', onCollect)
    bot.on?.('entityGone', onGone)
    try {
      await food.collectDrops(bot, center, () => dropChanged || stopped(), {
        timeoutMs: 3000,
        radius: 2,
        // Keep provenance stable: if this entity disappears or changes, do not
        // switch to another cobblestone item that happened to enter the radius.
        matches: (entity) => entity === selectedDrop &&
          entity.getDroppedItem?.()?.name === 'cobblestone',
        done: () => count(snapshot(), 'cobblestone') > before,
        beforeMove: (entity) => {
          check()
          if (dropChanged || entity !== selectedDrop || entity.isValid === false ||
              entity.getDroppedItem?.()?.name !== 'cobblestone' ||
              entity.position.distanceTo(center) > 2) {
            throw new Error('RECOVERY_DROP_CHANGED')
          }
          onEvent({
            event: 'before_physical_action',
            operation: 'recover_drop_move',
            item: 'cobblestone',
            selectedDropId: recoveryStep.selectedDropId,
            target: recoveryStep.approvedTarget,
            timestamp: Date.now()
          })
        }
      })
      check()
      if (dropChanged) throw new Error('RECOVERY_DROP_CHANGED')
    } finally {
      bot.removeListener?.('playerCollect', onCollect)
      bot.removeListener?.('entityGone', onGone)
      const after = count(snapshot(), 'cobblestone')
      const delta = Math.max(0, after - before)
      recoveryStep.inventoryAfter = after
      recoveryStep.delta = delta
      recoveryStep.inventoryConfirmed = delta > 0
      recoveryStep.pickupObserved = pickedUpByBot
      if (dropChanged) recoveryStep.interruption = 'RECOVERY_DROP_CHANGED'
      steps.push(recoveryStep)
      recovered += delta
    }

    check()
  }

  return recovered
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
    // Caller must explicitly supply a live nearby table. Even when storage is configured,
    // this bridge remains local-only: craftInternal(..., { localOnly: true }) never withdraws
    // ingredients or bootstraps a crafting table from storage.
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

      // A reconnect can leave an expected drop in the world after the approved
      // block is already air. Recover only one unambiguous cobblestone item
      // within 2 blocks of that exact approved destroyed target, then re-plan
      // from the inventory actually confirmed by the server.
      if (plan.collect.cobblestone > 0) {
        const recovered = await recoverApprovedCobblestoneDrops({
          bot,
          allowedTargets,
          maxItems: plan.collect.cobblestone,
          stopped,
          snapshot,
          check,
          onEvent,
          steps
        })
        if (recovered > 0) plan = preparationPlan(snapshot())
      }

      // Recovery may already have moved or confirmed an item. Preserve that
      // evidence and the live remaining plan even when subsequent preflight refuses.
      const refuse = code => {
        const final = snapshot()
        return { ok: false, code, initial, plan, steps, final,
          remainingPlan: preparationPlan(final), juliaExecutionAuthority: 'none' }
      }

      // Preflight all physical prerequisites before breaking anything.
      const targets = [...new Map(allowedTargets.map(t => [JSON.stringify([t.x, t.y, t.z]), t])).values()]
        .map(t => ({ position: new Vec3(t.x, t.y, t.z), name: t.name }))
        .filter(t => Number.isInteger(t.position.x) && Number.isInteger(t.position.y) && Number.isInteger(t.position.z) &&
          typeof t.name === 'string' && bot.entity.position.distanceTo(t.position) <= 4 && bot.blockAt(t.position)?.name === t.name)
      const wood = targets.filter(t => logName(t.name) && gather.isExposed(bot, t.position))
      const stone = targets.filter(t => ['stone', 'cobblestone'].includes(t.name) && gather.isExposed(bot, t.position))
      if (wood.length < plan.collect.logs || stone.length < plan.collect.cobblestone) return refuse('APPROVED_TARGETS_INSUFFICIENT')
      if (plan.collect.cobblestone && !bot.inventory.items().some(i => i.name.endsWith('_pickaxe') && !i.enchants?.some(e => e.name === 'silk_touch'))) {
        return refuse('MINING_PICKAXE_REQUIRED')
      }
      if (stone.slice(0, plan.collect.cobblestone).some(t =>
        !gather.expectedDrops(bot, bot.blockAt(t.position), bot.pathfinder.bestHarvestTool(bot.blockAt(t.position))).has('cobblestone'))) {
        return refuse('COBBLESTONE_DROP_REQUIRED')
      }
      const anchor = bot.entity.position.clone()
      const collect = async (targets, quantity, resource) => {
        if (!quantity) return
        check()
        const allowed = new Set(targets.map(t => t.position.toString()))
        const names = new Set(targets.map(t => t.name))
        const before = snapshot().inventory
        const attempts = []
        const collected = await gather.mineBlocks(bot, n => names.has(n), quantity, stopped,
          { allowedPositions: allowed, preferInReach: true, requireInReach: true, retryPickup: true, anchor, beforeAction, onAttempt: a => attempts.push(a) })
        const after = snapshot().inventory
        // Um drop pego tarde (ex.: durante o alvo seguinte) não entra no contador de mineBlocks; o inventário é a evidência.
        const gained = resource === 'log'
          ? Object.entries(after).reduce((n, [k, c]) => n + (logName(k) ? c - Number(before[k] || 0) : 0), 0)
          : Number(after[resource] || 0) - Number(before[resource] || 0)
        const confirmed = collected >= quantity || gained >= quantity
        steps.push({ task: 'gather', resource, requested: quantity, collected, gained, before,
          after, attempts, approvedPositions: [...allowed], inventoryConfirmed: confirmed })
        check()
        if (!confirmed) throw new Error(attempts.find(a => a.code === 'MINING_PICKAXE_REQUIRED')?.code || (attempts.some(a => a.code === 'TARGET_BLOCKED') ? 'TARGET_BLOCKED' : 'GATHER_ITEM_NOT_CONFIRMED'))
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

module.exports = { preparationPlan, preparationDispatchTask, preparationIntegrationPreflight, preparationIntegrationTask, preparationStateSnapshot, recoverApprovedCobblestoneDrops, executePreparationStep }
