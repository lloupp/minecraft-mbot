const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const food = require('./food')

// Recovery must not recursively collect remote ingredients while holding storage.
async function craftLocalChest(bot) {
  const chest = bot.registry?.itemsByName?.chest
  const tableId = bot.registry?.blocksByName?.crafting_table?.id
  const table = tableId == null ? null : bot.findBlock?.({ matching: tableId, maxDistance: 4 })
  const recipe = chest && table && bot.recipesFor?.(chest.id, null, 1, table)?.[0]
  if (!recipe) throw new Error('recuperação precisa de um baú ou ingredientes prontos e mesa próxima')
  await bot.craft(recipe, 1, table)
}

// Only while the storage transaction owns this bot, near confirmed missing stock.
// Never dig, replace built blocks, or turn a rejected placement into success.
async function createReplacementChest(bot, anchor, isCancelled = () => false) {
  const origin = new Vec3(anchor.x, anchor.y, anchor.z)
  const check = () => {
    if (isCancelled()) throw new Error('recuperação do estoque cancelada')
    if (!bot.entity || bot.health <= 0) throw new Error('bot indisponível para recuperar estoque')
    if (bot.entity.position.distanceTo(origin) > 6) throw new Error('recuperação recusada longe do estoque original')
  }
  check()
  if (!bot.inventory.items().some(item => item.name === 'chest')) await craftLocalChest(bot)
  check()
  const validSpot = position => {
    const floor = bot.blockAt(position.offset(0, -1, 0))
    const here = bot.blockAt(position)
    const above = bot.blockAt(position.offset(0, 1, 0))
    if (floor?.boundingBox !== 'block' || /chest|barrel|furnace|crafting_table|sand|gravel|lava|water|_bed/.test(floor.name)) return null
    if (!here || !above || here.name !== 'air' || above.name !== 'air') return null
    return floor
  }
  let attempts = 0
  let lastError = null
  for (let radius = 0; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
      const position = origin.offset(dx, 0, dz)
      if (!validSpot(position) || bot.entity.position.distanceTo(position) < 1.1) continue
      check()
      try {
        if (++attempts > 3) throw lastError || new Error('limite de tentativas de recuperar o baú')
        await food.goTo(bot, new goals.GoalNear(position.x, position.y, position.z, 2), 10000)
        check()
        const reference = validSpot(position)
        const item = bot.inventory.items().find(entry => entry.name === 'chest')
        if (!reference || !item) continue
        await bot.equip(item, 'hand')
        check()
        await bot.lookAt(position.offset(0.5, 0.5, 0.5), true)
        check()
        await bot.placeBlock(reference, new Vec3(0, 1, 0))
        check()
        const placed = bot.blockAt(position)
        if (placed?.name === 'chest') return placed
        throw new Error('baú de recuperação não confirmado no mundo')
      } catch (error) {
        check()
        lastError = error
        if (attempts >= 3) throw error
      }
    }
  }
  throw lastError || new Error('sem posição livre para recuperar o baú central')
}
module.exports = { createReplacementChest }
