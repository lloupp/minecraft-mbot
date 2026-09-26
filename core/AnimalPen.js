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
    fences,
    fenceCount: fences.length,
    gateCount: 1
  }
}

module.exports = { PEN_SIZE, SPECIES_OFFSETS, animalPenPlan }
