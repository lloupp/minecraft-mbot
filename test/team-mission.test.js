const test = require('node:test')
const assert = require('node:assert/strict')
const { teamMission } = require('../lib/ore-mission')

const FAMILIES = [
  { key: 'carvao', label: 'carvão', item: 'coal' },
  { key: 'ferro', label: 'ferro', item: 'raw_iron' },
  { key: 'lapis', label: 'lápis', item: 'lapis_lazuli' }
]

// Estoque compartilhado da equipe (mochilas + baú) num mapa simples.
function team(initial = {}) {
  const stock = new Map(Object.entries(initial))
  return {
    stock,
    count: (item) => stock.get(item) || 0,
    add: (item, n) => stock.set(item, (stock.get(item) || 0) + n)
  }
}

const noSleep = async () => {}

test('divide as famílias entre os membros e termina quando todas batem a meta', async () => {
  const t = team()
  const seen = []
  const member = (name) => ({
    name,
    mine: async (family, need) => { seen.push(`${name}:${family.key}`); t.add(family.item, need) }
  })
  const result = await teamMission({ target: 8, families: FAMILIES, members: [member('a'), member('b')], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, true)
  assert.deepEqual(result.progress, { carvao: 8, ferro: 8, lapis: 8 })
  // Duas primeiras famílias em paralelo, uma para cada.
  assert.deepEqual(seen.slice(0, 2), ['a:carvao', 'b:ferro'])
  // Na última família, o membro que sobrou ajuda o outro.
  assert.deepEqual(seen.slice(2).sort(), ['a:lapis', 'b:lapis'])
})

test('sem família livre, o membro ocioso ajuda na que outro está minerando', async () => {
  const t = team()
  const families = [{ key: 'ferro', label: 'ferro', item: 'raw_iron' }]
  const seen = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const slow = { name: 'lento', mine: async (family) => { seen.push('lento'); await gate; t.add(family.item, 1) } }
  const helper = { name: 'ajudante', mine: async (family, need) => { seen.push('ajudante'); t.add(family.item, need); release() } }
  const result = await teamMission({ target: 10, families, members: [slow, helper], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, true)
  assert.deepEqual(seen.slice(0, 2), ['lento', 'ajudante'])
})

test('já completo: ninguém trabalha', async () => {
  const t = team({ coal: 64, raw_iron: 70, lapis_lazuli: 64 })
  let calls = 0
  const result = await teamMission({ target: 64, families: FAMILIES, members: [{ name: 'a', mine: async () => { calls++ } }], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, true)
  assert.equal(calls, 0)
})

test('pede só o que falta, contando o que a equipe já tem', async () => {
  const t = team({ coal: 50 })
  const needs = {}
  const member = { name: 'a', mine: async (family, need) => { needs[family.key] = need; t.add(family.item, need) } }
  await teamMission({ target: 64, families: FAMILIES.slice(0, 1), members: [member], teamCount: t.count, sleep: noSleep })
  assert.equal(needs.carvao, 14)
})

test('família sem progresso desiste depois de 3 tentativas, as outras continuam', async () => {
  const t = team()
  let lapisTries = 0
  const member = {
    name: 'a',
    mine: async (family, need) => {
      if (family.key === 'lapis') { lapisTries++; return { ok: false, reason: 'cheguei ao fundo' } }
      t.add(family.item, need)
    }
  }
  const result = await teamMission({ target: 4, families: FAMILIES, members: [member], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, false)
  assert.equal(lapisTries, 3)
  assert.deepEqual(result.gaveUp, [{ key: 'lapis', reason: 'cheguei ao fundo' }])
  assert.equal(result.progress.carvao, 4)
  assert.equal(result.progress.ferro, 4)
})

test('erro do membro conta como tentativa e não derruba a missão', async () => {
  const t = team()
  let tries = 0
  const member = { name: 'a', mine: async () => { tries++; throw new Error('morri') } }
  const result = await teamMission({ target: 1, families: FAMILIES.slice(0, 1), members: [member], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, false)
  assert.equal(tries, 3)
  assert.equal(result.gaveUp[0].reason, 'morri')
})

test('progresso parcial não conta como falha', async () => {
  const t = team()
  let tries = 0
  const member = { name: 'a', mine: async (family) => { tries++; t.add(family.item, 2) } }
  const result = await teamMission({ target: 10, families: FAMILIES.slice(0, 1), members: [member], teamCount: t.count, sleep: noSleep })
  assert.equal(result.ok, true)
  assert.equal(tries, 5)
})

test('sem membros disponíveis espera e depois desiste', async () => {
  const t = team()
  let waits = 0
  const result = await teamMission({
    target: 1, families: FAMILIES, members: () => [], teamCount: t.count,
    maxIdleWaits: 3, sleep: async () => { waits++ }
  })
  assert.equal(result.ok, false)
  assert.equal(waits, 3)
})

test('membro que aparece depois (ajudante conectando) entra na missão', async () => {
  const t = team()
  let ready = false
  const helper = { name: 'h', mine: async (family, need) => t.add(family.item, need) }
  const result = await teamMission({
    target: 2, families: FAMILIES, members: () => (ready ? [helper] : []), teamCount: t.count,
    sleep: async () => { ready = true }
  })
  assert.equal(result.ok, true)
})

test('cancelar para a missão', async () => {
  const t = team()
  let cancelled = false
  const member = { name: 'a', mine: async (family) => { t.add(family.item, 1); cancelled = true } }
  const result = await teamMission({ target: 64, families: FAMILIES, members: [member], teamCount: t.count, isCancelled: () => cancelled, sleep: noSleep })
  assert.equal(result.cancelled, true)
  assert.equal(result.ok, false)
})

// ---------- tarefa minerar_fundo do ajudante ----------

const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const { WorkerController } = require('../core/WorkerController')

function workerWith(items, blocksByName = { iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 } }) {
  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 64, 0) }
  bot.health = 20
  bot.food = 20
  bot.inventory = { items: () => items }
  bot.registry = { blocksByName, blocksArray: [], foodsByName: {} }
  bot.entities = {}
  bot.nearestEntity = () => null
  bot.findBlocks = () => []
  const worker = new WorkerController({ bot, name: 'minerador_01', role: 'minerador', logger: { log: () => {} } })
  worker.ensureRoleTool = async () => null
  return worker
}

test('minerar_fundo sem picareta não desce e avisa', async () => {
  const worker = workerWith([])
  const result = await worker.mineDeepOre({ blocks: ['iron_ore'], item: 'raw_iron', tool: 'stone', count: 5 }, () => false)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NO_TOOL')
})

test('minerar_fundo de ouro sem picareta de ferro tenta fazer uma e desiste se não der', async () => {
  const worker = workerWith([{ name: 'stone_pickaxe', count: 1 }], { gold_ore: { id: 3 } })
  let tried = 0
  worker.makeIronPickaxe = async () => { tried++; return false }
  const result = await worker.mineDeepOre({ blocks: ['gold_ore'], item: 'raw_gold', tool: 'iron', count: 5 }, () => false)
  assert.equal(tried, 1)
  assert.equal(result.code, 'NO_TOOL')
  assert.match(result.reason, /ferro/)
})

test('minerar_fundo com bloco fora do registro não faz nada', async () => {
  const worker = workerWith([{ name: 'stone_pickaxe', count: 1 }], {})
  const result = await worker.mineDeepOre({ blocks: ['iron_ore'], item: 'raw_iron', tool: 'stone', count: 5 }, () => false)
  assert.equal(result.code, 'NO_BLOCKS')
})

test('interrupção (retry) não gasta tentativa: o membro descansa e tenta de novo', async () => {
  const t = team()
  let calls = 0
  let clock = 0
  const member = {
    name: 'a',
    mine: async (family, need) => {
      calls++
      if (calls <= 2) return { ok: false, retry: true, reason: 'fugi de creeper' }
      t.add(family.item, need)
    }
  }
  const result = await teamMission({
    target: 3, families: FAMILIES.slice(0, 1), members: [member], teamCount: t.count,
    cooldownMs: 1000, now: () => clock, sleep: async () => { clock += 1000 }
  })
  assert.equal(result.ok, true)
  assert.equal(calls, 3)
})

test('retry infinito vira tentativa depois do limite de interrupções', async () => {
  const t = team()
  let clock = 0
  let calls = 0
  const member = { name: 'a', mine: async () => { calls++; return { ok: false, retry: true, reason: 'vida baixa' } } }
  const result = await teamMission({
    target: 3, families: FAMILIES.slice(0, 1), members: [member], teamCount: t.count,
    maxSoftTries: 2, cooldownMs: 10, now: () => clock, sleep: async () => { clock += 10 }
  })
  assert.equal(result.ok, false)
  assert.equal(calls, 2 + 3) // 2 interrupções + 3 tentativas
  assert.equal(result.gaveUp[0].reason, 'vida baixa')
})

test('canMine: família de ferro só vai para quem pode', async () => {
  const t = team()
  const families = [{ key: 'carvao', label: 'carvão', item: 'coal' }, { key: 'ouro', label: 'ouro', item: 'raw_gold', tool: 'iron' }]
  const got = []
  const member = (name, iron) => ({ name, iron, mine: async (family, need) => { got.push(`${name}:${family.key}`); t.add(family.item, need) } })
  const result = await teamMission({
    target: 2, families, members: [member('semferro', false), member('comferro', true)], teamCount: t.count,
    canMine: (m, f) => f.tool !== 'iron' || m.iron, sleep: noSleep
  })
  assert.equal(result.ok, true)
  assert.ok(got.includes('comferro:ouro'))
  assert.ok(!got.includes('semferro:ouro'))
})

test('ninguém pode pegar o que falta: para e diz o motivo', async () => {
  const t = team()
  const families = [{ key: 'ouro', label: 'ouro', item: 'raw_gold', tool: 'iron' }]
  const result = await teamMission({
    target: 2, families, members: [{ name: 'a', mine: async () => {} }], teamCount: t.count,
    canMine: () => false, sleep: noSleep
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.gaveUp, [{ key: 'ouro', reason: 'ninguém com a ferramenta certa' }])
})

test('ajudante com vida baixa não desce e pede para tentar depois', async () => {
  const worker = workerWith([{ name: 'stone_pickaxe', count: 1 }])
  worker.bot.health = 3
  worker.eat = async () => {}
  const result = await worker.mineDeepOre({ blocks: ['iron_ore'], item: 'raw_iron', tool: 'stone', count: 5 }, () => false)
  assert.equal(result.code, 'LOW_HEALTH')
  assert.equal(result.retry, true)
})


test('vida baixa do membro não gasta tentativas da família e o descanso cresce', async () => {
  const t = team()
  let clock = 0
  const starts = []
  const sick = { name: 'doente', mine: async () => { starts.push(clock); return { ok: false, retry: true, memberIssue: true, reason: 'vida 2/20' } } }
  let ready = false
  const healthy = { name: 'bom', mine: async (family, need) => t.add(family.item, need) }
  const result = await teamMission({
    target: 2, families: FAMILIES.slice(0, 1), teamCount: t.count, cooldownMs: 100,
    members: () => (ready ? [healthy] : [sick]), maxSoftTries: 1,
    now: () => clock,
    sleep: async () => { clock += 100; if (clock >= 1500) ready = true }
  })
  assert.equal(result.ok, true)
  assert.ok(starts.length >= 3)
  // Intervalos crescentes: 100, 200, 400...
  assert.ok(starts[2] - starts[1] > starts[1] - starts[0])
})

test('ferro, cobre e ouro contam o bruto e o lingote', () => {
  const { itemsFor } = require('../lib/ore-mission')
  assert.deepEqual(itemsFor('raw_iron'), ['raw_iron', 'iron_ingot'])
  assert.deepEqual(itemsFor('raw_copper'), ['raw_copper', 'copper_ingot'])
  assert.deepEqual(itemsFor('raw_gold'), ['raw_gold', 'gold_ingot'])
  assert.deepEqual(itemsFor('coal'), ['coal'])
  assert.deepEqual(itemsFor('qualquer'), ['qualquer'])
})
