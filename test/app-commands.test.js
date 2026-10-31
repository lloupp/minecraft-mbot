const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')

const { CommandRouter } = require('../core/CommandRouter')
const { Memory } = require('../core/Memory')
const { WaypointManager } = require('../core/WaypointManager')
const { Clarifier } = require('../core/Clarifier')
const { createPlaces } = require('../app/places')
const { createCompanion } = require('../app/companion')
const { registerAllCommands, attachChat } = require('../app/commands')

// Bot falso com o mínimo que os comandos tocam; `said` guarda o chat.
function fakeBot() {
  const bot = new EventEmitter()
  Object.assign(bot, {
    username: 'eduardo_bot',
    said: [],
    chat(text) { this.said.push(text) },
    quitCalled: false,
    quit() { this.quitCalled = true },
    players: { dono: { entity: { position: new Vec3(1, 64, 1) } } },
    entity: { position: new Vec3(0, 64, 0) },
    game: { dimension: 'overworld' },
    health: 20,
    food: 20,
    version: '1.20.1',
    inventory: { items: () => [] },
    registry: {
      blocksByName: { stone: { name: 'stone' }, iron_ore: { name: 'iron_ore' }, deepslate_iron_ore: { name: 'deepslate_iron_ore' } },
      itemsByName: {}
    },
    pathfinder: { goal: null, setGoal(goal) { this.goal = goal }, setMovements() {}, goto: () => new Promise(() => {}) },
    nearestEntity: () => null,
    _client: { protocolVersion: 763 }
  })
  return bot
}

function harness({ storageConfigured = false, farmers = 0 } = {}) {
  const bot = fakeBot()
  const calls = []
  const record = (name, value) => (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value }
  const memory = new Memory({ autoSave: false })
  const waypointManager = new WaypointManager()
  const clarifier = new Clarifier({ say: (text) => bot.chat(text), timeoutMs: 50 })
  const botManager = {
    list: () => [],
    byRole: (role) => (role === 'fazendeiro' ? Array.from({ length: farmers }, (_, i) => ({ name: `f${i}` })) : []),
    get: () => null,
    capacity: () => 10,
    create: record('botManager.create', async (role, n) => Array.from({ length: n }, (_, i) => ({ name: `${role}${i}` }))),
    remove: record('botManager.remove', (name) => name === 'ajudante1'),
    stopAll: record('botManager.stopAll')
  }
  const colony = {
    auto: false,
    setAuto: record('colony.setAuto'),
    autoReadiness: () => ({ ready: false, missing: ['base', 'estoque'] }),
    demandReport: () => ({ deficits: {} }),
    assign: record('colony.assign', async () => [{ name: 'm1' }]),
    returnAll: record('colony.returnAll', async () => []),
    taskSummary: () => [],
    buildHouse: record('colony.buildHouse', async () => 'construtor1'),
    buildFarm: record('colony.buildFarm', async () => 'fazendeiro1'),
    buildMine: record('colony.buildMine', async () => 'minerador1'),
    buildAnimalPen: record('colony.buildAnimalPen', async () => ({ name: 'construtor1' })),
    sendTo: record('colony.sendTo', async () => {}),
    exploreAt: record('colony.exploreAt', async (_pos, radius) => ({ name: 'explorador1', radius })),
    animalTargetsSnapshot: () => ({}),
    setAnimalTarget: record('colony.setAnimalTarget'),
    clearAnimalTarget: record('colony.clearAnimalTarget', () => false),
    captureAnimals: record('colony.captureAnimals', async (species, count) => ({ name: 'f0', count })),
    breedAnimals: record('colony.breedAnimals', async () => ({ name: 'f0' })),
    manageAnimalPopulation: record('colony.manageAnimalPopulation', async (s, target) => ({ name: 'f0', target })),
    collectAnimalProduct: record('colony.collectAnimalProduct', async (p, count) => ({ name: 'f0', count })),
    shearSheep: record('colony.shearSheep', async (count) => ({ name: 'f0', count })),
    craft: record('colony.craft', async () => ({ name: 'artesao1' })),
    supply: record('colony.supply', async () => {}),
    depositAll: record('colony.depositAll', async () => []),
    controllers: () => []
  }
  const storage = {
    configured: () => storageConfigured,
    snapshotFresh: () => true,
    summary: async () => ({ stone: 10 }),
    setPosition: record('storage.setPosition'),
    configureNearest: () => { throw new Error('nenhum baú perto') }
  }
  const projectManager = {
    isActive: () => false,
    definition: (type) => (type === 'casa' ? { requiredRoles: {} } : null),
    types: () => ['casa', 'fazenda'],
    status: () => null,
    cancel: () => null,
    start: record('projectManager.start')
  }
  let saves = 0
  const places = createPlaces({ bot, memory, waypointManager, clarifier })
  const companion = createCompanion({ bot, memory, botManager, places, persistSoon: () => saves++ })
  let quit = false
  const ctx = {
    bot,
    CONFIG: { host: '127.0.0.1', port: 25565 },
    serverProfile: { id: 'vanilla1201', version: '1.20.1' },
    botManager,
    colony,
    storage,
    production: {},
    projectManager,
    waypointManager,
    memory,
    worldMemory: null,
    knowledge: { describe: (name) => (name === 'stone' ? { name: 'stone', isBlock: true, isItem: true, stackSize: 64 } : null) },
    planner: { craftPlan: (name) => (name === 'stick' ? { ok: true, target: 'stick', craftable: true } : { ok: false }) },
    smokeTest: { run: async () => ({ ok: true, passed: 3, failed: 0, checks: [] }) },
    runVerifier: { verify: () => ({ passed: 1, total: 1, failed: 0, allPassed: true }) },
    eventLog: { getRecent: () => [] },
    statusServer: { port: 3080 },
    maxColonyBots: 12,
    homeProvider: () => waypointManager.get('base')?.position || null,
    homeDimension: () => waypointManager.get('base')?.dimension || null,
    persistState: async () => { saves++ },
    persistSoon: () => { saves++ },
    ensureProjectWorkers: record('ensureProjectWorkers', async () => []),
    requestQuit: () => { quit = true },
    places,
    companion
  }
  const router = registerAllCommands(new CommandRouter(), ctx)
  const say = async (message, username = 'dono') => {
    bot.said.length = 0
    const handled = await router.dispatch({ bot, username }, message)
    return { handled, said: [...bot.said] }
  }
  return { bot, ctx, router, say, calls, companion, memory, waypointManager, saves: () => saves, quit: () => quit }
}

