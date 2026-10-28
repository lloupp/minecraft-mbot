const test = require('node:test')
const assert = require('node:assert/strict')
const { ironDepositPlan, canAutomaticIronDeposit } = require('../lib/iron-deposit')
const inventory = (rows) => ({ inventory: { items: () => rows.map(([name, count]) => ({ name, count })) } })

test('depósito preserva 16 ferros brutos e 8 lingotes por padrão', () => {
  const bot = inventory([['raw_iron', 20], ['iron_ore', 3], ['iron_ingot', 12], ['iron_pickaxe', 1]])
  assert.deepEqual(ironDepositPlan(bot, { keepRaw: 16, keepIngot: 8 }), { raw_iron: 7, iron_ingot: 4 })
})

test('depósito não retira materiais reservados', () => {
  assert.deepEqual(ironDepositPlan(inventory([['raw_iron', 16], ['iron_ingot', 8]]), { keepRaw: 16, keepIngot: 8 }), {})
  assert.deepEqual(ironDepositPlan(inventory([['iron_block', 2], ['iron_nugget', 5]]), { keepRaw: 16, keepIngot: 8 }), { iron_block: 2, iron_nugget: 5 })
})

test('timer de depósito rejeita tarefa, compromisso de movimento e fuga', () => {
  const idle = { mode: 'ficar', taskName: null, now: 10000 }
  assert.equal(canAutomaticIronDeposit(idle), true)
  assert.equal(canAutomaticIronDeposit({ ...idle, mode: 'seguir' }), true)
  for (const changed of [
    { mode: 'tarefa', taskName: 'minerar' },
    { taskName: 'fabricar' }, { taskName: 'lutar' },
    { pausedFollowing: 1 }, { fleeingUntil: 11000 },
    { eating: true }, { checkingGear: true }, { isMoving: true },
    { mode: 'patrulha' }
  ]) {
    assert.equal(canAutomaticIronDeposit({ ...idle, ...changed }), false, JSON.stringify(changed))
  }
})
