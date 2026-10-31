// minecraft-mbot/index.js
// Ponto de entrada: conecta o bot principal e monta a colônia. Configuração no
// .env (ver .env.example e README). O comportamento vive em app/ e core/.

const { loadLocalEnv, connectionSettings } = require('./lib/connection-config')
loadLocalEnv()
const CONNECTION = connectionSettings()

const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { WorldMemory } = require('./lib/world-memory')
const { detectProfile, configureClient, describeProfile } = require('./lib/serverProfile')
const { announceLan } = require('./lib/lan')
const { CommandRouter } = require('./core/CommandRouter')
const { MinecraftKnowledge } = require('./core/MinecraftKnowledge')
const { Planner } = require('./core/Planner')
const { BotManager } = require('./core/BotManager')
const { loadPlugins, startWebViews } = require('./lib/plugins')
const { createBot } = require('./lib/botFactory')
const { ColonyOrchestrator } = require('./core/ColonyOrchestrator')
const { StorageManager } = require('./core/StorageManager')
const { ProductionManager } = require('./core/ProductionManager')
const { DemandPlanner } = require('./core/DemandPlanner')
const { ProjectManager } = require('./core/ProjectManager')
const { StateStore } = require('./core/StateStore')
const { SmokeTest } = require('./core/SmokeTest')
const { JuliaShadowObserver } = require('./lib/julia-shadow')
const { JuliaAuthority } = require('./lib/julia-authority')
const { WaypointManager } = require('./core/WaypointManager')
const { Memory } = require('./core/Memory')
const { Clarifier } = require('./core/Clarifier')
const { attachMemoryCapture } = require('./lib/memoryCapture')
const { getEventLog } = require('./lib/event-log')
const { StatusServer } = require('./lib/status-server')
const { RunVerifier } = require('./core/RunVerifier')
const { startToolApiRuntime } = require('./lib/tool-api-runtime')
const { ConsoleBuffer } = require('./lib/dashboard-snapshot')
const { findServer } = require('./app/discovery')
const { createPlaces } = require('./app/places')
const { createCompanion } = require('./app/companion')
const { createPersistence } = require('./app/persistence')
const { createWorkerFactory, ensureProjectWorkers } = require('./app/workers')
const { startDashboard, setScenarioContext } = require('./app/dashboard')
const { createLifecycle, installSignalHandlers, restoreOnFirstSpawn, installConnectionHandlers } = require('./app/lifecycle')
const { registerAllCommands, attachChat } = require('./app/commands')

