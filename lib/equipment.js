// lib/equipment.js
// Equipamento de jogador: vestir a melhor armadura do inventário e manter uma
// arma e uma picareta decentes, fabricando-as quando dá.

const craft = require('./craft')
const { bestWeapon } = require('./combat')

// Do melhor para o pior.
const ARMOR_RANK = ['netherite', 'diamond', 'iron', 'chainmail', 'golden', 'copper', 'turtle', 'leather']
const ARMOR_SLOTS = {
  head: { suffix: '_helmet', slot: 5 },
  torso: { suffix: '_chestplate', slot: 6 },
  legs: { suffix: '_leggings', slot: 7 },
  feet: { suffix: '_boots', slot: 8 }
}
// Ferramentas/armas por material, do melhor para o pior, e o ingrediente principal.
const TOOL_TIERS = [
  { tier: 'diamond', material: 'diamond' },
  { tier: 'iron', material: 'iron_ingot' },
  { tier: 'copper', material: 'copper_ingot' },
  { tier: 'stone', material: 'cobblestone' },
  { tier: 'wooden', material: null }
]

const armorTier = (name) => {
  const tier = ARMOR_RANK.indexOf(name.split('_')[0])
  return tier === -1 ? ARMOR_RANK.length : tier
}

// Veste, em cada parte do corpo, a melhor peça do inventário (se for melhor
// que a atual). Retorna os nomes das peças vestidas.
async function equipBestArmor(bot) {
  const worn = []
  for (const [destination, { suffix, slot }] of Object.entries(ARMOR_SLOTS)) {
    const best = bot.inventory.items()
      .filter((i) => i.name.endsWith(suffix))
      .sort((a, b) => armorTier(a.name) - armorTier(b.name))[0]
    if (!best) continue
    const current = bot.inventory.slots[slot]
    if (current && armorTier(current.name) <= armorTier(best.name)) continue
    await bot.equip(best, destination)
    worn.push(best.name)
  }
  return worn
}

const hasItemEnding = (bot, suffix) => bot.inventory.items().some((i) => i.name.endsWith(suffix))

// Melhor versão de `kind` (ex.: 'sword', 'pickaxe') que dá para fabricar
// agora só com o inventário, se for melhor que a que já tem.
function craftableUpgrade(bot, kind) {
  const have = bot.inventory.items().filter((i) => i.name.endsWith(`_${kind}`))
    .map((i) => TOOL_TIERS.findIndex((t) => i.name.startsWith(`${t.tier}_`)))
    .filter((tier) => tier >= 0)
  const currentTier = have.length ? Math.min(...have) : TOOL_TIERS.length
  for (let tier = 0; tier < currentTier; tier++) {
    const name = `${TOOL_TIERS[tier].tier}_${kind}`
    if (craft.canCraftFromInventory(bot, name)) return name
  }
  return null
}

// O que o bot pode melhorar no equipamento sem sair para coletar.
function pendingUpgrades(bot) {
  return ['sword', 'pickaxe'].map((kind) => craftableUpgrade(bot, kind)).filter(Boolean)
}

module.exports = {
  equipBestArmor,
  pendingUpgrades,
  craftableUpgrade,
  hasItemEnding,
  armorTier,
  bestWeapon,
  ARMOR_RANK,
  TOOL_TIERS
}
