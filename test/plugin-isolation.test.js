const test = require('node:test')
const assert = require('node:assert/strict')
const { loadPlugins, PLUGINS } = require('../lib/plugins')

const names = PLUGINS.map(([name]) => name)

function fixture({ failing = null } = {}) {
  const calls = []
  const logs = []
  const plugins = names.map(name => [name, () => {
    calls.push(`resolve:${name}`)
    return () => name
  }])
  const bot = { loadPlugin(fn) {
    const name = fn()
    calls.push(`load:${name}`)
    if (name === failing) throw new Error(`erro sintético: ${name}`)
  } }
  const run = (options = {}) => loadPlugins(bot, { plugins, log: msg => logs.push(msg), ...options })
  return { calls, logs, run }
}

test('sem seleção, carrega todos os plugins na ordem original', () => {
  const { calls, run } = fixture()
  assert.deepEqual(run({ only: null, skip: '', enabled: true }), names)
  assert.deepEqual(calls.filter(x => x.startsWith('load:')), names.map(x => `load:${x}`))
})

for (const name of names) {
  test(`isola o plugin ${name} sem carregar os demais`, () => {
    const { calls, run } = fixture()
    assert.deepEqual(run({ only: ` ${name} `, skip: '', enabled: true }), [name])
    assert.deepEqual(calls, [`resolve:${name}`, `load:${name}`])
  })
}

test('allowlist vazia não ativa nenhum plugin opcional', () => {
  const { calls, run } = fixture()
  assert.deepEqual(run({ only: '', enabled: true }), [])
  assert.deepEqual(calls, [])
})

test('skip prevalece sobre only e reconhece listas com espaços', () => {
  const { calls, run } = fixture()
  assert.deepEqual(run({ only: 'pvp,tool,collectblock', skip: ' pvp, collectblock ', enabled: true }), ['tool'])
  assert.deepEqual(calls, ['resolve:tool', 'load:tool'])
})

test('nomes desconhecidos não ativam plugins e geram aviso', () => {
  const { calls, logs, run } = fixture()
  assert.deepEqual(run({ only: 'nao-existe', enabled: true }), [])
  assert.deepEqual(calls, [])
  assert.ok(logs.some(line => line.includes('nome desconhecido') && line.includes('nao-existe')))
})

test('plugin que falha não bloqueia o próximo', () => {
  const { calls, logs, run } = fixture({ failing: 'tool' })
  assert.deepEqual(run({ only: 'tool,collectblock', enabled: true }), ['collectblock'])
  assert.deepEqual(calls, ['resolve:tool', 'load:tool', 'resolve:collectblock', 'load:collectblock'])
  assert.ok(logs.some(line => line.includes('tool indisponível')))
})

test('MBOT_PLUGINS=0 desliga todo carregamento', () => {
  const { calls, run } = fixture()
  assert.deepEqual(run({ only: 'tool', enabled: false }), [])
  assert.deepEqual(calls, [])
})

test('seleção por variável de ambiente também funciona', () => {
  const previous = process.env.MBOT_PLUGINS_ONLY
  process.env.MBOT_PLUGINS_ONLY = 'hawkeye'
  try {
    const { calls, run } = fixture()
    assert.deepEqual(run({ enabled: true, skip: '' }), ['hawkeye'])
    assert.deepEqual(calls, ['resolve:hawkeye', 'load:hawkeye'])
  } finally {
    if (previous === undefined) delete process.env.MBOT_PLUGINS_ONLY
    else process.env.MBOT_PLUGINS_ONLY = previous
  }
})