async function main() {
  // Painel de testes local (opt-in). Captura o console desde o início para o painel mostrar a conexão.
  const dashboardEnabled = process.env.MBOT_DASHBOARD === '1'
  const consoleBuffer = dashboardEnabled ? new ConsoleBuffer().capture() : null
  const server = await findServer(CONNECTION)
  if (!server) {
    console.error(`Nenhum servidor Minecraft respondeu em ${CONNECTION.host}${CONNECTION.port ? ':' + CONNECTION.port : ''}. Verifique o endereço, a porta, o firewall e se o servidor permite consultas de status. Configure MINECRAFT_HOST e MINECRAFT_PORT no .env ou no ambiente.`)
    process.exit(1)
  }

  const requestedVersion = process.env.MINECRAFT_VERSION || server.version
  const serverProfile = detectProfile(requestedVersion)
  const CONFIG = {
    host: CONNECTION.host,
    port: server.port,
    username: CONNECTION.username,
    password: '',
    version: serverProfile.version || requestedVersion,
    hideErrors: !process.env.DEBUG_PROTOCOL
  }
  console.log(`Conectando a ${CONFIG.host}:${CONFIG.port} (versão ${CONFIG.version})...`)
  console.log(`Perfil: ${describeProfile(serverProfile)}`)

  const bot = createBot(mineflayer, CONFIG)
  configureClient(bot, serverProfile)

  // Servidor dedicado neste PC não aparece sozinho em "Jogos em LAN"; o bot anuncia.
  let stopLan = () => {}
  if (process.env.MINECRAFT_LAN_ANNOUNCE === '1') {
    if (['127.0.0.1', 'localhost'].includes(CONFIG.host)) {
      stopLan = announceLan({ motd: process.env.MINECRAFT_LAN_MOTD || server.motd || 'Servidor', port: server.port })
    } else {
      console.log('[lan] anúncio só funciona para servidor neste PC (MINECRAFT_HOST local)')
    }
  }
  bot.loadPlugin(pathfinder)
  loadPlugins(bot)
  const clarifier = new Clarifier({ say: (text) => bot.chat(text) })

  // ========== ESTADO SALVO E SERVIÇOS ==========
  const storage = new StorageManager()
  const production = new ProductionManager({ storage })
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
  const waypointManager = new WaypointManager(savedState.waypoints)
  // Migra o campo legado uma vez; depois disso o WaypointManager é a fonte canônica.
  waypointManager.restoreLegacyBase(savedState.home, savedState.homeDimension)
  const homeProvider = () => waypointManager.get('base')?.position || null
  const homeDimension = () => waypointManager.get('base')?.dimension || null
  const worldMemory = startWorldMemory({ waypointManager, storage, homeDimension })
  const projectManager = new ProjectManager({ storage, homeProvider })
  projectManager.restore(savedState.project)

  // Julia-1 (opt-in): shadow só observa; autoridade escolhe entre candidatos do player loop com guardrails.
  const juliaShadow = new JuliaShadowObserver({ logger: console })
  const juliaAuthority = new JuliaAuthority({ logger: console })
  if (juliaAuthority.enabled()) {
    console.log(`[julia-authority] LIGADA: ${juliaAuthority.endpoint} (timeout ${juliaAuthority.timeoutMs} ms)`)
    if (process.env.MBOT_EXPLORE_PREPARATION !== '1') console.log('[julia-authority] aviso: sem MBOT_EXPLORE_PREPARATION=1 o player loop não roda e a Julia não decide nada')
  }

  // ========== COLÔNIA ==========
  let companion = null
  let toolApiRuntime = null
  const ownerEntity = () => companion?.ownerEntity()
  const maxColonyBots = Math.max(1, Number.parseInt(process.env.MAX_COLONY_BOTS, 10) || 12)
  const botManager = new BotManager({
    createBot: createWorkerFactory({
      CONFIG, serverProfile, homeProvider, ownerEntity, storage, production,
      shadow: juliaShadow, worldMemory, juliaAuthority, toolApi: () => toolApiRuntime
    }),
    orchestratorName: CONFIG.username,
    maxBots: maxColonyBots
  })
  try {
    toolApiRuntime = await startToolApiRuntime({ botManager })
  } catch (error) {
    console.log(`[tool-api] desativada: ${error.message}`)
  }
  const lifecycle = createLifecycle()
  installSignalHandlers({ lifecycle, bot, toolApiRuntime, worldMemory })
  const colony = new ColonyOrchestrator({ botManager, homeProvider, ownerProvider: ownerEntity, storage, demandPlanner: new DemandPlanner(), projectManager })
  colony.restoreAnimalTargets(savedState.animalTargets)

  // ========== AUDITABILIDADE ==========
  const eventLog = getEventLog()
  const statusServer = new StatusServer({ botManager, storage, projectManager, eventLog, port: Number(process.env.STATUS_PORT || 3080) })
  const runVerifier = new RunVerifier({ eventLog, storage, botManager, projectManager })
  if (process.env.STATUS_SERVER === '1') statusServer.start()
  let webViews = null
  const views = () => webViews
  const dashboardServer = dashboardEnabled
    ? startDashboard({ bot, CONFIG, serverProfile, botManager, storage, projectManager, eventLog, runVerifier, consoleBuffer, views, companion: () => companion })
    : null
  eventLog.log('colony_start', { version: serverProfile.version, profile: serverProfile.id, bots: maxColonyBots })
  const smokeTest = new SmokeTest({ bot, storage, botManager, homeProvider, projectManager, serverProfile })

  const persistence = createPersistence({
    stateStore, storage, colony, waypointManager, botManager, projectManager,
    companionAuto: () => companion?.autonomous
  })
  const { persistState, persistSoon } = persistence
  colony.start()
  persistence.startPeriodic()

  // ========== COMPANHEIRO ==========
  const places = createPlaces({ bot, memory, waypointManager, clarifier })
  companion = createCompanion({
    bot, memory, botManager, places, persistSoon,
    owner: CONNECTION.owner,
    initialAutonomous: Boolean(savedState.companionAuto) || process.env.MBOT_COMPANION_AUTOSTART === '1'
  })

  // ========== EVENTOS ==========
  bot.once('spawn', () => { webViews = startWebViews(bot) })
  setScenarioContext({ runVerifier, bot, storage, botManager, smokeTest, places, companion, views, persistSoon })
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
  const ensureWorkers = (type, roles) => ensureProjectWorkers({ projectManager, botManager }, type, roles)
  companion.start()
  restoreOnFirstSpawn({ bot, savedState, botManager, projectManager, colony, storage, homeProvider, ensureProjectWorkers: ensureWorkers, persistSoon, ownerName: companion.ownerName })
  installConnectionHandlers({
    bot, CONFIG, lifecycle,
    shutdown: async () => {
      colony.stop()
      try { await toolApiRuntime?.close() } catch (error) { console.log(`[tool-api] shutdown: ${error.message}`) }
      try { await persistState() } catch (err) { console.log(`[estado] falha ao salvar: ${err.message}`) }
      try { await memory.save() } catch (err) { console.log(`[memória] falha ao salvar: ${err.message}`) }
      memoryCapture?.stop()
      botManager.stopAll()
      statusServer.stop()
      dashboardServer?.stop()
      webViews?.viewer?.close?.()
      webViews?.inventory?.close?.()
      stopLan()
    }
  })

  // ========== COMANDOS VIA CHAT ==========
  const knowledge = new MinecraftKnowledge(bot)
  const commandRouter = registerAllCommands(new CommandRouter(), {
    bot, CONFIG, serverProfile, botManager, colony, storage, production, projectManager, waypointManager,
    memory, worldMemory, knowledge, planner: new Planner(bot, knowledge), smokeTest, runVerifier,
    eventLog, statusServer, maxColonyBots, homeProvider, homeDimension, persistState, persistSoon,
    ensureProjectWorkers: ensureWorkers, requestQuit: () => lifecycle.requestQuit(), places, companion
  })
  attachChat({ bot, botManager, clarifier, commandRouter, companion })
}

// Memória espacial do mundo (MBOT_WORLD_MEMORY=1 coleta/persiste; MBOT_WORLD_MEMORY_GUIDE=1 deixa
// a memória orientar destinos). base/storage continuam vindo dos providers: sem fonte duplicada.
function startWorldMemory({ waypointManager, storage, homeDimension }) {
  if (process.env.MBOT_WORLD_MEMORY !== '1') return null
  const worldMemory = new WorldMemory({
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
  const s = worldMemory.summary()
  console.log(`[world-memory] ${worldMemory.loadStatus}: ${s.places} lugar(es), ${s.explored} chunk(s) explorado(s); guia=${process.env.MBOT_WORLD_MEMORY_GUIDE === '1' ? 'on' : 'off'}`)
  process.on('exit', () => { try { worldMemory.flushSync() } catch (err) { console.log(`[world-memory] falha ao salvar: ${err.message}`) } })
  return worldMemory
}

main()
