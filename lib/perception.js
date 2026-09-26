// lib/perception.js
// Reconhecer o ambiente: blocos (onde pisa, para onde olha, recursos por perto)
// e entidades (mobs hostis, animais, jogadores).

const RESOURCE_RANGE = 16
const ENTITY_RANGE = 24

// Blocos que interessam a um jogador ao olhar em volta.
function isNotable(name) {
  return name.endsWith('_log') || name.endsWith('_ore') ||
    ['chest', 'crafting_table', 'furnace', 'water', 'lava', 'wheat', 'carrots', 'potatoes',
      'beetroots', 'sweet_berry_bush', 'melon', 'pumpkin', 'sugar_cane', 'bed'].includes(name) ||
    name.endsWith('_bed')
}

function nearbyBlocks(bot, range = RESOURCE_RANGE) {
  const ids = bot.registry.blocksArray.filter((b) => isNotable(b.name)).map((b) => b.id)
  const counts = {}
  for (const pos of bot.findBlocks({ matching: ids, maxDistance: range, count: 500 })) {
    const name = bot.blockAt(pos)?.name
    if (name) counts[name] = (counts[name] || 0) + 1
  }
  return counts
}

function nearbyEntities(bot, range = ENTITY_RANGE) {
  const groups = { hostile: {}, animal: {}, player: {} }
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !groups[e.type]) continue
    if (e.position.distanceTo(bot.entity.position) > range) continue
    const name = e.username || e.name
    groups[e.type][name] = (groups[e.type][name] || 0) + 1
  }
  return groups
}

const fmt = (counts, max = 6) => Object.entries(counts)
  .sort((a, b) => b[1] - a[1]).slice(0, max)
  .map(([name, n]) => `${name}x${n}`).join(', ') || 'nada'

// Linhas curtas para o chat (limite de 256 caracteres por mensagem).
function describe(bot) {
  const under = bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name ?? '?'
  const looking = bot.blockAtCursor(6)?.name ?? 'nada'
  const ents = nearbyEntities(bot)
  return [
    `Pisando em: ${under} | Olhando para: ${looking}`,
    `Recursos (${RESOURCE_RANGE} blocos): ${fmt(nearbyBlocks(bot))}`,
    `Hostis: ${fmt(ents.hostile)} | Animais: ${fmt(ents.animal)}`
  ]
}

module.exports = { describe, nearbyBlocks, nearbyEntities }
