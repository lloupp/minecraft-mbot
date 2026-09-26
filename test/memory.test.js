const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const { Memory, dito, visto, inferido, parseValor, tipoDe, formatar } = require('../core/Memory')
const { resolveReference, blockVariants, searchTerms } = require('../core/References')
const { Clarifier } = require('../core/Clarifier')
const { attachMemoryCapture } = require('../lib/memoryCapture')
const { WaypointManager } = require('../core/WaypointManager')
const { StateStore } = require('../core/StateStore')

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-mbot-memoria-'))
  return path.join(dir, 'memory.json')
}

function newMemory(extra = {}) {
  return new Memory({ filePath: tmpFile(), autoSave: false, ...extra })
}

test('Memory referencia o waypoint sem duplicar coordenadas', () => {
  const memory = newMemory()
  const waypoints = new WaypointManager()
  const savedCasa = waypoints.save('Casa', { x: -300.4, y: 64, z: -520.7 }, 'overworld')
  memory.lembrarLugar(savedCasa.name, dito('eduardo'), 'casa definida pelo Eduardo')
  memory.definirPreferencia('tochas.quantidade', 64, dito('eduardo'))
  memory.prometer('fazer 64 tochas', { para: 'eduardo' }, inferido())
  memory.registrarFato('vi diamond_ore em 1,12,2', { assunto: 'minerio:diamond_ore', posicao: { x: 1, y: 12, z: 2 } }, visto())

  const [casa] = memory.listar('lugar')
  assert.equal(casa.nome, 'casa')
  assert.equal(casa.chave, 'casa')
  assert.equal(casa.waypoint, 'casa')
  assert.equal(Object.hasOwn(casa, 'posicao'), false)
  assert.equal(Object.hasOwn(casa, 'dimensao'), false)
  assert.deepEqual(waypoints.get('casa').position, { x: -300.4, y: 64, z: -520.7 })
  assert.equal(waypoints.get('casa').dimension, 'overworld')
  assert.equal(casa.origem.tipo, 'dito')
  assert.equal(casa.origem.quem, 'eduardo')
  assert.equal(casa.origem.confianca, 1)
  assert.ok(casa.origem.em)
  assert.equal(memory.formatar(casa), 'casa [dito por eduardo]')

  assert.equal(memory.preferencia('tochas.quantidade'), 64)
  assert.equal(memory.preferencia('nao.existe', 7), 7)
  assert.equal(memory.listar('compromisso')[0].estado, 'pendente')
  assert.equal(memory.listar('fato')[0].origem.tipo, 'visto')
  assert.equal(memory.listar().length, 4)
})

test('esquecer local remove waypoint canônico e metadados', () => {
  const memory = newMemory()
  const waypoints = new WaypointManager()
  const entry = waypoints.save('casa', { x: 1, y: 64, z: 2 }, 'overworld')
  memory.lembrarLugar(entry.name, dito('eduardo'))
  assert.equal(memory.esquecer('casa'), 1)
  assert.equal(waypoints.remove('casa'), true)
  assert.equal(memory.lugar('casa'), null)
  assert.equal(waypoints.get('casa'), null)
})

test('Memory atualiza sem duplicar e não deixa o visto sobrescrever o dito', () => {
  const memory = newMemory()
  memory.lembrarLugar('baú', dito('eduardo'))
  memory.lembrarLugar('bau', visto())
  assert.equal(memory.lugares().length, 1)
  assert.equal(memory.lugar('bau').origem.tipo, 'dito')
  assert.equal(Object.hasOwn(memory.lugar('bau'), 'posicao'), false)

  memory.lembrarLugar('cama', visto())
  memory.lembrarLugar('cama', visto(), 'cama atualizada')
  assert.equal(memory.lugar('cama').contexto, 'cama atualizada')

  memory.definirPreferencia('seguir.distancia', 3, dito('eduardo'))
  memory.definirPreferencia('Seguir.Distancia', 4, dito('eduardo'))
  assert.equal(memory.listar('preferencia').length, 1)
  assert.equal(memory.preferenciaNumero('seguir.distancia', 2, 1, 10), 4)
  assert.equal(memory.preferenciaNumero('seguir.distancia', 2, 1, 3), 2)
})

test('Memory esquece por nome e encerra compromissos', () => {
  const memory = newMemory()
  memory.lembrarLugar('casa velha', dito('eduardo'))
  memory.definirPreferencia('comida.preferida', 'cooked_beef', dito('eduardo'))
  assert.equal(memory.esquecer('Casa Velha'), 1)
  assert.equal(memory.esquecer('comida.preferida'), 1)
  assert.equal(memory.esquecer('nada'), 0)
  assert.equal(memory.listar().length, 0)

  const promessa = memory.prometer('fabricar 64x torch', { para: 'eduardo' })
  memory.encerrarCompromisso(promessa.id, 'feito')
  assert.equal(memory.listar('compromisso')[0].estado, 'feito')
})

