const { Vec3 } = require('vec3')

const PEN_SIZE = 7

const SPECIES_OFFSETS = {
  cow: { x: 12, z: 8 },
  sheep: { x: 20, z: 8 },
  pig: { x: 12, z: 16 },
  chicken: { x: 20, z: 16 },
  rabbit: { x: 28, z: 8 },
  goat: { x: 28, z: 16 },
  mooshroom: { x: 12, z: 24 },
  llama: { x: 20, z: 24 }
}

function animalPenPlan(home, species = 'cow', offset = null) {
  if (!home) throw new Error('base da colônia ainda não definida')
  const chosen = offset || SPECIES_OFFSETS[species] || { x: 12, z: 8 }
  const x0 = Math.floor(Number(home.x)) + Number(chosen.x || 0)
  const y = Math.floor(Number(home.y))
  const z0 = Math.floor(Number(home.z)) + Number(chosen.z || 0)
  const gate = { x: x0 + Math.floor(PEN_SIZE / 2), y, z: z0 }
  const fences = []

  for (let x = 0; x < PEN_SIZE; x++) {
    for (let z = 0; z < PEN_SIZE; z++) {
      const edge = x === 0 || z === 0 || x === PEN_SIZE - 1 || z === PEN_SIZE - 1
      if (!edge) continue
      const point = { x: x0 + x, y, z: z0 + z }
      if (point.x === gate.x && point.y === gate.y && point.z === gate.z) continue
      fences.push(point)
    }
  }

  return {
    species,
    size: PEN_SIZE,
    offset: { x: Number(chosen.x || 0), z: Number(chosen.z || 0) },
    origin: { x: x0, y, z: z0 },
    center: {
      x: x0 + Math.floor(PEN_SIZE / 2),
      y,
      z: z0 + Math.floor(PEN_SIZE / 2)
    },
    gate,
    outside: { x: gate.x, y, z: gate.z - 2 },
    insideEntry: { x: gate.x, y, z: gate.z + 2 },
    fences,
    fenceCount: fences.length,
    gateCount: 1
  }
}

function pointInsidePen(position, plan, margin = 0.35) {
  if (!position || !plan?.origin) return false
  const x = Number(position.x)
  const z = Number(position.z)
  if (![x, z].every(Number.isFinite)) return false
  const minX = plan.origin.x + margin
  const maxX = plan.origin.x + plan.size - 1 - margin
  const minZ = plan.origin.z + margin
  const maxZ = plan.origin.z + plan.size - 1 - margin
  return x > minX && x < maxX && z > minZ && z < maxZ
}

function inspectAnimalPen(bot, plan) {
  const gateBlock = bot.blockAt?.(new Vec3(plan.gate.x, plan.gate.y, plan.gate.z))
  const gatePresent = Boolean(gateBlock?.name?.endsWith('_fence_gate'))
  let fencesPresent = 0
  for (const position of plan.fences) {
    const block = bot.blockAt?.(new Vec3(position.x, position.y, position.z))
    if (block?.name?.endsWith('_fence') && !block.name.endsWith('_fence_gate')) fencesPresent++
  }
  return {
    species: plan.species,
    built: gatePresent && fencesPresent === plan.fenceCount,
    gatePresent,
    gateOpen: Boolean(gatePresent && gateBlock.getProperties?.().open),
    fencesPresent,
    fencesExpected: plan.fenceCount,
    center: { ...plan.center }
  }
}

// Nível do chão no local do curral. O curral fica a 12+ blocos da base e o terreno
// ali costuma ser mais alto ou mais baixo; com a altura da base, todas as cercas
// eram puladas (visto no 1.20.1: 0/23 com a base 1 bloco acima do chão do curral).
function isGroundBelow(block) {
  return block?.boundingBox === 'block' && !/fence|_leaves$/.test(block.name)
}

function penGroundY(blockAt, home, species = 'cow', offset = null) {
  const plan = animalPenPlan(home, species, offset)
  const counts = new Map()
  for (const point of [...plan.fences, plan.gate]) {
    for (let y = plan.origin.y + 4; y >= plan.origin.y - 4; y--) {
      const here = blockAt(new Vec3(point.x, y, point.z))
      const below = blockAt(new Vec3(point.x, y - 1, point.z))
      if (!here || !below) continue
      const free = here.boundingBox === 'empty' || /fence/.test(here.name)
      if (free && isGroundBelow(below)) {
        counts.set(y, (counts.get(y) || 0) + 1)
        break
      }
    }
  }
  if (!counts.size) return plan.origin.y
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || Math.abs(a[0] - plan.origin.y) - Math.abs(b[0] - plan.origin.y))[0][0]
}

function groundedPenPlan(bot, home, species = 'cow', offset = null) {
  if (!home || typeof bot?.blockAt !== 'function') return animalPenPlan(home, species, offset)
  const y = penGroundY((pos) => bot.blockAt(pos), home, species, offset)
  return animalPenPlan({ ...home, y }, species, offset)
}

module.exports = {
  penGroundY,
  groundedPenPlan,
  PEN_SIZE,
  SPECIES_OFFSETS,
  animalPenPlan,
  pointInsidePen,
  inspectAnimalPen
}
