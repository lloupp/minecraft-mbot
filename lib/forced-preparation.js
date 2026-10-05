// Explicit opt-in preparation bridge, independent of all model outputs.
// One bounded step per call. No automatic retry, task dispatch or world-wide scan.
const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const gather = require('./gather')
const food = require('./food')
const { realStateSnapshot } = require('./real-state')
const { candidateIntents, deterministicPlayerPolicy, immediateSafety, bestWeapon } = require('./player-loop')

const busy = new WeakSet()
const count = (state, name) => Number(state.inventory?.[name] || 0)
// Raio local de alvos da preparação. 4 = comportamento original; até 8 só por opt-in explícito.
function preparationRadius() {
  const value = Number(process.env.MBOT_PREPARATION_RADIUS)
  return Number.isFinite(value) ? Math.min(8, Math.max(4, value)) : 4
}
// Célula de pé (ao lado do alvo, mesmo nível, chão sólido, 2 de altura livre) de onde o raio olhos→centro do
// alvo acerta o próprio alvo; a mais próxima do bot. null se nenhuma (ou sem raycast disponível).
function clearStandingCell(bot, target) {
  if (typeof bot.world?.raycast !== 'function') return null
  const origin = bot.entity?.position
  const center = target.offset(0.5, 0.5, 0.5)
  const cells = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const feet = target.offset(dx, 0, dz)
    const at = bot.blockAt(feet), head = bot.blockAt(feet.offset(0, 1, 0)), below = bot.blockAt(feet.offset(0, -1, 0))
    if (!at || !head || !below) continue
    if (at.boundingBox !== 'empty' || head.boundingBox !== 'empty' || below.boundingBox !== 'block') continue
    const eye = new Vec3(feet.x + 0.5, feet.y + 1.62, feet.z + 0.5)
    const hit = bot.world.raycast(eye, center.minus(eye).normalize(), 5)
    if (hit?.position?.equals(target)) cells.push(feet)
  }
  if (origin) cells.sort((a, b) => a.offset(0.5, 0, 0.5).distanceTo(origin) - b.offset(0.5, 0, 0.5).distanceTo(origin))
  return cells[0] || null
}
const logName = name => name.endsWith('_log') // stems/stripped variants deliberately unsupported here

// Bootstrap (opt-in, MBOT_PREPARATION_BOOTSTRAP=1): num mundo sem mesa, o passo de coleta forçado pode criar a
// base mínima com madeira aprovada ao alcance — tábuas, mesa colocada ao lado do bot, gravetos e picareta de madeira.
// Sem a flag a ponte continua exigindo uma mesa existente (NEARBY_TABLE_REQUIRED), como antes.
const bootstrapEnabled = () => process.env.MBOT_PREPARATION_BOOTSTRAP === '1'
const sumWhere = (inventory, predicate) => Object.entries(inventory || {}).filter(([n]) => predicate(n)).reduce((s, [, c]) => s + Number(c || 0), 0)
function bootstrapLogsNeeded(inventory, { hasTable = false } = {}) {
  const hasPickaxe = Object.keys(inventory || {}).some((n) => n.endsWith('_pickaxe') && Number(inventory[n]) > 0)
  const planksNeeded = (hasTable || Number(inventory?.crafting_table) > 0 ? 0 : 4) + (hasPickaxe ? 0 : 5)
  const planks = sumWhere(inventory, (n) => n.endsWith('_planks'))
  const logs = sumWhere(inventory, logName)
  return Math.max(0, Math.ceil(Math.max(0, planksNeeded - planks) / 4) - logs)
}

// Autoridade da Julia (opt-in): a intenção escolhida só vale enquanto ainda for candidata no estado atual;
// caso contrário (ou sem escolha) vale a política determinística. Nunca cria intenção fora dos candidatos.
function chosenIntent(state, candidates, authorizedIntent = null) {
  if (authorizedIntent && candidates.some((candidate) => candidate.id === authorizedIntent)) return authorizedIntent
  return deterministicPlayerPolicy(state, candidates)
}

