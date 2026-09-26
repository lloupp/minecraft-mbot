const craft = require('./craft')
const { bestWeapon, equipShield } = require('./combat')

const ARMOR_RANK = ['netherite', 'diamond', 'iron', 'chainmail', 'golden', 'copper', 'turtle', 'leather']
const ARMOR_SLOTS = {
  head: { suffix: '_helmet', slot: 5 },
  torso: { suffix: '_chestplate', slot: 6 },
  legs: { suffix: '_leggings', slot: 7 },
  feet: { suffix: '_boots', slot: 8 }
}
const TOOL_TIERS = [
  { tier: 'diamond', material: 'diamond' },
  { tier: 'iron', material: 'iron_ingot' },
  { tier: 'copper', material: 'copper_ingot' },
  { tier: 'stone', material: 'cobblestone' },
  { tier: 'wooden', material: null }
]

const armorTier = (name) => {
  const tier = ARMOR_RANK.indexOf(String(name || '').split('_')[0])
  return tier === -1 ? ARMOR_RANK.length : tier
}

function availableToolTiers(bot, kind) {
  return TOOL_TIERS.filter(({ tier }) => Boolean(bot.registry?.itemsByName?.[`${tier}_${kind}`]))
}

async function equipBestArmor(bot) {
  const worn = []
  for (const [destination, { suffix, slot }] of Object.entries(ARMOR_SLOTS)) {
    const best = bot.inventory.items()
      .filter((item) => item.name.endsWith(suffix))
      .sort((a, b) => armorTier(a.name) - armorTier(b.name))[0]
    if (!best) continue
    const current = bot.inventory.slots[slot]
    if (current && armorTier(current.name) <= armorTier(best.name)) continue
    await bot.equip(best, destination)
    worn.push(best.name)
  }
  if (bot.inventory.slots?.[45]?.name !== 'shield' && await equipShield(bot)) worn.push('shield')
  return worn
}

function bestTier(bot, kind) {
  const tiers = availableToolTiers(bot, kind)
  const owned = bot.inventory.items()
    .filter((item) => item.name.endsWith(`_${kind}`))
    .map((item) => tiers.findIndex((entry) => item.name === `${entry.tier}_${kind}`))
    .filter((index) => index >= 0)
  return owned.length ? Math.min(...owned) : Infinity
}

function craftableUpgrade(bot, kind) {
  const tiers = availableToolTiers(bot, kind)
  const currentTier = bestTier(bot, kind)
  const limit = Number.isFinite(currentTier) ? currentTier : tiers.length
  for (let i = 0; i < limit; i++) {
    const name = `${tiers[i].tier}_${kind}`
    if (craft.canCraftFromInventory(bot, name)) return name
  }
  return null
}

function pendingUpgrades(bot) {
  return ['sword', 'pickaxe']
    .map((kind) => craftableUpgrade(bot, kind))
    .filter(Boolean)
}

module.exports = {
  equipBestArmor,
  pendingUpgrades,
  craftableUpgrade,
  armorTier,
  bestWeapon,
  bestTier,
  availableToolTiers,
  ARMOR_RANK,
  TOOL_TIERS
}
