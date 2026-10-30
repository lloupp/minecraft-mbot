// core/Capabilities.js
// Metadado puro das habilidades existentes: argumentos, pré-condições, efeito,
// verificador e risco. Não executa nada; planner e MissionRunner consultam.

'use strict'

const NAME = /^[a-z0-9_:-]{1,80}$/i
const ACTIONS = Object.freeze({
  GATHER: 'gather',
  CRAFT: 'craft',
  SMELT: 'smelt',
  DEPOSIT: 'deposit',
  WITHDRAW: 'withdraw',
  MOVE_TO: 'move_to',
  DELIVER: 'deliver'
})

const DESCRIPTORS = Object.freeze({
  gather: {
    name: 'gather',
    action: 'gather',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned', 'free_slots', 'resource_known'],
    effects: ['inventory_contains'],
    verifier: 'inventory_at_least',
    failureCodes: ['RESOURCE_NOT_FOUND', 'RESOURCE_UNREACHABLE', 'PATH_NO_PATH', 'INVENTORY_FULL', 'VERIFICATION_FAILED'],
    cost: 'medium',
    risk: 'low'
  },
  craft: {
    name: 'craft',
    action: 'craft',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned', 'recipe_known'],
    effects: ['inventory_contains'],
    verifier: 'inventory_at_least',
    failureCodes: ['TOOL_MISSING', 'RESOURCE_NOT_FOUND', 'VERIFICATION_FAILED'],
    cost: 'medium',
    risk: 'low'
  },
  smelt: {
    name: 'smelt',
    action: 'smelt',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned', 'recipe_known', 'fuel_available'],
    effects: ['inventory_contains'],
    verifier: 'inventory_at_least',
    failureCodes: ['TOOL_MISSING', 'RESOURCE_NOT_FOUND', 'VERIFICATION_FAILED'],
    cost: 'medium',
    risk: 'low'
  },
  deposit: {
    name: 'deposit',
    action: 'deposit',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned', 'storage_configured'],
    effects: ['container_contains'],
    verifier: 'container_contains',
    failureCodes: ['CONTAINER_UNREACHABLE', 'CONTAINER_FULL', 'VERIFICATION_FAILED'],
    cost: 'low',
    risk: 'low'
  },
  withdraw: {
    name: 'withdraw',
    action: 'withdraw',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned', 'storage_configured'],
    effects: ['inventory_contains'],
    verifier: 'inventory_at_least',
    failureCodes: ['CONTAINER_UNREACHABLE', 'RESOURCE_NOT_FOUND', 'VERIFICATION_FAILED'],
    cost: 'low',
    risk: 'low'
  },
  move_to: {
    name: 'move_to',
    action: 'move_to',
    role: null,
    argsSchema: { local: 'name' },
    preconditions: ['spawned', 'waypoint_known'],
    effects: ['position_near'],
    verifier: 'position_near',
    failureCodes: ['PATH_NO_PATH', 'PATH_TIMEOUT', 'WRONG_DIMENSION', 'VERIFICATION_FAILED'],
    cost: 'high',
    risk: 'medium'
  },
  deliver: {
    name: 'deliver',
    action: 'deliver',
    role: null,
    argsSchema: { item: 'name', quantity: 'count' },
    preconditions: ['spawned'],
    effects: ['inventory_removed'],
    verifier: 'inventory_removed',
    failureCodes: ['RESOURCE_NOT_FOUND', 'TOOL_MISSING', 'PROTECTED_AREA', 'VERIFICATION_FAILED'],
    cost: 'medium',
    risk: 'medium'
  }
})

function get(name) {
  const descriptor = DESCRIPTORS[String(name || '').toLowerCase()]
  return descriptor ? JSON.parse(JSON.stringify(descriptor)) : null
}

function list() {
  return Object.keys(DESCRIPTORS)
}

function validateArgs(name, args = {}) {
  const descriptor = DESCRIPTORS[String(name || '').toLowerCase()]
  if (!descriptor) return 'capability_desconhecida'
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'args_invalid'
  for (const [key, type] of Object.entries(descriptor.argsSchema)) {
    const value = args[key]
    if (type === 'name') {
      if (typeof value !== 'string' || !NAME.test(value)) return `invalid_${key}`
    } else if (type === 'count') {
      const count = Number(value)
      if (!Number.isInteger(count) || count < 1 || count > 64) return `invalid_${key}`
    }
  }
  return null
}

function available(name, { bot = null, storage = null } = {}) {
  const key = String(name || '').toLowerCase()
  if (!DESCRIPTORS[key]) return false
  if (!bot?.entity) return false
  if (key === 'deposit' || key === 'withdraw') return Boolean(storage?.configured?.())
  return true
}

function describe(name) {
  return get(name)
}

module.exports = { ACTIONS, DESCRIPTORS, get, list, validateArgs, available, describe }
