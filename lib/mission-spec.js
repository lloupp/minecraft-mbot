// lib/mission-spec.js
// Gramática determinística de missão. Nenhum modelo decide nada aqui: o dono
// informa verbo, item, quantidade e destino; o parser valida e monta o grafo.

'use strict'

const handover = require('./handover')

const MAX_QUANTITY = 64
const VERBS = new Set(['pegar', 'coletar', 'fabricar', 'entregar', 'ir'])
const USAGE = 'Uso: !missao pegar|coletar <item> <qtd> [guardar] | fabricar <item> <qtd> [guardar] | entregar <item> <qtd> [bau|mao] | ir <local> | status | cancelar <id> | retomar <id>'

function error(message) {
  return { ok: false, error: message }
}

function quantityOf(value, fallback = 1) {
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_QUANTITY) return null
  return parsed
}

function parse(args = []) {
  const verb = String(args[0] || '').toLowerCase()
  if (!VERBS.has(verb)) return error(USAGE)

  if (verb === 'ir') {
    const local = String(args[1] || '').trim().toLowerCase()
    if (!local) return error('Uso: !missao ir <local>')
    return { ok: true, spec: { verb, local } }
  }

  const rawItem = String(args[1] || '').trim()
  const item = handover.normalizeItem(rawItem)
  if (!item) return error(`Informe o item. ${USAGE}`)
  const quantity = quantityOf(args[2])
  if (quantity == null) return error(`Quantidade deve ser de 1 a ${MAX_QUANTITY}.`)

  if (verb === 'entregar') {
    const mode = String(args[3] || '').toLowerCase() === 'mao' ? 'hand' : 'chest'
    return { ok: true, spec: { verb, item, quantity, mode } }
  }

  const guardar = args.slice(3).some((arg) => String(arg).toLowerCase() === 'guardar')
  return { ok: true, spec: { verb, item, quantity, delivery: guardar ? 'chest' : null } }
}

function node(id, action, args, objective, dependsOn = [], verify = null) {
  return { id, action, args, objective, dependsOn, ...(verify ? { verify } : {}) }
}

function graphForSpec(spec = {}) {
  const nodes = []
  if (spec.verb === 'pegar' || spec.verb === 'coletar') {
    nodes.push(node('coletar', 'gather', { item: spec.item, quantity: spec.quantity },
      `coletar ${spec.quantity}x ${spec.item}`, [], 'inventory_at_least'))
    if (spec.delivery === 'chest') {
      nodes.push(node('guardar', 'deposit', { item: spec.item, quantity: spec.quantity },
        `guardar ${spec.quantity}x ${spec.item} no baú`, ['coletar'], 'container_contains'))
    }
  } else if (spec.verb === 'fabricar') {
    nodes.push(node('fabricar', 'craft', { item: spec.item, quantity: spec.quantity },
      `fabricar ${spec.quantity}x ${spec.item}`, [], 'inventory_at_least'))
    if (spec.delivery === 'chest') {
      nodes.push(node('guardar', 'deposit', { item: spec.item, quantity: spec.quantity },
        `guardar ${spec.quantity}x ${spec.item} no baú`, ['fabricar'], 'container_contains'))
    }
  } else if (spec.verb === 'entregar') {
    const chest = spec.mode !== 'hand'
    nodes.push(node('entregar', 'deliver', { item: spec.item, quantity: spec.quantity, mode: chest ? 'chest' : 'hand' },
      `entregar ${spec.quantity}x ${spec.item} ${chest ? 'no baú' : 'na mão'}`,
      [], 'inventory_removed'))
  } else if (spec.verb === 'ir') {
    nodes.push(node('ir', 'move_to', { local: spec.local }, `ir para ${spec.local}`, [], 'position_near'))
  } else {
    throw new Error(`verbo de missão inválido: ${spec.verb}`)
  }
  return nodes
}

function describe(spec = {}) {
  if (spec.verb === 'pegar' || spec.verb === 'coletar') {
    return `coletar ${spec.quantity}x ${spec.item}${spec.delivery === 'chest' ? ' e guardar no baú' : ''}`
  }
  if (spec.verb === 'fabricar') {
    return `fabricar ${spec.quantity}x ${spec.item}${spec.delivery === 'chest' ? ' e guardar no baú' : ''}`
  }
  if (spec.verb === 'entregar') return `entregar ${spec.quantity}x ${spec.item} ${spec.mode === 'hand' ? 'na mão' : 'no baú'}`
  if (spec.verb === 'ir') return `ir para ${spec.local}`
  return spec.verb || 'missão'
}

module.exports = { parse, graphForSpec, describe, USAGE, VERBS, MAX_QUANTITY }