// Todos os comandos citados no !ajuda precisam existir no router.
test('todo comando listado no !ajuda está registrado', async () => {
  const { router, say } = harness()
  const { said } = await say('!ajuda')
  const listed = new Set(said.join(' ').match(/!([a-zà-ú]+)/g).map((cmd) => cmd.slice(1)))
  assert.ok(listed.size > 40)
  for (const cmd of listed) assert.ok(router.commands.has(cmd), `!${cmd} não registrado`)
})

test('comandos sem argumento obrigatório respondem com uso, sem lançar', async () => {
  const { say } = harness()
  const usage = {
    '!ordem': 'Uso: !ordem', '!todos': 'Uso: !todos voltar', '!construir': 'Uso: !construir',
    '!ir': 'Uso: !ir', '!patrulha x': 'Uso: !patrulha', '!enviar': 'Uso: !enviar', '!explorar': 'Uso: !explorar',
    '!capturar': 'Uso: !capturar', '!reproduzir': 'Uso: !reproduzir', '!manejo': 'Uso: !manejo',
    '!produto': 'Uso: !produto', '!fabricar': 'Uso: !fabricar', '!abastecer': 'Uso: !abastecer', '!bot': 'Uso: !bot',
    '!item': 'Uso: !item', '!receita': 'Uso: !receita', '!lembrar': 'Uso: !lembrar', '!esquecer': 'Uso: !esquecer',
    '!onde': 'Uso: !onde', '!minerar': 'Uso: !minerar', '!memoria xyz': 'Uso: !memoria', '!curral meta': 'Uso: !curral meta',
    '!local salvar': 'Uso: !local salvar', '!local remover': 'Uso: !local remover', '!base xyz': 'Uso: !base'
  }
  for (const [message, expected] of Object.entries(usage)) {
    const { handled, said } = await say(message)
    assert.equal(handled, true, message)
    assert.ok(said.some((line) => line.startsWith(expected)), `${message}: ${JSON.stringify(said)}`)
  }
})

test('!seguir, !ficar e !cancelar trocam o modo e desligam o autônomo', async () => {
  const { say, companion, saves } = harness()
  companion.autonomous = true
  assert.deepEqual((await say('!ficar')).said, ['Ok, fico aqui.'])
  assert.equal(companion.mode, 'ficar')
  assert.equal(companion.autonomous, false)
  assert.deepEqual((await say('!seguir')).said, ['Seguindo você!'])
  assert.equal(companion.mode, 'seguir')
  await say('!cancelar')
  assert.equal(companion.mode, 'seguir')
  assert.ok(saves() >= 3)
})