test('Memory respeita limite descartando os fatos mais antigos', () => {
  let clock = Date.parse('2026-01-01T00:00:00Z')
  const memory = newMemory({ maxItems: 10, now: () => clock })
  memory.lembrarLugar('casa', dito('eduardo'))
  memory.definirPreferencia('tochas.quantidade', 32, dito('eduardo'))
  for (let i = 0; i < 20; i++) {
    clock += 1000
    memory.registrarFato(`fato ${i}`, { assunto: 'teste' }, visto())
  }
  assert.equal(memory.items.length, 10)
  assert.ok(memory.lugar('casa'), 'lugar não é descartado antes dos fatos')
  assert.equal(memory.preferencia('tochas.quantidade'), 32)
  const fatos = memory.listar('fato').map((f) => f.descricao)
  assert.equal(fatos.length, 8)
  assert.equal(fatos[0], 'fato 19')
  assert.ok(!fatos.includes('fato 0'))
})

test('Memory faz fatos expirarem', () => {
  let clock = Date.parse('2026-01-01T00:00:00Z')
  const memory = newMemory({ now: () => clock })
  memory.registrarFato('vi iron_ore em 1,2,3', { assunto: 'minerio:iron_ore', ttlMs: 60000 }, visto())
  memory.registrarFato('fato eterno', { assunto: 'x' }, visto())
  assert.equal(memory.listar('fato').length, 2)
  clock += 61000
  assert.deepEqual(memory.listar('fato').map((f) => f.descricao), ['fato eterno'])
  memory.prune()
  assert.equal(memory.items.length, 1)
})

test('Memory salva e carrega do disco', async () => {
  const file = tmpFile()
  const memory = new Memory({ filePath: file, autoSave: false })
  const waypoints = new WaypointManager()
  waypoints.save('mina', { x: 8, y: 20, z: -5 }, 'overworld')
  memory.lembrarLugar('mina', dito('eduardo'))
  memory.definirPreferencia('comida.preferida', 'cooked_beef', dito('eduardo'))
  memory.registrarFato('morri em 1,2,3 por creeper', { assunto: 'morte', posicao: { x: 1, y: 2, z: 3 } }, visto())
  await memory.save()

  const loaded = await new Memory({ filePath: file, autoSave: false }).load()
  assert.equal(loaded.lugar('mina').origem.quem, 'eduardo')
  assert.equal(Object.hasOwn(loaded.lugar('mina'), 'posicao'), false)
  assert.equal(new WaypointManager(waypoints.exportState()).get('mina').position.y, 20)
  assert.equal(loaded.preferencia('comida.preferida'), 'cooked_beef')
  assert.equal(loaded.buscarFatos('morte')[0].posicao.z, 3)
  const next = loaded.registrarFato('outro', {}, visto())
  assert.ok(next.id > Math.max(...memory.items.map((i) => i.id)))

  await fs.promises.writeFile(file, '{quebrado', 'utf8')
  const broken = await new Memory({ filePath: file, autoSave: false }).load()
  assert.ok(broken.lastLoadError)
  assert.equal(broken.items.length, 0)
})

test('reinício restaura coordenadas pelo StateStore e metadados sem coordenadas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-mbot-restart-'))
  const memoryPath = path.join(dir, 'memory.json')
  const statePath = path.join(dir, 'state.json')
  const waypoints = new WaypointManager()
  const entry = waypoints.save('casa', { x: -20, y: 70, z: 4 }, 'overworld')
  const memory = new Memory({ filePath: memoryPath, autoSave: false })
  memory.lembrarLugar(entry.name, dito('eduardo'), 'local principal')
  await memory.save()
  await new StateStore(statePath).save({ waypoints: waypoints.exportState() })

  const restartedState = await new StateStore(statePath).load()
  const restartedWaypoints = new WaypointManager(restartedState.waypoints)
  const restartedMemory = await new Memory({ filePath: memoryPath, autoSave: false }).load()
  assert.deepEqual(restartedWaypoints.get('casa').position, { x: -20, y: 70, z: 4 })
  assert.equal(restartedMemory.lugar('casa').origem.quem, 'eduardo')
  assert.equal(Object.hasOwn(restartedMemory.lugar('casa'), 'posicao'), false)
  assert.equal(Object.hasOwn(restartedMemory.lugar('casa'), 'dimensao'), false)
})

