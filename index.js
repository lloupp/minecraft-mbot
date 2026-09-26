// minecraft-mbot/index.js
// Bot de automação Minecraft Forge 26.3 (protocolo 777)
//
// INSTRUÇÕES:
// 1. Abra o Minecraft via TLauncher, entre no mundo "Novo mundo"
// 2. No jogo, pressione Esc > "Abrir para LAN" (permite cheats)
// 3. Rode este arquivo: node index.js
//    A porta LAN e a versão do jogo são detectadas automaticamente.

const { execFileSync } = require('child_process')
const mineflayer = require('mineflayer')
const { ping } = require('minecraft-protocol')
const { autoVersionForge } = require('minecraft-protocol-forge')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const food = require('./lib/food')
const perception = require('./lib/perception')
const { fixEntityMovement, fixOutgoingPackets } = require('./lib/protocol')
const { announceLan, motdText } = require('./lib/lan')
const { CommandRouter } = require('./core/CommandRouter')
const { MinecraftKnowledge } = require('./core/MinecraftKnowledge')
const { Planner } = require('./core/Planner')
const { BotManager } = require('./core/BotManager')
const craft = require('./lib/craft')
const gather = require('./lib/gather')
const combat = require('./lib/combat')
const { WorkerController } = require('./core/WorkerController')
const { ColonyOrchestrator } = require('./core/ColonyOrchestrator')
const { StorageManager } = require('./core/StorageManager')
const { ProductionManager, normalizeItemName } = require('./core/ProductionManager')
const { DemandPlanner } = require('./core/DemandPlanner')
const { ProjectManager } = require('./core/ProjectManager')
const { StateStore } = require('./core/StateStore')
const { SmokeTest } = require('./core/SmokeTest')

const HOST = process.env.MINECRAFT_HOST || '127.0.0.1'
const DEFAULT_PORT = 25565
// Jogador que o bot segue e obedece. Sem valor, usa o primeiro jogador online.
const OWNER = process.env.MINECRAFT_OWNER || null

const FOLLOW_DISTANCE = 2   // blocos de distância ao seguir o dono
const FLEE_DISTANCE = 16    // distância que tenta manter do agressor
const FLEE_MS = 4000        // tempo fugindo depois de tomar dano
const DEFEND_RANGE = 5      // hostil mais perto que isso: o bot reage (luta ou foge)
const CREEPER_RANGE = 6     // creeper mais perto que isso: foge antes que exploda
const HUNGRY = 14           // abaixo disso come (ou vai buscar comida)
const FOOD_RETRY_MS = 30000 // espera entre buscas de comida que não deram certo

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
      resolve(err || !res?.version ? null : { port, version: res.version.name, motd: motdText(res.description) })
    })
  })
}

// Encontra o servidor: MINECRAFT_PORT, senão portas Java locais, senão 25565.
async function findServer() {
  const envP = envPort(process.env.MINECRAFT_PORT)
  const candidates = envP ? [envP] : [...javaListeningPorts(), DEFAULT_PORT]
  for (const port of [...new Set(candidates)]) {
    const server = await pingServer(port)
    if (server) return server
  }
  return null
}

