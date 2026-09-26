const { Vec3 } = require('vec3')

const PEN_SIZE = 7

// Passo de 10 blocos (curral de 7 + 3 livres): o acesso ao portão (2 blocos ao
// norte) não cai na cerca do curral vizinho. Começa em x=20 para não invadir
// as casas e fazendas dos projetos (até x=16, z=12).
const PEN_STEP = 10
const SPECIES_OFFSETS = {
  cow: { x: 20, z: 8 },
  sheep: { x: 20 + PEN_STEP, z: 8 },
  rabbit: { x: 20 + 2 * PEN_STEP, z: 8 },
  pig: { x: 20, z: 8 + PEN_STEP },
  chicken: { x: 20 + PEN_STEP, z: 8 + PEN_STEP },
  goat: { x: 20 + 2 * PEN_STEP, z: 8 + PEN_STEP },
  mooshroom: { x: 20, z: 8 + 2 * PEN_STEP },
  llama: { x: 20 + PEN_STEP, z: 8 + 2 * PEN_STEP }
}

function animalPenPlan(home, species = 'cow', offset = null) {
  if (!home) throw new Error('base da colônia ainda não definida')
  const chosen = offset || SPECIES_OFFSETS[species] || SPECIES_OFFSETS.cow
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

module.exports = {
  PEN_SIZE,
  SPECIES_OFFSETS,
  animalPenPlan,
  pointInsidePen,
  inspectAnimalPen
}