test('parseValor e tipoDe interpretam o chat', () => {
  assert.equal(parseValor('64'), 64)
  assert.equal(parseValor('sim'), true)
  assert.equal(parseValor('cooked_beef'), 'cooked_beef')
  assert.equal(tipoDe('Lugares'), 'lugar')
  assert.equal(tipoDe('preferências'), 'preferencia')
  assert.equal(tipoDe('xyz'), null)
  assert.match(formatar({ tipo: 'fato', descricao: 'vi x', origem: visto() }), /^vi x \[visto agora\]$/)
})

test('resolveReference: exato, único, ambíguo, parecido e preferido', () => {
  const entries = [
    { name: 'casa', position: { x: -300, y: 64, z: -520 } },
    { name: 'casa-velha', position: { x: 120, y: 70, z: 5 } },
    { name: 'mina-de-ferro', position: { x: 1, y: 12, z: 1 } }
  ]
  const amb = resolveReference('casa', entries)
  assert.equal(amb.match, null)
  assert.equal(amb.reason, 'ambiguo')
  assert.deepEqual(amb.candidates.map((e) => e.name), ['casa', 'casa-velha'])

  assert.equal(resolveReference('casa velha', entries).match.name, 'casa-velha')
  assert.equal(resolveReference('mina', entries).match.name, 'mina-de-ferro')
  assert.equal(resolveReference('mina', entries).reason, 'unico')

  const typo = resolveReference('csa', entries)
  assert.equal(typo.reason, 'parecido')
  assert.equal(typo.candidates[0].name, 'casa')

  assert.equal(resolveReference('castelo', entries).reason, 'nenhum')
  const pref = resolveReference('casa', entries, { preferido: 'casa-velha' })
  assert.equal(pref.reason, 'preferido')
  assert.equal(pref.match.name, 'casa-velha')

  assert.equal(resolveReference('casa', [entries[0]]).reason, 'exato')
})

test('blockVariants separa nomes exatos de palavras ambíguas', () => {
  const registry = { iron_ore: {}, deepslate_iron_ore: {}, stone: {} }
  assert.deepEqual(blockVariants('iron_ore', registry), ['iron_ore'])
  assert.deepEqual(blockVariants('ferro', registry), ['iron_ore', 'deepslate_iron_ore'])
  assert.deepEqual(blockVariants('pedra', registry), ['stone'])
  assert.deepEqual(blockVariants('xyz', registry), [])
  assert.ok(searchTerms('diamante').includes('diamond'))
})

function clarifier(timeoutMs = 1000) {
  const said = []
  return { said, c: new Clarifier({ say: (t) => said.push(t), timeoutMs }) }
}

test('Clarifier: resposta por número', async () => {
  const { said, c } = clarifier()
  const promise = c.ask('Qual casa?', ['casa (-300,64)', 'casa velha (120,70)'], { who: 'eduardo' })
  assert.equal(said[0], 'Qual casa? 1) casa (-300,64) 2) casa velha (120,70)')
  assert.equal(c.handleMessage('outro', '1'), false, 'ignora outros jogadores')
  assert.equal(c.handleMessage('eduardo', '2'), true)
  assert.deepEqual(await promise, { index: 1, option: 'casa velha (120,70)' })
  assert.equal(c.isPending(), false)
  assert.equal(c.handleMessage('eduardo', '2'), false)
})

test('Clarifier: resposta por nome e prefixo', async () => {
  const { c } = clarifier()
  let promise = c.ask('Qual casa?', ['casa (-300,64)', 'casa velha (120,70)'])
  assert.equal(c.handleMessage('eduardo', 'Casa'), true)
  assert.equal((await promise).index, 0)

  promise = c.ask('Qual casa?', ['casa (-300,64)', 'casa velha (120,70)'])
  assert.equal(c.handleMessage('eduardo', 'casa v'), true)
  assert.equal((await promise).index, 1)

  // Local salvo com hífen responde ao nome com espaço.
  promise = c.ask('Qual casa?', ['casa (1,2,3)', 'casa-velha (4,5,6)'])
  assert.equal(c.handleMessage('eduardo', 'Casa Velha'), true)
  assert.equal((await promise).index, 1)
})

test('Clarifier: pergunta opcional expira em silêncio', async () => {
  const { said, c } = clarifier(20)
  const answer = await c.confirm('Usar sempre essa? sim/não', { quiet: true })
  assert.equal(answer, null)
  assert.deepEqual(said, ['Usar sempre essa? sim/não'])
})

test('Clarifier: resposta inválida, cancelamento e comando novo', async () => {
  const { said, c } = clarifier()
  let promise = c.ask('Qual?', ['a', 'b'])
  assert.equal(c.handleMessage('eduardo', 'hmm'), true)
  assert.match(said.at(-1), /número \(1-2\)/)
  assert.equal(c.handleMessage('eduardo', 'nenhum'), true)
  assert.equal(await promise, null)

  promise = c.ask('Qual?', ['a', 'b'])
  assert.equal(c.handleMessage('eduardo', '!seguir'), false, 'comando segue para o roteador')
  assert.equal(await promise, null)
})

