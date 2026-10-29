// lib/preflight.js
// Barreiras antes de começar uma tarefa. Falhar aqui é barato; falhar no meio
// de uma escada ou de uma viagem longa custa tempo e pode alterar o terreno.

'use strict'

const { CODES } = require('./failure')

const MIN_FREE_SLOTS = 2

function countItem(bot, name) {
  return (bot?.inventory?.items?.() || [])
    .filter((item) => item.name === name)
    .reduce((sum, item) => sum + (item.count || 0), 0)
}

function freeSlots(bot) {
  const inventory = bot?.inventory
  if (!inventory) return null
  if (typeof inventory.emptySlotCount === 'function') {
    try { return inventory.emptySlotCount() } catch { return null }
  }
  if (Array.isArray(inventory.slots) && Number.isInteger(inventory.inventoryStart) && Number.isInteger(inventory.inventoryEnd)) {
    return inventory.slots.slice(inventory.inventoryStart, inventory.inventoryEnd).filter((slot) => !slot).length
  }
  if (typeof inventory.items === 'function') return Math.max(0, 36 - inventory.items().length)
  return null
}

function hasAny(bot, names) {
  const wanted = new Set((names || []).filter(Boolean))
  if (!wanted.size) return true
  return (bot?.inventory?.items?.() || []).some((item) => wanted.has(item.name))
}

function check(bot, spec = {}, { storage = null, registry = null } = {}) {
  const blockers = []
  const add = (code, detail, action = null) => blockers.push({ code, detail, action })

  if (!bot || !bot.entity) add(CODES.NOT_SPAWNED, 'o bot ainda não entrou no mundo')

  if (bot?.entity && Number.isFinite(Number(bot.health)) && Number(bot.health) <= 0) {
    add(CODES.DEAD, 'vida zerada')
  }

  if (spec.dimension && bot?.game?.dimension && spec.dimension !== bot.game.dimension) {
    add(CODES.WRONG_DIMENSION, `destino em ${spec.dimension}, bot em ${bot.game.dimension}`)
  }

  if (spec.longTask && bot?.entity && Number.isFinite(Number(bot.food)) && Number(bot.food) <= 6) {
    add(CODES.FOOD_MISSING, `fome ${bot.food}/20 para uma tarefa longa`, 'eat')
  }

  const free = freeSlots(bot)
  const needed = Math.max(0, Number(spec.minFreeSlots ?? MIN_FREE_SLOTS) || 0)
  if (free != null && free < needed) {
    add(CODES.INVENTORY_FULL, `${free} slot(s) livre(s), precisa de ${needed}`, 'free_slots')
  }

  if (Array.isArray(spec.tools) && spec.tools.length && !hasAny(bot, spec.tools)) {
    add(CODES.TOOL_MISSING, `sem ${spec.tools.join('/')}`, 'withdraw_tool')
  }

  if (spec.item && registry && !registry.itemsByName?.[spec.item] && !registry.blocksByName?.[spec.item]) {
    add(CODES.RESOURCE_NOT_FOUND, `item desconhecido no registry: ${spec.item}`, 'alternate_target')
  }

  if (spec.requiresStorage && !storage?.configured?.()) {
    add(CODES.CONTAINER_UNREACHABLE, 'estoque central não configurado', 'retry')
  }

  if (spec.requiresQuantity && !(Number.isInteger(Number(spec.quantity)) && Number(spec.quantity) > 0)) {
    add(CODES.UNKNOWN, 'quantidade inválida', 'abort')
  }

  return { ok: blockers.length === 0, blockers }
}

module.exports = { check, countItem, freeSlots, hasAny, MIN_FREE_SLOTS }