test('!autonomo liga e !autonomo OFF desliga (argumento em maiúsculas)', async () => {
  const { say, companion } = harness()
  assert.match((await say('!autonomo')).said[0], /^Modo autônomo ligado!/)
  assert.equal(companion.autonomous, true)
  await say('!autônomo OFF')
  assert.equal(companion.autonomous, false)
})

test('!parar pede saída limpa, salva e desconecta', async () => {
  const { say, bot, quit, calls } = harness()
  await say('!parar')
  assert.equal(quit(), true)
  assert.equal(bot.quitCalled, true)
  assert.ok(calls.some(([name]) => name === 'botManager.stopAll'))
})

test('!base aqui salva a posição do dono e !base status mostra', async () => {
  const { say, waypointManager, memory } = harness()
  assert.match((await say('!base')).said[0], /^Base ainda não definida/)
  assert.match((await say('!base aqui')).said[0], /^Este local agora é a base: X=1, Y=64, Z=1 \| overworld/)
  assert.deepEqual(waypointManager.get('base').position, { x: 1, y: 64, z: 1 })
  assert.ok(memory.lugar('base'))
  assert.match((await say('!base status')).said[0], /^Base: X=1, Y=64, Z=1/)
})

test('!local salvar / listar / remover', async () => {
  const { say } = harness()
  assert.match((await say('!local salvar mina')).said[0], /^Local mina salvo/)
  assert.match((await say('!local')).said[0], /^mina\(1,64,1\)/)
  assert.deepEqual((await say('!local remover mina')).said, ['Local mina removido.'])
  assert.deepEqual((await say('!local')).said, ['Nenhum local salvo. Use !local salvar <nome>.'])
})

test('!ir para local conhecido inicia a viagem; desconhecido explica', async () => {
  const { say, companion } = harness()
  await say('!local salvar mina')
  assert.match((await say('!ir mina')).said[0], /^Indo para mina/)
  assert.equal(companion.taskName, 'ir para mina')
  assert.match((await say('!ir lua')).said[0], /^Não conheço "lua"/)
})

test('!patrulha valida locais e !patrulha off encerra', async () => {
  const { say, companion } = harness()
  assert.deepEqual((await say('!patrulha a b')).said, ['Não encontrei o local a.'])
  await say('!local salvar a')
  await say('!local salvar b')
  assert.match((await say('!patrulha a b')).said[0], /^Patrulha iniciada: a -> b/)
  assert.equal(companion.patrolActive, true)
  assert.match((await say('!patrulha')).said[0], /^Patrulha ativa: a -> b/)
  assert.deepEqual((await say('!patrulha off')).said, ['Patrulha encerrada.'])
  assert.equal(companion.patrolActive, false)
  assert.equal(companion.mode, 'ficar')
})

test('!colonia auto recusa sem base/estoque e !colonia auto off desliga', async () => {
  const { say, calls } = harness()
  assert.match((await say('!colonia auto')).said[0], /Falta definir: base, estoque/)
  await say('!colonia auto off')
  assert.ok(calls.some(([name, value]) => name === 'colony.setAuto' && value === false))
  assert.match((await say('!bots')).said[0], /^Colônia: 1\/12/)
})

test('!ordem, !construir e !explorar delegam ao orquestrador', async () => {
  const { say, calls } = harness()
  assert.deepEqual((await say('!ordem mineradores ferro 64')).said, ['Ordem enviada a 1 bot(s): ferro x64.'])
  assert.match((await say('!construir casa')).said[0], /construtor1 recebeu a ordem de construir um abrigo/)
  assert.match((await say('!construir mina 20')).said[0], /mina de 20 blocos/)
  await say('!base aqui')
  assert.match((await say('!explorar base 30')).said[0], /^explorador1 vai explorar ao redor de base \(raio 30\)/)
  assert.ok(calls.some(([name]) => name === 'colony.exploreAt'))
})

test('!bot criar e !bot remover passam pelo BotManager', async () => {
  const { say } = harness()
  assert.deepEqual((await say('!bot criar minerador 2')).said, ['Criados 2: minerador0, minerador1'])
  assert.deepEqual((await say('!bot remover ajudante1')).said, ['ajudante1 removido da colônia.'])
  assert.deepEqual((await say('!bot remover ninguem')).said, ['Não encontrei ninguem.'])
})