function preparationDispatchTask({ enabled = false, state, objective, allowedTargets = [], timeoutMs = 20000, authorizedIntent = null } = {}) {
  if (!enabled || !state || !objective || typeof objective !== 'object' || !objective.type) return null

  const candidates = candidateIntents(state)
  const choice = chosenIntent(state, candidates, authorizedIntent)
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
    deterministicIntent: choice,
    ...(authorizedIntent ? { authorizedIntent } : {})
  }
}

function preparationIntegrationPreflight({ bot, production, state, allowedTargets = [], authorizedIntent = null } = {}) {
  if (!bot?.entity?.position || !production || !state) return { ok: false, code: 'PREFLIGHT_CONTEXT_REQUIRED' }

  const candidates = candidateIntents(state)
  const choice = chosenIntent(state, candidates, authorizedIntent)
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
  const tableNearby = Boolean(table) && bot.blockAt?.(table.position)?.name === 'crafting_table' &&
      bot.entity.position.distanceTo(table.position) <= 4
  const bootstrapping = !tableNearby && bootstrapEnabled() && choice === 'gather_materials'
  if (!tableNearby && !bootstrapping) {
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
    const distance = bot.entity.position.distanceTo(position)
    if (distance > preparationRadius()) return false
    if (!gather.isExposed(bot, position)) return false
    // Exposure and Mineflayer canDigBlock establish air adjacency/range, not
    // line of sight. Match the bounded executor's refusal to dig through an
    // obstacle or underneath a falling block, without rotating/moving the bot.
    if (gather.hasFallingAbove(bot, position)) return false
    // Além do alcance de escavação (>4) só dá para validar visibilidade depois da caminhada; o executor revalida.
    if (distance > 4) return true
    if (typeof bot.canDigBlock !== 'function' || !bot.canDigBlock(block)) return false
    if (typeof bot.canSeeBlock !== 'function' || !bot.canSeeBlock(block)) return false
    return true
  })

  const wood = liveTargets.filter((target) => logName(target.name))
  const stone = liveTargets.filter((target) => ['stone', 'cobblestone'].includes(target.name))

  if (bootstrapping) {
    const logsNeeded = bootstrapLogsNeeded(state.inventory)
    if (wood.length < logsNeeded) return { ok: false, code: 'APPROVED_TARGETS_INSUFFICIENT', choice, plan, liveTargets, bootstrap: true }
    return { ok: true, choice, plan, bootstrap: true, tableRequired: false, requiredTargets: logsNeeded, liveTargets }
  }

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

function preparationIntegrationTask({ enabled = false, bot, production, state, objective, allowedTargets = [], timeoutMs = 20000, authorizedIntent = null } = {}) {
  if (!enabled) return null
  const task = preparationDispatchTask({ enabled, state, objective, allowedTargets, timeoutMs, authorizedIntent })
  if (!task) return null
  const preflight = preparationIntegrationPreflight({ bot, production, state, allowedTargets, authorizedIntent })
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
    if (distance > preparationRadius() || bot.blockAt(p)?.name !== t.name) continue
    const resource = logName(t.name) ? 'wood' : ['stone', 'cobblestone'].includes(t.name) ? 'stone' : null
    if (resource) {
      state.nearby[resource] = true
      state.nearby[`${resource}Distance`] = Math.min(state.nearby[`${resource}Distance`] ?? Infinity, distance)
    }
  }
  state.cancellationRequested = isCancelled()
  return state
}

// Coloca a mesa do inventário numa célula livre ao lado do bot (sem caminhar, sem storage). Confirma no mundo.
async function placeLocalCraftingTable({ bot, production, check, beforeAction, steps }) {
  const item = bot.inventory.items().find((i) => i.name === 'crafting_table')
  if (!item) throw new Error('TABLE_ITEM_NOT_CONFIRMED')
  const feet = bot.entity.position.floored()
  const air = new Set(['air', 'cave_air'])
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    for (const dy of [0, 1, -1]) {
      const target = feet.offset(dx, dy, dz)
      const below = bot.blockAt(target.offset(0, -1, 0))
      if (!air.has(bot.blockAt(target)?.name) || below?.boundingBox !== 'block') continue
      check()
      beforeAction({ operation: 'place', item: 'crafting_table', position: { x: target.x, y: target.y, z: target.z } })
      await bot.equip(item, 'hand')
      try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch { continue }
      await bot.waitForTicks?.(2)
      const placed = bot.blockAt(target)
      if (placed?.name === 'crafting_table') {
        production.rememberCraftingTable(bot, placed)
        steps.push({ task: 'place', item: 'crafting_table', position: { x: target.x, y: target.y, z: target.z }, inventoryConfirmed: true })
        return placed
      }
    }
  }
  throw new Error('TABLE_PLACEMENT_FAILED')
}

