// lib/combat.js
// Lutar: escolher arma, respeitar o tempo de recarga do golpe e decidir entre
// lutar e fugir conforme o tipo de mob, a vida do bot e quantos inimigos há.

const { goals } = require('mineflayer-pathfinder')

const REACH = 3            // alcance do ataque corpo a corpo
const GIVE_UP_DIST = 24    // alvo fugiu para longe: desiste
const FIGHT_TIMEOUT = 30000
const RETREAT_HEALTH = 6   // com vida nesse nível ou menos, sai da luta
const MIN_FIGHT_HEALTH = 8 // só começa uma luta com pelo menos isso de vida
const MAX_ENEMIES = 2      // mais que isso por perto: foge em vez de lutar

// Explodem de perto: nunca atacar corpo a corpo.
const EXPLOSIVE = new Set(['creeper'])
// Atiram de longe: fugir não adianta, é melhor avançar.
const RANGED = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'blaze', 'ghast', 'witch'])
// Só atacam se provocados; não vale começar briga.
const NEUTRAL = new Set(['enderman', 'zombified_piglin', 'piglin'])

const WEAPON_RANK = ['netherite', 'diamond', 'iron', 'copper', 'stone', 'golden', 'wooden']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function bestWeapon(bot) {
  const tier = (item) => {
    const index = WEAPON_RANK.indexOf(item.name.split('_')[0])
    return index === -1 ? WEAPON_RANK.length : index
  }
  return bot.inventory.items()
    .filter((i) => i.name.endsWith('_sword') || i.name.endsWith('_axe'))
    .sort((a, b) => tier(a) - tier(b) || (a.name.endsWith('_sword') ? -1 : 1))[0] || null
}

async function equipWeapon(bot) {
  const weapon = bestWeapon(bot)
  if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand')
  return weapon
}

// Tempo de recarga do golpe (ms): bater antes disso quase não causa dano.
function attackCooldown(bot) {
  const held = bot.heldItem?.name || ''
  if (held.endsWith('_sword')) return 650
  if (held.endsWith('_axe')) return 1000
  return 300
}

function hostilesNear(bot, range) {
  return Object.values(bot.entities).filter((e) =>
    e.type === 'hostile' && e.isValid !== false && e.position.distanceTo(bot.entity.position) <= range)
}

// Decide a reação a uma ameaça: 'lutar' ou 'fugir'.
function decide(bot, threat) {
  if (!threat || threat.type !== 'hostile') return 'fugir'
  if (EXPLOSIVE.has(threat.name)) return 'fugir'
  if (hostilesNear(bot, 10).length > MAX_ENEMIES) return 'fugir'
  const minHealth = bestWeapon(bot) ? MIN_FIGHT_HEALTH - 2 : MIN_FIGHT_HEALTH
  if (RANGED.has(threat.name)) return bot.health > RETREAT_HEALTH ? 'lutar' : 'fugir'
  return bot.health >= minHealth ? 'lutar' : 'fugir'
}

// Hostil perto que vale atacar antes que ele ataque (não neutro, não creeper).
function proactiveTarget(bot, range = 5) {
  return bot.nearestEntity((e) => e.type === 'hostile' && !NEUTRAL.has(e.name) && !EXPLOSIVE.has(e.name) &&
    e.position.distanceTo(bot.entity.position) <= range)
}

const hasItem = (bot, name) => bot.inventory.items().some((i) => i.name === name)

// Arco (minecrafthawkeye) contra quem atira de longe ou está distante.
function shouldUseBow(bot, target) {
  if (!bot.hawkEye || !hasItem(bot, 'bow') || !bot.inventory.items().some((i) => i.name.endsWith('arrow'))) return false
  return RANGED.has(target.name) || target.position.distanceTo(bot.entity.position) > 8
}

// Escudo na mão secundária: o bot já fabricava escudo, mas não o equipava.
async function equipShield(bot) {
  const offHand = bot.inventory.slots?.[45]
  if (offHand?.name === 'shield') return true
  const shield = bot.inventory.items().find((i) => i.name === 'shield')
  if (!shield) return false
  await bot.equip(shield, 'off-hand')
  return true
}
// Persegue e ataca `target` até ele morrer, fugir para longe, o tempo acabar,
// a vida do bot ficar baixa (`retreatHealth`) ou a tarefa ser cancelada.
// Usa mineflayer-pvp (e o arco, se couber) quando carregados; senão, ataque próprio.
// Retorna 'morto' | 'recuei' | 'fugiu' | 'tempo' | 'cancelado'.
async function fight(bot, target, isCancelled, { retreatHealth = RETREAT_HEALTH } = {}) {
  // Uma luta antiga não pode limpar o motor de uma luta mais nova contra o mesmo alvo.
  const fightId = bot._fightId = (bot._fightId || 0) + 1
  const bow = shouldUseBow(bot, target)
  if (bow) {
    bot.hawkEye.autoAttack(target, 'bow')
  } else {
    await equipWeapon(bot)
    await equipShield(bot).catch(() => false)
    if (bot.pvp) bot.pvp.attack(target)
    else bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true)
  }
  const deadline = Date.now() + FIGHT_TIMEOUT
  let lastHit = 0
  try {
    while (!isCancelled()) {
      if (!target.isValid) return 'morto'
      if (bot.health <= retreatHealth) return 'recuei'
      if (Date.now() > deadline) return 'tempo'
      const dist = target.position.distanceTo(bot.entity.position)
      if (dist > GIVE_UP_DIST) return 'fugiu'
      const manual = !bow && !bot.pvp
      if (manual && dist <= REACH && Date.now() - lastHit >= attackCooldown(bot)) {
        await bot.lookAt(target.position.offset(0, (target.height || 1) * 0.7, 0), true)
        bot.attack(target)
        lastHit = Date.now()
      }
      await sleep(50)
    }
    return 'cancelado'
  } finally {
    if (bot._fightId === fightId) {
      if (bow) bot.hawkEye.stop()
      if (bot.pvp?.target === target) Promise.resolve(bot.pvp.stop()).catch(() => {})
      if (bot.usingHeldItem) {
        try { bot.deactivateItem() } catch {}
      }
      if (!isCancelled() && !bot.pvp) bot.pathfinder.setGoal(null)
    }
  }
}

module.exports = { fight, decide, proactiveTarget, hostilesNear, equipWeapon, equipShield, bestWeapon, EXPLOSIVE, RANGED, NEUTRAL, RETREAT_HEALTH }
