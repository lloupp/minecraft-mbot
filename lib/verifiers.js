// lib/verifiers.js
// Pós-condição de cada nó. Aceite de API, mensagem no chat ou "a função
// resolveu" não contam: o verificador relê inventário, posição ou contêiner.

'use strict'

function countItem(bot, name) {
  return (bot?.inventory?.items?.() || [])
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + (item.count || 0), 0)
}

// "Tenho pelo menos N": o objetivo é absoluto. Pedir 4 carvão com 2 na mochila
// exige 2 novos, mas a pós-condição é 4 no total, não delta de 4.
async function inventoryAtLeast(node, ctx = {}) {
  const item = node?.args?.item
  const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
  const after = Number.isFinite(Number(ctx.after)) ? Number(ctx.after) : countItem(ctx.bot, item)
  const before = Number.isFinite(Number(ctx.before)) ? Number(ctx.before) : null
  return { ok: after >= quantity, detail: { item, quantity, before, after } }
}

// "Saiu da mochila": entrega/consumo. Sem `before` explícito, não há como
// provar remoção; falha em vez de aprovar por suposição.
async function inventoryRemoved(node, ctx = {}) {
  const item = node?.args?.item
  const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
  const before = Number(ctx.before)
  const after = Number.isFinite(Number(ctx.after)) ? Number(ctx.after) : countItem(ctx.bot, item)
  if (!Number.isFinite(before)) return { ok: false, detail: { reason: 'before ausente', item, quantity, after } }
  return { ok: before - after >= quantity, detail: { item, quantity, before, after, removed: before - after } }
}

async function containerContains(node, ctx = {}) {
  const item = node?.args?.item
  const quantity = Math.max(1, Number(node?.args?.quantity) || 1)
  if (!ctx.storage?.summary) return { ok: false, detail: { reason: 'estoque indisponível' } }
  const summary = await ctx.storage.summary(ctx.bot)
  const count = summary?.[item] || 0
  return { ok: count >= quantity, detail: { item, quantity, count } }
}

function positionNear(node, ctx = {}) {
  const target = ctx.target || node?.args?.position
  const range = Math.max(0.5, Number(ctx.range ?? 3) || 3)
  const position = ctx.bot?.entity?.position
  if (!target || !position) return { ok: false, detail: { reason: 'posição indisponível' } }
  const dx = Number(position.x) - Number(target.x)
  const dy = Number(position.y) - Number(target.y)
  const dz = Number(position.z) - Number(target.z)
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return { ok: distance <= range, detail: { distance, range, target: { x: target.x, y: target.y, z: target.z } } }
}

function blockAt(node, ctx = {}) {
  const position = node?.args?.position
  const expected = node?.args?.block
  const block = position ? ctx.bot?.blockAt?.(position) : null
  const ok = Boolean(block && expected && block.name === expected)
  return { ok, detail: { expected, actual: block?.name || null } }
}

const VERIFIERS = {
  inventory_at_least: inventoryAtLeast,
  inventory_removed: inventoryRemoved,
  container_contains: containerContains,
  position_near: positionNear,
  block_at: blockAt
}

async function verify(name, node, ctx = {}) {
  const verifier = VERIFIERS[name]
  if (!verifier) return { ok: false, detail: { reason: `verificador desconhecido: ${name}` } }
  return verifier(node, ctx)
}

module.exports = {
  VERIFIERS, verify, countItem,
  inventoryAtLeast, inventoryRemoved, containerContains, positionNear, blockAt
}
