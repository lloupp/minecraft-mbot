const test = require('node:test')
const assert = require('node:assert/strict')

const { Autonomy } = require('../lib/autonomy')

function fakeBot() {
  return {
    entity: { position: { x: 0, y: 64, z: 0 } },
    time: { isDay: true },
    registry: { itemsByName: {}, blocksByName: {} },
    inventory: { items: () => [] },
    blockAt: () => null
  }
}

const names = (autonomy) => autonomy.goals().map((goal) => goal.name)

function withoutBedEnv(fn) {
  const previous = process.env.MBOT_BED_GOAL
  delete process.env.MBOT_BED_GOAL
  try { return fn() } finally {
    if (previous === undefined) delete process.env.MBOT_BED_GOAL
    else process.env.MBOT_BED_GOAL = previous
  }
}

test('a meta de cama fica desligada por padrão (não caça ovelha)', () => {
  withoutBedEnv(() => {
    assert.equal(names(new Autonomy(fakeBot())).includes('cama'), false)
  })
})

test('outras metas continuam disponíveis sem a cama', () => {
  withoutBedEnv(() => {
    const list = names(new Autonomy(fakeBot()))
    assert.ok(list.includes('picareta de madeira'))
    assert.ok(list.includes('estoque de comida'))
  })
})

test('MBOT_BED_GOAL=1 volta a oferecer a cama', () => {
  const previous = process.env.MBOT_BED_GOAL
  process.env.MBOT_BED_GOAL = '1'
  try {
    assert.equal(names(new Autonomy(fakeBot())).includes('cama'), true)
  } finally {
    if (previous === undefined) delete process.env.MBOT_BED_GOAL
    else process.env.MBOT_BED_GOAL = previous
  }
})

test('meta desligada nunca é escolhida como próxima', () => {
  withoutBedEnv(() => {
    const autonomy = new Autonomy(fakeBot())
    assert.notEqual(autonomy.next()?.name, 'cama')
  })
})