test('comandos de animais: sem base, sem fazendeiro e delegação', async () => {
  const solo = harness()
  assert.deepEqual((await solo.say('!capturar vaca')).said, ['Base ainda não definida. Use !base aqui.'])
  assert.match((await solo.say('!produto leite')).said[0], /^Preciso de um fazendeiro/)
  assert.match((await solo.say('!animais')).said[0], /^Não vejo animais suportados/)
  const farm = harness({ farmers: 1 })
  await farm.say('!base aqui')
  assert.deepEqual((await farm.say('!capturar vaca 3')).said, ['f0 vai levar até 3 cow para o curral.'])
  assert.match((await farm.say('!reproduzir ovelha 2')).said[0], /^f0 vai tentar reproduzir 2 par/)
  assert.match((await farm.say('!manejo porco 8')).said[0], /^f0 vai manejar pig com meta de 8/)
  assert.match((await farm.say('!tosquiar 4')).said[0], /^f0 vai tentar tosquiar até 4/)
  assert.match((await farm.say('!curral meta vaca 6')).said[0], /^Meta automática de cow: 6/)
})

test('!estoque sem configuração e !fabricar via colônia', async () => {
  const solo = harness()
  assert.match((await solo.say('!estoque')).said[0], /^Estoque não configurado/)
  assert.match((await solo.say('!estoque aqui')).said[0], /^Não consegui definir o estoque: nenhum baú perto/)
  const colony = harness({ storageConfigured: true })
  assert.deepEqual((await colony.say('!estoque')).said, ['stonex10'])
  assert.deepEqual((await colony.say('!fabricar tocha 3')).said, ['artesao1 vai fabricar 3x torch e guardar no estoque.'])
})

test('!item e !receita consultam o conhecimento do jogo', async () => {
  const { say } = harness()
  assert.deepEqual((await say('!item stone')).said, ['stone: bloco | item | pilha 64'])
  assert.match((await say('!item nada')).said[0], /^Não encontrei "nada"/)
  assert.match((await say('!receita stick')).said[0], /^Consigo fabricar 1x stick/)
})

test('memória: preferência, lugar, anotação, !onde e !esquecer', async () => {
  const { say, memory } = harness()
  assert.deepEqual((await say('!lembrar seguir.distancia = 4')).said, ['Anotado: seguir.distancia=4.'])
  assert.equal(memory.preferenciaNumero('seguir.distancia', 2, 1, 16), 4)
  assert.match((await say('!lembrar casa aqui')).said[0], /^Vou lembrar: casa/)
  assert.deepEqual((await say('!lembrar o portal fica no norte')).said, ['Anotado.'])
  assert.match((await say('!onde casa')).said[0], /^casa /)
  assert.match((await say('!memoria')).said[0], /^Memória: /)
  assert.deepEqual((await say('!esquecer casa')).said, ['Esqueci casa.'])
})

test('!status, !pos, !servidor, !metas e !verify', async () => {
  const { say } = harness()
  assert.match((await say('!status')).said[0], /^HP: 20\/20 \| Fome: 20\/20 \| Itens: 0 \| Modo: seguir/)
  assert.deepEqual((await say('!pos')).said, ['X=0.0, Y=64.0, Z=0.0'])
  assert.match((await say('!servidor')).said[0], /^Servidor: 127\.0\.0\.1:25565 .* protocolo 763/)
  assert.ok((await say('!metas')).said[0])
  assert.deepEqual((await say('!verify')).said, ['Verificação: 1/1 passaram, 0 falharam', 'All passed: SIM'])
  assert.match((await say('!status server')).said[0], /^Status server/)
})

test('!smoke roda o smoke test e relata', async () => {
  const { say } = harness()
  assert.deepEqual((await say('!smoke')).said, ['Executando smoke test da colônia...', 'Smoke: PASSOU | 3 ok | 0 falha(s).'])
})

test('chat: só o dono comanda; sem dono, o primeiro a falar vira dono', async () => {
  const { bot, ctx, router, companion } = harness()
  attachChat({ bot, botManager: ctx.botManager, clarifier: new Clarifier(), commandRouter: router, companion })
  bot.players = {}
  bot.emit('chat', 'alguem', '!pos')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(companion.resolvedOwner, 'alguem')
  assert.deepEqual(bot.said, ['X=0.0, Y=64.0, Z=0.0'])
  bot.said.length = 0
  bot.emit('chat', 'intruso', '!parar')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(bot.quitCalled, false)
  bot.emit('chat', 'eduardo_bot', '!pos')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bot.said, [])
})
