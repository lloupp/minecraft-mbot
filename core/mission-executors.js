// core/mission-executors.js
// Adaptadores entre o grafo de missão e as skills já validadas no jogo.
// Cada executor devolve { ok, evidence, code?, error? }; quem verifica é o
// MissionRunner + lib/verifiers, nunca o próprio executor.

'use strict'

const { Vec3 } = require('vec3')

const MOVE_TIMEOUT_MS = 90000

function countItem(bot, name) {
  return (bot?.inventory?.items?.() || [])
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + (item.count || 0), 0)
}

function blockNamesForItem(bot, item) {
  const registry = bot?.registry
  const names = new Set()
  if (!registry) return names
  if (registry.blocksByName?.[item]) names.add(item)
  for (const block of registry.blocksArray || []) {
    if (!Array.isArray(block.drops)) continue
    if (block.drops.some((id) => registry.items?.[id]?.name === item)) names.add(block.name)
  }
  return names
}

function failed(error, code = null) {
  return { ok: false, error: error?.message || String(error || 'falha'), ...(code ? { code } : {}) }
}

function createExecutors({
  bot,
  storage = null,
  production = null,
  gather,
  craft,
  handover,
  goals,
  waypointManager = null,
  ownerProvider = () => null,
  deliveryChestProvider = null,
  logger = console
} = {}) {
  async function gatherNode(node, ctx = {}) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    const before = countItem(bot, item)
    const needed = Math.max(0, quantity - before)
    if (needed === 0) return { ok: true, evidence: { before, after: before, skipped: true } }

    const names = blockNamesForItem(bot, item)
    if (!names.size) return failed(`não encontrei bloco que dê ${item}`, 'RESOURCE_NOT_FOUND')

    const mined = await gather.mineBlocks(
      bot,
      (name) => names.has(name),
      needed,
      ctx.isCancelled || (() => false)
    )
    const after = countItem(bot, item)
    const ok = after - before >= needed
    return {
      ok,
      evidence: { before, after, mined, needed },
      ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: `consegui ${after - before}/${needed} ${item}` })
    }
  }

  async function craftNode(node, ctx = {}) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    const before = countItem(bot, item)
    if (before >= quantity) return { ok: true, evidence: { before, after: before, skipped: true } }
    if (production?.craftInternal) await production.craftInternal(bot, item, quantity)
    else await craft.craftItem(bot, item, quantity, ctx.isCancelled || (() => false))
    const after = countItem(bot, item)
    const ok = after - before >= quantity
    return {
      ok,
      evidence: { before, after },
      ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: `fabricou ${after - before}/${quantity} ${item}` })
    }
  }

  async function smeltNode(node, ctx = {}) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    const before = countItem(bot, item)
    if (before >= quantity) return { ok: true, evidence: { before, after: before, skipped: true } }
    await craft.smeltItem(bot, item, quantity, ctx.isCancelled || (() => false))
    const after = countItem(bot, item)
    const ok = after - before >= quantity
    return {
      ok,
      evidence: { before, after },
      ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: `fundiu ${after - before}/${quantity} ${item}` })
    }
  }

  async function depositNode(node) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    if (!storage?.configured?.()) return failed('estoque central não configurado', 'CONTAINER_UNREACHABLE')
    const deposited = await storage.depositMany(bot, { [item]: quantity })
    const summary = await storage.summary(bot)
    const moved = Number(deposited?.[item]) || 0
    const inside = Number(summary?.[item]) || 0
    const ok = moved >= quantity && inside >= quantity
    return {
      ok,
      evidence: { deposited: moved, inside, before: countItem(bot, item) },
      ...(ok ? {} : { code: 'VERIFICATION_FAILED', error: `depositei ${moved}/${quantity} ${item}` })
    }
  }

  async function withdrawNode(node) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    if (!storage?.configured?.()) return failed('estoque central não configurado', 'CONTAINER_UNREACHABLE')
    const before = countItem(bot, item)
    if (before >= quantity) return { ok: true, evidence: { before, after: before, skipped: true } }
    const got = await storage.withdraw(bot, item, quantity)
    const after = countItem(bot, item)
    const ok = after - before >= quantity
    return {
      ok,
      evidence: { before, after, got },
      ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: `retirei ${after - before}/${quantity} ${item}` })
    }
  }

  async function moveToNode(node, ctx = {}) {
    const local = String(node?.args?.local || '').toLowerCase()
    const entry = waypointManager?.get?.(local)
    if (!entry) return failed(`local desconhecido: ${local}`, 'RESOURCE_NOT_FOUND')
    if (waypointManager?.sameDimension && !waypointManager.sameDimension(entry, bot.game?.dimension)) {
      return failed(`local ${local} fica em outra dimensão`, 'WRONG_DIMENSION')
    }
    const { x, y, z } = entry.position
    const goal = new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 3)
    let timer
    try {
      await Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            try { bot.pathfinder.setGoal(null) } catch { /* já parado */ }
            reject(new Error('caminho demorou demais'))
          }, MOVE_TIMEOUT_MS)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    if (ctx.isCancelled?.()) return { ok: false, cancelled: true }
    const position = bot.entity.position
    const distance = position.distanceTo(new Vec3(x, y, z))
    const ok = distance <= 5
    return {
      ok,
      evidence: { position: { x: position.x, y: position.y, z: position.z }, distance },
      ...(ok ? {} : { code: 'PATH_TIMEOUT', error: `parei a ${distance.toFixed(1)} blocos de ${local}` })
    }
  }

  async function deliverNode(node, ctx = {}) {
    const item = node?.args?.item
    const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
    const mode = node?.args?.mode === 'hand' ? 'hand' : 'chest'

    if (countItem(bot, item) < quantity && storage?.configured?.()) {
      await storage.withdraw(bot, item, quantity - countItem(bot, item)).catch(() => 0)
    }

    if (mode === 'hand') {
      const owner = ownerProvider?.()
      if (!owner) return failed('não vejo o dono por perto', 'RESOURCE_NOT_FOUND')
      const before = countItem(bot, item)
      const result = await handover.deliverTo(bot, { owner, name: item, amount: quantity, isCancelled: ctx.isCancelled })
      const after = countItem(bot, item)
      const ok = Boolean(result?.ok) && Number(result?.delivered) >= quantity
      return {
        ok,
        evidence: { before, after, delivered: result?.delivered || 0, remaining: result?.remaining },
        ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: result?.reason || `entreguei ${result?.delivered || 0}/${quantity}` })
      }
    }

    const position = deliveryChestProvider?.() || handover.DELIVERY_CHEST
    const before = countItem(bot, item)
    const result = await handover.depositAtChest(bot, {
      position,
      name: item,
      amount: quantity,
      isCancelled: ctx.isCancelled || (() => false),
      craftItem: (client, name, count, isCancelled) => craft.craftItem(client, name, count, isCancelled),
      withdraw: (name, count) => storage.withdraw(bot, name, count),
      allowCreate: true,
      log: (line) => logger.log?.(line)
    })
    const outside = countItem(bot, item)
    const ok = Boolean(result?.ok) && Number(result?.deposited) >= quantity
    return {
      ok,
      evidence: { before, after: outside, deposited: result?.deposited || 0, inside: result?.inside, chest: result?.chest },
      ...(ok ? {} : { code: 'ITEM_NOT_CONFIRMED', error: result?.reason || `depositei ${result?.deposited || 0}/${quantity}` })
    }
  }

  return {
    gather: gatherNode,
    craft: craftNode,
    smelt: smeltNode,
    deposit: depositNode,
    withdraw: withdrawNode,
    move_to: moveToNode,
    deliver: deliverNode
  }
}

module.exports = { createExecutors, blockNamesForItem, countItem }
