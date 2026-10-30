// minecraft-mbot/index.js
// Bot de automação Minecraft Forge 26.3 (protocolo 777)
//
// INSTRUÇÕES:
// 1. Abra o Minecraft via TLauncher, entre no mundo "Novo mundo"
// 2. No jogo, pressione Esc > "Abrir para LAN" (permite cheats)
// 3. Rode este arquivo: node index.js
//    A porta LAN e a versão do jogo são detectadas automaticamente.

// Preserve the local project .env and explicit shell overrides.
const path = require('path')
const { loadLocalEnv, connectionSettings } = require('./lib/connection-config')
loadLocalEnv(path.join(__dirname, '.env'))
const CONNECTION = connectionSettings()
const { canAutomaticDeposit } = require('./lib/idle-deposit')
const { createReplacementChest } = require('./lib/storage-recovery')

const { execFileSync } = require('child_process')
const mineflayer = require('mineflayer')
const { ping } = require('minecraft-protocol')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const food = require('./lib/food')
const { WorldMemory } = require('./lib/world-memory')
const perception = require('./lib/perception')
const situation = require('./lib/situation')
const climb = require('./lib/climb')
const { detectProfile, configureClient, describeProfile } = require('./lib/serverProfile')
const { announceLan, motdText } = require('./lib/lan')
const { CommandRouter } = require('./core/CommandRouter')
const { MinecraftKnowledge } = require('./core/MinecraftKnowledge')
const { Planner } = require('./core/Planner')
const { BotManager } = require('./core/BotManager')
const craft = require('./lib/craft')
const gather = require('./lib/gather')
const combat = require('./lib/combat')
const equipment = require('./lib/equipment')
const night = require('./lib/night')
const handover = require('./lib/handover')
const deepmine = require('./lib/deepmine')
const farm = require('./lib/farm')
const oreMission = require('./lib/ore-mission')
const fear = require('./lib/fear-mode')
const invincible = require('./lib/invincible')
const pathGuard = require('./lib/path-guard')
const unstick = require('./lib/unstick')
const sleepWatch = require('./lib/sleep-watch')
const resumeTask = require('./lib/resume-task')
const bedLib = require('./lib/bed')
const husbandry = require('./lib/husbandry')
const animalProducts = require('./lib/animalProducts')
const { Autonomy } = require('./lib/autonomy')
const { loadPlugins, startWebViews } = require('./lib/plugins')
const { createBot } = require('./lib/botFactory')
const { WorkerController } = require('./core/WorkerController')
const { ColonyOrchestrator } = require('./core/ColonyOrchestrator')
const { StorageManager } = require('./core/StorageManager')
const { ProductionManager, normalizeItemName } = require('./core/ProductionManager')
const { DemandPlanner } = require('./core/DemandPlanner')
const { ProjectManager } = require('./core/ProjectManager')
const { StateStore } = require('./core/StateStore')
const { SmokeTest } = require('./core/SmokeTest')
const { LayaShadowObserver } = require('./lib/laya-shadow')
const { JuliaShadowObserver } = require('./lib/julia-shadow')
const { JuliaAuthority } = require('./lib/julia-authority')
const { combineShadows } = require('./lib/shadow-fanout')
const { WaypointManager, normalizeWaypointName } = require('./core/WaypointManager')
const { Memory, TIPOS, dito, inferido, tipoDe, normalizarChave, parseValor, fmtPos, fmtOrigem } = require('./core/Memory')
const { resolveReference, blockVariants, searchTerms } = require('./core/References')
const { Clarifier } = require('./core/Clarifier')
const { attachMemoryCapture } = require('./lib/memoryCapture')
const { groundedPenPlan, pointInsidePen, inspectAnimalPen } = require('./core/AnimalPen')
const blueprint = require('./lib/blueprint')
const { buildBlueprint, describeReport } = require('./lib/blueprintBuilder')
const { getEventLog } = require('./lib/event-log')
const { StatusServer } = require('./lib/status-server')
const { RunVerifier } = require('./core/RunVerifier')
const { startToolApiRuntime } = require('./lib/tool-api-runtime')
const { describeBot, describeWorkers, ConsoleBuffer } = require('./lib/dashboard-snapshot')
const { RequestQueue } = require('./core/RequestQueue')
const preflight = require('./lib/preflight')
const missionSpec = require('./lib/mission-spec')
const { VERIFIERS } = require('./lib/verifiers')
const capabilities = require('./core/Capabilities')
const { MissionStore } = require('./core/MissionStore')
const { MissionRunner } = require('./core/MissionRunner')
const { createExecutors } = require('./core/mission-executors')

const HOST = CONNECTION.host
const DEFAULT_PORT = 25565
// Jogador que o bot segue e obedece. Sem valor, usa o primeiro jogador online.
const OWNER = CONNECTION.owner

const FOLLOW_DISTANCE = 2   // blocos de distância ao seguir o dono
const FLEE_DISTANCE = 16    // distância que tenta manter do agressor
const FLEE_MS = 4000        // tempo fugindo depois de tomar dano
const DEFEND_RANGE = 5      // hostil mais perto que isso: o bot reage (luta ou foge)
const CREEPER_RANGE = 6     // creeper mais perto que isso: foge antes que exploda
const CHAIN_RANGE = 8       // depois de matar, emenda luta com hostil até essa distância
const CHAIN_FIGHTS = 6      // máximo de lutas emendadas numa mesma tarefa
const HUNGRY = 14           // abaixo disso come (ou vai buscar comida)
const FOOD_RETRY_MS = 30000 // espera entre buscas de comida que não deram certo
const OWNER_NEAR = 32
const GEAR_CHECK_MS = 15000
const NIGHT_RETRY_MS = 60000
const EXPLORE_DISTANCE = 50
const EXPLORE_EVERY_MS = 20000

function envPort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

// Portas TCP abertas por processos Java nesta máquina (o mundo LAN usa uma
// porta aleatória a cada vez que é aberto).
function javaListeningPorts() {
  try {
    const out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' })
    return out.split('\n')
      .filter((line) => line.includes('"java"'))
      .map((line) => envPort(line.split(/\s+/)[3]?.split(':').pop()))
      .filter(Boolean)
  } catch {
    return []
  }
}

function pingServer(port) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000)
    ping({ host: HOST, port }, (err, res) => {
      clearTimeout(timer)
      resolve(err || !res?.version ? null : { port, version: res.version.name, motd: motdText(res.description), forgeData: res.forgeData })
    })
  })
}

// Encontra o servidor: MINECRAFT_PORT, senão portas Java locais, senão 25565.
async function findServer() {
  const candidates = CONNECTION.port ? [CONNECTION.port]
    : CONNECTION.local ? [...javaListeningPorts(), DEFAULT_PORT] : [DEFAULT_PORT]
  for (const port of [...new Set(candidates)]) {
    const server = await pingServer(port)
    if (server) return server
  }
  return null
}

// Visualizações para o painel: sem funções, só porta/endereço/estado.
function publicViews(views) {
  if (!views) return null
  const pick = (view) => view && { port: view.port, address: view.address, status: view.status, error: view.error }
  return { viewer: pick(views.viewer), inventory: pick(views.inventory) }
}

