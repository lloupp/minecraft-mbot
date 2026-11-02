// lib/water.js
// Saída da água: o bot morria afogado minerando num túnel inundado (sessão
// autônoma real, 1.20.1) porque nada olhava o ar que restava.

const WATERY = new Set(['water', 'lava', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'])
const LOW_AIR = 14 // de 20 (bot.oxygenLevel): ~10 s antes de começar a tomar dano

// Ponto mais próximo com chão firme e duas células de ar (fora da água).
function findDryLand(bot, radius = 8) {
  const here = bot.entity?.position?.floored()
  if (!here) return null
  const free = (b) => b && b.boundingBox === 'empty' && !WATERY.has(b.name)
  for (let r = 0; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        for (let dy = 6; dy >= -2; dy--) {
          const p = here.offset(dx, dy, dz)
          const floor = bot.blockAt(p.offset(0, -1, 0))
          if (floor?.boundingBox === 'block' && free(bot.blockAt(p)) && free(bot.blockAt(p.offset(0, 1, 0)))) return p
        }
      }
    }
  }
  return null
}

function runningOutOfAir(bot) {
  return Number.isFinite(bot.oxygenLevel) && bot.oxygenLevel < LOW_AIR
}

module.exports = { findDryLand, runningOutOfAir, LOW_AIR }
