// lib/gather.js
// Coletar blocos do mundo: escolhe blocos alcançáveis (de preferência expostos),
// pula os que não consegue alcançar e recolhe os itens que caem.

const { goals } = require('mineflayer-pathfinder')
const { goTo, collectDrops } = require('./food')

const RANGE = 48
const MAX_FAILURES = 6
const AIR = new Set(['air', 'cave_air', 'void_air'])
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

// Bloco encostado em ar: dá para chegar sem cavar túnel.
function isExposed(bot, pos) {
  return SIDES.some(([x, y, z]) => AIR.has(bot.blockAt(pos.offset(x, y, z))?.name))
}

function blockIds(bot, predicate) {
  return bot.registry.blocksArray.filter((b) => predicate(b.name)).map((b) => b.id)
}

// Minera até `count` blocos cujo nome satisfaz `predicate`. Retorna quantos minerou.
async function mineBlocks(bot, predicate, count, isCancelled) {
  const ids = blockIds(bot, predicate)
  const skip = new Set()
  let mined = 0
  let failures = 0
  while (mined < count && failures < MAX_FAILURES && !isCancelled()) {
    const candidates = bot.findBlocks({ matching: ids, maxDistance: RANGE, count: 64 })
      .filter((p) => !skip.has(p.toString()))
    const pos = candidates.find((p) => isExposed(bot, p)) || candidates[0]
    if (!pos) break
    const block = bot.blockAt(pos)
    try {
      await goTo(bot, new goals.GoalGetToBlock(pos.x, pos.y, pos.z), 20000)
      if (isCancelled()) break
      const tool = bot.pathfinder.bestHarvestTool(block)
      if (tool) await bot.equip(tool, 'hand')
      await bot.dig(bot.blockAt(pos))
      mined++
      await collectDrops(bot, pos, isCancelled)
    } catch (err) {
      if (isCancelled()) break
      console.log(`Pulando ${block?.name} em ${pos}: ${err.message}`)
      skip.add(pos.toString())
      failures++
    }
  }
  return mined
}

const hasPickaxe = (bot) => bot.inventory.items().some((i) => i.name.endsWith('_pickaxe'))

module.exports = { mineBlocks, hasPickaxe, isExposed }
