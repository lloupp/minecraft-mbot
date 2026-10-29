const test = require('node:test')
const assert = require('node:assert/strict')
const { canAutomaticDeposit } = require('../lib/idle-deposit')
const { mineralResourcesFor, resolveBlockNames } = require('../core/resources')

test('automatic deposit cannot interrupt mining, crafting, combat, movement or feeding', () => {
  const idle = { mode: 'ficar', taskName: null, now: 100 }
  assert.equal(canAutomaticDeposit(idle), true)
  for (const extra of [{ mode: 'tarefa' }, { taskName: 'minerar' }, { pausedFollowing: 1 }, { fleeingUntil: 200 }, { eating: true }, { checkingGear: true }, { isMoving: true }]) {
    assert.equal(canAutomaticDeposit({ ...idle, ...extra }), false, JSON.stringify(extra))
  }
})

test('mineral catalog preserves local aliases and adds registered Nether/modded resources without inventing blocks', () => {
  const names = ['iron_ore', 'deepslate_iron_ore', 'amethyst_cluster', 'nether_quartz_ore', 'nether_gold_ore', 'ancient_debris', 'custom_ore']
  const bot = { registry: { blocksByName: Object.fromEntries(names.map((name, id) => [name, { id }])) }, game: { dimension: 'overworld' } }
  assert.deepEqual(resolveBlockNames(bot, 'ferro'), ['iron_ore', 'deepslate_iron_ore'])
  assert.deepEqual(resolveBlockNames(bot, 'detritos ancestrais'), ['ancient_debris'])
  assert.deepEqual(resolveBlockNames(bot, 'diamante'), [])
  assert(mineralResourcesFor(bot).includes('custom_ore'))
  assert(!mineralResourcesFor(bot).includes('quartzo'))
  bot.game.dimension = 'minecraft:the_nether'
  assert(mineralResourcesFor(bot).includes('quartzo'))
  assert(!mineralResourcesFor(bot).includes('ferro'))
  bot.game.dimension = 'minecraft:the_end'
  assert.deepEqual(mineralResourcesFor(bot), [])
})