test('Clarifier: sim/não e timeout', async () => {
  const { said, c } = clarifier(30)
  let promise = c.confirm('Usar sempre essa? sim/não')
  c.handleMessage('eduardo', 'sim')
  assert.equal(await promise, true)
  promise = c.confirm('Usar sempre essa? sim/não')
  c.handleMessage('eduardo', 'não')
  assert.equal(await promise, false)

  promise = c.ask('Qual?', ['a', 'b'])
  assert.equal(await promise, null)
  assert.match(said.at(-1), /Sem resposta/)

  // Nova pergunta substitui a anterior.
  const first = c.ask('Primeira?', ['a'])
  const second = c.ask('Segunda?', ['b'])
  assert.equal(await first, null)
  c.handleMessage('eduardo', '1')
  assert.equal((await second).option, 'b')
})

// ---------- captura automática com bot falso ----------

function fakeBot() {
  const bot = new EventEmitter()
  bot.username = 'eduardo_bot'
  bot.game = { dimension: 'overworld' }
  bot.entity = { position: { x: 10.5, y: 64, z: -3.2 } }
  bot.registry = { blocksByName: { diamond_ore: { id: 1 }, iron_ore: { id: 2 }, stone: { id: 3 } } }
  bot.world = new Map()
  bot.findBlocks = ({ matching }) => [...bot.world.values()]
    .filter((b) => matching.includes(bot.registry.blocksByName[b.name].id))
    .map((b) => b.position)
  bot.blockAt = (p) => bot.world.get(`${p.x},${p.y},${p.z}`) || null
  bot.findBlock = () => ({ name: 'red_bed', position: { x: 11, y: 64, z: -4 } })
  bot.activated = []
  bot.activateBlock = async (block) => { bot.activated.push(block.name) }
  return bot
}

function put(bot, name, x, y, z) {
  bot.world.set(`${x},${y},${z}`, { name, position: { x, y, z } })
}

test('captura: morte com causa, minérios, cama e estações', async () => {
  const bot = fakeBot()
  const memory = newMemory()
  const waypoints = new WaypointManager()
  const capture = attachMemoryCapture(bot, memory, {
    scanMs: 0,
    rememberWaypoint: (name, position, dimension, context, provenance) => {
      waypoints.save(name, position, dimension)
      memory.lembrarLugar(name, provenance, context)
    }
  })

  bot.emit('entityHurt', bot.entity, { name: 'creeper' })
  bot.emit('death')
  assert.equal(memory.buscarFatos('morte')[0].descricao, 'morri em 10,64,-4 por creeper')

  bot.emit('death')
  bot.emit('messagestr', 'eduardo_bot was shot by Skeleton')
  assert.equal(memory.buscarFatos('morte')[0].descricao, 'morri em 10,64,-4 por skeleton')

  put(bot, 'diamond_ore', 1, 12, 1)
  put(bot, 'diamond_ore', 2, 12, 1) // vizinho: mesmo veio, não duplica
  put(bot, 'iron_ore', 40, 30, 40)
  put(bot, 'stone', 5, 5, 5)
  assert.equal(capture.scanOres(), 2)
  assert.equal(capture.scanOres(), 0, 'não repete o que já anotou')
  assert.equal(memory.buscarFatos('diamond').length, 1)

  bot.emit('blockUpdate', { name: 'diamond_ore', position: { x: 1, y: 12, z: 1 } }, { name: 'air' })
  assert.equal(memory.buscarFatos('diamond').length, 0, 'minério minerado some da memória')

  bot.emit('sleep')
  assert.deepEqual(waypoints.get('auto-cama').position, { x: 11, y: 64, z: -4 })
  assert.equal(memory.lugar('auto-cama').origem.tipo, 'visto')
  assert.equal(Object.hasOwn(memory.lugar('auto-cama'), 'posicao'), false)

  await bot.activateBlock({ name: 'chest', position: { x: 3, y: 64, z: 3 } })
  await bot.activateBlock({ name: 'stone', position: { x: 3, y: 64, z: 3 } })
  assert.deepEqual(bot.activated, ['chest', 'stone'], 'a chamada original continua acontecendo')
  assert.equal(waypoints.get('auto-estacao-bau').position.x, 3)
  assert.equal(memory.lugar('auto-estacao-bau').dimensao, undefined)
  assert.equal(memory.lugar('auto-estacao-bau').contexto, 'baú utilizado')
  capture.stop()
})
