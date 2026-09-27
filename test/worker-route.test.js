const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { pathfinder, goals } = require('mineflayer-pathfinder')
const { WorkerController } = require('../core/WorkerController')

function worldBot () {
  const registry = require('minecraft-data')('1.20.1')
  const Block = require('prismarine-block')('1.20.1')
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '1.20.1', game: { minY: -64, height: 384 }, entities: {}, health: 20, food: 20,
    entity: { position: new Vec3(0.5, 64, 0.5), effects: {}, onGround: true },
    inventory: { items: () => [] }, clearControlStates () {}
  })
  bot.blockAt = pos => {
    const p = pos.floored()
    let name = p.y === 63 ? 'grass_block' : 'air'
    // Morro com subida íngreme e caminho plano pelos dois lados.
    if (p.x === 3 && Math.abs(p.z) <= 20 && p.y >= 64 && p.y <= 69) name = 'stone'
    // Blocos artificiais não fecham os desvios.
    if (p.x === 2 && p.z === 0 && p.y === 64) name = 'oak_planks'
    if (p.x === 2 && p.z === 1 && p.y === 64) name = 'cobblestone'
    if (p.x === 2 && p.z === -1 && p.y === 64) name = 'oak_fence'
    const block = Block.fromStateId(registry.blocksByName[name].defaultState, 0)
    block.position = p
    return block
  }
  pathfinder(bot)
  return bot
}

for (const withPickaxe of [false, true]) {
  test(`worker planeja desvio sem quebrar morro ou construção (picareta=${withPickaxe})`, t => {
    const bot = worldBot()
    if (withPickaxe) bot.inventory.items = () => [{ name: 'iron_pickaxe', type: bot.registry.itemsByName.iron_pickaxe.id }]
    const worker = new WorkerController({ bot, name: 'lenhador_01', role: 'lenhador', homeProvider: () => null, ownerProvider: () => null })
    bot.emit('spawn')
    t.after(() => clearInterval(worker.survivalTimer))
    bot.pathfinder.tickTimeout = 10000
    const { result } = bot.pathfinder.getPathFromTo(worker.workMoves, bot.entity.position, new goals.GoalBlock(12, 64, 0), { optimizePath: false, timeout: 10000 }).next().value
    assert.equal(result.status, 'success')
    assert.ok(result.path.some(node => Math.abs(node.z) >= 21), 'rota deve contornar o morro')
    assert.ok(result.path.every(node => !node.toBreak.length), 'não pode incluir nenhuma quebra automática')
    assert.ok(result.path.every(node => node.y === 64), 'desvio plano disponível deve ser usado')
  })
}
