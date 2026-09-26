const test = require('node:test')
const assert = require('node:assert/strict')

const combat = require('../lib/combat')

const pos = (x) => ({ distanceTo: (other) => Math.abs(other.x - x), x })

function fakeBot({ health = 20, items = [], mobs = [] } = {}) {
  const self = { position: pos(0) }
  const entities = { self }
  mobs.forEach((m, i) => { entities[i] = { type: 'hostile', position: pos(m.dist), ...m } })
  return {
    health,
    entity: self,
    entities,
    inventory: { items: () => items.map((name) => ({ name })) },
    nearestEntity: (filter) => Object.values(entities).filter((e) => e !== self && filter(e))
      .sort((a, b) => a.position.x - b.position.x)[0] || null
  }
}

test('foge de creeper mesmo com vida cheia', () => {
  const bot = fakeBot({ mobs: [{ name: 'creeper', dist: 3 }] })
  assert.equal(combat.decide(bot, bot.entities[0]), 'fugir')
})

test('luta com zumbi com vida suficiente e foge com vida baixa', () => {
  const healthy = fakeBot({ health: 15, mobs: [{ name: 'zombie', dist: 3 }] })
  assert.equal(combat.decide(healthy, healthy.entities[0]), 'lutar')
  const hurt = fakeBot({ health: 5, mobs: [{ name: 'zombie', dist: 3 }] })
  assert.equal(combat.decide(hurt, hurt.entities[0]), 'fugir')
})

test('com espada aceita lutar com menos vida', () => {
  const noSword = fakeBot({ health: 7, mobs: [{ name: 'zombie', dist: 3 }] })
  assert.equal(combat.decide(noSword, noSword.entities[0]), 'fugir')
  const sword = fakeBot({ health: 7, items: ['stone_sword'], mobs: [{ name: 'zombie', dist: 3 }] })
  assert.equal(combat.decide(sword, sword.entities[0]), 'lutar')
})

test('avança sobre esqueletos (fugir de flechas não adianta)', () => {
  const bot = fakeBot({ health: 7, mobs: [{ name: 'skeleton', dist: 8 }] })
  assert.equal(combat.decide(bot, bot.entities[0]), 'lutar')
})

test('foge quando cercado', () => {
  const bot = fakeBot({ mobs: [{ name: 'zombie', dist: 3 }, { name: 'zombie', dist: 4 }, { name: 'spider', dist: 5 }] })
  assert.equal(combat.decide(bot, bot.entities[0]), 'fugir')
})

test('ataque proativo ignora neutros e creepers', () => {
  const bot = fakeBot({ mobs: [{ name: 'enderman', dist: 2 }, { name: 'creeper', dist: 3 }, { name: 'spider', dist: 4 }] })
  assert.equal(combat.proactiveTarget(bot, 5).name, 'spider')
})

test('escolhe a melhor arma, preferindo espada', () => {
  const bot = fakeBot({ items: ['wooden_sword', 'iron_axe', 'iron_sword', 'dirt'] })
  assert.equal(combat.bestWeapon(bot).name, 'iron_sword')
})
