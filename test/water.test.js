const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { findDryLand, runningOutOfAir } = require('../lib/water')

// Túnel inundado: água em y=40..42 por toda parte, exceto uma margem seca em x=5.
function flooded() {
  const blockAt = (p) => {
    const { x, y } = p
    if (y <= 39) return { name: 'stone', boundingBox: 'block' }
    if (x === 5 && y === 40) return { name: 'stone', boundingBox: 'block' }
    if (x === 5 && y >= 41) return { name: 'air', boundingBox: 'empty' }
    if (y <= 42) return { name: 'water', boundingBox: 'empty' }
    return { name: 'stone', boundingBox: 'block' }
  }
  return { entity: { position: new Vec3(0.5, 40, 0.5) }, blockAt }
}

test('findDryLand acha a margem seca mais perto, nunca a água', () => {
  const bot = flooded()
  const spot = findDryLand(bot)
  assert.equal(spot.x, 5) // a margem fica a 5 blocos: nada mais perto está seco
  assert.equal(spot.y, 41)
  assert.equal(bot.blockAt(spot).name, 'air')
  assert.equal(bot.blockAt(spot.offset(0, -1, 0)).name, 'stone')
})

test('findDryLand sem saída devolve null', () => {
  const bot = { entity: { position: new Vec3(0, 40, 0) }, blockAt: () => ({ name: 'water', boundingBox: 'empty' }) }
  assert.equal(findDryLand(bot, 3), null)
})

test('runningOutOfAir só dispara com o ar baixo', () => {
  assert.equal(runningOutOfAir({ oxygenLevel: 20 }), false)
  assert.equal(runningOutOfAir({ oxygenLevel: 13 }), true)
  assert.equal(runningOutOfAir({}), false)
})