async function main() {
  const server = await findServer()
  if (!server) {
    console.error(`Nenhum servidor Minecraft encontrado em ${HOST}. Abra o mundo para LAN (Esc > "Abrir para LAN") ou defina MINECRAFT_PORT.`)
    process.exit(1)
  }

  // ========== CONFIGURAÇÃO ==========
  const CONFIG = {
    host: HOST,
    port: server.port,
    username: process.env.MINECRAFT_BOT_NAME || 'eduardo_bot',
    password: '',
    // version: false trava na detecção automática; usa a versão do ping.
    version: process.env.MINECRAFT_VERSION || server.version,
    // O 26.3 ainda tem pacotes que a biblioteca não lê (ex.: partículas); não são
    // fatais, só enchem o console. DEBUG_PROTOCOL=1 mostra esses erros.
    hideErrors: !process.env.DEBUG_PROTOCOL
  }
  console.log(`Conectando a ${CONFIG.host}:${CONFIG.port} (versão ${CONFIG.version})...`)

  // ========== CRIAÇÃO DO BOT ==========
  const bot = mineflayer.createBot(CONFIG)
  autoVersionForge(bot._client)

  // Servidor dedicado neste PC não aparece sozinho em "Jogos em LAN"; o bot anuncia.
  let stopLan = () => {}
  if (process.env.MINECRAFT_LAN_ANNOUNCE === '1') {
    if (['127.0.0.1', 'localhost'].includes(HOST)) {
      stopLan = announceLan({ motd: process.env.MINECRAFT_LAN_MOTD || server.motd || 'Servidor', port: server.port })
    } else {
      console.log('[lan] anúncio só funciona para servidor neste PC (MINECRAFT_HOST local)')
    }
  }
  fixEntityMovement(bot._client)
  fixOutgoingPackets(bot._client)
  bot.loadPlugin(pathfinder)

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
    console.log('[estado] arquivo local inválido; iniciando com estado vazio')
  }
  let colonyHome = savedState.home
  if (savedState.storage) storage.setPosition(savedState.storage)
  const projectManager = new ProjectManager({
    storage,
    homeProvider: () => colonyHome
  })
  projectManager.restore(savedState.project)

  function createWorker({ name, role }) {
    const worker = mineflayer.createBot({ ...CONFIG, username: name })
    autoVersionForge(worker._client)
    fixEntityMovement(worker._client)
    fixOutgoingPackets(worker._client)
    worker.loadPlugin(pathfinder)
    worker.colonyController = new WorkerController({
      bot: worker,
      name,
      role,
      homeProvider: () => colonyHome,
      ownerProvider: () => ownerEntity(),
      storage,
      production
    })

    worker.once('spawn', () => {
      console.log(`[colônia] ${name} conectado como ${role}`)
    })
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
  const colony = new ColonyOrchestrator({
    botManager,
    homeProvider: () => colonyHome,
    ownerProvider: () => ownerEntity(),
    storage,
    demandPlanner,
    projectManager
  })
  const smokeTest = new SmokeTest({
    bot,
    storage,
    botManager,
    homeProvider: () => colonyHome,
    projectManager
  })

  function workerRoleCounts() {
    const counts = {}
    for (const worker of botManager.list()) counts[worker.role] = (counts[worker.role] || 0) + 1
    return counts
  }

  async function persistState() {
    await stateStore.save({
      home: colonyHome,
      storage: storage.getPosition(),
      auto: colony.auto,
      workers: workerRoleCounts(),
      project: projectManager.exportState()
    })
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

  // ========== ESTADO ==========
  let mode = 'seguir'       // 'seguir' | 'ficar' | 'tarefa'
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

  function nearestHostile(maxDist) {
    return bot.nearestEntity((e) => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) <= maxDist)
  }

  function follow() {
    const owner = ownerEntity()
    if (!owner) return
    bot.pathfinder.setMovements(followMoves)
    bot.pathfinder.setGoal(new goals.GoalFollow(owner, FOLLOW_DISTANCE), true)
  }

  function cancelTask() {
    taskId++
    taskName = null
    if (bot.targetDigBlock) bot.stopDigging()
    bot.pathfinder.setGoal(null)
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

  // Executa uma tarefa longa. `fn` recebe isCancelled() e deve parar quando for true
  // (fuga, !cancelar, outra tarefa). No fim, volta a seguir o dono (ou a `resume`).
  async function runTask(name, fn, { resume = 'seguir' } = {}) {
    cancelTask()
    const myTask = taskId
    const isCancelled = () => myTask !== taskId
    mode = 'tarefa'
    taskName = name
    bot.pathfinder.setMovements(workMoves)
    try {
      await fn(isCancelled)
    } catch (err) {
      if (!isCancelled()) bot.chat(`Não consegui ${name}: ${err.message}`)
    }
    if (isCancelled()) return
    taskName = null
    mode = resume
    if (resume === 'seguir') follow()
    else bot.pathfinder.setGoal(null)
  }

  const isLiving = (entity) => entity && entity !== bot.entity && entity.isValid !== false

  // Luta com `target` até ele morrer; com vida baixa, recua.
  function defend(target) {
    const resume = mode === 'ficar' || (mode === 'tarefa' && taskName === 'lutar' && fightResume === 'ficar') ? 'ficar' : 'seguir'
    if (mode === 'tarefa' && taskName !== 'lutar') bot.chat(`Parei de ${taskName} para lutar com ${target.name}.`)
    fightTarget = target
    fightResume = resume
    console.log(`Lutando com ${target.name} (HP ${Math.round(bot.health)})`)
    runTask('lutar', async (isCancelled) => {
      const result = await combat.fight(bot, target, isCancelled)
      console.log(`Luta com ${target.name}: ${result}`)
      if (result === 'recuei') {
        flee(target)
      } else if (result === 'morto') {
        await food.collectDrops(bot, target.position.clone(), isCancelled)
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

  function mine(blockName, count) {
    const blockType = bot.registry.blocksByName[blockName]
    if (!blockType) {
      bot.chat(`Não conheço o bloco "${blockName}". Use o nome em inglês, ex.: stone, oak_log, iron_ore.`)
      return
    }
    bot.chat(`Minerando ${count}x ${blockName}...`)
    runTask('minerar', async (isCancelled) => {
      const mined = await gather.mineBlocks(bot, (name) => name === blockName, count, isCancelled)
      if (isCancelled()) return
      if (mined < count) bot.chat(`Só consegui ${mined}x ${blockName} (não achei mais ou não alcancei).`)
      else bot.chat(`Minerei ${mined}x ${blockName}.`)
    })
  }

  async function eatNow() {
    if (eating) return
    eating = true
    try {
      const eaten = await food.eat(bot)
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
  bot.on('spawn', async () => {
    console.log('=== Bot conectado! ===')
    console.log(`Jogador: ${bot.username}`)
    console.log(`Posição: X=${bot.entity.position.x.toFixed(1)}, Y=${bot.entity.position.y.toFixed(1)}, Z=${bot.entity.position.z.toFixed(1)}`)
    console.log(`Modo: ${bot.game?.gameMode ?? 'desconhecido'} | Ping: ${bot.players[bot.username]?.ping ?? 'N/A'}ms`)
    console.log(`Dono: ${ownerName() ?? '(ninguém online)'}`)
    console.log('\n--- Bot ativo! Digite !ajuda no chat ---\n')

    followMoves = new Movements(bot)
    followMoves.canDig = false          // não quebra construções enquanto segue
    followMoves.allow1by1towers = false
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
      if (savedState.auto && colony.autoReadiness().ready) colony.setAuto(true)
      if (restored.length) console.log(`[estado] workers restaurados: ${restored.join(', ')}`)
      if (colonyHome) console.log(`[estado] base restaurada: ${colonyHome.x}, ${colonyHome.y}, ${colonyHome.z}`)
      if (storage.configured()) console.log('[estado] estoque central restaurado')
      if (projectManager.isActive()) console.log(`[estado] projeto restaurado: ${projectManager.active.type}`)
      persistSoon()
    }
  })

  bot.once('health', () => {
    console.log(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20`)
  })

  bot.on('entityHurt', (entity, source) => {
    if (entity === bot.entity && source) lastAttacker = source
  })

  bot.on('health', () => {
    // Durante a luta, o próprio laço de combate decide quando recuar.
    if (lastHealth !== null && bot.health < lastHealth && bot.health > 0 && taskName !== 'lutar') {
      react(lastAttacker)
      lastAttacker = null
    }
    lastHealth = bot.health
  })

  bot.on('death', () => {
    console.log('O bot morreu.')
    cancelTask()
    lastHealth = null
    fleeingUntil = 0
  })

  // Laço principal: termina fugas, foge preventivamente e mantém o bot perto do dono.
  setInterval(() => {
    if (!bot.entity || !followMoves) return
    if (fleeingUntil) {
      if (Date.now() < fleeingUntil) return
      fleeingUntil = 0
      if (mode === 'ficar') bot.pathfinder.setGoal(null)
    }
    // Defesa: foge de creepers e reage a hostis que chegam perto.
    if (taskName !== 'lutar') {
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
    if (needsFood && !eating && (mode !== 'tarefa' || bot.food <= 6) && food.hasFood(bot)) {
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
    if (mode === 'seguir') {
      const owner = ownerEntity()
      if (owner && bot.pathfinder.goal?.entity !== owner) follow()
    }
  }, 500)

  bot.on('kicked', (reason) => {
    console.log('Bot desconectado:', reason)
  })

  // Queda inesperada (servidor reiniciou, rede caiu, kick): sai com erro para o
  // supervisor (systemd ou `npm run sempre`) reconectar. !parar sai com código 0.
  let quitRequested = false
  bot.on('end', async (reason) => {
    colony.stop()
    try { await persistState() } catch {}
    botManager.stopAll()
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
    const baseText = colonyHome
      ? `${Math.floor(colonyHome.x)},${Math.floor(colonyHome.y)},${Math.floor(colonyHome.z)}`
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
        if (!storage.snapshotFresh(5000)) await storage.summary(bot)
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
    if (!status) return ['Nenhum projeto ativo. Tipos: casa, fazenda, mina, vila.']

    const actionDone = status.actions.filter((a) => a.status === 'concluido').length
    const actionTotal = status.actions.length
    if (status.status !== 'ativo') {
      return [`Projeto ${status.type}: ${status.status} | obras ${actionDone}/${actionTotal || 0}`]
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

  async function ensureProjectWorkers(type) {
    const definition = projectManager.definition(type)
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

    if (action === 'iniciar') action = String(args[1] || '').toLowerCase()

    const definition = projectManager.definition(action)
    if (!definition) {
      bot.chat('Uso: !projeto <casa|fazenda|mina|vila> | !projeto status | !projeto cancelar')
      return
    }

    try {
      if (!colonyHome) throw new Error('defina a base primeiro com !base aqui')
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
      const assignments = await colony.assign(role, resource, count)
      bot.chat(`Ordem enviada a ${assignments.length} bot(s): ${resource} x${count}.`)
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
      bot.chat('Uso: !construir casa | !construir fazenda | !construir mina [comprimento]')
    } catch (err) {
      bot.chat(`Não consegui iniciar a construção: ${err.message}`)
    }
  })

  commandRouter.register('base', async (context, args) => {
    const action = String(args[0] || 'status').toLowerCase()

    if (action === 'status') {
      if (!colonyHome) {
        bot.chat('Base ainda não definida. Vá ao local desejado e use !base aqui.')
        return
      }
      bot.chat(`Base: X=${Math.floor(colonyHome.x)}, Y=${Math.floor(colonyHome.y)}, Z=${Math.floor(colonyHome.z)}.`)
      return
    }

    if (action === 'limpar' || action === 'remover') {
      colonyHome = null
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

    colonyHome = source.clone()
    persistSoon()
    bot.chat(`Este local agora é a base: X=${Math.floor(colonyHome.x)}, Y=${Math.floor(colonyHome.y)}, Z=${Math.floor(colonyHome.z)}.`)
  })

  commandRouter.register('smoke', async () => {
    bot.chat('Executando smoke test da colônia...')
    const result = await smokeTest.run()
    const status = result.ok ? 'PASSOU' : 'FALHOU'
    bot.chat(`Smoke: ${status} | ${result.passed} ok | ${result.failed} falha(s).`)
    for (const check of result.checks) {
      if (check.ok === false) bot.chat(`FALHA ${check.name}: ${check.detail}`)
    }
  })

  commandRouter.register('tarefas', async () => {
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
        await storage.summary(bot)
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
      const counts = await storage.summary(bot)
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
    runTask('fabricar', async (isCancelled) => {
      await craft.craftItem(bot, item.name, target, isCancelled)
      if (!isCancelled()) bot.chat(`Pronto! Tenho ${craft.countItem(bot, item.id)}x ${item.name}.`)
    })
  }

  commandRouter.register('fabricar', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !fabricar <item> [qtd]. Ex.: !fabricar picareta_ferro 2')
      return
    }
    let count = 1
    if (/^\d+$/.test(args.at(-1))) count = Math.max(1, Number.parseInt(args.pop(), 10))
    const item = normalizeItemName(args.join('_'))
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

  bot.on('chat', async (username, message) => {
    if (username === bot.username || botManager.get(username)) return
    const owner = ownerName()
    if (owner && username !== owner) return
    if (!resolvedOwner) resolvedOwner = username
    if (await commandRouter.dispatch({ bot, username }, message)) return
    const [cmd, ...args] = message.toLowerCase().trim().split(/\s+/)

    switch (cmd) {
      case '!parar':
        console.log(`Comando !parar recebido de ${username}. Encerrando bot e colônia...`)
        quitRequested = true
        await persistState().catch(() => {})
        botManager.stopAll()
        bot.quit()
        break
      case '!seguir':
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
      case '!ver':
        if (!bot.entity) return
        for (const line of perception.describe(bot)) bot.chat(line)
        break
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
      case '!ficar':
        cancelTask()
        mode = 'ficar'
        bot.chat('Ok, fico aqui.')
        break
      case '!cancelar':
        cancelTask()
        mode = 'seguir'
        bot.chat('Tarefa cancelada. Voltando a te seguir.')
        break
      case '!minerar': {
        if (!args[0]) {
          bot.chat('Uso: !minerar <bloco> [quantidade]  ex.: !minerar oak_log 5')
          return
        }
        mine(args[0], parseCount(args[1]))
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
        bot.chat('Comandos: !seguir, !ficar, !minerar, !fabricar, !cozinhar, !atacar, !comer, !comida, !ver, !status, !pos, !cancelar, !parar')
        bot.chat('Colônia: !base aqui, !estoque aqui, !projeto <casa|fazenda|mina|vila>, !projeto status, !smoke, !colonia auto, !colonia necessidades, !bot, !bots, !ordem, !abastecer, !construir <casa|fazenda|mina>, !todos voltar, !tarefas')
        break
    }
  })
}

main()
