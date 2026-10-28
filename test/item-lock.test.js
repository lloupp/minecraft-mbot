const test = require('node:test')
const assert = require('node:assert/strict')

const craft = require('../lib/craft')
const food = require('../lib/food')

// AutoEat de mentira com a mesma superfície usada pelo plugin real
// (enabled/isEating/disableAuto/enableAuto/cancelEat).
function fakeAutoEat({ enabled = true, eating = false } = {}) {
  return {
    _enabled: enabled,
    _eating: eating,
    disables: 0,
    enables: 0,
    get enabled() { return this._enabled },
    get isEating() { return this._eating },
    disableAuto() { this.disables++; this._enabled = false },
    enableAuto() { this.enables++; this._enabled = true },
    cancelEat() { this._eating = false }
  }
}

function fakeCraftBot({ autoEat = null, items = [] } = {}) {
  const bot = {
    autoEat,
    inventory: {
      items: () => {
        bot.itemsSeenAt = autoEat ? autoEat.enabled : null
        return items
      }
    },
    registry: { itemsByName: { oak_planks: { id: 5 } }, items: { 5: { name: 'oak_planks' } } },
    currentWindow: null,
    entities: {}
  }
  return bot
}

test('craft com AutoEat ativo devolve o item e reativa a alimentação', async () => {
  const autoEat = fakeAutoEat()
  const bot = fakeCraftBot({ autoEat, items: [{ type: 5, name: 'oak_planks', count: 1 }] })

  await craft.craftItem(bot, 'oak_planks', 1, () => false)

  assert.equal(bot.itemsSeenAt, false, 'inventário só é tocado com AutoEat pausado')
  assert.equal(autoEat.enabled, true)
  assert.equal(autoEat.disables, 1)
  assert.equal(autoEat.enables, 1)
})

test('craft que falha ainda reativa o AutoEat', async () => {
  const autoEat = fakeAutoEat()
  const bot = fakeCraftBot({ autoEat })

  await assert.rejects(craft.craftItem(bot, 'item_inexistente', 1, () => false))

  assert.equal(autoEat.enabled, true)
})

test('craft aninhado não reativa o AutoEat no meio', async () => {
  const autoEat = fakeAutoEat()
  const bot = fakeCraftBot({ autoEat })
  const { withItemLock } = require('../lib/item-lock')

  await withItemLock(bot, async () => {
    await withItemLock(bot, async () => {})
    assert.equal(autoEat.enables, 0, 'trava interna não pode soltar o item')
    assert.equal(autoEat.enabled, false)
  })

  assert.equal(autoEat.enables, 1)
  assert.equal(autoEat.enabled, true)
})

test('duas operações concorrentes usam o inventário uma de cada vez', async () => {
  const autoEat = fakeAutoEat()
  const bot = fakeCraftBot({ autoEat })
  const { withItemLock } = require('../lib/item-lock')
  const events = []

  const first = withItemLock(bot, async () => {
    events.push('início-1')
    await new Promise((resolve) => setTimeout(resolve, 40))
    events.push('fim-1')
  })
  const second = withItemLock(bot, async () => {
    events.push('início-2')
    events.push('fim-2')
  })
  await Promise.all([first, second])

  assert.deepEqual(events, ['início-1', 'fim-1', 'início-2', 'fim-2'])
  assert.equal(autoEat.enabled, true)
})

test('espera o AutoEat terminar de comer antes de tirar o item da mão', async () => {
  const autoEat = fakeAutoEat({ eating: true })
  const bot = fakeCraftBot({ autoEat })
  const { withItemLock } = require('../lib/item-lock')
  const order = []

  setTimeout(() => { autoEat._eating = false; order.push('terminou-de-comer') }, 120)
  await withItemLock(bot, async () => { order.push('pegou-o-item') })

  assert.deepEqual(order, ['terminou-de-comer', 'pegou-o-item'])
  assert.equal(autoEat.enabled, true)
})

function fakeFoodBot({ autoEat = null, food = 5, items = [] } = {}) {
  const bot = {
    autoEat,
    food,
    registry: { foodsByName: { bread: { foodPoints: 5, effectiveQuality: 5 } } },
    inventory: { items: () => items },
    equip: async () => { bot.autoEatEnabledWhileEquipping = autoEat ? autoEat.enabled : null },
    consume: async () => {} 
  }
  return bot
}

test('comer também segura o item na mão sem AutoEat disputar', async () => {
  const autoEat = fakeAutoEat()
  const bot = fakeFoodBot({ autoEat, items: [{ name: 'bread', count: 2 }] })

  assert.equal(await food.eat(bot), 'bread')
  assert.equal(bot.autoEatEnabledWhileEquipping, false)
  assert.equal(autoEat.enabled, true)
})

test('sem AutoEat o craft e a refeição continuam funcionando', async () => {
  const craftBot = fakeCraftBot({ items: [{ type: 5, name: 'oak_planks', count: 1 }] })
  await craft.craftItem(craftBot, 'oak_planks', 1, () => false)
  const foodBot = fakeFoodBot({ items: [{ name: 'bread', count: 1 }] })
  assert.equal(await food.eat(foodBot), 'bread')
})
