// lib/gather.js
// Coletar blocos do mundo: escolhe blocos alcançáveis (de preferência expostos),
// pula os que não consegue alcançar e recolhe os itens que caem.

const { goals } = require('mineflayer-pathfinder')
const { goTo, collectDrops } = require('./food')

const RANGE = 48
const MAX_FAILURES = 6
const AIR = new Set(['air', 'cave_air', 'void_air'])
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
// Caem quando o bloco de baixo some: cavar embaixo deles pode soterrar o bot.
const FALLING = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'])

function hasFallingAbove(bot, pos) {
  return FALLING.has(bot.blockAt(pos.offset(0, 1, 0))?.name)
}

// Bloco encostado em ar: dá para chegar sem cavar túnel.
function isExposed(bot, pos) {
  return SIDES.some(([x, y, z]) => AIR.has(bot.blockAt(pos.offset(x, y, z))?.name))
}

function blockIds(bot, predicate) {
  return bot.registry.blocksArray.filter((b) => predicate(b.name)).map((b) => b.id)
}

// mineflayer-collectblock: anda até o bloco, escolhe a ferramenta, cava e
// recolhe os itens. Com limite de tempo (caminhos impossíveis podem travar).
async function collectWithPlugin(bot, block, ms = 45000) {
  let timer
  try {
    await Promise.race([
      bot.collectBlock.collect(block),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          bot.collectBlock.cancelTask().catch(() => {})
          reject(new Error('coleta demorou demais'))
        }, ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Minera até `count` blocos cujo nome satisfaz `predicate`. Retorna quantos minerou.
async function mineBlocks(bot, predicate, count, isCancelled) {
  const ids = blockIds(bot, predicate)
  const skip = new Set()
  let mined = 0
  let failures = 0
  while (mined < count && failures < MAX_FAILURES && !isCancelled()) {
    const candidates = bot.findBlocks({ matching: ids, maxDistance: RANGE, count: 64 })
      .filter((p) => !skip.has(p.toString()) && !hasFallingAbove(bot, p))
    const pos = candidates.find((p) => isExposed(bot, p)) || candidates[0]
    if (!pos) break
    const block = bot.blockAt(pos)
    try {
      // mineflayer-collectblock só se pedido: no teste em 1.20.1 ele travou em
      // minérios subterrâneos (0 ferro) onde a coleta própria fundiu 10.
      if (bot.collectBlock && process.env.MBOT_COLLECTBLOCK === '1') {
        await collectWithPlugin(bot, block)
      } else {
        await goTo(bot, new goals.GoalGetToBlock(pos.x, pos.y, pos.z), 20000)
        if (isCancelled()) break
        const tool = bot.pathfinder.bestHarvestTool(block)
        if (tool) await bot.equip(tool, 'hand')
        await bot.dig(bot.blockAt(pos))
      }
      if (isCancelled()) break
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

module.exports = { mineBlocks, hasPickaxe, isExposed, hasFallingAbove, FALLING }