async function main() {
  // Painel de testes local (opt-in). Captura o console desde o início para o painel mostrar a conexão.
  const dashboardEnabled = process.env.MBOT_DASHBOARD === '1'
  const consoleBuffer = dashboardEnabled ? new ConsoleBuffer().capture() : null
  const server = await findServer()
  if (!server) {
    console.error(`Nenhum servidor Minecraft respondeu em ${HOST}${CONNECTION.port ? ':' + CONNECTION.port : ''}. Verifique o endereço, a porta, o firewall e se o servidor permite consultas de status. Configure MINECRAFT_HOST e MINECRAFT_PORT no .env ou no ambiente.`)
    process.exit(1)
  }

  // ========== CONFIGURAÇÃO ==========
  const requestedVersion = process.env.MINECRAFT_VERSION || server.version
  const serverProfile = detectProfile(requestedVersion)
  // Necessário para escolher o handshake FML3 correto (Forge 1.20.1).
  serverProfile.forgeData = server.forgeData
  const CONFIG = {
    host: HOST,
    port: server.port,
    username: CONNECTION.username,
    password: '',
    version: serverProfile.version || requestedVersion,
    hideErrors: !process.env.DEBUG_PROTOCOL
  }
  console.log(`Conectando a ${CONFIG.host}:${CONFIG.port} (versão ${CONFIG.version})...`)
  console.log(`Perfil: ${describeProfile(serverProfile)}`)

  // ========== CRIAÇÃO DO BOT ==========
  const bot = createBot(mineflayer, CONFIG)
  // MBOT_INVINCIBLE=1: o principal dá efeitos infinitos a si e a cada ajudante ao entrar no mundo.
  const invincibility = invincible.enabled() ? new invincible.Invincibility({ commander: () => bot }) : null
  if (invincibility) {
    console.log('[invencível] ligado: efeitos infinitos para o bot e os ajudantes (precisa de /op)')
    invincibility.watch(bot, CONFIG.username)
  }
  configureClient(bot, serverProfile)

  // Servidor dedicado neste PC não aparece sozinho em "Jogos em LAN"; o bot anuncia.
  let stopLan = () => {}
  if (process.env.MINECRAFT_LAN_ANNOUNCE === '1') {
    if (['127.0.0.1', 'localhost'].includes(HOST)) {
      stopLan = announceLan({ motd: process.env.MINECRAFT_LAN_MOTD || server.motd || 'Servidor', port: server.port })
    } else {
      console.log('[lan] anúncio só funciona para servidor neste PC (MINECRAFT_HOST local)')
    }
  }
  bot.loadPlugin(pathfinder)
  loadPlugins(bot)
  const clarifier = new Clarifier({ say: (text) => bot.chat(text) })

  // ========== ORQUESTRAÇÃO ==========
  const knowledge = new MinecraftKnowledge(bot)
  const planner = new Planner(bot, knowledge)
  const commandRouter = new CommandRouter()
  const storage = new StorageManager()
  const production = new ProductionManager({ storage })
  const demandPlanner = new DemandPlanner()
  const stateStore = new StateStore()
  const savedState = await stateStore.load()
  if (stateStore.lastLoadError) {
    console.log(`[estado] ${stateStore.lastLoadError.message}; restauração automática desativada e arquivo preservado. Salvamento bloqueado até recuperação manual e reinício.`)
  }
  // Memória tipada (lugares, preferências, compromissos, fatos) com proveniência.
  const memory = await new Memory().load()
  if (memory.lastLoadError) console.log('[memória] arquivo inválido; iniciando com memória vazia')
  // Tarefas não sobrevivem a um reinício: compromissos pendentes ficam interrompidos.
  for (const item of memory.listar('compromisso')) {
    if (item.estado === 'pendente') memory.encerrarCompromisso(item.id, 'interrompido')
  }
  console.log(`[memória] ${memory.items.length} item(ns) carregado(s)`)
  if (savedState.storage) storage.setPosition(savedState.storage)
  if (savedState.storage) storage.setExtras(savedState.storageExtras)
  const waypointManager = new WaypointManager(savedState.waypoints)
  // Migra o campo legado uma vez; depois disso o WaypointManager é a fonte canônica.
  waypointManager.restoreLegacyBase(savedState.home, savedState.homeDimension)
  const homeProvider = () => waypointManager.get('base')?.position || null
  const homeDimension = () => waypointManager.get('base')?.dimension || null
  // Memória espacial do mundo (MBOT_WORLD_MEMORY=1 coleta/persiste; MBOT_WORLD_MEMORY_GUIDE=1 deixa
  // a memória orientar destinos). base/storage continuam vindo dos providers acima: sem fonte duplicada.
  const worldMemory = process.env.MBOT_WORLD_MEMORY === '1'
    ? new WorldMemory({
      file: process.env.MBOT_WORLD_MEMORY_FILE || '.data/world-memory.json',
      logger: console,
      providers: {
        base: () => {
          const p = waypointManager.get('base')
          return p ? { ...p.position, dimension: p.dimension } : null
        },
        storage: () => {
          const p = storage.getPosition()
          return p ? { ...p, dimension: homeDimension() } : null
        }
      }
    }).load()
    : null
  if (worldMemory) {
    const s = worldMemory.summary()
    console.log(`[world-memory] ${worldMemory.loadStatus}: ${s.places} lugar(es), ${s.explored} chunk(s) explorado(s); guia=${process.env.MBOT_WORLD_MEMORY_GUIDE === '1' ? 'on' : 'off'}`)
    process.on('exit', () => { try { worldMemory.flushSync() } catch {} })
  }
  const projectManager = new ProjectManager({
    storage,
    homeProvider
  })
  projectManager.restore(savedState.project)

  // Shadow mode do Laya: desligado por padrão (MBOT_LAYA_SHADOW=1 para ligar).
  // Só observa em paralelo (ver lib/laya-shadow.js e docs/LAYA_SHADOW_MODE.md);
  // nunca decide nem executa nada no bot real.
  const layaShadow = new LayaShadowObserver({ logger: console })
  // Shadow mode da Julia-1 (MBOT_JULIA_SHADOW=1 + JULIA_PLAYER_LOOP_URL): mesma
  // regra, sem autoridade de execução (lib/julia-shadow.js).
  const juliaShadow = new JuliaShadowObserver({ logger: console })
  const shadowObservers = combineShadows(layaShadow, juliaShadow)
  // Autoridade da Julia-1 (MBOT_JULIA_AUTHORITY=1 + JULIA_PLAYER_LOOP_URL): escolhe entre os candidatos do
  // player loop do explorador; guardrails e executor determinístico continuam valendo (lib/julia-authority.js).
  const juliaAuthority = new JuliaAuthority({ logger: console })
  if (juliaAuthority.enabled()) {
    console.log(`[julia-authority] LIGADA: ${juliaAuthority.endpoint} (timeout ${juliaAuthority.timeoutMs} ms)`)
    if (process.env.MBOT_EXPLORE_PREPARATION !== '1') console.log('[julia-authority] aviso: sem MBOT_EXPLORE_PREPARATION=1 o player loop não roda e a Julia não decide nada')
  }

  let toolApiRuntime = null
  function createWorker({ name, role }) {
    const worker = createBot(mineflayer, CONFIG, { username: name })
    configureClient(worker, serverProfile)
    worker.loadPlugin(pathfinder)
    loadPlugins(worker, { log: (msg) => console.log(`[colônia] ${name} ${msg}`) })
    worker.colonyController = new WorkerController({
      bot: worker,
      name,
      role,
      homeProvider,
      ownerProvider: () => ownerEntity(),
      storage,
      production,
      onStorageConfigured: () => persistSoon(),
      shadow: shadowObservers,
      worldMemory,
      juliaAuthority
    })
    toolApiRuntime?.attach(worker, name)

    worker.once('spawn', () => {
      console.log(`[colônia] ${name} conectado como ${role}`)
    })
    invincibility?.watch(worker, name)
    worker.on('kicked', (reason) => console.log(`[colônia] ${name} expulso:`, reason))
    worker.on('error', (err) => console.log(`[colônia] ${name} erro: ${err.message}`))
    return worker
  }

  const maxColonyBots = Math.max(1, Number.parseInt(process.env.MAX_COLONY_BOTS, 10) || 12)
  const botManager = new BotManager({
    createBot: createWorker,
    orchestratorName: CONFIG.username,
    maxBots: maxColonyBots
  })
  try {
    toolApiRuntime = await startToolApiRuntime({ botManager })
  } catch (error) {
    console.log(`[tool-api] desativada: ${error.message}`)
  }
  if (toolApiRuntime) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      quitRequested = true
      try { worldMemory?.flushSync() } catch {}
      toolApiRuntime.close().catch(error => console.log(`[tool-api] shutdown: ${error.message}`))
      bot.quit()
    })
  } else if (worldMemory) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { try { worldMemory.flushSync() } catch {} process.exit(0) })
  }
  const colony = new ColonyOrchestrator({
    botManager,
    homeProvider,
    ownerProvider: () => ownerEntity(),
    storage,
    demandPlanner,
    projectManager
  })
  colony.restoreAnimalTargets(savedState.animalTargets)
  const requestQueue = new RequestQueue({
    persist: async () => persistState(),
    candidates: () => colony.controllers().map(({ worker, controller }) => {
      const version = controller.taskVersion
      const canStart = () => controller.isIdle() && !controller.currentTask &&
        controller.taskVersion === version && !colony.autoInFlight.has(worker.name)
      return {
        name: worker.name, role: worker.role, idle: canStart(),
        run: task => controller.run(task, { canStart })
      }
    })
  })
  requestQueue.restore(savedState.requests)
  colony.requestQueue = requestQueue
  storage.onPositionChanged = () => persistSoon()
  storage.recoverContainer = (client, anchor) => {
    const controller = client.colonyController
    const ownerVersion = controller ? controller.taskVersion : taskId
    return createReplacementChest(client, anchor, () => controller
      ? controller.taskVersion !== ownerVersion : taskId !== ownerVersion)
  }

  // Baús cheios: quem está guardando faz um baú (pega tábua/tronco do estoque,
  // senão corta madeira) e o coloca ao lado do último baú.
  storage.expandContainer = async (client, anchor) => {
    const controller = client.colonyController
    const ownerVersion = controller ? controller.taskVersion : taskId
    const isCancelled = () => controller ? controller.taskVersion !== ownerVersion : taskId !== ownerVersion
    const hasChest = () => client.inventory.items().some((item) => item.name === 'chest')
    const wood = () => client.inventory.items()
      .filter((item) => /_(planks|log|stem)$/.test(item.name))
      .reduce((sum, item) => sum + item.count * (/_planks$/.test(item.name) ? 1 : 4), 0)
    if (!hasChest() && wood() < 8) {
      await storage.withdrawFirst(client, ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks'], 8).catch(() => null) ||
        await storage.withdrawFirst(client, ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'], 3).catch(() => null)
    }
    if (!hasChest() && wood() < 8) {
      console.log(`[estoque] ${client.username} vai cortar madeira para fazer outro baú`)
      if (controller?.fetchWood) await controller.fetchWood(isCancelled, 3)
      else await gather.mineBlocks(client, (name) => /_(log|stem)$/.test(name), 3, isCancelled).catch(() => 0)
    }
    if (isCancelled()) throw new Error('criação do baú cancelada')
    // Mesa: o craft acha ou coloca uma (precisa de 2 baús de madeira = 8 tábuas + 4 da mesa se não houver).
    if (!hasChest()) await craft.craftItem(client, 'chest', 1, isCancelled)
    if (!hasChest()) throw new Error('não consegui fabricar o baú')
    await storage.goNear(client, anchor)
    return createReplacementChest(client, anchor, isCancelled)
  }

  // ========== AUDITABILIDADE E RESILIÊNCIA ==========
  const eventLog = getEventLog()
  const statusPort = Number(process.env.STATUS_PORT || 3080)
  const statusServer = new StatusServer({ botManager, storage, projectManager, eventLog, port: statusPort })
  const runVerifier = new RunVerifier({ eventLog, storage, botManager, projectManager })

  // O servidor de status é opt-in. Os módulos experimentais de recovery/replanning
  // ficam disponíveis no código, mas não são ativados até integração real com workers.
  if (process.env.STATUS_SERVER === '1') statusServer.start()

  // Painel: mesmo StatusServer (rotas antigas continuam), com a página, o retrato
  // do bot/workers e os cenários do RunVerifier. Só em 127.0.0.1.
  let webViews = null
  const dashboardServer = dashboardEnabled
    ? new StatusServer({
      botManager,
      storage,
      projectManager,
      eventLog,
      port: envPort(process.env.MBOT_DASHBOARD_PORT) || 3006,
      dashboard: {
        runVerifier,
        views: () => webViews,
        snapshot: () => ({
          profile: { id: serverProfile.id, version: bot.version || serverProfile.version, server: `${CONFIG.host}:${CONFIG.port}` },
          main: describeBot(bot, { role: 'orquestrador', status: bot.entity ? 'conectado' : 'desconectado', mode, task: taskName, owner: ownerName() || null }),
          ready: Boolean(workMoves && pathGuard.ready(bot)),
          workers: describeWorkers(botManager),
          requests: requestQueue.list().slice(-30),
          views: publicViews(webViews),
          logs: consoleBuffer ? consoleBuffer.recent(200) : []
        }),
        command: async ({ text }) => {
          const actor = OWNER || ownerName() || 'dashboard'
          if (!bot.entity) throw new Error('o bot ainda não entrou no mundo')
          console.log(`[painel] comando de ${actor}: ${text}`)
          eventLog.log('dashboard_command', { command: text, actor })
          bot.emit('chat', actor, text)
          return { ok: true, command: text, actor }
        }
      }
    })
    : null
  if (dashboardServer) {
    dashboardServer.start()
    console.log(`[painel] http://127.0.0.1:${dashboardServer.port}/dashboard`)
  }

  // Registrar evento de início da colônia
  eventLog.log('colony_start', {
    version: serverProfile.version,
    profile: serverProfile.id,
    bots: maxColonyBots
  })

  const smokeTest = new SmokeTest({
    bot,
    storage,
    botManager,
    homeProvider,
    projectManager,
    serverProfile
  })

  // Escala pretendida, não só quem está online: se o servidor cair, os workers
  // caem antes do orquestrador salvar e a colônia se perderia no estado.
  function workerRoleCounts() {
    return botManager.rosterCounts()
  }

  async function persistState() {
    await stateStore.save({
      // Mantém campos legados vazios; a posição vive em waypoints.base.
      home: null,
      homeDimension: null,
      storage: storage.getPosition(),
      storageExtras: storage.getExtras(),
      auto: colony.auto,
      companionAuto: autonomous,
      waypoints: waypointManager.exportState(),
      workers: workerRoleCounts(),
      project: projectManager.exportState(),
      animalTargets: colony.animalTargetsSnapshot(),
      requests: requestQueue.list(),
      resumeTask: resumeTaskRecord,
      deliveryChest
    })
  }

  // Tarefa do dono interrompida pelo descanso dos jogadores: volta no próximo início.
  // Baú combinado para entregas; o estado guarda o endereço atual.
  let deliveryChest = handover.positionOf(savedState.deliveryChest) || { ...handover.DELIVERY_CHEST }
  let resumeTaskRecord = resumeTask.pending(savedState.resumeTask)

  // Missões: estado próprio em .data/missions.json. Restaura sem executar nada:
  // o dono decide quando retomar (!missao retomar), como nas outras tarefas.
  const missionStore = new MissionStore()
  await missionStore.load()
  if (missionStore.lastLoadError) {
    console.log(`[missões] ${missionStore.lastLoadError.message}; arquivo preservado e autosave bloqueado`)
  }
  missionStore.prune()
  const missionRunner = new MissionRunner({
    store: missionStore,
    bot,
    storage,
    capabilities,
    executors: createExecutors({
      bot,
      storage,
      production,
      gather,
      craft,
      handover,
      goals,
      waypointManager,
      ownerProvider: () => ownerEntity(),
      deliveryChestProvider: () => deliveryChest,
      logger: console
    }),
    verifiers: VERIFIERS,
    eventLog,
    logger: console,
    preflight: (node) => preflight.check(bot, {
      action: node.action,
      item: node.args?.item,
      quantity: node.args?.quantity,
      requiresQuantity: node.args?.quantity != null,
      requiresStorage: node.action === 'deposit',
      longTask: node.action === 'move_to',
      dimension: null
    }, { storage, registry: bot.registry })
  })

  const missionShortId = (id) => String(id).slice(0, 8)
  const missionLine = (mission) => `${missionShortId(mission.id)} ${mission.status} — ${missionSpec.describe(mission.spec)}`

  async function runMission(mission) {
    bot.chat(`Missão ${missionShortId(mission.id)}: ${missionSpec.describe(mission.spec)}.`)
    await runTask(`missão ${missionShortId(mission.id)}`, async (isCancelled) => {
      const result = await missionRunner.run(mission.id, {
        isCancelled,
        onProgress: ({ node, status }) => {
          if (status === 'completed') bot.chat(`[missão ${missionShortId(mission.id)}] ${node?.objective || node?.id || 'etapa'} concluído.`)
        }
      })
      if (result.status === 'completed') bot.chat(`Missão ${missionShortId(mission.id)} concluída.`)
      else if (result.status === 'cancelled') bot.chat(`Missão ${missionShortId(mission.id)} cancelada.`)
      else if (result.status === 'interrupted') bot.chat(`Missão ${missionShortId(mission.id)} interrompida; use !missao retomar ${missionShortId(mission.id)}.`)
      else bot.chat(`Missão ${missionShortId(mission.id)} falhou: ${result.failure?.code || 'erro'}${result.failure?.detail ? ` (${result.failure.detail})` : ''}.`)
    }, { resume: 'ficar', deposit: false })
  }

  commandRouter.register('missao', async (_context, args) => {
    if (!bot.entity || !workMoves || !pathGuard.ready(bot)) { bot.chat('Ainda estou entrando no mundo; tente de novo em instantes.'); return }
    const action = String(args[0] || '').toLowerCase()

    if (action === 'status') {
      const missions = missionStore.list().slice(-8).reverse()
      if (!missions.length) { bot.chat('Nenhuma missão registrada.'); return }
      for (const mission of missions) bot.chat(missionLine(mission))
      return
    }

    if (action === 'cancelar') {
      const wanted = String(args[1] || '').toLowerCase()
      const matches = missionStore.list().filter((mission) => mission.id.startsWith(wanted))
      if (!wanted || matches.length !== 1) { bot.chat(matches.length ? 'Identificador ambíguo.' : 'Uso: !missao cancelar <id>'); return }
      const mission = matches[0]
      if (missionRunner.isRunning(mission.id)) {
        await missionRunner.cancel(mission.id)
        cancelTask()
        // cancelTask não restaura o modo; a missão usa 'ficar' como retomada.
        mode = 'ficar'
        bot.pathfinder.setGoal(null)
      } else {
        await missionRunner.cancel(mission.id)
      }
      bot.chat(`Missão ${missionShortId(mission.id)} cancelada.`)
      return
    }

    if (action === 'retomar') {
      const wanted = String(args[1] || '').toLowerCase()
      const matches = missionStore.list().filter((mission) => mission.id.startsWith(wanted))
      if (!wanted || matches.length !== 1) { bot.chat(matches.length ? 'Identificador ambíguo.' : 'Uso: !missao retomar <id>'); return }
      const mission = matches[0]
      if (!['interrupted', 'paused', 'pending'].includes(mission.status)) { bot.chat(`Missão ${missionShortId(mission.id)} está ${mission.status}.`); return }
      if (mode === 'tarefa' || taskName) { bot.chat(`Estou ocupado: ${taskName || 'tarefa em andamento'}.`); return }
      const byId = new Map(mission.graph.map((node) => [node.id, node]))
      const nodes = mission.graph.map((node) => {
        if (['running', 'interrupted'].includes(node.status)) return { ...node, status: 'pending' }
        if (node.status === 'blocked' && (node.dependsOn || []).every((id) => byId.get(id)?.status === 'completed')) {
          return { ...node, status: 'pending' }
        }
        return node
      })
      missionStore.update(mission.id, { graph: nodes, status: 'pending', nodeAttempts: {}, recoveryRequired: false })
      await missionStore.save()
      missionRunner.resume(mission.id)
      await runMission(missionStore.get(mission.id))
      return
    }

    const parsed = missionSpec.parse(args)
    if (!parsed.ok) { bot.chat(parsed.error); return }
    const spec = parsed.spec
    if (mode === 'tarefa' || taskName) { bot.chat(`Estou ocupado: ${taskName || 'tarefa em andamento'}. Use !missao status.`); return }
    const active = missionStore.active()
    if (active.length) { bot.chat(`Já tenho missão ativa (${missionShortId(active[0].id)}). Use !missao status.`); return }
    if (spec.verb === 'ir' && !waypointManager.get(spec.local)) { bot.chat(`Local desconhecido: ${spec.local}.`); return }

    const pre = preflight.check(bot, {
      action: spec.verb,
      item: spec.item,
      quantity: spec.quantity,
      requiresQuantity: spec.quantity != null,
      requiresStorage: spec.delivery === 'chest',
      longTask: spec.verb === 'ir',
      dimension: spec.verb === 'ir' ? waypointManager.get(spec.local)?.dimension : null
    }, { storage, registry: bot.registry })
    if (!pre.ok) {
      const blocker = pre.blockers[0]
      bot.chat(`Não posso começar: ${blocker.detail || blocker.code} (${blocker.code}).`)
      return
    }

    let nodes
    try { nodes = missionSpec.graphForSpec(spec) } catch (err) { bot.chat(`Missão inválida: ${err.message}`); return }
    const mission = missionStore.create({ spec, graph: nodes })
    await missionStore.save()
    await runMission(mission)
  })

  let resumeAttempts = 0
  let resumeNextAt = 0
  function setResumeTask(task) {
    resumeTaskRecord = resumeTask.record(task)
    if (!resumeTaskRecord) {
      resumeAttempts = 0
      resumeNextAt = 0
    }
    persistSoon()
  }

  let persistTimer = null
  function persistSoon() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistState().catch((err) => console.log(`[estado] não consegui salvar: ${err.message}`))
    }, 250)
    persistTimer.unref?.()
  }

  colony.start()
  setInterval(() => persistState().catch(() => {}), 15000).unref?.()

  // Ferro na mochila vai para o baú central sem esperar uma meta de autonomia.
  // Só ferro (minério/bruto/lingote/bloco/nugget); ferramentas e armadura ficam.
  const IRON_DEPOSIT_NAMES = new Set(['raw_iron', 'iron_ore', 'deepslate_iron_ore', 'iron_ingot', 'iron_block', 'iron_nugget'])
  let ironDepositBusy = false
  let lastIronDeposit = 0
  const ironInInventory = () => bot.inventory.items()
    .filter((item) => IRON_DEPOSIT_NAMES.has(item.name))
    .reduce((sum, item) => sum + item.count, 0)
  async function depositIron() {
    const counts = {}
    for (const item of bot.inventory.items()) {
      if (!IRON_DEPOSIT_NAMES.has(item.name)) continue
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    if (!Object.keys(counts).length) return {}
    return storage.depositMany(bot, counts)
  }

  // Baú de campo: quando o baú central está longe/bloqueado (subsolo), coloca
  // um baú ao lado do bot e deposita ali. O ferro fica em um baú identificado.
  async function depositIronInField(counts, isCancelled) {
    const chestId = bot.registry.blocksByName.chest?.id
    let chest = chestId ? bot.findBlock({ matching: chestId, maxDistance: 8 }) : null
    if (!chest) {
      if (!bot.inventory.items().some((item) => item.name === 'chest')) {
        await craft.craftItem(bot, 'chest', 1, isCancelled).catch((err) => {
          console.log(`[ferro] não fabriquei baú: ${err.message}`)
        })
      }
      if (isCancelled() || !bot.inventory.items().some((item) => item.name === 'chest')) {
        throw new Error('sem baú para o depósito de campo')
      }
      const base = bot.entity.position.floored()
      let placed = null
      for (let dx = -3; dx <= 3 && !placed; dx++) {
        for (let dz = -3; dz <= 3 && !placed; dz++) {
          if (!dx && !dz) continue
          for (const dy of [0, 1, -1, 2, -2]) {
            const ground = new Vec3(base.x + dx, base.y + dy - 1, base.z + dz)
            const position = ground.offset(0, 1, 0)
            const floor = bot.blockAt(ground)
            const here = bot.blockAt(position)
            const above = bot.blockAt(position.offset(0, 1, 0))
            if (!floor || !here || !above) continue
            if (floor.boundingBox !== 'block' || /water|lava/.test(floor.name)) continue
            if (here.boundingBox !== 'empty' || above.boundingBox !== 'empty') continue
            try {
              await food.goTo(bot, new goals.GoalNear(position.x, position.y, position.z, 2), 10000).catch(() => {})
              if (isCancelled()) return { deposited: {}, chest: null }
              await bot.lookAt(position.offset(0.5, 0.5, 0.5), true)
              const item = bot.inventory.items().find((entry) => entry.name === 'chest')
              if (!item) break
              await bot.equip(item, 'hand')
              const reference = bot.blockAt(ground)
              if (!reference) continue
              await bot.placeBlock(reference, new Vec3(0, 1, 0))
              placed = bot.blockAt(position)
              if (placed?.name === 'chest') { chest = placed; break }
            } catch { /* tenta outro ponto */ }
          }
        }
      }
    }
    if (!chest) throw new Error('não achei lugar para o baú de campo')
    const deposited = {}
    const container = await bot.openContainer(chest)
    try {
      for (const item of bot.inventory.items()) {
        const limit = counts[item.name]
        if (!limit) continue
        const amount = Math.min(item.count, limit)
        if (amount > 0) {
          await container.deposit(item.type, null, amount)
          deposited[item.name] = (deposited[item.name] || 0) + amount
        }
      }
    } finally {
      try { container.close() } catch {}
    }
    console.log(`[ferro] baú de campo em ${chest.position.x}, ${chest.position.y}, ${chest.position.z}`)
    return { deposited, chest: chest.position }
  }

  // Lote dedicado: cava ferro, funde o bruto e deposita todo o ferro no baú.
  async function mineIronBatch(wanted, isCancelled) {
    if (!storage.configured()) throw new Error('estoque central não configurado')
    console.log(`[ferro] lote de ${wanted} iniciado`)
    // Minera onde está e usa baú de campo; não tenta voltar a uma base
    // bloqueada no subsolo (isso fazia o lote ser cancelado no caminho).
    const names = ['iron_ore', 'deepslate_iron_ore']
    const mined = await gather.mineBlocks(bot, (name) => names.includes(name), wanted, isCancelled).catch((err) => {
      console.log(`[ferro] mineração: ${err.message}`)
      return 0
    })
    if (isCancelled()) return { mined, smelted: 0, deposited: {} }
    const raw = bot.inventory.items()
      .filter((item) => item.name === 'raw_iron')
      .reduce((sum, item) => sum + item.count, 0)
    let smelted = 0
    if (raw > 0) {
      smelted = await craft.smeltItem(bot, 'raw_iron', raw, isCancelled).catch((err) => {
        console.log(`[ferro] fornalha: ${err.message}`)
        return 0
      })
    }
    if (isCancelled()) return { mined, smelted, deposited: {} }
    const counts = {}
    for (const item of bot.inventory.items()) {
      if (!IRON_DEPOSIT_NAMES.has(item.name)) continue
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    if (!Object.keys(counts).length) return { mined, smelted, deposited: {}, chest: null }
    const central = storage.getPosition()
    const far = !central || bot.entity.position.distanceTo(new Vec3(central.x, central.y, central.z)) > 12
    let deposited = {}
    let chest = null
    if (far) {
      const field = await depositIronInField(counts, isCancelled).catch((err) => {
        console.log(`[ferro] baú de campo falhou: ${err.message}`)
        return null
      })
      if (field) { deposited = field.deposited; chest = field.chest }
    } else {
      deposited = await storage.depositMany(bot, counts).catch((err) => {
        console.log(`[ferro] baú central falhou: ${err.message}`)
        return {}
      })
    }
    if (!Object.keys(deposited).length) {
      const field = await depositIronInField(counts, isCancelled).catch((err) => {
        console.log(`[ferro] baú de campo (reserva) falhou: ${err.message}`)
        return null
      })
      if (field) { deposited = field.deposited; chest = field.chest }
    }
    return { mined, smelted, deposited, chest }
  }
  setInterval(() => {
    if (ironDepositBusy || ironBatchBusy || !bot.entity || !storage.configured() || sheltered || bot.isSleeping) return
    if (!canAutomaticDeposit({ mode, taskName, pausedFollowing, fleeingUntil, eating, checkingGear, isMoving: Boolean(bot.pathfinder?.isMoving?.()) })) return
    if (Date.now() - lastIronDeposit < 120000) return
    if (ironInInventory() < 4) return
    ironDepositBusy = true
    lastIronDeposit = Date.now()
    runTask('guardar ferro', async (isCancelled) => {
      try {
        const deposited = await depositIron()
        const text = Object.entries(deposited).map(([name, quantity]) => `${quantity}x ${name}`).join(', ')
        if (!isCancelled() && text) {
          console.log(`[ferro] guardei no baú: ${text}`)
          bot.chat(`Guardei no baú: ${text}`)
        }
      } catch (err) {
        if (!isCancelled()) console.log(`[ferro] não guardei: ${err.message}`)
      }
    }).finally(() => { ironDepositBusy = false })
  }, 30000).unref?.()

  // ========== ESTADO ==========
  // Override de sessão: permite carregar correções sem iniciar movimento no spawn.
  let mode = process.env.MBOT_START_MODE === 'ficar' ? 'ficar' : 'seguir' // 'seguir' | 'ficar' | 'tarefa'
  let taskName = null       // descrição da tarefa em andamento
  let eating = false
  let warnedNoFood = false  // já avisou no chat que não acha comida
  let lastFoodSearch = Date.now() - FOOD_RETRY_MS + 10000 // 1ª busca após 10s (entidades carregando)
  let fleeingUntil = 0
  let lastHealth = null
  let lastAttacker = null
  let taskId = 0            // incrementado para cancelar a tarefa em andamento
  let followMoves, workMoves
  let resolvedOwner = OWNER
  let fightTarget = null     // mob com quem está lutando
  let fightResume = 'seguir' // modo para voltar depois da luta
  let autonomous = Boolean(savedState.companionAuto) || process.env.MBOT_COMPANION_AUTOSTART === '1'
  let sheltered = false
  let lastNightTry = 0
  let lastGearCheck = 0
  let checkingGear = false
  let patrolActive = false
  let patrolRoute = []
  let patrolVersion = 0
  const autonomy = new Autonomy(bot, { storage })

  function ownerName() {
    if (resolvedOwner) return resolvedOwner
    const candidate = Object.keys(bot.players).find((name) =>
      name !== bot.username && !botManager.get(name)
    )
    if (candidate) resolvedOwner = candidate
    return resolvedOwner
  }

  function ownerEntity() {
    return bot.players[ownerName()]?.entity
  }

  function currentDimension() {
    const value = bot.game?.dimension
    if (value == null) return null
    if (typeof value === 'string') return value
    if (typeof value?.name === 'string') return value.name
    return String(value)
  }

  // A memória referencia um waypoint, mas suas coordenadas vivem somente no WaypointManager.
  function memoryPlace(name) {
    const metadata = memory.lugar(name)
    const entry = waypointManager.get(metadata?.waypoint || name)
    return entry ? { ...entry, origem: metadata?.origem, contexto: metadata?.contexto } : null
  }

  function waypointOrBase(name) {
    if (String(name || '').toLowerCase() === 'base') {
      const base = waypointManager.get('base')
      if (base) return base
      // Sem base da colônia, a "casa" lembrada serve de destino padrão.
      return memoryPlace('base') || memoryPlace('casa')
    }
    return waypointManager.get(name) || memoryPlace(name)
  }

  // Todos os lugares conhecidos (memória, base e locais salvos), sem repetir nomes.
  function placeEntries() {
    const byKey = new Map()
    const add = (entry) => {
      const key = normalizeWaypointName(entry?.name)
      if (key && !byKey.has(key)) byKey.set(key, entry)
    }
    for (const entry of waypointManager.list()) {
      const metadata = memory.lugar(entry.name)
      add({ ...entry, origem: metadata?.origem, contexto: metadata?.contexto })
    }
    return [...byKey.values()]
  }

  const placeLabel = (entry) => `${entry.name} ${fmtPos(entry.position)}`

  // Depois de uma escolha, oferece torná-la padrão (sem travar a tarefa).
  function offerDefault(key, value, username) {
    clarifier.confirm('Usar sempre essa? sim/não', { who: username, timeoutMs: 20000, quiet: true })
      .then((yes) => {
        if (!yes) return
        memory.definirPreferencia(key, value, dito(username))
        bot.chat('Ok, vou lembrar.')
      })
      .catch(() => {})
  }

  // Resolve "casa", "mina"... Se houver mais de um lugar parecido, PERGUNTA ao dono.
  // Retorna a entrada ou null (desconhecido, cancelado ou sem resposta).
  async function resolvePlace(query, username) {
    const prefKey = `ref.lugar.${normalizeWaypointName(query)}`
    const result = resolveReference(query, placeEntries(), { preferido: memory.preferencia(prefKey) })
    if (result.match) return result.match
    if (!result.candidates.length) {
      bot.chat(`Não conheço "${query}". Use !lembrar ${query} aqui ou !memoria lugares.`)
      return null
    }
    const question = result.reason === 'parecido' ? `Não achei "${query}". Quis dizer:` : `Qual ${query}?`
    const choice = await clarifier.ask(question, result.candidates.map(placeLabel), { who: username })
    if (!choice) return null
    const entry = result.candidates[choice.index]
    if (result.reason === 'ambiguo') offerDefault(prefKey, entry.name, username)
    return entry
  }

  // "ferro" pode ser iron_ore ou deepslate_iron_ore: pergunta, a menos que já haja preferência.
  async function resolveBlocks(word, username) {
    const variants = blockVariants(word, bot.registry.blocksByName)
    if (!variants.length) {
      bot.chat(`Não conheço o bloco "${word}". Use o nome em inglês, ex.: stone, oak_log, iron_ore.`)
      return null
    }
    if (variants.length === 1) return variants
    const prefKey = `minerar.${normalizarChave(word)}`
    const saved = memory.preferencia(prefKey)
    if (saved === 'qualquer') return variants
    if (variants.includes(saved)) return [saved]

    const choice = await clarifier.ask(`Qual ${word}?`, [...variants, 'qualquer um'], { who: username })
    if (!choice) return null
    const any = choice.index === variants.length
    offerDefault(prefKey, any ? 'qualquer' : variants[choice.index], username)
    return any ? variants : [variants[choice.index]]
  }

  function assertWaypointReachable(entry) {
    if (!entry) throw new Error('local não encontrado')
    if (!waypointManager.sameDimension(entry, currentDimension())) {
      throw new Error(`o local ${entry.name} está em outra dimensão (${entry.dimension})`)
    }
  }

  async function goToPoint(position, isCancelled, radius = 2) {
    const x = Math.floor(Number(position.x))
    const y = Math.floor(Number(position.y))
    const z = Math.floor(Number(position.z))
    if (![x, y, z].every(Number.isFinite)) throw new Error('posição inválida')

    // Fundo no subsolo o pathfinder desiste de rotas longas: sobe primeiro.
    if (climb.needsClimb(bot, y)) {
      await climb.climbOut(bot, y, { isCancelled, log: console.log })
      if (isCancelled()) return false
    }
    const here = bot.entity?.position
    const distance = here ? Math.hypot(here.x - x, here.y - y, here.z - z) : 0
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        bot.pathfinder.setGoal(null)
        reject(new Error('caminho demorou demais'))
      }, Math.max(60000, Math.round(distance * 700)))
    })

    try {
      await Promise.race([
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, radius)),
        timeout
      ])
      return !isCancelled()
    } finally {
      clearTimeout(timer)
    }
  }

  function nearestHostile(maxDist) {
    return bot.nearestEntity((e) => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) <= maxDist)
  }

  function follow() {
    const owner = ownerEntity()
    if (!owner) return
    pathGuard.safeSetMovements(bot, followMoves)
    const distance = memory.preferenciaNumero('seguir.distancia', FOLLOW_DISTANCE, 1, 16)
    pathGuard.safeSetGoal(bot, new goals.GoalFollow(owner, distance), true)
  }

  function cancelTask() {
    taskId++
    taskName = null
    if (bot.targetDigBlock) bot.stopDigging()
    pathGuard.safeStop(bot)
  }

  // Foge do agressor (ou do hostil mais próximo); sem ameaça visível, corre para o dono.
  function flee(attacker) {
    if (mode === 'tarefa') {
      bot.chat(taskName === 'lutar' ? 'Recuando!' : `Estou apanhando! Parei de ${taskName}.`)
      cancelTask()
      mode = 'seguir'
    }
    fleeingUntil = Date.now() + FLEE_MS
    const threat = attacker && attacker !== bot.entity && attacker.isValid !== false ? attacker : nearestHostile(FLEE_DISTANCE)
    bot.pathfinder.setMovements(followMoves)
    if (threat) {
      console.log(`Fugindo de ${threat.username || threat.name} (HP ${Math.round(bot.health)})`)
      bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(threat, FLEE_DISTANCE)), true)
    } else {
      follow()
    }
  }

  // Ações do próprio orquestrador que andam (ler o baú, smoke test). No modo
  // seguir, o laço principal troca o objetivo do pathfinder a cada 500 ms e o
  // goto falharia com "The goal was changed before it could be completed!".
  // O contador cobre chamadas sobrepostas: só volta a seguir quando a última acaba.
  let pausedFollowing = 0
  let pauseName = null
  async function withoutFollowing(name, fn) {
    if (mode !== 'seguir' && !pausedFollowing) return fn()
    if (!pausedFollowing++) {
      mode = 'tarefa'
      taskName = pauseName = name
    }
    try {
      return await fn()
    } finally {
      // Outra tarefa pode ter começado no meio (runTask troca taskName): não a sobrescreve.
      if (!--pausedFollowing && mode === 'tarefa' && taskName === pauseName) {
        mode = 'seguir'
        taskName = null
      }
    }
  }

  // Executa uma tarefa longa. `fn` recebe isCancelled() e deve parar quando for true
  // (fuga, !cancelar, outra tarefa). Preserva !ficar, inclusive ao substituir uma
  // tarefa; só retoma seguir se já seguia ou se o chamador pedir explicitamente.
  let taskResumeMode = 'seguir'
  async function runTask(name, fn, { resume = mode === 'tarefa' ? taskResumeMode : mode === 'ficar' ? 'ficar' : 'seguir', deposit = true } = {}) {
    taskResumeMode = resume
    if (!workMoves || !pathGuard.ready(bot)) {
      bot.chat('Ainda estou entrando no mundo; tente de novo em instantes.')
      return
    }
    cancelTask()
    const myTask = taskId
    const isCancelled = () => myTask !== taskId
    mode = 'tarefa'
    taskName = name
    pathGuard.safeSetMovements(bot, workMoves)
    try {
      await fn(isCancelled)
    } catch (err) {
      if (!isCancelled()) bot.chat(`Não consegui ${name}: ${err.message}`)
    }
    if (isCancelled()) return
    const hasCargo = deposit && bot.inventory.items().some((item) => item.count > storage.reserveFor(bot, item))
    if (hasCargo) {
      try {
        if (!storage.configured()) await autoStorage(isCancelled)
        if (!isCancelled() && storage.configured()) {
          const deposited = await storage.depositCargo(bot)
          const text = Object.entries(deposited).map(([item, count]) => `${count}x ${item}`).join(', ')
          if (text) console.log(`[estoque] carga do bot guardada após ${name}: ${text}`)
        }
      } catch (err) {
        console.log(`[estoque] não consegui guardar a carga após ${name}: ${err.message}`)
      }
    }
    if (isCancelled()) return
    taskName = null
    mode = resume
    if (resume === 'seguir' && !autonomous) follow()
    else bot.pathfinder.setGoal(null)
  }

  function autonomyStep() {
    const goal = autonomy.next()
    if (!goal) return false
    console.log(`[autônomo] meta: ${goal.name}`)
    runTask(goal.name, async (isCancelled) => {
      try {
        const result = await goal.run(bot, isCancelled)
        if (isCancelled()) return
        autonomy.succeeded(goal)
        if (result) console.log(`[autônomo] ${goal.name}: ${result}`)
      } catch (err) {
        if (isCancelled()) return
        autonomy.failed(goal)
        throw err
      }
    })
    return true
  }

  let lastExplore = 0
  function explore() {
    if (Date.now() - lastExplore < EXPLORE_EVERY_MS) return false
    lastExplore = Date.now()
    const angle = Math.random() * 2 * Math.PI
    const target = bot.entity.position.offset(
      Math.cos(angle) * EXPLORE_DISTANCE,
      0,
      Math.sin(angle) * EXPLORE_DISTANCE
    )
    console.log(`[autônomo] sem meta disponível; explorando até ${Math.round(target.x)}, ${Math.round(target.z)}`)
    runTask('explorar', async () => {
      await food.goTo(
        bot,
        new goals.GoalXZ(Math.round(target.x), Math.round(target.z)),
        60000
      ).catch(() => {})
    })
    return true
  }

  function ownerNearby() {
    const owner = ownerEntity()
    return Boolean(owner) && owner.position.distanceTo(bot.entity.position) <= OWNER_NEAR
  }

  function spendNight() {
    lastNightTry = Date.now()
    runTask('passar a noite', async (isCancelled) => {
      const how = await night.spendNight(bot, isCancelled, {
        onShelter: (inside) => { sheltered = inside },
        say: (text) => bot.chat(text)
      })
      if (how && !isCancelled()) {
        bot.chat(how === 'dormi' ? 'Bom dia! Dormi bem.' : 'Amanheceu, saindo do abrigo.')
      }
    })
  }

  async function checkGear() {
    lastGearCheck = Date.now()
    if (checkingGear) return
    checkingGear = true
    try {
      const worn = await equipment.equipBestArmor(bot)
      if (worn.length) console.log(`Vesti ${worn.join(', ')}`)
      // Com missão de minérios pendente, só picareta: espada gastaria os diamantes da missão.
      const upgrades = equipment.pendingUpgrades(bot, resumeTaskRecord?.kind === 'minerios' ? ['pickaxe'] : undefined)
      if (upgrades.length && mode === 'seguir') {
        runTask('melhorar equipamento', async (isCancelled) => {
          for (const item of upgrades) {
            if (isCancelled()) return
            await craft.craftItem(
              bot,
              item,
              craft.countItem(bot, bot.registry.itemsByName[item].id) + 1,
              isCancelled
            )
          }
        })
      }
    } catch (err) {
      console.log(`Equipamento: ${err.message}`)
    } finally {
      checkingGear = false
    }
  }

  function clearPatrolState() {
    patrolVersion++
    patrolActive = false
    patrolRoute = []
  }

  function travelTo(entry) {
    assertWaypointReachable(entry)
    autonomous = false
    clearPatrolState()
    persistSoon()
    bot.chat(`Indo para ${placeLabel(entry)}...`)
    runTask(`ir para ${entry.name}`, async (isCancelled) => {
      await goToPoint(entry.position, isCancelled, 2)
      if (!isCancelled()) bot.chat(`Cheguei em ${entry.name}.`)
    }, { resume: 'ficar' })
  }

  function startPatrol(entries) {
    for (const entry of entries) assertWaypointReachable(entry)
    autonomous = false
    const myPatrol = ++patrolVersion
    patrolActive = true
    patrolRoute = entries.map((entry) => entry.name)
    persistSoon()
    bot.chat(`Patrulha iniciada: ${patrolRoute.join(' -> ')}.`)

    runTask('patrulhar', async (isCancelled) => {
      try {
        while (!isCancelled() && patrolActive && patrolVersion === myPatrol) {
          for (const entry of entries) {
            if (isCancelled() || !patrolActive || patrolVersion !== myPatrol) return
            await goToPoint(entry.position, isCancelled, 2)
            if (isCancelled() || !patrolActive || patrolVersion !== myPatrol) return
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
        }
      } finally {
        if (patrolVersion === myPatrol) {
          patrolActive = false
          patrolRoute = []
        }
      }
    }, { resume: 'ficar' })
  }

  const isLiving = (entity) => entity && entity !== bot.entity && entity.isValid !== false

  // Luta com `target` até ele morrer; com vida baixa, recua.
  function defend(target) {
    // Já lutando com ele (defesa automática + !atacar): não reinicia a luta.
    if (mode === 'tarefa' && taskName === 'lutar' && fightTarget === target) return
    const resume = mode === 'ficar' || (mode === 'tarefa' && taskName === 'lutar' && fightResume === 'ficar') ? 'ficar' : 'seguir'
    if (mode === 'tarefa' && taskName !== 'lutar') bot.chat(`Parei de ${taskName} para lutar com ${target.name}.`)
    fightTarget = target
    fightResume = resume
    console.log(`Lutando com ${target.name} (HP ${Math.round(bot.health)})`)
    runTask('lutar', async (isCancelled) => {
      // Emenda lutas: matou um e há outro hostil perto, continua (se ainda compensa lutar).
      let current = target
      for (let fights = 0; current && fights < CHAIN_FIGHTS && !isCancelled(); fights++) {
        fightTarget = current
        const result = await combat.fight(bot, current, isCancelled)
        console.log(`Luta com ${current.name}: ${result}`)
        if (result === 'recuei') {
          flee(current)
          return
        }
        if (result !== 'morto') return
        const next = combat.proactiveTarget(bot, CHAIN_RANGE)
        await food.collectDrops(bot, current.position.clone(), isCancelled)
        current = next && next.isValid !== false && combat.decide(bot, next) === 'lutar' ? next : null
        if (current) console.log(`Próximo: ${current.name}`)
      }
    }, { resume })
  }

  // Reação a uma ameaça: lutar ou fugir, conforme o mob, a vida e quantos inimigos há.
  function react(attacker) {
    const threat = isLiving(attacker) ? attacker : nearestHostile(FLEE_DISTANCE)
    if (taskName === 'lutar' && threat === fightTarget) return
    if (threat && combat.decide(bot, threat) === 'lutar') defend(threat)
    else flee(threat)
  }

  // Anota o que o bot prometeu fazer; o estado final fica na memória.
  // fn retorna true (feito), false (falhou) ou undefined (interrompido).
  async function withCommitment(description, fn) {
    const item = memory.prometer(description, { para: ownerName() }, inferido())
    let ok
    try {
      ok = await fn()
    } finally {
      memory.encerrarCompromisso(item.id, ok === true ? 'feito' : ok === false ? 'falhou' : 'interrompido')
    }
  }

  function mine(blockNames, count) {
    const names = new Set(blockNames)
    const label = blockNames.length > 2 ? `${blockNames[0]} e parecidos` : blockNames.join('/')
    bot.chat(`Minerando ${count}x ${label}...`)
    withCommitment(`minerar ${count}x ${label}`, async () => {
      let result
      await runTask('minerar', async (isCancelled) => {
        const mined = await gather.mineBlocks(bot, (name) => names.has(name), count, isCancelled)
        if (isCancelled()) return
        result = mined >= count
        if (mined < count) bot.chat(`Só consegui ${mined}x ${label} (não achei mais ou não alcancei).`)
        else bot.chat(`Minerei ${mined}x ${label}.`)
      })
      return result
    }).catch(() => {})
  }

  async function eatNow() {
    if (eating) return
    eating = true
    try {
      const eaten = await food.eat(bot, { preferred: memory.preferencia('comida.preferida') || null })
      if (eaten) {
        console.log(`Comi ${eaten} (fome ${bot.food}/20)`)
        warnedNoFood = false
      }
      return eaten
    } catch (err) {
      console.log(`Não consegui comer: ${err.message}`)
    } finally {
      eating = false
    }
  }

  function searchFood(announce) {
    lastFoodSearch = Date.now()
    if (announce) bot.chat('Vou procurar comida.')
    runTask('buscar comida', async (isCancelled) => {
      // Continua até ter comida no inventário (máx. 5 fontes por busca).
      for (let i = 0; i < 5 && !food.hasFood(bot) && !isCancelled(); i++) {
        const done = await food.gatherFood(bot, isCancelled)
        if (!done) {
          if (!isCancelled() && i === 0) bot.chat('Não achei comida por perto (animais, plantações ou frutas).')
          break
        }
        console.log(`Busca de comida: ${done}`)
        if (food.hasFood(bot)) bot.chat(`Consegui comida: ${done}.`)
      }
      if (!isCancelled() && food.hasFood(bot)) await eatNow()
    })
  }

  // ========== EVENTOS ==========
  let restoredWorkers = false
  let autoSetupTimer = null
  let autoSetupBusy = false
  let autoStorageRetryAt = 0
  let autoProjectRetryAt = 0
  let autoIronRetryAt = 0
  let ironBatchBusy = false
  bot.once('spawn', () => { webViews = startWebViews(bot) })

  // Retoma a tarefa interrompida pelo descanso dos jogadores, já acordados.
  bot.once('spawn', () => {
    const decision = resumeTask.canResume(resumeTaskRecord, {
      sleeping: sleepWatch.sleepingOthers(bot, { skip: (name) => Boolean(botManager.get(name)) })
    })
    if (!decision.ok) {
      if (decision.keep) console.log('[retomada] adiada: ainda há jogador dormindo')
      else if (resumeTaskRecord) setResumeTask(null)
      return
    }
    const task = decision.task
    setTimeout(() => {
      if (!bot.entity) return
      console.log(`[retomada] voltando à tarefa: ${resumeTask.describe(task)}`)
      bot.chat(`Voltei e vou retomar: ${resumeTask.describe(task)}.`)
      if (task.kind === 'lapis') startLapis(task.target)
      else if (task.kind === 'dar') startHandover(task.name, task.amount)
      else if (task.kind === 'trigo') startWheat(task.target)
      else if (task.kind === 'pao') startBread(task.breads)
      else if (task.kind === 'minerios') startOreMission(task.target, task.helpers)
    }, 5000).unref?.()
  })

  // Contexto dos cenários do painel: só ações já existentes, com o bot real.
  const LOG_BLOCK_IDS = () => Object.values(bot.registry.blocksByName).filter((b) => /_log$/.test(b.name)).map((b) => b.id)
  runVerifier.setScenarioContext({
    get bot() { return bot },
    storage,
    botManager,
    dimension: () => currentDimension(),
    views: () => webViews,
    countLogsNearby: () => bot.findBlocks({ matching: LOG_BLOCK_IDS(), maxDistance: 32, count: 256 }).length,
    // measure() roda ainda dentro da tarefa, antes de o bot voltar a seguir.
    mineLog: async (isCancelled, measure) => {
      const ids = new Set(LOG_BLOCK_IDS().map((id) => bot.registry.blocks[id].name))
      let mined = 0
      let inventoryAfter = null
      let interrupted = true
      await runTask('teste: coletar madeira', async (taskCancelled) => {
        mined = await gather.mineBlocks(bot, (name) => ids.has(name), 1, () => taskCancelled() || isCancelled())
        inventoryAfter = await measure()
        // Luta, fuga ou outro comando cancelam a tarefa no meio.
        interrupted = taskCancelled()
      })
      return { mined, inventoryAfter, interrupted }
    },
    runSmoke: () => withoutFollowing('smoke test', () => smokeTest.run()),
    createWorker: async () => {
      const created = await botManager.create('ajudante', 1)
      persistSoon()
      return created
    }
  })
  let memoryCapture = null
  bot.once('spawn', () => {
    memoryCapture = attachMemoryCapture(bot, memory, {
      log: (msg) => console.log(msg),
      rememberWaypoint: (name, position, dimension, context, provenance) => {
        try {
          waypointManager.save(name, position, dimension)
          memory.lembrarLugar(name, provenance, context)
          persistSoon()
        } catch (err) {
          console.log(`[memória] não consegui registrar waypoint automático: ${err.message}`)
        }
      }
    })
  })
  bot.on('spawn', async () => {
    console.log('=== Bot conectado! ===')
    console.log(`Jogador: ${bot.username}`)
    console.log(`Posição: X=${bot.entity.position.x.toFixed(1)}, Y=${bot.entity.position.y.toFixed(1)}, Z=${bot.entity.position.z.toFixed(1)}`)
    console.log(`Modo: ${bot.game?.gameMode ?? 'desconhecido'} | Ping: ${bot.players[bot.username]?.ping ?? 'N/A'}ms`)
    console.log(`Dono: ${ownerName() ?? '(ninguém online)'}`)
    if (fear.invulnerable(bot)) console.log(`[modo] ${fear.fearless() ? 'sem medo' : bot.game?.gameMode}: sem fuga, sem briga automática e sem abrigo noturno`)
    console.log('\n--- Bot ativo! Digite !ajuda no chat ---\n')

    followMoves = new Movements(bot)
    followMoves.canDig = false          // não quebra construções enquanto segue/foge
    followMoves.allow1by1towers = false
    followMoves.maxDropDown = 1         // não escolher atalhos descendo ravinas
    followMoves.allowParkour = false
    workMoves = new Movements(bot)
    bot.pathfinder.thinkTimeout = 10000 // caminhos até blocos subterrâneos demoram a calcular

    if (!restoredWorkers) {
      restoredWorkers = true
      const restored = []
      for (const [role, count] of Object.entries(savedState.workers || {})) {
        const amount = Math.min(Number(count) || 0, botManager.capacity())
        if (amount <= 0) continue
        try {
          const workers = await botManager.create(role, amount)
          restored.push(...workers.map((worker) => worker.name))
        } catch (err) {
          console.log(`[estado] não consegui restaurar ${role}: ${err.message}`)
        }
      }
      if (projectManager.isActive()) {
        try {
          const extra = await ensureProjectWorkers(projectManager.active.type)
          restored.push(...extra)
        } catch (err) {
          console.log(`[estado] projeto restaurado, mas faltam workers: ${err.message}`)
        }
      }
      const autoWanted = savedState.auto || process.env.MBOT_COLONY_AUTOSTART === '1'
      const readiness = colony.autoReadiness()
      if (autoWanted && readiness.ready) {
        colony.setAuto(true)
        console.log('[colônia] modo automático ativado no startup (base/estoque/planejador verificados)')
      } else if (process.env.MBOT_COLONY_AUTOSTART === '1') {
        console.log(`[colônia] autostart recusado: faltam ${readiness.missing.join(', ')}`)
      }
      if (restored.length) console.log(`[estado] workers restaurados: ${restored.join(', ')}`)
      const home = homeProvider()
      if (home) console.log(`[estado] base restaurada: ${home.x}, ${home.y}, ${home.z}`)
      if (storage.configured()) console.log('[estado] estoque central restaurado')
      if (projectManager.isActive()) console.log(`[estado] projeto restaurado: ${projectManager.active.type}`)
      persistSoon()
    }
    scheduleAutoSetup()
  })

  bot.once('health', () => {
    console.log(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20`)
  })

  bot.on('entityHurt', (entity, source) => {
    if (entity === bot.entity && source) lastAttacker = source
  })

  bot.on('health', () => {
    // Sufocando (areia/cascalho caiu na cabeça): cava o bloco da cabeça na hora.
    const head = bot.blockAt(bot.entity.position.offset(0, 1.6, 0))
    if (lastHealth !== null && bot.health < lastHealth && head?.boundingBox === 'block' && bot.canDigBlock(head)) {
      console.log(`Sufocando em ${head.name}: cavando para sair`)
      bot.dig(head).catch(() => {})
      lastHealth = bot.health
      return
    }

    // Durante a luta, o próprio laço de combate decide quando recuar.
    // Sem medo (invulnerável), tomar dano não pode cancelar a tarefa.
    if (!fear.invulnerable(bot) && lastHealth !== null && bot.health < lastHealth && bot.health > 0 && taskName !== 'lutar') {
      react(lastAttacker)
      lastAttacker = null
    }
    lastHealth = bot.health
  })

  bot.on('death', () => {
    console.log('O bot morreu.')
    // Uma tarefa cancelada não finaliza o modo por conta própria. Sem restaurar
    // aqui, o respawn fica em tarefa/null e a autonomia nunca mais despacha.
    const resume = mode === 'tarefa' ? taskResumeMode : mode
    cancelTask()
    mode = autonomous ? 'seguir' : resume
    sheltered = false
    lastHealth = null
    fleeingUntil = 0
  })

  // Laço principal: termina fugas, foge preventivamente e mantém o bot perto do dono.
  setInterval(() => {
    if (!bot.entity || !followMoves || bot.health <= 0) return
    if (fleeingUntil) {
      // Deixar o pathfinder executar o recuo antes de recalcular outro objetivo.
      if (Date.now() < fleeingUntil) return
      // O relógio de fuga não é prova de segurança: não retomar coleta perto
      // do mesmo atirador enquanto ainda estamos sem condições de enfrentá-lo.
      const threat = nearestHostile(FLEE_DISTANCE)
      if (threat && combat.decide(bot, threat) === 'fugir') {
        flee(threat)
        return
      }
      fleeingUntil = 0
      if (mode === 'ficar') bot.pathfinder.setGoal(null)
    }
    // Defesa: foge de creepers e reage a hostis que chegam perto.
    if (!fear.invulnerable(bot) && taskName !== 'lutar' && !sheltered) {
      const creeper = bot.nearestEntity((e) => combat.EXPLOSIVE.has(e.name) &&
        e.position.distanceTo(bot.entity.position) <= CREEPER_RANGE)
      if (creeper) {
        flee(creeper)
        return
      }
      const target = combat.proactiveTarget(bot, DEFEND_RANGE)
      if (target) {
        react(target)
        return
      }
    }
    // Correr gasta muita fome; com pouca comida, só anda.
    followMoves.allowSprinting = workMoves.allowSprinting = bot.food > 6

    // Fome: come se tiver comida; senão, sai para buscar (só quando está livre).
    const needsFood = bot.food <= HUNGRY || (bot.food < 18 && bot.health < 20)
    // Com mineflayer-auto-eat ativo ele é o único que come sozinho; aqui só
    // buscamos comida quando não há nenhuma no inventário.
    const autoEat = Boolean(bot.autoEat?.enabled)
    if (!autoEat && needsFood && !eating && (mode !== 'tarefa' || bot.food <= 6) && food.hasFood(bot)) {
      eatNow()
    } else if (bot.food <= HUNGRY && mode === 'seguir' && !food.hasFood(bot) &&
        Date.now() - lastFoodSearch > FOOD_RETRY_MS) {
      lastFoodSearch = Date.now()
      if (food.findFoodSource(bot)) {
        searchFood(true)
        return
      }
      if (!warnedNoFood) bot.chat('Estou com fome e não acho comida por perto. Me leve até animais ou plantações, ou me dê comida.')
      warnedNoFood = true
    }
    if (mode !== 'seguir' || eating) return
    // Tarefa do dono cancelada por combate: volta com espera crescente e limite.
    if (resumePendingTask()) return

    if (!fear.invulnerable(bot) && night.isNight(bot) && (autonomous || !ownerNearby()) &&
        Date.now() - lastNightTry > NIGHT_RETRY_MS) {
      spendNight()
      return
    }

    if (Date.now() - lastGearCheck > GEAR_CHECK_MS) {
      checkGear()
      if (mode !== 'seguir') return
    }

    if (autonomous) {
      if (!autonomyStep() && !explore()) bot.pathfinder.setGoal(null)
      return
    }

    const owner = ownerEntity()
    if (owner && bot.pathfinder.goal?.entity !== owner) follow()
  }, 500)

  bot.on('kicked', (reason) => {
    console.log('Bot desconectado:', reason)
  })

  // Queda inesperada (servidor reiniciou, rede caiu, kick): sai com erro para o
  // supervisor (systemd ou `npm run sempre`) reconectar. !parar sai com código 0.
  let quitRequested = false
  bot.on('end', async (reason) => {
    colony.stop()
    try { await toolApiRuntime?.close() } catch (error) { console.log(`[tool-api] shutdown: ${error.message}`) }
    try { await persistState() } catch {}
    try { await memory.save() } catch {}
    memoryCapture?.stop()
    botManager.stopAll()
    statusServer.stop()
    dashboardServer?.stop()
    webViews?.viewer?.close?.()
    webViews?.inventory?.close?.()
    stopLan()
    console.log(`Conexão encerrada${reason ? ` (${reason})` : ''}.`)
    setTimeout(() => process.exit(quitRequested ? 0 : 1), 500)
  })

  bot.on('error', (err) => {
    console.error(`Erro de conexão (${err.code || 'desconhecido'}): ${err.message}`)
    if (err.code === 'ECONNREFUSED') {
      console.error(`Verifique se o mundo está aberto para LAN e se a porta ${CONFIG.port} está correta. Configure outra porta com MINECRAFT_PORT.`)
    }
  })

  const parseCount = (arg, fallback = 1) => Math.max(1, Math.min(64, Number.parseInt(arg, 10) || fallback))

  // ========== COMANDOS VIA CHAT ==========
  function colonySummary() {
    const workers = botManager.list()
    const roles = {}
    for (const worker of workers) roles[worker.role] = (roles[worker.role] || 0) + 1
    const roleText = Object.entries(roles).map(([role, n]) => `${role}x${n}`).join(', ') || 'sem workers'
    const home = homeProvider()
    const baseText = home
      ? `${Math.floor(home.x)},${Math.floor(home.y)},${Math.floor(home.z)}`
      : 'NÃO'
    const lines = [`Colônia: ${workers.length + 1}/${maxColonyBots} | auto: ${colony.auto ? 'ON' : 'OFF'} | base: ${baseText} | estoque: ${storage.configured() ? 'OK' : 'NÃO'} | ${roleText}`]
    for (let i = 0; i < workers.length; i += 4) {
      lines.push(workers.slice(i, i + 4).map((w) => {
        const detail = w.resource || w.item || ''
        const task = w.task ? `:${w.task}${detail ? '/' + detail : ''}` : ''
        return `${w.name}(${w.status}${task})`
      }).join(', '))
    }
    return lines
  }

  commandRouter.register('bots', async () => {
    for (const line of colonySummary()) bot.chat(line)
  })

  commandRouter.register('colonia', async (_context, args) => {
    const action = String(args[0] || '').toLowerCase()
    if (action === 'auto') {
      const value = String(args[1] || 'on').toLowerCase()
      const enabled = !['off', '0', 'nao', 'não', 'false'].includes(value)

      if (!enabled) {
        colony.setAuto(false)
        persistSoon()
        bot.chat('Modo automático da colônia: DESATIVADO.')
        return
      }

      const readiness = colony.autoReadiness()
      if (!readiness.ready) {
        bot.chat(`Não posso ativar o automático. Falta definir: ${readiness.missing.join(', ')}.`)
        return
      }

      colony.setAuto(true)
      persistSoon()
      bot.chat('Modo automático por demanda: ATIVADO.')
      return
    }

    if (action === 'necessidades' || action === 'demanda') {
      if (!storage.configured()) {
        bot.chat('Defina primeiro o estoque com !estoque aqui.')
        return
      }
      try {
        if (!storage.snapshotFresh(5000)) await withoutFollowing('ler o estoque', () => storage.summary(bot))
        const report = colony.demandReport()
        const d = report?.deficits || {}
        bot.chat(`Faltas: comida ${d.food || 0}, madeira ${d.wood || 0}, combustível ${d.fuel || 0}, ferro ${d.ironTotal || 0}, construção ${d.building || 0}.`)
        bot.chat(`Reserva: lingotes ${d.ironIngot || 0}, picaretas ${d.ironPickaxe || 0}, machados ${d.ironAxe || 0}, espadas ${d.ironSword || 0}.`)
      } catch (err) {
        bot.chat(`Não consegui analisar a demanda: ${err.message}`)
      }
      return
    }

    for (const line of colonySummary()) bot.chat(line)
  })

  function projectStatusLines() {
    const report = colony.demandReport()
    const status = projectManager.status(report)
    if (!status) return ['Nenhum projeto ativo. Tipos: base, casa, fazenda, mina, vila, planta <nome>.']

    const actionDone = status.actions.filter((a) => a.status === 'concluido').length
    const actionTotal = status.actions.length
    if (status.status !== 'ativo') {
      return [`Projeto ${status.type}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`]
    }
    if (status.type === 'planta') {
      const lines = [`Projeto ${status.label}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`]
      const lacking = status.missingMaterials || {}
      lines.push(Object.keys(lacking).length
        ? `Falta no estoque: ${blueprint.formatMaterials(lacking)}`
        : 'Material das obras pendentes disponível no estoque.')
      const errors = status.actions.filter((a) => a.lastError).map((a) => `${a.id}: ${a.lastError}`)
      if (errors.length) lines.push(errors.slice(0, 2).join(' | '))
      return lines
    }
    const deficits = status.deficits || {}
    const missing = Object.entries(deficits)
      .filter(([, value]) => Number(value || 0) > 0)
      .slice(0, 5)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ')

    return [
      `Projeto ${status.type}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`,
      missing ? `Faltas: ${missing}` : 'Recursos-alvo atingidos.'
    ]
  }

  async function ensureProjectWorkers(type, roles = null) {
    const definition = roles ? { requiredRoles: roles } : projectManager.definition(type)
    if (!definition) throw new Error(`projeto desconhecido: ${type}`)

    const missing = {}
    let totalMissing = 0
    for (const [role, wanted] of Object.entries(definition.requiredRoles || {})) {
      const current = botManager.byRole(role).length
      const amount = Math.max(0, Number(wanted) - current)
      if (amount > 0) {
        missing[role] = amount
        totalMissing += amount
      }
    }

    if (totalMissing > botManager.capacity()) {
      throw new Error(`faltam ${totalMissing} bots, mas há capacidade para ${botManager.capacity()}`)
    }

    const created = []
    for (const [role, amount] of Object.entries(missing)) {
      const workers = await botManager.create(role, amount)
      created.push(...workers.map((worker) => worker.name))
    }
    return created
  }

  // ========== BOOTSTRAP AUTÔNOMO DA BASE ==========
  // Sem o dono online, o bot define uma base em céu aberto, cria um baú de
  // estoque e inicia o projeto "base" (casa + cerca com portão). Só roda de dia,
  // fora do abrigo, e respeita o limite de jogadores do servidor.
  function openSky(position) {
    for (let y = 1; y <= 10; y++) {
      const block = bot.blockAt(position.offset(0, y, 0))
      if (!block || block.boundingBox === 'block') return false
    }
    return true
  }

  function setBaseHere() {
    const position = bot.entity.position.floored()
    if (!openSky(position)) return false
    const entry = waypointManager.save('base', position, currentDimension())
    memory.lembrarLugar('base', dito(bot.username), 'base definida automaticamente')
    persistSoon()
    console.log(`[base] definida automaticamente em ${entry.position.x}, ${entry.position.y}, ${entry.position.z}`)
    bot.chat(`Base definida em X=${entry.position.x}, Y=${entry.position.y}, Z=${entry.position.z}.`)
    return true
  }

  async function autoStorage(isCancelled) {
    try {
      const block = storage.configureNearest(bot, 8)
      console.log(`[estoque] usando ${block.name} em ${block.position.x}, ${block.position.y}, ${block.position.z}`)
      persistSoon()
      return true
    } catch { /* sem baú perto: fabrica um */ }

    if (!bot.inventory.items().some((item) => item.name === 'chest')) {
      await craft.craftItem(bot, 'chest', 1, isCancelled)
    }
    if (isCancelled()) return false
    if (!bot.inventory.items().some((item) => item.name === 'chest')) return false

    const base = homeProvider() || bot.entity.position.floored()
    // Fica na base (não em cima do futuro baú) para ter alcance e linha de visão.
    // O bot pode ter ido minerar no subsolo; 60s cobrem a subida e o caminho.
    const baseVec = new Vec3(base.x, base.y, base.z)
    if (bot.entity.position.distanceTo(baseVec) > 4) {
      console.log(`[estoque] voltando à base para colocar o baú (${Math.round(bot.entity.position.distanceTo(baseVec))} blocos)`)
      await food.goTo(bot, new goals.GoalNear(base.x, base.y, base.z, 1), 60000).catch(() => {})
    }
    if (isCancelled()) return false
    if (bot.entity.position.distanceTo(baseVec) > 6) {
      console.log(`[estoque] ainda longe da base (${Math.round(bot.entity.position.distanceTo(baseVec))} blocos); tento depois`)
      return false
    }
    const spots = []
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        if (dx === 0 && dz === 0) continue
        // A casa do projeto fica no quadrante x>=0, z>=0; não coloque o baú lá.
        if (dx > 0 && dz > 0) continue
        for (const dy of [0, 1, -1, 2, -2, 3, -3]) {
          const ground = new Vec3(Math.floor(base.x) + dx, Math.floor(base.y) + dy - 1, Math.floor(base.z) + dz)
          const position = ground.offset(0, 1, 0)
          const above = position.offset(0, 1, 0)
          const floor = bot.blockAt(ground)
          const here = bot.blockAt(position)
          const top = bot.blockAt(above)
          if (!floor || !here || !top) continue
          if (floor.boundingBox !== 'block' || /water|lava|bubble_column/.test(floor.name)) continue
          if (here.boundingBox !== 'empty' || top.boundingBox !== 'empty') continue
          const distance = position.distanceTo(bot.entity.position)
          if (distance < 1.3 || distance > 5) continue
          spots.push({ ground, position, dist: distance })
        }
      }
    }
    spots.sort((a, b) => a.dist - b.dist)
    console.log(`[estoque] ${spots.length} lugar(es) candidato(s) perto da base`)
    let lastError = null
    for (const spot of spots.slice(0, 12)) {
      if (isCancelled()) return false
      try {
        await food.goTo(bot, new goals.GoalNear(spot.position.x, spot.position.y, spot.position.z, 2), 10000).catch(() => {})
        if (isCancelled()) return false
        await bot.lookAt(spot.position.offset(0.5, 0.5, 0.5), true)
        const item = bot.inventory.items().find((entry) => entry.name === 'chest')
        if (!item) return false
        await bot.equip(item, 'hand')
        const reference = bot.blockAt(spot.ground)
        if (!reference) throw new Error('bloco de apoio do baú não carregado')
        await bot.placeBlock(reference, new Vec3(0, 1, 0))
      } catch (err) {
        lastError = err
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      const placed = bot.blockAt(spot.position)
      if (!placed || (placed.name !== 'chest' && placed.name !== 'barrel')) {
        console.log(`[estoque] tentativa em ${spot.position.x},${spot.position.y},${spot.position.z}: ${placed?.name || 'nada'}`)
      }
      if (placed?.name === 'chest' || placed?.name === 'barrel') {
        storage.setPosition(placed.position)
        persistSoon()
        console.log(`[estoque] baú colocado em ${placed.position.x}, ${placed.position.y}, ${placed.position.z}`)
        bot.chat('Estoque central criado.')
        return true
      }
    }
    if (lastError) console.log(`[estoque] baú não colocado: ${lastError.message}`)
    return false
  }

  async function autoStartProject() {
    const type = process.env.MBOT_AUTO_PROJECT
    if (!type || projectManager.isActive()) return false
    if (!homeProvider() || !storage.configured()) return false
    // Um projeto automático por tipo: reinícios não constroem outra casa/cerca
    // por cima da primeira. Para repetir, apague o marcador em .data/.
    const marker = path.join(__dirname, '.data', `auto-project-${type}.started`)
    try {
      if (require('fs').existsSync(marker)) return false
    } catch { /* sem marcador: segue */ }
    const created = await ensureProjectWorkers(type)
    projectManager.start(type)
    colony.setAuto(true)
    try {
      require('fs').mkdirSync(path.dirname(marker), { recursive: true })
      require('fs').writeFileSync(marker, new Date().toISOString())
    } catch (err) {
      console.log(`[projeto] não gravei o marcador: ${err.message}`)
    }
    persistSoon()
    console.log(`[projeto] ${type} iniciado automaticamente (auto=true)${created.length ? `; workers: ${created.join(', ')}` : ''}`)
    bot.chat(`Projeto ${type} iniciado automaticamente.`)
    return true
  }

  async function autoSetupTick() {
    if (autoSetupBusy || !bot.entity || !bot.time?.isDay || sheltered) return
    autoSetupBusy = true
    try {
      if (!homeProvider()) {
        setBaseHere()
        return
      }
      if (!storage.configured()) {
        if (Date.now() < autoStorageRetryAt) return
        let stored = false
        await runTask('preparar estoque', async (isCancelled) => {
          stored = await autoStorage(isCancelled)
          if (!stored && !isCancelled()) {
            console.log('[estoque] não achei lugar para o baú; tentando de novo em 60s')
          }
        })
        if (!stored) autoStorageRetryAt = Date.now() + 60000
        return
      }
      if (!projectManager.isActive() && process.env.MBOT_AUTO_PROJECT) {
        if (Date.now() < autoProjectRetryAt) return
        try {
          await autoStartProject()
        } catch (err) {
          autoProjectRetryAt = Date.now() + 60000
          throw err
        }
      }
      // Lote único de ferro para o baú; depois o marcador evita repetir.
      const ironBatch = Number(process.env.MBOT_AUTO_IRON_BATCH) || 0
      if (ironBatch > 0 && !ironBatchBusy && Date.now() >= autoIronRetryAt && bot.time.timeOfDay <= 14000) {
        const marker = path.join(__dirname, '.data', 'auto-iron-batch.done')
        if (!require('fs').existsSync(marker)) {
          ironBatchBusy = true
          let ok = false
          try {
            await runTask('minerar ferro para o baú', async (isCancelled) => {
              const result = await mineIronBatch(Math.min(128, ironBatch), isCancelled)
              const text = Object.entries(result.deposited || {}).map(([name, quantity]) => `${quantity}x ${name}`).join(', ')
              if (!isCancelled() && text) {
                ok = true
                console.log(`[ferro] lote guardado: ${text}`)
                const where = result.chest ? ` em ${result.chest.x}, ${result.chest.y}, ${result.chest.z}` : ''
                bot.chat(`Ferro guardado no baú${where}: ${text}`)
              }
            })
          } finally {
            ironBatchBusy = false
          }
          if (ok) {
            try { require('fs').writeFileSync(marker, new Date().toISOString()) } catch {}
          } else {
            autoIronRetryAt = Date.now() + 120000
          }
        }
      }
    } catch (err) {
      console.log(`[auto] ${err.message}`)
    } finally {
      autoSetupBusy = false
    }
  }

  function scheduleAutoSetup() {
    if (autoSetupTimer) return
    if (process.env.MBOT_AUTO_BASE !== '1' && !process.env.MBOT_AUTO_PROJECT) return
    autoSetupTimer = setInterval(() => { autoSetupTick() }, 5000)
    autoSetupTimer.unref?.()
  }

  // Ponto de origem da planta: onde o dono está (ou o próprio bot, com "aqui").
  function blueprintOrigin(useBot) {
    const entity = useBot ? bot.entity : ownerEntity()
    if (!entity) return null
    const p = entity.position
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
  }

  // Colônia: divide a planta em fatias entre construtores; cada fatia só começa
  // quando o estoque central tem o material dela, e o que falta entra na demanda.
  async function startBlueprintProject(name, buildersArg) {
    try {
      if (!name) throw new Error(`diga a planta: ${blueprint.listBlueprints().map((p) => p.name).join(', ') || 'nenhuma em plantas/'}`)
      if (!homeProvider()) throw new Error('defina a base primeiro com !base aqui')
      if (!storage.configured()) throw new Error('defina o estoque primeiro com !estoque aqui')
      if (projectManager.isActive()) throw new Error(`já existe projeto ativo: ${projectManager.active.type}`)
      const origin = blueprintOrigin(false)
      if (!origin) throw new Error('não estou te vendo; fique onde a planta deve começar')

      const plan = await blueprint.loadBlueprint(name, { version: bot.version })
      const builders = Math.max(1, Math.min(4, Number.parseInt(buildersArg, 10) || 2))
      const regions = blueprint.splitRegions(plan, builders).map((region) => ({
        region,
        materials: blueprint.regionMaterials(plan, region)
      }))
      const roles = { construtor: regions.length, minerador: 1, lenhador: 1, artesao: 1 }
      const created = await ensureProjectWorkers('planta', roles)
      projectManager.startBlueprint({ name: plan.name, origin, size: plan.size, regions, builders: regions.length })
      colony.setAuto(true)
      persistSoon()

      bot.chat(`Projeto planta ${plan.name} (${plan.size.x}x${plan.size.y}x${plan.size.z}) iniciado em ${origin.x} ${origin.y} ${origin.z}, ${regions.length} fatia(s).`)
      if (created.length) bot.chat(`Bots criados para o projeto: ${created.join(', ')}`)
      for (const line of projectStatusLines()) bot.chat(line)
    } catch (err) {
      bot.chat(`Não consegui iniciar a planta: ${err.message}`)
    }
  }

  // Bot principal: constrói sozinho com o que tem no inventário.
  async function buildBlueprintSolo(name, useBot) {
    if (!name) {
      bot.chat('Uso: !construir planta <nome> [aqui]. Veja !plantas')
      return
    }
    let plan
    try {
      plan = await blueprint.loadBlueprint(name, { version: bot.version })
    } catch (err) {
      bot.chat(`${err.message}. Veja !plantas`)
      return
    }
    const origin = blueprintOrigin(useBot)
    if (!origin) {
      bot.chat('Não estou te vendo. Use !construir planta <nome> aqui para construir onde eu estou.')
      return
    }
    const steps = blueprint.buildOrder(plan)
    const { materials, ignored } = blueprint.materialList(plan.blocks)
    const missing = blueprint.missingMaterials(materials, blueprint.inventoryCounts(bot.inventory.items()))
    if (Object.keys(missing).length) {
      bot.chat(`Para a planta ${plan.name} faltam: ${blueprint.formatMaterials(missing, 10)}`)
      return
    }
    if (Object.keys(ignored).length) bot.chat(`Vou pular o que não se coloca com a mão: ${blueprint.formatMaterials(ignored)}`)
    bot.chat(`Construindo ${plan.name} (${plan.size.x}x${plan.size.y}x${plan.size.z}, ${steps.length} blocos) em ${origin.x} ${origin.y} ${origin.z}. Saia da área!`)
    runTask('construir planta', async (isCancelled) => {
      const report = await buildBlueprint(bot, steps, origin, {
        isCancelled,
        clear: plan.air,
        log: (msg) => console.log(`[planta] ${msg}`)
      })
      if (isCancelled()) return
      console.log(`[planta] ${plan.name}:`, report)
      bot.chat(`Planta ${plan.name}: ${describeReport(report)}.`)
      if (report.obstructed.length) {
        const first = report.obstructed.slice(0, 3).map((o) => `${o.name} em ${o.x} ${o.y} ${o.z}`).join('; ')
        bot.chat(`Não quebrei blocos que não são terreno natural: ${first}`)
      }
    }, { resume: 'ficar' })
  }

  commandRouter.register('plantas', async (_context, args) => {
    const name = args[0]
    if (!name) {
      const list = blueprint.listBlueprints()
      bot.chat(list.length
        ? `Plantas: ${list.map((p) => p.name).join(', ')}. Detalhes: !plantas <nome>`
        : 'Nenhuma planta em plantas/ (.schem, .litematic, .schematic, .nbt).')
      return
    }
    try {
      const summary = blueprint.summarize(await blueprint.loadBlueprint(name, { version: bot.version }))
      bot.chat(`${summary.name}: ${summary.size.x}x${summary.size.y}x${summary.size.z}, ${summary.blocks} blocos.`)
      bot.chat(`Materiais: ${blueprint.formatMaterials(summary.materials, 12)}`)
    } catch (err) {
      bot.chat(`Não consegui ler a planta: ${err.message}`)
    }
  })

  commandRouter.register(['projeto', 'projetos'], async (_context, args) => {
    let action = String(args[0] || 'status').toLowerCase()

    if (action === 'tipos' || action === 'listar' || action === 'lista') {
      bot.chat(`Projetos: ${projectManager.types().join(', ')}.`)
      return
    }

    if (action === 'status') {
      for (const line of projectStatusLines()) bot.chat(line)
      return
    }

    if (action === 'cancelar' || action === 'parar') {
      for (const { controller } of colony.controllers()) {
        if (controller.currentTask?.projectType) controller.cancel()
      }
      const cancelled = projectManager.cancel()
      persistSoon()
      if (!cancelled) {
        bot.chat('Nenhum projeto para cancelar.')
        return
      }
      bot.chat(`Projeto ${cancelled.type} cancelado. O modo automático continua disponível para a colônia.`)
      return
    }

    // "!projeto iniciar <tipo>" é o mesmo que "!projeto <tipo>".
    const rest = action === 'iniciar' ? args.slice(2) : args.slice(1)
    if (action === 'iniciar') action = String(args[1] || '').toLowerCase()

    if (action === 'planta') {
      await startBlueprintProject(rest[0], rest[1])
      return
    }

    const definition = projectManager.definition(action)
    if (!definition) {
      bot.chat('Uso: !projeto <casa|fazenda|mina|vila> | !projeto planta <nome> [construtores] | !projeto status | !projeto cancelar')
      return
    }

    try {
      if (!homeProvider()) throw new Error('defina a base primeiro com !base aqui')
      if (!storage.configured()) throw new Error('defina o estoque primeiro com !estoque aqui')
      if (projectManager.isActive()) throw new Error(`já existe projeto ativo: ${projectManager.active.type}`)

      const created = await ensureProjectWorkers(action)
      projectManager.start(action)
      colony.setAuto(true)
      persistSoon()

      bot.chat(`Projeto ${action} iniciado. Orquestração automática ativada.`)
      if (created.length) bot.chat(`Bots criados para o projeto: ${created.join(', ')}`)
      for (const line of projectStatusLines()) bot.chat(line)
    } catch (err) {
      bot.chat(`Não consegui iniciar o projeto: ${err.message}`)
    }
  })

  commandRouter.register('ordem', async (_context, args) => {
    if (args.length < 2) {
      bot.chat('Uso: !ordem <papel> <recurso> [qtd]. Ex.: !ordem mineradores ferro 64')
      return
    }
    const role = args[0]
    const resource = args[1]
    const count = Math.max(1, Number.parseInt(args[2], 10) || 1)
    try {
      const normalized = botManager.normalizeRole(role)
      if (!normalized) throw new Error(`papel desconhecido: ${role}`)
      if (!colony.controllers(normalized).length) throw new Error(`não há bots com papel ${normalized}`)
      const task = colony.taskFor(normalized, resource, count)
      const request = await requestQueue.enqueue(normalized, task)
      bot.chat(`Pedido ${request.id.slice(0, 8)} na fila: ${resource} x${count}.`)
    } catch (err) {
      bot.chat(`Não consegui distribuir a ordem: ${err.message}`)
    }
  })

  commandRouter.register('todos', async (_context, args) => {
    if (String(args[0] || '').toLowerCase() !== 'voltar') {
      bot.chat('Uso: !todos voltar')
      return
    }
    const names = await colony.returnAll()
    bot.chat(names.length ? `Chamando ${names.length} bot(s) de volta para a base.` : 'Não há bots auxiliares.')
  })

  commandRouter.register('construir', async (_context, args) => {
    const what = String(args[0] || '').toLowerCase()
    if (what === 'planta') {
      await buildBlueprintSolo(args[1], String(args[2] || '').toLowerCase() === 'aqui')
      return
    }
    try {
      if (['casa', 'abrigo'].includes(what)) {
        const name = await colony.buildHouse()
        bot.chat(`${name} recebeu a ordem de construir um abrigo 3x3.`)
        return
      }
      if (what === 'fazenda') {
        const name = await colony.buildFarm()
        bot.chat(`${name} recebeu a ordem de preparar uma fazenda física 5x5.`)
        return
      }
      if (what === 'mina') {
        const length = parseCount(args[1], 12)
        const name = await colony.buildMine(length)
        bot.chat(`${name} recebeu a ordem de abrir uma mina de ${length} blocos.`)
        return
      }
      if (what === 'curral') {
        const species = husbandry.normalizeSpecies(args[1] || 'vaca')
        if (!species) {
          bot.chat('Uso: !construir curral <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama>')
          return
        }
        const result = await colony.buildAnimalPen(species)
        bot.chat(`${result.name} recebeu a ordem de construir um curral 7x7 para ${species}.`)
        return
      }
      bot.chat('Uso: !construir casa | !construir fazenda | !construir mina [comprimento] | !construir curral [animal] | !construir planta <nome> [aqui]')
    } catch (err) {
      bot.chat(`Não consegui iniciar a construção: ${err.message}`)
    }
  })

  commandRouter.register('mundo', async () => {
    if (!worldMemory) { bot.chat('Memória do mundo desligada (MBOT_WORLD_MEMORY=1).'); return }
    const s = worldMemory.summary()
    const kinds = Object.entries(s.byKind).map(([k, v]) => `${k}:${v.CONFIRMED}/${v.STALE}/${v.INVALIDATED}`).join(' ')
    console.log(`[world-memory] resumo ${JSON.stringify(s)}`)
    bot.chat(`Mundo: ${s.places} lugares (${kinds || 'vazio'}), ${s.explored} chunks; criados=${s.metrics.created} confirmados=${s.metrics.confirmed} invalidados=${s.metrics.invalidated} consultas=${s.metrics.queries} úteis=${s.metrics.usefulQueries} stale=${s.metrics.staleQueries} explore=${s.metrics.exploreChoices}/rep${s.metrics.exploreRepeats}`)
  })

  commandRouter.register('base', async (context, args) => {
    const action = String(args[0] || 'status').toLowerCase()

    if (action === 'status') {
      const home = homeProvider()
      const dimension = homeDimension()
      if (!home) {
        bot.chat('Base ainda não definida. Vá ao local desejado e use !base aqui.')
        return
      }
      bot.chat(`Base: X=${Math.floor(home.x)}, Y=${Math.floor(home.y)}, Z=${Math.floor(home.z)}${dimension ? ` | ${dimension}` : ''}.`)
      return
    }

    if (action === 'limpar' || action === 'remover') {
      waypointManager.remove('base')
      memory.esquecerLugar('base')
      colony.setAuto(false)
      if (projectManager.isActive()) projectManager.cancel()
      persistSoon()
      bot.chat('Base removida. O modo automático foi desativado e o projeto ativo foi cancelado.')
      return
    }

    if (action !== 'aqui') {
      bot.chat('Uso: !base aqui | !base status | !base limpar')
      return
    }

    const player = bot.players[context.username]?.entity
    const source = player?.position || bot.entity?.position
    if (!source) {
      bot.chat('Não consigo determinar sua posição agora.')
      return
    }

    const entry = waypointManager.save('base', source, currentDimension())
    persistSoon()
    memory.lembrarLugar('base', dito(context.username), 'base definida pelo jogador')
    bot.chat(`Este local agora é a base: X=${Math.floor(entry.position.x)}, Y=${Math.floor(entry.position.y)}, Z=${Math.floor(entry.position.z)}${entry.dimension ? ` | ${entry.dimension}` : ''}.`)
  })

  commandRouter.register(['local', 'locais'], async (context, args) => {
    const action = String(args[0] || 'listar').toLowerCase()

    if (['listar', 'lista', 'status'].includes(action) && !args[1]) {
      const points = waypointManager.list()
      if (!points.length) {
        bot.chat('Nenhum local salvo. Use !local salvar <nome>.')
        return
      }
      for (let i = 0; i < points.length; i += 4) {
        bot.chat(points.slice(i, i + 4).map((entry) =>
          `${entry.name}(${Math.floor(entry.position.x)},${Math.floor(entry.position.y)},${Math.floor(entry.position.z)})`
        ).join(', '))
      }
      return
    }

    if (action === 'salvar' || action === 'aqui') {
      const name = args.slice(1).join(' ')
      if (!name) {
        bot.chat('Uso: !local salvar <nome>')
        return
      }
      const player = bot.players[context.username]?.entity
      const source = player?.position || bot.entity?.position
      if (!source) {
        bot.chat('Não consigo determinar sua posição agora.')
        return
      }
      try {
        const entry = waypointManager.save(name, source, currentDimension())
        memory.lembrarLugar(entry.name, dito(context.username), 'local salvo pelo jogador')
        persistSoon()
        bot.chat(`Local ${entry.name} salvo em X=${Math.floor(entry.position.x)}, Y=${Math.floor(entry.position.y)}, Z=${Math.floor(entry.position.z)}.`)
      } catch (err) {
        bot.chat(`Não consegui salvar o local: ${err.message}`)
      }
      return
    }

    if (action === 'remover' || action === 'apagar') {
      const name = args.slice(1).join(' ')
      if (!name) {
        bot.chat('Uso: !local remover <nome>')
        return
      }
      const removed = waypointManager.remove(name)
      if (removed) {
        memory.esquecerLugar(name)
        persistSoon()
      }
      bot.chat(removed ? `Local ${name} removido.` : `Não encontrei o local ${name}.`)
      return
    }

    const name = action === 'status' ? args.slice(1).join(' ') : args.join(' ')
    const entry = waypointOrBase(name)
    if (!entry) {
      bot.chat(`Não encontrei o local ${name}.`)
      return
    }
    bot.chat(`${entry.name}: X=${Math.floor(entry.position.x)}, Y=${Math.floor(entry.position.y)}, Z=${Math.floor(entry.position.z)}${entry.dimension ? ` | ${entry.dimension}` : ''}.`)
  })

  commandRouter.register(['ir', 'viajar'], async (context, args) => {
    const name = args.join(' ')
    if (!name) {
      bot.chat('Uso: !ir <local>  ex.: !ir mina')
      return
    }
    const entry = await resolvePlace(name, context.username)
    if (!entry) return
    try {
      travelTo(entry)
    } catch (err) {
      bot.chat(`Não consigo ir para ${name}: ${err.message}`)
    }
  })

  commandRouter.register('voltar', async (_context, args) => {
    const name = args.length ? args.join(' ') : 'base'
    const entry = waypointOrBase(name)
    if (!entry) {
      bot.chat(name === 'base' ? 'Base ainda não definida.' : `Não encontrei o local ${name}.`)
      return
    }
    try {
      travelTo(entry)
    } catch (err) {
      bot.chat(`Não consigo voltar para ${name}: ${err.message}`)
    }
  })

  commandRouter.register('patrulha', async (_context, args) => {
    const action = String(args[0] || 'status').toLowerCase()

    if (action === 'status') {
      bot.chat(patrolActive
        ? `Patrulha ativa: ${patrolRoute.join(' -> ')}.`
        : 'Nenhuma patrulha ativa.')
      return
    }

    if (['off', 'parar', 'cancelar'].includes(action)) {
      clearPatrolState()
      if (taskName === 'patrulhar') cancelTask()
      mode = 'ficar'
      bot.chat('Patrulha encerrada.')
      return
    }

    if (args.length < 2) {
      bot.chat('Uso: !patrulha <local1> <local2> [local3...] | !patrulha off')
      return
    }

    const entries = args.map((name) => waypointOrBase(name))
    const missingIndex = entries.findIndex((entry) => !entry)
    if (missingIndex >= 0) {
      bot.chat(`Não encontrei o local ${args[missingIndex]}.`)
      return
    }

    try {
      startPatrol(entries)
    } catch (err) {
      bot.chat(`Não consegui iniciar a patrulha: ${err.message}`)
    }
  })

  commandRouter.register('enviar', async (_context, args) => {
    const workerName = String(args[0] || '').toLowerCase()
    const locationName = args.slice(1).join(' ')
    if (!workerName || !locationName) {
      bot.chat('Uso: !enviar <bot> <local>')
      return
    }
    const entry = waypointOrBase(locationName)
    if (!entry) {
      bot.chat(`Não encontrei o local ${locationName}.`)
      return
    }
    try {
      assertWaypointReachable(entry)
      await colony.sendTo(workerName, entry.position)
      bot.chat(`${workerName} recebeu a ordem de ir para ${entry.name}.`)
    } catch (err) {
      bot.chat(`Não consegui enviar ${workerName}: ${err.message}`)
    }
  })

  commandRouter.register('explorar', async (_context, args) => {
    const parts = [...args]
    let radius = 64
    if (/^\d+$/.test(parts.at(-1) || '')) radius = Number.parseInt(parts.pop(), 10)
    const locationName = parts.join(' ')
    if (!locationName) {
      bot.chat('Uso: !explorar <local> [raio]')
      return
    }
    const entry = waypointOrBase(locationName)
    if (!entry) {
      bot.chat(`Não encontrei o local ${locationName}.`)
      return
    }
    try {
      assertWaypointReachable(entry)
      const result = await colony.exploreAt(entry.position, radius)
      bot.chat(`${result.name} vai explorar ao redor de ${entry.name} (raio ${result.radius}).`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a exploração: ${err.message}`)
    }
  })

  commandRouter.register('animais', async (_context, args) => {
    const radius = Math.max(4, Math.min(64, Number.parseInt(args[0], 10) || 24))
    const nearby = husbandry.counts(bot, radius)
    const entries = Object.entries(nearby).sort((a, b) => b[1] - a[1])
    if (!entries.length) {
      bot.chat(`Não vejo animais suportados num raio de ${radius} blocos.`)
      return
    }
    bot.chat(`Animais (${radius} blocos): ${entries.map(([name, count]) => `${name}x${count}`).join(', ')}`)
  })

  commandRouter.register('curral', async (_context, args) => {
    const action = String(args[0] || 'vaca').toLowerCase()

    if (action === 'metas') {
      const targets = colony.animalTargetsSnapshot()
      const entries = Object.entries(targets)
      bot.chat(entries.length
        ? `Metas de animais: ${entries.map(([species, target]) => `${species}=${target}`).join(', ')}.`
        : 'Nenhuma meta persistente de animais configurada.')
      return
    }

    if (action === 'meta') {
      const species = husbandry.normalizeSpecies(args[1])
      const rawTarget = String(args[2] || '').toLowerCase()
      if (!species) {
        bot.chat('Uso: !curral meta <animal> <2-32|off>')
        return
      }
      if (['off', 'remover', 'apagar'].includes(rawTarget)) {
        const removed = colony.clearAnimalTarget(species)
        persistSoon()
        bot.chat(removed
          ? `Meta automática de ${species} removida.`
          : `Não havia meta automática para ${species}.`)
        return
      }

      const target = Number.parseInt(rawTarget, 10)
      if (!Number.isInteger(target) || target < 2 || target > 32) {
        bot.chat('Uso: !curral meta <animal> <2-32|off>')
        return
      }
      colony.setAnimalTarget(species, target)
      persistSoon()
      bot.chat(`Meta automática de ${species}: ${target}. Ela é mantida quando !colonia auto estiver ativo.`)
      return
    }

    const species = husbandry.normalizeSpecies(action)
    if (!species) {
      bot.chat('Uso: !curral <animal> | !curral metas | !curral meta <animal> <2-32|off>')
      return
    }
    const home = homeProvider()
    if (!home) {
      bot.chat('Base ainda não definida. Use !base aqui.')
      return
    }

    const plan = groundedPenPlan(bot, home, species)
    const status = inspectAnimalPen(bot, plan)
    const center = new Vec3(plan.center.x, plan.center.y, plan.center.z)
    const inside = husbandry.selectAnimals(bot, species, {
      center,
      range: plan.size + 2,
      filter: (entity) => pointInsidePen(entity.position, plan)
    }).length
    const target = colony.animalTargetsSnapshot()[species]

    bot.chat(
      `Curral ${species}: ${status.built ? 'pronto' : 'incompleto'} | cercas ${status.fencesPresent}/${status.fencesExpected} | portão ${status.gatePresent ? (status.gateOpen ? 'aberto' : 'fechado') : 'ausente'} | animais dentro ${inside}${target ? ` | meta ${target}` : ''}.`
    )
  })

  commandRouter.register(['capturar', 'recolheranimais'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const count = Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
    if (!species) {
      bot.chat('Uso: !capturar <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [qtd]')
      return
    }
    if (!homeProvider()) {
      bot.chat('Base ainda não definida. Use !base aqui.')
      return
    }

    try {
      const result = await colony.captureAnimals(species, count)
      bot.chat(`${result.name} vai levar até ${result.count} ${species} para o curral.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a captura: ${err.message}`)
    }
  })

  commandRouter.register(['reproduzir', 'criaranimais'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const pairs = Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
    if (!species) {
      bot.chat('Uso: !reproduzir <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [pares]')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (farmers.length) {
      try {
        const result = await colony.breedAnimals(species, pairs)
        bot.chat(`${result.name} vai tentar reproduzir ${pairs} par(es) de ${species}.`)
      } catch (err) {
        bot.chat(`Não consegui delegar a reprodução: ${err.message}`)
      }
      return
    }

    autonomous = false
    clearPatrolState()
    persistSoon()
    bot.chat(`Vou tentar reproduzir ${pairs} par(es) de ${species}.`)
    runTask(`reproduzir ${species}`, async (isCancelled) => {
      const result = await husbandry.breed(bot, species, pairs, isCancelled, { storage })
      if (isCancelled()) return
      if (result.ok) {
        bot.chat(`Alimentei ${result.fed} ${species}; tentei ${result.pairsAttempted} par(es).`)
      } else if (result.reason === 'sem_alimento') {
        bot.chat(`Não tenho alimento adequado. Aceito: ${result.feed.join(', ')}.`)
      } else {
        bot.chat(`Não há animais suficientes: encontrei ${result.nearby} ${species}.`)
      }
    })
  })

  commandRouter.register(['manejo', 'populacao', 'população'], async (_context, args) => {
    const species = husbandry.normalizeSpecies(args[0])
    const target = Math.max(2, Math.min(32, Number.parseInt(args[1], 10) || 6))
    if (!species) {
      bot.chat('Uso: !manejo <vaca|ovelha|porco|galinha|coelho|cabra|mooshroom|lhama> [alvo]')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (farmers.length) {
      try {
        const result = await colony.manageAnimalPopulation(species, target)
        bot.chat(`${result.name} vai manejar ${species} com meta de ${result.target} animais.`)
      } catch (err) {
        bot.chat(`Não consegui delegar o manejo: ${err.message}`)
      }
      return
    }

    autonomous = false
    clearPatrolState()
    persistSoon()
    runTask(`manejar população de ${species}`, async (isCancelled) => {
      const result = await husbandry.managePopulation(bot, species, target, isCancelled, { storage })
      if (isCancelled()) return
      if (result.action === 'nenhuma') {
        bot.chat(`População de ${species} já está na meta: ${result.current}/${result.target}.`)
      } else if (result.action === 'aguardar') {
        bot.chat(`Só encontrei ${result.current} ${species}; preciso de pelo menos dois para reproduzir.`)
      } else if (result.ok) {
        bot.chat(`Manejo de ${species}: atual ${result.current}, alvo ${result.target}, pares tentados ${result.pairsAttempted}.`)
      } else if (result.reason === 'sem_alimento') {
        bot.chat(`Manejo parado por falta de alimento: ${result.feed.join(', ')}.`)
      } else {
        bot.chat(`Manejo de ${species} incompleto; encontrei ${result.current} e a meta é ${result.target}.`)
      }
    })
  })

  commandRouter.register(['produto', 'produtoanimal'], async (_context, args) => {
    const product = animalProducts.normalizeProduct(args[0])
    const count = product === 'milk'
      ? Math.max(1, Math.min(16, Number.parseInt(args[1], 10) || 1))
      : product === 'eggs'
        ? 1
        : Math.max(1, Math.min(32, Number.parseInt(args[1], 10) || 1))
    if (!product) {
      bot.chat('Uso: !produto la [1-32] | !produto leite [1-16] | !produto ovos')
      return
    }

    const farmers = botManager.byRole('fazendeiro')
    if (!farmers.length) {
      bot.chat('Preciso de um fazendeiro na colônia para trabalhar dentro dos currais.')
      return
    }

    try {
      const result = await colony.collectAnimalProduct(product, count)
      bot.chat(`${result.name} recebeu a tarefa de coletar ${product}${product === 'eggs' ? ' disponível' : ` x${result.count}`}.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a produção animal: ${err.message}`)
    }
  })

  commandRouter.register(['tosquiar', 'tosquia'], async (_context, args) => {
    const count = Math.max(1, Math.min(32, Number.parseInt(args[0], 10) || 1))
    const farmers = botManager.byRole('fazendeiro')

    if (farmers.length) {
      try {
        const result = await colony.shearSheep(count)
        bot.chat(`${result.name} vai tentar tosquiar até ${result.count} ovelha(s).`)
      } catch (err) {
        bot.chat(`Não consegui delegar a tosquia: ${err.message}`)
      }
      return
    }

    autonomous = false
    clearPatrolState()
    persistSoon()
    runTask('tosquiar ovelhas', async (isCancelled) => {
      const result = await husbandry.shearSheep(bot, count, isCancelled, {
        storage,
        production
      })
      if (isCancelled()) return
      if (result.ok) bot.chat(`Tentei tosquiar ${result.sheared} ovelha(s); recolhi os drops disponíveis.`)
      else bot.chat(result.reason === 'sem_tesoura'
        ? 'Não consegui uma tesoura.'
        : 'Não encontrei ovelhas disponíveis por perto.')
    })
  })

  commandRouter.register('smoke', async () => {
    bot.chat('Executando smoke test da colônia...')
    const result = await withoutFollowing('smoke test', () => smokeTest.run())
    const status = result.ok ? 'PASSOU' : 'FALHOU'
    bot.chat(`Smoke: ${status} | ${result.passed} ok | ${result.failed} falha(s).`)
    for (const check of result.checks) {
      if (check.ok === false) bot.chat(`FALHA ${check.name}: ${check.detail}`)
    }
  })

  commandRouter.register('tarefas', async (_context, args) => {
    if (args[0] === 'cancelar') {
      if (!args[1]) { bot.chat('Uso: !tarefas cancelar <id>'); return }
      try {
        const request = await requestQueue.cancel(args[1])
        bot.chat(`Pedido ${request.id.slice(0, 8)} cancelado.`)
      } catch (err) { bot.chat(`Não consegui cancelar: ${err.message}`) }
      return
    }
    const requests = requestQueue.list().slice(-10)
    if (requests.length) {
      for (const request of requests) {
        bot.chat(`Pedido ${request.id.slice(0, 8)}: ${request.status} ${request.role} ${request.task.resource || request.task.type}${request.worker ? ` (${request.worker})` : ''}`)
      }
    }
    const tasks = colony.taskSummary()
    if (!tasks.length) {
      bot.chat('Nenhum bot auxiliar na colônia.')
      return
    }
    for (let i = 0; i < tasks.length; i += 4) {
      bot.chat(tasks.slice(i, i + 4).map((entry) =>
        `${entry.name}:${entry.state}${entry.task ? '/' + entry.task : ''}${entry.resource || entry.item ? '/' + (entry.resource || entry.item) : ''}`
      ).join(', '))
    }
  })

  commandRouter.register('estoque', async (_context, args) => {
    const action = String(args[0] || 'status').toLowerCase()

    if (action === 'aqui' || action === 'definir') {
      try {
        const block = storage.configureNearest(bot, 8)
        await withoutFollowing('ler o estoque', () => storage.summary(bot))
        persistSoon()
        bot.chat(`Estoque central definido: ${block.name} em X=${block.position.x}, Y=${block.position.y}, Z=${block.position.z}.`)
      } catch (err) {
        bot.chat(`Não consegui definir o estoque: ${err.message}`)
      }
      return
    }

    if (action === 'guardar' || action === 'recolher') {
      if (!storage.configured()) {
        bot.chat('Defina primeiro o estoque com !estoque aqui.')
        return
      }
      const names = await colony.depositAll()
      bot.chat(names.length ? `Mandando ${names.length} bot(s) ociosos descarregar no estoque.` : 'Nenhum bot ocioso para descarregar.')
      return
    }

    if (action === 'limpar') {
      storage.setPosition(null)
      colony.setAuto(false)
      if (projectManager.isActive()) projectManager.cancel()
      persistSoon()
      bot.chat('Estoque central removido. O modo automático foi desativado e o projeto ativo foi cancelado.')
      return
    }

    if (!storage.configured()) {
      bot.chat('Estoque não configurado. Fique perto de um baú/barrel e use !estoque aqui.')
      return
    }

    try {
      const counts = await withoutFollowing('ler o estoque', () => storage.summary(bot))
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
      if (!entries.length) {
        bot.chat('Estoque central está vazio.')
        return
      }
      for (let i = 0; i < Math.min(entries.length, 20); i += 5) {
        bot.chat(entries.slice(i, i + 5).map(([name, count]) => `${name}x${count}`).join(', '))
      }
    } catch (err) {
      bot.chat(`Não consegui ler o estoque: ${err.message}`)
    }
  })

  // O próprio bot fabrica (coletando madeira/pedra e usando a mesa se precisar).
  function craftSelf(itemName, count) {
    const item = bot.registry.itemsByName[itemName]
    if (!item) {
      bot.chat(`Não conheço o item "${itemName}".`)
      return
    }
    const target = craft.countItem(bot, item.id) + count
    bot.chat(`Fabricando ${count}x ${item.name}...`)
    withCommitment(`fabricar ${count}x ${item.name}`, async () => {
      let result
      await runTask('fabricar', async (isCancelled) => {
        await craft.craftItem(bot, item.name, target, isCancelled)
        if (isCancelled()) return
        result = craft.countItem(bot, item.id) >= target
        bot.chat(`Pronto! Tenho ${craft.countItem(bot, item.id)}x ${item.name}.`)
      })
      return result
    }).catch(() => {})
  }

  commandRouter.register('fabricar', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !fabricar <item> [qtd]. Ex.: !fabricar picareta_ferro 2')
      return
    }
    let count = null
    if (/^\d+$/.test(args.at(-1))) count = Math.max(1, Number.parseInt(args.pop(), 10))
    const item = normalizeItemName(args.join('_'))
    // Sem quantidade: usa a preferência lembrada (ex.: tochas.quantidade=64).
    if (count == null) count = item === 'torch' ? memory.preferenciaNumero('tochas.quantidade', 1, 1, 256) : 1
    // Sem estoque central da colônia, o próprio bot fabrica para si.
    if (!storage.configured()) {
      craftSelf(item, count)
      return
    }
    try {
      const assignment = await colony.craft(item, count)
      bot.chat(`${assignment.name} vai fabricar ${count}x ${item} e guardar no estoque.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a fabricação: ${err.message}`)
    }
  })

  commandRouter.register('abastecer', async (_context, args) => {
    if (args.length < 2) {
      bot.chat('Uso: !abastecer <bot> <item> [qtd]')
      return
    }
    const name = String(args[0]).toLowerCase()
    const item = normalizeItemName(args[1])
    const count = Math.max(1, Number.parseInt(args[2], 10) || 1)
    try {
      await colony.supply(name, item, count)
      bot.chat(`${name} vai retirar ${count}x ${item} do estoque.`)
    } catch (err) {
      bot.chat(`Não consegui abastecer: ${err.message}`)
    }
  })

  commandRouter.register('bot', async (_context, args) => {
    const action = String(args[0] || '').toLowerCase()
    if (action === 'criar') {
      let role = String(args[1] || 'ajudante').toLowerCase()
      let count = Number.parseInt(args[2], 10) || 1
      if (/^\d+$/.test(role)) {
        count = Number.parseInt(role, 10)
        role = 'ajudante'
      }
      try {
        const created = await botManager.create(role, count)
        persistSoon()
        bot.chat(`Criados ${created.length}: ${created.map((w) => w.name).join(', ')}`)
      } catch (err) {
        bot.chat(`Não consegui criar bot: ${err.message}`)
      }
      return
    }

    if (action === 'remover' || action === 'parar') {
      const name = String(args[1] || '').toLowerCase()
      if (!name) {
        bot.chat('Uso: !bot remover <nome>')
        return
      }
      const removed = botManager.remove(name)
      if (removed) persistSoon()
      bot.chat(removed ? `${name} removido da colônia.` : `Não encontrei ${name}.`)
      return
    }

    bot.chat('Uso: !bot criar [papel] [qtd] | !bot remover <nome> | !bots')
  })

  commandRouter.register('item', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !item <nome>')
      return
    }
    const info = knowledge.describe(args.join('_'))
    if (!info) {
      bot.chat(`Não encontrei "${args.join(' ')}" no registro do Minecraft.`)
      return
    }
    const details = [
      info.isBlock ? 'bloco' : null,
      info.isItem ? 'item' : null,
      info.stackSize ? `pilha ${info.stackSize}` : null,
      info.foodPoints != null ? `comida +${info.foodPoints}` : null
    ].filter(Boolean).join(' | ')
    bot.chat(`${info.name}: ${details || 'registrado'}`)
  })

  commandRouter.register('receita', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !receita <item> [qtd]')
      return
    }
    let count = 1
    if (/^\d+$/.test(args.at(-1))) count = Math.max(1, Number.parseInt(args.pop(), 10))
    const plan = planner.craftPlan(args.join('_'), count)
    if (!plan.ok) {
      bot.chat(`Não conheço o item "${args.join(' ')}".`)
      return
    }
    if (plan.reason === 'sem_receita_conhecida') {
      bot.chat(`${plan.target}: não encontrei receita de crafting no registro atual.`)
      return
    }
    if (plan.craftable) {
      bot.chat(`Consigo fabricar ${count}x ${plan.target} com o inventário atual${plan.requiresTable ? ' (precisa bancada)' : ''}.`)
      return
    }
    bot.chat(`Para ${count}x ${plan.target} faltam: ${plan.missing.map((m) => `${m.name}x${m.needed}`).join(', ')}`)
  })

  // ========== MEMÓRIA ==========
  // Distância (em blocos) do bot até uma posição, para as respostas do !onde.
  function distanceText(position) {
    if (!bot.entity || !position) return ''
    const dx = position.x - bot.entity.position.x
    const dz = position.z - bot.entity.position.z
    return ` | a ${Math.round(Math.hypot(dx, dz))} blocos`
  }

  commandRouter.register('lembrar', async (context, args) => {
    const text = args.join(' ').trim()
    if (!text) {
      bot.chat('Uso: !lembrar <nome> aqui | !lembrar <chave> = <valor> | !lembrar <anotação>')
      return
    }

    // Preferência: "!lembrar tochas.quantidade = 64"
    const eq = text.indexOf('=')
    if (eq > 0) {
      const key = normalizarChave(text.slice(0, eq))
      let value = parseValor(text.slice(eq + 1))
      if (!key || value === '') {
        bot.chat('Uso: !lembrar <chave> = <valor>  ex.: !lembrar seguir.distancia = 3')
        return
      }
      if (key === 'comida.preferida') value = normalizeItemName(value)
      memory.definirPreferencia(key, value, dito(context.username))
      bot.chat(`Anotado: ${key}=${value}.`)
      if (key === 'seguir.distancia' && mode === 'seguir' && !autonomous) follow()
      return
    }

    // Lugar: "!lembrar casa" (ou a forma antiga "!lembrar casa aqui").
    if (args.length >= 1 && (args.length === 1 || args.at(-1).toLowerCase() === 'aqui')) {
      const name = args.at(-1).toLowerCase() === 'aqui' ? args.slice(0, -1).join(' ') : args.join(' ')
      const source = bot.players[context.username]?.entity?.position || bot.entity?.position
      if (!source) {
        bot.chat('Não consigo determinar sua posição agora.')
        return
      }
      try {
        const entry = waypointManager.save(name, source, currentDimension())
        const item = memory.lembrarLugar(entry.name, dito(context.username), 'local lembrado pelo jogador')
        persistSoon()
        bot.chat(`Vou lembrar: ${entry.name} ${fmtPos(entry.position)} ${fmtOrigem(item.origem)}.`)
      } catch (err) {
        bot.chat(`Não consegui lembrar: ${err.message}`)
      }
      return
    }

    // Qualquer outra coisa vira uma anotação dita pelo jogador.
    memory.registrarFato(text, { assunto: 'nota' }, dito(context.username))
    bot.chat('Anotado.')
  })

  commandRouter.register('esquecer', async (_context, args) => {
    const name = args.join(' ').trim()
    if (!name) {
      bot.chat('Uso: !esquecer <nome>')
      return
    }
    let removed = memory.esquecer(name)
    if (waypointManager.remove(name)) {
      removed++
      persistSoon()
    }
    bot.chat(removed ? `Esqueci ${name}.` : `Não lembro de nada chamado ${name}.`)
  })

  commandRouter.register(['memoria', 'memória'], async (_context, args) => {
    const raw = args[0]
    const type = raw ? tipoDe(raw) : null
    if (raw && !type) {
      bot.chat('Uso: !memoria [lugares|preferencias|compromissos|fatos]')
      return
    }
    const counts = TIPOS.map((t) => `${memory.listar(t).length} ${t}`).join(', ')
    const items = memory.listar(type).slice(0, 6)
    bot.chat(`Memória: ${counts}.`)
    if (!items.length) {
      bot.chat(type ? `Nada do tipo ${type}.` : 'Ainda não lembro de nada. Use !lembrar <nome> aqui.')
      return
    }
    for (let i = 0; i < items.length; i += 2) {
      bot.chat(items.slice(i, i + 2).map((item) => memory.formatar(item)).join(' | ').slice(0, 250))
    }
  })

  commandRouter.register('onde', async (_context, args) => {
    const query = args.join(' ').trim()
    if (!query) {
      bot.chat('Uso: !onde <coisa>  ex.: !onde casa, !onde diamante, !onde morri')
      return
    }
    const place = resolveReference(query, placeEntries())
    const entry = place.match || (place.reason === 'ambiguo' ? place.candidates[0] : null)
    const facts = memory.buscarFatos(searchTerms(query))
    if (!entry && !facts.length) {
      bot.chat(`Não sei onde fica ${query}. Use !lembrar ${query} aqui.`)
      return
    }
    if (entry) {
      const tag = entry.origem ? ` ${fmtOrigem(entry.origem)}` : ''
      const others = place.reason === 'ambiguo' ? ` (também: ${place.candidates.slice(1, 3).map((e) => e.name).join(', ')})` : ''
      bot.chat(`${placeLabel(entry)}${tag}${distanceText(entry.position)}${others}`.slice(0, 250))
    }
    if (facts.length) {
      const [fact] = facts
      const more = facts.length > 1 ? ` (+${facts.length - 1})` : ''
      bot.chat(`${memory.formatar(fact)}${distanceText(fact.posicao)}${more}`.slice(0, 250))
    }
  })

  // Entrega ao dono: caminha até ele e joga as pilhas no pé.
  function startHandover(wanted, amountArg, thirdArg) {
    const name = handover.normalizeItem(wanted)
    if (!name || !bot.registry.itemsByName[name]) {
      bot.chat('Uso: !dar <item> [qtd]  ex.: !dar lapis 64')
      return
    }
    const amount = Math.max(1, Math.min(2304, Number.parseInt(amountArg, 10) || 64))
    // `mao` mantém a entrega direta; sem ele, o destino é o baú combinado.
    const inHand = ['mao', 'mão', 'hand'].includes(String(thirdArg || '').toLowerCase())
    setResumeTask({ kind: 'dar', name, amount })
    runTask(`entregar ${name}`, async (isCancelled) => {
      if (inHand) {
        const owner = ownerEntity()
        if (!owner) {
          bot.chat('Não vejo você por perto; chegue mais perto que eu entrego na mão.')
          return
        }
        const result = await handover.deliverTo(bot, { owner, name, amount, isCancelled })
        if (isCancelled()) return
        setResumeTask(null)
        if (result.delivered > 0) bot.chat(`Toma ${result.delivered}x ${name}.${result.missing ? ` Faltaram ${result.missing}.` : ''}`)
        else bot.chat(`Não entreguei ${name}: ${result.reason || 'nada saiu do inventário'}.`)
        return
      }
      // Prepara o baú na mochila antes de sair da base.
      const readyChest = await handover.prepareChestItem(bot, {
        withdraw: async (item, count) => (storage.configured() ? storage.withdraw(bot, item, count) : 0),
        craftItem: craft.craftItem,
        isCancelled,
        log: (text) => console.log(text)
      })
      if (isCancelled()) return
      console.log(`[entrega] baú na mochila: ${readyChest ? 'sim' : 'não'}`)
      bot.chat(`Levando ${amount}x ${name} para o baú em ${deliveryChest.x}, ${deliveryChest.y}, ${deliveryChest.z}.`)
      const result = await handover.depositAtChest(bot, {
        position: deliveryChest,
        name,
        amount,
        isCancelled,
        craftItem: craft.craftItem,
        withdraw: async (item, count) => (storage.configured() ? storage.withdraw(bot, item, count) : 0),
        log: (text) => console.log(text)
      })
      if (isCancelled()) return
      setResumeTask(null)
      if (result.ok) {
        if (result.created && result.chest) bot.chat(`Coloquei um baú em ${result.chest.x}, ${result.chest.y}, ${result.chest.z}.`)
        bot.chat(`Guardei ${result.deposited}x ${name} no baú (confirmei no baú).${result.missing ? ` Faltaram ${result.missing}.` : ''}`)
      } else {
        bot.chat(`Não entreguei ${name}: ${result.reason || 'nada saiu do inventário'}.`)
      }
    }, { resume: 'ficar' })
  }

  // Lápis fica fundo: desce cavando degraus e confirma pelo item no inventário.
  function startLapis(amountArg) {
    const target = Math.max(1, Math.min(64, Number.parseInt(amountArg, 10) || 64))
    const names = ['lapis_ore', 'deepslate_lapis_ore'].filter((n) => bot.registry.blocksByName[n])
    if (!names.length) {
      bot.chat('Este servidor não tem minério de lápis no registro.')
      return
    }
    setResumeTask({ kind: 'lapis', target })
    runTask('minerar lápis', async (isCancelled) => {
      if (bot.health < 10) {
        // Antes de descer: come o que tiver e tenta caçar/colher até recuperar.
        await eatNow()
        for (let i = 0; i < 3 && bot.health < 10 && !isCancelled(); i++) {
          const got = await food.gatherFood(bot, isCancelled).catch(() => null)
          if (!got) break
          await eatNow()
        }
        if (bot.health < 10) {
          bot.chat(`Estou com HP ${Math.round(bot.health)}/20; me alimente ou espere eu recuperar antes de descer.`)
          return
        }
      }
      bot.chat(`Vou descer até achar lápis (meta ${target}).`)
      const result = await deepmine.mineDeep(bot, { names, item: 'lapis_lazuli', target, isCancelled, floor: -58, maxSteps: 160 })
      if (isCancelled()) return
      setResumeTask(null)
      bot.chat(`Lápis: ${result.item}/${target} (${result.steps} degraus).${result.ok ? '' : ` Parei: ${result.reason}.`}`)
    })
  }

  // Sair da água: sobe nadando e busca terra seca ao lado.
  function startUnstick() {
    runTask('sair da água', async (isCancelled) => {
      if (!unstick.inWater(bot)) {
        bot.chat('Não estou na água.')
        return
      }
      bot.chat('Estou na água; subindo.')
      const up = await unstick.swimUp(bot, { isCancelled })
      if (isCancelled()) return
      const dry = await unstick.stepToDry(bot, {
        isCancelled,
        goTo: async (target) => {
          await food.goTo(bot, new goals.GoalNear(target.x, target.y, target.z, 1), 8000).catch(() => {})
        }
      })
      if (isCancelled()) return
      console.log(`[sair] ciclos=${up.cycles} terraFirme=${dry.ok}`)
      bot.chat(dry.ok ? 'Saí da água e estou em terra seca.' : 'Subi, mas ainda tem água em volta.')
    }, { resume: 'ficar' })
  }

  // Bolos: baú novo na base; se o servidor recusar o contêiner, derruba no chão.
  function startCakeFlow() {
    runTask('guardar bolos', async (isCancelled) => {
      const cakes = farm.countItem(bot, 'cake')
      if (cakes <= 0) {
        bot.chat('Não tenho bolo para guardar.')
        return
      }
      const at = handover.positionOf(bot.entity?.position)
      const withdraw = async (item, count) => (storage.configured() ? storage.withdraw(bot, item, count) : 0)
      const made = await handover.createChestAt(bot, at, {
        craftItem: craft.craftItem,
        withdraw,
        isCancelled,
        log: (text) => console.log(text)
      })
      if (isCancelled()) return
      if (made.block) {
        const where = handover.positionOf(made.block.position) || at
        deliveryChest = where
        persistSoon()
        console.log(`[bolos] baú novo em ${where.x}, ${where.y}, ${where.z}`)
        const result = await handover.depositAtChest(bot, {
          position: where,
          name: 'cake',
          amount: cakes,
          isCancelled,
          craftItem: craft.craftItem,
          withdraw,
          allowCreate: false,
          log: (text) => console.log(text)
        })
        if (isCancelled()) return
        if (result.ok) {
          console.log(`[bolos] guardados ${result.deposited} no baú`)
          bot.chat(`Guardei ${result.deposited} bolos no baú novo.`)
          return
        }
        console.log(`[bolos] depósito recusado: ${result.reason || 'sem motivo'}`)
      } else {
        console.log(`[bolos] sem baú: ${made.reason || 'sem motivo'}`)
      }
      const remaining = farm.countItem(bot, 'cake')
      const drop = await handover.dropItems(bot, { name: 'cake', amount: remaining, isCancelled })
      if (isCancelled()) return
      console.log(`[bolos] derrubados ${drop.dropped} no chão`)
      bot.chat(drop.dropped > 0 ? `Derrubei ${drop.dropped} bolos no chão da base.` : 'Não consegui guardar nem derrubar os bolos.')
    }, { resume: 'ficar' })
  }

  // Cria o baú de entrega no lugar onde o bot está, quando o ponto fixo não
  // aceita construção (proteção do servidor).
  function startMakeDeliveryChest() {
    runTask('fazer baú de entrega', async (isCancelled) => {
      const at = handover.positionOf(bot.entity?.position)
      if (!at) {
        bot.chat('Não sei onde estou para colocar o baú.')
        return
      }
      const made = await handover.ensureChest(bot, at, {
        isCancelled,
        craftItem: craft.craftItem,
        withdraw: async (item, count) => (storage.configured() ? storage.withdraw(bot, item, count) : 0),
        log: (text) => console.log(text)
      })
      if (isCancelled()) return
      if (!made.block) {
        console.log(`[báu] não criei: ${made.reason || 'sem motivo'}`)
        bot.chat(`Não consegui o baú aqui: ${made.reason || 'sem motivo'}.`)
        return
      }
      const where = handover.positionOf(made.block.position) || at
      deliveryChest = where
      persistSoon()
      console.log(`[báu] entrega definida em ${where.x}, ${where.y}, ${where.z}${made.created ? ' (novo)' : ' (já existia)'}`)
      bot.chat(`Baú de entrega em ${where.x}, ${where.y}, ${where.z}.${made.created ? ' Criei agora.' : ''}`)
    }, { resume: 'ficar' })
  }

  // Guarda no baú central: um item específico ou a carga que não é equipamento.
  function startStoreInStock(wanted, amountArg) {
    const name = wanted ? handover.normalizeItem(wanted) : null
    runTask(name ? `guardar ${name}` : 'guardar carga', async (isCancelled) => {
      if (!storage.configured()) {
        bot.chat('Estoque central não configurado; use !estoque aqui.')
        return
      }
      if (name) {
        const total = farm.countItem(bot, name)
        if (total <= 0) {
          bot.chat(`Não tenho ${name}.`)
          return
        }
        const amount = Math.max(1, Math.min(total, Number.parseInt(amountArg, 10) || total))
        const deposited = await storage.depositMany(bot, { [name]: amount })
          .catch((err) => { console.log(`[baú] ${name}: ${err.message}`); return {} })
        if (isCancelled()) return
        const text = Object.entries(deposited).map(([key, value]) => `${value}x ${key}`).join(', ')
        bot.chat(text ? `Guardei no baú: ${text}.` : `Não guardei ${name} (baú longe ou cheio).`)
        return
      }
      const cargo = await storage.depositCargo(bot)
        .catch((err) => { console.log(`[baú] carga: ${err.message}`); return {} })
      if (isCancelled()) return
      const text = Object.entries(cargo).map(([key, value]) => `${value}x ${key}`).join(', ')
      bot.chat(text ? `Guardei no baú: ${text}.` : 'Nada para guardar.')
    }, { resume: 'ficar' })
  }

  // Missão do dono: juntar N de CADA minério, contando pelo item na mochila.
  // Missão de minérios em equipe: o principal (se não estiver em criativo) e
  // mineradores ajudantes descem em degraus, cada um numa família de minério.
  // Progresso = mochilas da equipe + baú central. `!minerios [qtd] [ajudantes]`.
  function startOreMission(amountArg, helpersArg) {
    const target = Math.max(1, Math.min(64, Number.parseInt(amountArg, 10) || 64))
    const creative = bot.game?.gameMode === 'creative'
    const parsedHelpers = Number.parseInt(helpersArg, 10)
    const wantHelpers = Math.max(0, Number.isFinite(parsedHelpers) ? parsedHelpers : (creative ? 3 : 2))
    setResumeTask({ kind: 'minerios', target, helpers: wantHelpers })
    runTask('missão: minérios', async (isCancelled) => {
      const count = (name) => oreMission.countItem(bot, name)
      const helperBots = () => colony.controllers('minerador')
      // Mochilas da equipe + baú; minério bruto e fundido contam juntos (ferro bruto + lingote).
      const teamCount = (item) => oreMission.itemsFor(item).reduce((total, name) => {
        let sum = creative ? 0 : count(name)
        for (const { worker } of helperBots()) {
          sum += (worker.bot.inventory?.items?.() || []).filter((i) => i.name === name).reduce((acc, i) => acc + i.count, 0)
        }
        return total + sum + (storage.configured() ? (storage.cachedSummary()[name] || 0) : 0)
      }, 0)

      // Pede ajuda: cria os mineradores que faltam (até a capacidade da colônia).
      const missing = Math.min(wantHelpers - helperBots().length, botManager.capacity())
      if (missing > 0) {
        try {
          const created = await botManager.create('minerador', missing)
          persistSoon()
          bot.chat(`Chamei ajuda: ${created.map((w) => w.name).join(', ')}.`)
        } catch (err) {
          console.log(`[minérios] não consegui criar ajudantes: ${err.message}`)
        }
      }
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      // Espera os ajudantes entrarem no mundo (até 30 s).
      for (let i = 0; i < 30 && !isCancelled() && helperBots().some(({ worker }) => !worker.bot.entity); i++) await pause(1000)
      if (storage.configured()) await storage.summary(bot).catch((err) => console.log(`[minérios] não li o baú: ${err.message}`))
      if (isCancelled()) return

      const mainBadWood = [] // árvores que o principal não conseguiu cortar nesta missão
      const members = () => {
        const list = []
        if (!creative && bot.entity && bot.health > 0) {
          list.push({
            name: bot.username,
            bot,
            mine: async (family, need, cancel) => {
              const hasIronPick = () => bot.inventory.items().some((item) => ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(item.name))
              if (family.tool === 'iron' && !hasIronPick()) {
                // Sem madeira (subsolo): sobe até a base; o craft corta as árvores por perto.
                const hasWood = () => bot.inventory.items().some((i) => /_(log|planks|stem)$/.test(i.name)) || count('stick') >= 2
                const home = homeProvider()
                if (!hasWood() && home) {
                  console.log('[minérios] sem madeira aqui; subindo até a base')
                  await food.goTo(bot, new goals.GoalNear(Math.floor(home.x), Math.floor(home.y), Math.floor(home.z), 3), 120000).catch((err) => console.log(`[minérios] subir: ${err.message}`))
                  if (cancel()) return { ok: false, retry: true, reason: 'interrompido' }
                }
                // Sem árvore perto da base: vai até o tronco mais próximo à vista (fora de áreas que já falharam).
                // 6 troncos: gravetos e, sem carvão, combustível da fornalha.
                const isLog = (name) => /_(log|stem)$/.test(name)
                if (!hasWood()) await gather.mineBlocks(bot, isLog, 6, cancel).catch(() => 0)
                if (!hasWood() && !cancel()) {
                  const logIds = bot.registry.blocksArray.filter((b) => isLog(b.name)).map((b) => b.id)
                  const isBad = (p) => mainBadWood.some((q) => p.distanceTo(q) <= 8)
                  const tree = (bot.findBlocks({ matching: logIds, maxDistance: 128, count: 64 }) || []).find((p) => !isBad(p))
                  if (tree) {
                    console.log(`[minérios] indo cortar árvore em ${tree.x},${tree.y},${tree.z}`)
                    await food.goTo(bot, new goals.GoalNear(tree.x, tree.y, tree.z, 3), 120000).catch((err) => console.log(`[minérios] até a árvore: ${err.message}`))
                    if (!cancel()) await gather.mineBlocks(bot, isLog, 6, cancel).catch(() => 0)
                    if (!hasWood()) mainBadWood.push(tree)
                  }
                  if (cancel()) return { ok: false, retry: true, reason: 'interrompido' }
                }
                if (!hasWood()) return { ok: false, retry: true, reason: 'sem madeira para gravetos' }
                const ingots = () => oreMission.countItem(bot, 'iron_ingot')
                if (ingots() < 3 && count('raw_iron') > 0) {
                  await craft.smeltItem(bot, 'raw_iron', Math.min(count('raw_iron'), 3 - ingots()), cancel).catch((err) => console.log(`[minérios] fundir ferro: ${err.message}`))
                }
                await craft.craftItem(bot, 'iron_pickaxe', 1, cancel).catch((err) => console.log(`[minérios] picareta de ferro: ${err.message}`))
                // Sem a picareta certa, cavar não rende item: tenta de novo depois em vez de gastar tentativa.
                if (!hasIronPick()) return { ok: false, retry: true, reason: 'sem picareta de ferro' }
              }
              const names = family.blocks.filter((name) => bot.registry.blocksByName[name])
              return deepmine.mineDeep(bot, { names, item: family.item, target: count(family.item) + need, isCancelled: cancel, floor: -58, maxSteps: 200 })
            }
          })
        }
        for (const { worker, controller } of helperBots()) {
          if (!worker.bot.entity || worker.bot.health <= 0 || controller.state === 'desconectado') continue
          list.push({
            name: worker.name,
            bot: worker.bot,
            stop: () => { if (controller.currentTask?.type === 'minerar_fundo') controller.cancel() },
            mine: (family, need) => controller.run({
              type: 'minerar_fundo', blocks: family.blocks, item: family.item, tool: family.tool, count: need
            })
          })
        }
        return list
      }

      // Se a missão for cancelada, os ajudantes param de cavar também.
      const stopHelpers = setInterval(() => {
        if (!isCancelled()) return
        clearInterval(stopHelpers)
        for (const { controller } of helperBots()) if (controller.currentTask?.type === 'minerar_fundo') controller.cancel()
      }, 1000)
      bot.chat(`Missão: ${target} de cada minério. Equipe: ${members().map((m) => m.name).join(', ') || 'ninguém'}${creative ? ' (estou em criativo; só coordeno)' : ''}.`)
      let result
      try {
        result = await oreMission.teamMission({
          target,
          members,
          teamCount,
          isCancelled,
          // Ouro, redstone, diamante e esmeralda: só quem tem picareta de ferro ou ferro para fazer uma.
          canMine: (member, family) => {
            if (family.tool !== 'iron') return true
            const items = member.bot?.inventory?.items?.() || []
            const n = (name) => items.filter((i) => i.name === name).reduce((sum, i) => sum + i.count, 0)
            if (['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].some((name) => n(name) > 0)) return true
            // Para fazer uma: 3 de ferro. A madeira dos gravetos o bot busca na superfície se faltar.
            return n('raw_iron') + n('iron_ingot') >= 3
          },
          log: (text) => console.log(`[minérios] ${text}`),
          onProgress: (family, have) => bot.chat(`${family.label}: ${Math.min(have, target)}/${target}`)
        })
      } finally {
        clearInterval(stopHelpers)
      }
      if (isCancelled()) return
      const resumo = Object.entries(result.progress).map(([key, value]) => `${key} ${value}`).join(', ')
      console.log(`[minérios] resumo: ${resumo}`)
      for (const g of result.gaveUp) console.log(`[minérios] desisti de ${g.key}: ${g.reason}`)
      bot.chat(result.ok ? `Missão concluída: ${target} de cada minério (mochilas + baú).` : `Missão parcial: ${resumo}`.slice(0, 256))
      if (result.ok) setResumeTask(null)
    })
  }

  // Retoma dentro da mesma sessão a tarefa que um combate/abrigo cancelou.
  function resumePendingTask() {
    const task = resumeTask.pending(resumeTaskRecord)
    if (!task || process.env.MBOT_RESUME_RETRY === '0') return false
    if (Date.now() < resumeNextAt) return false
    if (resumeAttempts >= resumeTask.MAX_ATTEMPTS) {
      console.log('[retomada] desisti depois de ' + resumeAttempts + ' tentativas')
      setResumeTask(null)
      return false
    }
    resumeAttempts++
    resumeNextAt = Date.now() + resumeTask.retryDelay(resumeAttempts)
    console.log(`[retomada] tentativa ${resumeAttempts}: ${resumeTask.describe(task)}`)
    if (task.kind === 'trigo') startWheat(task.target)
    else if (task.kind === 'lapis') startLapis(task.target)
    else if (task.kind === 'dar') startHandover(task.name, task.amount)
    else if (task.kind === 'pao') startBread(task.breads)
    return true
  }

  // Trigo: sementes do capim, arar, plantar e esperar amadurecer.
  function startWheat(amountArg) {
    const target = Math.max(3, Math.min(192, Number.parseInt(amountArg, 10) || 24))
    setResumeTask({ kind: 'trigo', target })
    runTask('plantar e colher trigo', async (isCancelled) => {
      const hoe = await farm.ensureHoe(bot, { craftItem: craft.craftItem })
      if (!hoe) {
        bot.chat('Não consegui uma enxada para arar (preciso de tábuas/gravetos).')
        return
      }
      // Já existe plantação? Cuida dela em vez de juntar sementes de novo.
      const existing = farm.countCrops(bot)
      if (existing > 0) {
        console.log(`[trigo] plantação existente: ${existing} pé(s); pulando sementes`)
        bot.chat(`Já tenho ${existing} pés de trigo; vou cuidar deles.`)
        const early = await farm.harvestRipe(bot, isCancelled)
        if (!isCancelled() && early.harvested > 0) bot.chat(`Colhi ${early.harvested} trigos maduros.`)
        const grownExisting = await farm.waitRipe(bot, { minutes: 25, isCancelled })
        if (isCancelled()) return
        if (grownExisting.ok) {
          const harvestExisting = await farm.harvestRipe(bot, isCancelled)
          console.log(`[trigo] colheita maduros=${harvestExisting.ripe} colhidos=${harvestExisting.harvested} trigo=${farm.countItem(bot, 'wheat')}`)
          if (isCancelled()) return
          setResumeTask(null)
          bot.chat(`Colhi ${harvestExisting.harvested} trigos. Tenho ${farm.countItem(bot, 'wheat')} (meta ${target}).`)
        } else {
          bot.chat('A plantação ainda não amadureceu; fica crescendo para depois.')
        }
        return
      }
      const seedWanted = Math.max(8, Math.min(64, target))
      // Sementes: o baú central primeiro, capim depois.
      if (storage.configured() && farm.countItem(bot, farm.SEED) < seedWanted) {
        await storage.withdraw(bot, farm.SEED, seedWanted).catch(() => 0)
        console.log(`[trigo] sementes no baú central: ${farm.countItem(bot, farm.SEED)}`)
      }
      const seeds = await farm.collectSeeds(bot, seedWanted, isCancelled, {
        log: (text) => console.log(text),
        // Sem capim por perto: anda em leque e tenta de novo.
        move: async (round) => {
          const angle = (round * Math.PI) / 3
          const from = bot.entity.position
          await food.goTo(bot, new goals.GoalXZ(Math.floor(from.x + Math.cos(angle) * 24), Math.floor(from.z + Math.sin(angle) * 24)), 20000)
            .catch(() => {})
        }
      })
      console.log(`[trigo] sementes ${seeds.seeds}/${seedWanted} (capim quebrado: ${seeds.blocks})`)
      if (isCancelled()) return
      if (!seeds.ok) {
        bot.chat(`Sementes: ${seeds.seeds}/${seedWanted}. Não achei capim suficiente por perto.`)
        return
      }
      bot.chat(`Tenho ${seeds.seeds} sementes. Vou arar e plantar.`)
      const planted = await farm.plantArea(bot, {
        center: bot.entity.position,
        plots: Math.min(24, seeds.seeds + 4),
        hoe,
        isCancelled
      })
      if (isCancelled()) return
      if (!(planted.tilled > 0)) {
        bot.chat('Não achei terra para arar por perto; preciso de um pedaço de terra com espaço em cima.')
        return
      }
      console.log(`[trigo] canteiros arados=${planted.tilled} plantados=${planted.planted}`)
      bot.chat(`Canteiros: ${planted.tilled} arados, ${planted.planted} plantados. Esperando amadurecer.`)
      const early = await farm.harvestRipe(bot, isCancelled)
      if (!isCancelled() && early.harvested > 0) bot.chat(`Colhi ${early.harvested} trigos que já estavam maduros.`)
      const grown = await farm.waitRipe(bot, { minutes: 25, isCancelled })
      if (isCancelled()) return
      if (!grown.ok) {
        bot.chat('Nada amadureceu nesse tempo; a plantação fica crescendo para depois.')
        return
      }
      const harvest = await farm.harvestRipe(bot, isCancelled)
      console.log(`[trigo] colheita maduros=${harvest.ripe} colhidos=${harvest.harvested} trigo=${farm.countItem(bot, 'wheat')}`)
      if (isCancelled()) return
      setResumeTask(null)
      bot.chat(`Colhi ${harvest.harvested} trigos. Tenho ${farm.countItem(bot, 'wheat')} (meta ${target}).`)
    })
  }

  // Pão: 3 trigos por pão.
  function startBread(amountArg) {
    const breads = Math.max(1, Math.min(64, Number.parseInt(amountArg, 10) || 8))
    runTask('fazer pão', async (isCancelled) => {
      const wheat = farm.countItem(bot, 'wheat')
      if (wheat < farm.WHEAT_PER_BREAD) {
        bot.chat(`Tenho ${wheat} trigo; cada pão pede ${farm.WHEAT_PER_BREAD}. Use !trigo primeiro.`)
        return
      }
      const possible = Math.floor(wheat / farm.WHEAT_PER_BREAD)
      const wanted = Math.min(breads, possible)
      await craft.craftItem(bot, 'bread', wanted, isCancelled)
      if (isCancelled()) return
      bot.chat(`Pão: ${farm.countItem(bot, 'bread')} no inventário (trigo restante: ${farm.countItem(bot, 'wheat')}).`)
    }, { resume: 'ficar' })
  }

  // Um bot acordado impede a noite de passar para quem está na cama: sair com
  // código 0 (o supervisor não reconecta) e voltar depois com a tarefa pendente.
  let sleepQuit = false
  async function disableForSleep(reason) {
    if (sleepQuit || quitRequested) return
    sleepQuit = true
    quitRequested = true
    console.log(`[sono] ${reason}; desligando. Tarefa pendente: ${resumeTask.describe(resumeTaskRecord)}`)
    bot.chat('Vou sair para vocês dormirem. Volto depois e retomo o que eu estava fazendo.')
    await persistState().catch(() => {})
    botManager.stopAll()
    bot.quit()
  }

  function checkSleepRequest() {
    if (process.env.MBOT_SLEEP_DISABLE === '0' || sleepQuit || quitRequested || !bot.entity) return
    const sleepers = sleepWatch.sleepingOthers(bot, { skip: (name) => Boolean(botManager.get(name)) })
    if (sleepers.length) disableForSleep(`${sleepers.map((s) => s.name).join(', ')} ${sleepers[0].why}`)
  }
  setInterval(checkSleepRequest, 2000).unref?.()

  bot.on('chat', async (username, message) => {
    if (username === bot.username || botManager.get(username)) return
    // O dono avisando que vai dormir: sair para a noite poder passar.
    if (process.env.MBOT_SLEEP_DISABLE !== '0' && sleepWatch.isSleepMessage(message)) {
      disableForSleep(`${username} quer dormir`)
      return
    }
    const owner = ownerName()
    if (owner && username !== owner) return
    if (!resolvedOwner) resolvedOwner = username
    // Resposta a uma pergunta pendente ("Qual casa? 1) ... 2) ...").
    if (clarifier.handleMessage(username, message)) return
    if (await commandRouter.dispatch({ bot, username }, message)) return
    const [cmd, ...args] = message.toLowerCase().trim().split(/\s+/)

    switch (cmd) {
      case '!parar':
        console.log(`Comando !parar recebido de ${username}. Encerrando bot e colônia...`)
        setResumeTask(null) // parada explícita não é retomada
        quitRequested = true
        await persistState().catch(() => {})
        botManager.stopAll()
        bot.quit()
        break
      case '!seguir':
        autonomous = false
        clearPatrolState()
        persistSoon()
        cancelTask()
        mode = 'seguir'
        if (ownerEntity()) {
          follow()
          bot.chat('Seguindo você!')
        } else {
          bot.chat('Não estou te vendo; vou seguir quando você chegar perto.')
        }
        break
      case '!comer':
        if (!food.hasFood(bot)) {
          bot.chat('Não tenho comida. Use !comida para eu buscar.')
          return
        }
        eatNow().then((eaten) => eaten && bot.chat(`Comi ${eaten}. Fome: ${bot.food}/20`))
        break
      case '!comida':
        searchFood(true)
        break
      // Entrega ao dono: caminha até ele e joga as pilhas no pé.
      case '!dar':
      case '!entregar':
        startHandover(args[0], args[1], args[2])
        break
      // Lápis fica fundo: desce cavando degraus e confirma pelo item no inventário.
      case '!lapis':
        startLapis(args[0])
        break
      // Missão: 64 de cada minério (padrão).
      case '!minerios':
        startOreMission(args[0], args[1])
        break
      // Trigo: sementes do capim -> arar -> plantar -> esperar -> colher.
      case '!trigo':
        startWheat(args[0])
        break
      // Pão: 3 trigos por pão, no craft normal.
      case '!pao':
      case '!pão':
        startBread(args[0])
        break
      // Diagnóstico: o que o cliente vê num bloco (ex.: !bloco -241 64 -11).
      case '!bloco': {
        const [bx, by, bz] = args.slice(0, 3).map((value) => Number.parseInt(value, 10))
        if (![bx, by, bz].every(Number.isFinite)) {
          bot.chat('Uso: !bloco <x> <y> <z>  ex.: !bloco -241 64 -11')
          return
        }
        const block = bot.blockAt(new Vec3(bx, by, bz))
        const report = `${bx},${by},${bz}: ${block ? `${block.name} (${block.boundingBox})` : 'chunk não carregado'}`
        console.log(`[bloco] ${report}`)
        bot.chat(report)
        break
      }
      // Bolos: baú novo na base; se o servidor recusar, derruba no chão.
      case '!bolos':
        startCakeFlow()
        break
      // Sair da água (nadar até terra seca).
      case '!sair':
        startUnstick()
        break
      // Cria o baú de entrega onde o bot está e passa a usá-lo.
      case '!bau':
        startMakeDeliveryChest()
        break
      // Guardar no baú central (ex.: !guardar bolo 26).
      case '!guardar':
        startStoreInStock(args[0], args[1])
        break
      case '!ferro': {
        const amount = Math.max(1, Math.min(128, Number.parseInt(args[0], 10) || Number(process.env.MBOT_AUTO_IRON_BATCH) || 32))
        runTask('minerar ferro para o baú', async (isCancelled) => {
          try {
            const result = await mineIronBatch(amount, isCancelled)
            const text = Object.entries(result.deposited || {}).map(([name, quantity]) => `${quantity}x ${name}`).join(', ')
            if (!isCancelled()) bot.chat(`Ferro: minerei ${result.mined}, fundi ${result.smelted}${text ? `, guardei ${text}` : ', nada guardado'}.`)
          } catch (err) {
            if (!isCancelled()) bot.chat(`Não consegui o lote de ferro: ${err.message}`)
          }
        })
        break
      }
      case '!cama':
        runTask('fazer cama', async (isCancelled) => {
          try {
            const bed = await bedLib.ensureBed(bot, isCancelled, {
              allowHunt: true,
              log: (msg) => console.log(msg),
              say: (msg) => bot.chat(msg)
            })
            if (!bed || isCancelled()) return
            const p = bed.position.floored()
            bot.chat(`Cama pronta em X=${p.x}, Y=${p.y}, Z=${p.z}.`)
            if (night.isNight(bot)) {
              const how = await bedLib.useBed(bot, bed, isCancelled)
              if (!isCancelled()) bot.chat(how === 'dormi' ? 'Bom dia! Dormi bem.' : 'Cama usada; ponto de renascimento registrado.')
            }
          } catch (err) {
            if (!isCancelled()) bot.chat(`Não consegui fazer a cama: ${err.message}`)
          }
        })
        break
      case '!dormir': {
        if (!night.isNight(bot)) {
          bot.chat('Só durmo à noite. Use !cama para eu deixar uma pronta.')
          break
        }
        const bed = night.findBed(bot)
        if (!bed) {
          bot.chat('Não vejo cama perto. Use !cama para eu fazer uma.')
          break
        }
        runTask('dormir', async (isCancelled) => {
          const how = await bedLib.useBed(bot, bed, isCancelled)
          if (how === 'dormi' && !isCancelled()) bot.chat('Bom dia! Dormi bem.')
        })
        break
      }
      case '!ver':
        if (!bot.entity) return
        for (const line of perception.describe(bot)) { console.log(`[ver] ${line}`); bot.chat(line) }
        break
      case '!ondeestou':
      case '!onde': {
        if (!bot.entity) return
        const where = situation.whereAmI(bot, { worldMemory, waypoints: waypointManager })
        for (const line of situation.describeSituation(where)) { console.log(`[onde] ${line}`); bot.chat(line) }
        break
      }
      case '!atacar': {
        const name = args[0]
        const target = bot.nearestEntity((e) => e !== bot.entity && e.type !== 'player' &&
          (name ? e.name === name : e.type === 'hostile') && e.position.distanceTo(bot.entity.position) <= 24)
        if (!target) {
          bot.chat(name ? `Não vejo ${name} por perto.` : 'Não vejo nenhum monstro por perto.')
          return
        }
        bot.chat(`Atacando ${target.name}!`)
        defend(target)
        break
      }
      case '!autonomo':
      case '!autônomo':
        clearPatrolState()
        if (args[0] === 'off' || args[0] === 'parar') {
          autonomous = false
          cancelTask()
          mode = 'seguir'
          persistSoon()
          bot.chat('Modo autônomo desligado. Voltando a te seguir.')
          break
        }
        autonomous = true
        cancelTask()
        mode = 'seguir'
        persistSoon()
        bot.chat(`Modo autônomo ligado! ${autonomy.progress()}`)
        break
      case '!metas':
        bot.chat(autonomy.progress())
        break
      case '!servidor':
        bot.chat(`Servidor: ${CONFIG.host}:${CONFIG.port} | ${describeProfile(serverProfile)} | protocolo ${bot._client?.protocolVersion ?? 'N/A'}`)
        break
      case '!ficar':
        autonomous = false
        clearPatrolState()
        setResumeTask(null)
        cancelTask()
        mode = 'ficar'
        bot.chat('Ok, fico aqui.')
        break
      case '!cancelar':
        autonomous = false
        clearPatrolState()
        setResumeTask(null)
        cancelTask()
        mode = 'seguir'
        bot.chat('Tarefa cancelada. Voltando a te seguir.')
        break
      case '!minerar': {
        if (!args[0]) {
          bot.chat('Uso: !minerar <bloco> [quantidade]  ex.: !minerar oak_log 5')
          return
        }
        const count = parseCount(args[1])
        resolveBlocks(args[0], username)
          .then((blocks) => blocks && mine(blocks, count))
          .catch((err) => bot.chat(`Não consegui minerar: ${err.message}`))
        break
      }
      case '!cozinhar': {
        // Sem argumento: cozinha toda a comida crua. Com item: cozinha/funde esse item.
        const targets = args[0]
          ? [{ name: args[0], count: parseCount(args[1], 64) }]
          : craft.rawFoods(bot).map((i) => ({ name: i.name, count: i.count }))
        if (!targets.length) {
          bot.chat('Não tenho comida crua. Para fundir outra coisa: !cozinhar <item> [qtd], ex.: !cozinhar raw_iron')
          return
        }
        if (targets.some((t) => !craft.smeltResult(t.name))) {
          bot.chat(`${args[0]} não vai na fornalha.`)
          return
        }
        bot.chat('Indo para a fornalha...')
        runTask('cozinhar', async (isCancelled) => {
          for (const t of targets) {
            const done = await craft.smeltItem(bot, t.name, t.count, isCancelled)
            if (!isCancelled()) bot.chat(`Fornalha: ${done}x ${t.name} -> ${craft.smeltResult(t.name)}`)
          }
        })
        break
      }
      case '!status':
        if (args[0] === 'server') {
          bot.chat(process.env.STATUS_SERVER === '1'
            ? `Status server: http://127.0.0.1:${statusServer.port}`
            : 'Status server desativado. Defina STATUS_SERVER=1 para ativar.')
          break
        }
        if (!bot.entity) {
          bot.chat('Ainda estou entrando no mundo.')
          return
        }
        bot.chat(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20 | Itens: ${bot.inventory.items().length} | Modo: ${taskName ?? mode}`)
        const pos = bot.entity.position
        bot.chat(`Posição: X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}`)
        break
      case '!pos':
        if (!bot.entity) {
          bot.chat('Ainda estou entrando no mundo.')
          return
        }
        const p = bot.entity.position
        bot.chat(`X=${p.x.toFixed(1)}, Y=${p.y.toFixed(1)}, Z=${p.z.toFixed(1)}`)
        break
      case '!ajuda':
        bot.chat('Missões: !missao pegar|coletar <item> <qtd> [guardar], !missao fabricar <item> <qtd> [guardar], !missao entregar <item> <qtd> [bau|mao], !missao ir <local>, !missao status, !missao cancelar <id>, !missao retomar <id>')
        bot.chat('Memória: !lembrar <nome> aqui, !lembrar <chave> = <valor>, !esquecer <nome>, !memoria [tipo], !onde <coisa>')
        bot.chat('Comandos: !seguir, !ficar, !autonomo [off], !metas, !local, !ir, !voltar, !patrulha, !explorar, !enviar, !animais, !curral, !capturar, !reproduzir, !manejo, !produto, !tosquiar, !servidor, !minerar, !fabricar, !cozinhar, !atacar, !comer, !comida, !cama, !dormir, !ferro [qtd], !lapis [qtd], !dar <item> [qtd] [mao], !trigo [qtd], !pao [qtd], !guardar [item] [qtd], !bau, !bolos, !sair, !minerios [qtd], !ver, !ondeestou, !status, !pos, !cancelar, !parar')
        bot.chat('Colônia: !base aqui, !estoque aqui, !projeto <casa|fazenda|mina|vila>, !projeto planta <nome>, !projeto status, !smoke, !colonia auto, !colonia necessidades, !bot, !bots, !ordem, !abastecer, !construir <casa|fazenda|mina|curral|planta>, !plantas, !todos voltar, !tarefas')
        bot.chat('Auditoria: !verify, !events [n], !freeze [nome], !status server')
        break
      case '!verify': {
        const proof = runVerifier.verify()
        bot.chat(`Verificação: ${proof.passed}/${proof.total} passaram, ${proof.failed} falharam`)
        bot.chat(`All passed: ${proof.allPassed ? 'SIM' : 'NÃO'}`)
        break
      }
      case '!events': {
        const limit = Math.max(1, Math.min(50, Number(args[0]) || 10))
        const events = eventLog.getRecent(limit)
        bot.chat(`Últimos ${events.length} eventos:`)
        for (const e of events.slice(-5)) {
          bot.chat(`[${e.type}] ${e.worker || 'geral'} - ${new Date(e.time).toLocaleTimeString()}`)
        }
        break
      }
      case '!freeze': {
        const name = args[0] || `freeze-${Date.now()}`
        bot.chat(`Freeze iniciado: ${name}`)
        try {
          execFileSync(process.execPath, ['scripts/freeze-colony.js', name], { cwd: process.cwd(), timeout: 30000 })
          bot.chat(`Freeze concluído: ${name}`)
        } catch (err) {
          bot.chat(`Freeze erro: ${err.message}`)
        }
        break
      }
    }
  })
}

main()