async function executePreparationStep({ enabled = false, bot, task, production,
  allowedTargets = [], homeProvider, isCancelled = () => false, timeoutMs = 20000, onEvent = () => {}, authorizedIntent = null }) {
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
    intent = chosenIntent(initial, candidates, authorizedIntent)
    check()
    const equipCarriedSword = intent === 'equip_best_weapon' && bestWeapon(initial).name === 'stone_sword'
    if (intent !== 'gather_materials' && intent !== 'prepare_combat' && !equipCarriedSword) return { ok: false, code: 'NO_PREPARATION_INTENT', initial, candidates }
    if (intent === 'gather_materials' && (candidates.length !== 1 || candidates[0].id !== intent)) return { ok: false, code: 'NOT_FORCED' }
    // Caller must explicitly supply a live nearby table. Even when storage is configured,
    // this bridge remains local-only: craftInternal(..., { localOnly: true }) never withdraws
    // ingredients or bootstraps a crafting table from storage.
    const table = equipCarriedSword ? null : production.cachedCraftingTable(bot)
    const tableNearby = Boolean(table) && bot.entity.position.distanceTo(table.position) <= 4
    const bootstrapping = !equipCarriedSword && !tableNearby && bootstrapEnabled() && intent === 'gather_materials'
    if (!equipCarriedSword && !tableNearby && !bootstrapping) return { ok: false, code: 'NEARBY_TABLE_REQUIRED', initial }
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
          typeof t.name === 'string' && bot.entity.position.distanceTo(t.position) <= preparationRadius() && bot.blockAt(t.position)?.name === t.name)
      // Mesmos filtros de utilidade do preflight: mineBlocks escolhe o mais próximo, então um alvo
      // coberto (areia/cascalho em cima) ou fora de vista não pode entrar na lista aprovada.
      const usable = t => gather.isExposed(bot, t.position) && !gather.hasFallingAbove(bot, t.position) &&
        (bot.entity.position.distanceTo(t.position) > 4 || ((typeof bot.canDigBlock !== 'function' || bot.canDigBlock(bot.blockAt(t.position))) &&
          (typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(bot.blockAt(t.position)))))
      const wood = targets.filter(t => logName(t.name) && usable(t))
      const stone = targets.filter(t => ['stone', 'cobblestone'].includes(t.name) && usable(t))
      if (bootstrapping && wood.length < bootstrapLogsNeeded(initial.inventory)) return refuse('APPROVED_TARGETS_INSUFFICIENT')
      if (!bootstrapping && (wood.length < plan.collect.logs || stone.length < plan.collect.cobblestone)) return refuse('APPROVED_TARGETS_INSUFFICIENT')
      if (!bootstrapping && plan.collect.cobblestone && !bot.inventory.items().some(i => i.name.endsWith('_pickaxe') && !i.enchants?.some(e => e.name === 'silk_touch'))) {
        return refuse('MINING_PICKAXE_REQUIRED')
      }
      if (!bootstrapping && stone.slice(0, plan.collect.cobblestone).some(t =>
        !gather.expectedDrops(bot, bot.blockAt(t.position), bot.pathfinder.bestHarvestTool(bot.blockAt(t.position))).has('cobblestone'))) {
        return refuse('COBBLESTONE_DROP_REQUIRED')
      }
      const anchor = bot.entity.position.clone()
      // Raio >4 (opt-in): uma única caminhada até a célula ao lado do recurso mais próximo (visada quase
      // vertical: troncos de árvore têm folhas baixas que ocluem uma visada rasa a 2–3 blocos), com guard e parada imediata do
      // pathfinder se o monitor travar (ameaça/cancelamento); a mineração segue com a regra de alcance de sempre.
      const approach = async (group) => {
        if (preparationRadius() <= 4 || !group.length) return anchor
        const here = bot.entity.position
        const nearest = group.reduce((a, b) => here.distanceTo(a.position) <= here.distanceTo(b.position) ? a : b)
        if (here.distanceTo(nearest.position) > 4) {
          beforeAction({ operation: 'move', target: 'preparation_site' })
          const guard = setInterval(() => { if (stopped()) bot.pathfinder?.setGoal(null) }, 100)
          try {
            // Célula de pé ao lado do recurso com raio olhos→centro livre (folhas baixas de uma árvore podem
            // ocluir a visada de uma célula e não da vizinha); sem candidata, a célula alcançável mais próxima.
            const spot = clearStandingCell(bot, nearest.position)
            await food.goTo(bot, spot
              ? new goals.GoalBlock(spot.x, spot.y, spot.z)
              : new goals.GoalNear(nearest.position.x, nearest.position.y, nearest.position.z, 1.5), 8000)
          } catch { /* sem caminho: a mineração recusa com o código físico de sempre */ } finally { clearInterval(guard) }
          check()
        }
        return bot.entity.position.clone()
      }
      const collect = async (targets, quantity, resource) => {
        if (!quantity) return
        check()
        const siteAnchor = await approach(targets)
        const allowed = new Set(targets.map(t => t.position.toString()))
        const names = new Set(targets.map(t => t.name))
        const before = snapshot().inventory
        const attempts = []
        const collected = await gather.mineBlocks(bot, n => names.has(n), quantity, stopped,
          { allowedPositions: allowed, preferInReach: true, requireInReach: true, retryPickup: true, clearLeaves: preparationRadius() > 4, anchor: siteAnchor, beforeAction, onAttempt: a => attempts.push(a) })
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
      if (bootstrapping) {
        await collect(wood, bootstrapLogsNeeded(snapshot().inventory), 'log')
        const plankFrom = () => Object.entries(snapshot().inventory).find(([n, c]) => logName(n) && c >= 1)?.[0]?.replace(/_log$/, '_planks')
        const planks = () => sumWhere(snapshot().inventory, (n) => n.endsWith('_planks'))
        const ensurePlanks = async (needed) => {
          while (planks() < needed) {
            const name = plankFrom()
            if (!name) throw new Error('PLANK_SOURCE_NOT_USABLE')
            await craft(name, Math.min(4, needed - planks()))
          }
        }
        if (count(snapshot(), 'crafting_table') < 1) {
          await ensurePlanks(4)
          await craft('crafting_table', 1)
        }
        await placeLocalCraftingTable({ bot, production, check, beforeAction, steps })
        if (!snapshot().inventory || !Object.keys(snapshot().inventory).some((n) => n.endsWith('_pickaxe'))) {
          if (count(snapshot(), 'stick') < 2) { await ensurePlanks(2); await craft('stick', 2) }
          await ensurePlanks(3)
          await craft('wooden_pickaxe', 1)
        }
        const final = snapshot()
        return { ok: true, bootstrap: true, initial, intent, plan, steps, final, nextCandidates: candidateIntents(final),
          executionAuthority: 'deterministic_opt_in', juliaExecutionAuthority: 'none' }
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
      // Os pickups deslocam o bot; devolve-o ao ponto validado (mesa ≤4) para o próximo passo
      // (prepare_combat) não ser recusado por NEARBY_TABLE_REQUIRED. Um único movimento, com guard.
      const tablePos = production.cachedCraftingTable?.(bot)?.position
      if (tablePos && bot.entity.position.distanceTo(tablePos) > 3 && bot.entity.position.distanceTo(anchor) > 0.75) {
        beforeAction({ operation: 'move', target: 'preparation_anchor' })
        await food.goTo(bot, new goals.GoalBlock(Math.floor(anchor.x), Math.floor(anchor.y), Math.floor(anchor.z)), 5000).catch(() => {})
        check()
      }
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

module.exports = { clearStandingCell, preparationRadius, preparationPlan, preparationDispatchTask, preparationIntegrationPreflight, preparationIntegrationTask, preparationStateSnapshot, recoverApprovedCobblestoneDrops, executePreparationStep }
