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
const { CommandRouter } = require('./core/CommandRouter')
const { MinecraftKnowledge } = require('./core/MinecraftKnowledge')
const { Planner } = require('./core/Planner')
const { BotManager } = require('./core/BotManager')
const craft = require('./lib/craft')
const gather = require('./lib/gather')
const { WorkerController } = require('./core/WorkerController')
const { ColonyOrchestrator } = require('./core/ColonyOrchestrator')

const HOST = process.env.MINECRAFT_HOST || '127.0.0.1'
const DEFAULT_PORT = 25565
// Jogador que o bot segue e obedece. Sem valor, usa o primeiro jogador online.
const OWNER = process.env.MINECRAFT_OWNER || null

const FOLLOW_DISTANCE = 2   // blocos de distância ao seguir o dono
const FLEE_DISTANCE = 16    // distância que tenta manter do agressor
const FLEE_MS = 4000        // tempo fugindo depois de tomar dano
const LOW_HEALTH = 10       // com HP baixo, foge de hostis próximos antes de apanhar
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
      resolve(err || !res?.version ? null : { port, version: res.version.name })
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
  fixEntityMovement(bot._client)
  fixOutgoingPackets(bot._client)
  bot.loadPlugin(pathfinder)

  // ========== ORQUESTRAÇÃO ==========
  const knowledge = new MinecraftKnowledge(bot)
  const planner = new Planner(bot, knowledge)
  const commandRouter = new CommandRouter()
  let colonyHome = null

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
      homeProvider: () => colonyHome || bot.entity?.position,
      ownerProvider: () => ownerEntity()
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
    homeProvider: () => colonyHome || bot.entity?.position,
    ownerProvider: () => ownerEntity()
  })
  colony.start()

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
      bot.chat(`Estou apanhando! Parei de ${taskName}.`)
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
  // (fuga, !cancelar, outra tarefa). No fim, volta a seguir o dono.
  async function runTask(name, fn) {
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
    mode = 'seguir'
    taskName = null
    follow()
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
  bot.on('spawn', () => {
    if (!colonyHome) colonyHome = bot.entity.position.clone()
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
  })

  bot.once('health', () => {
    console.log(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20`)
  })

  bot.on('entityHurt', (entity, source) => {
    if (entity === bot.entity && source) lastAttacker = source
  })

  bot.on('health', () => {
    if (lastHealth !== null && bot.health < lastHealth && bot.health > 0) {
      flee(lastAttacker)
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
    if (bot.health <= LOW_HEALTH && mode !== 'ficar' && nearestHostile(6)) {
      flee()
      return
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

  bot.on('end', () => {
    colony.stop()
    botManager.stopAll()
    console.log('Conexão encerrada.')
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
    if (!workers.length) return [`Colônia: 1/${maxColonyBots} (somente ${bot.username}).`]
    const roles = {}
    for (const worker of workers) roles[worker.role] = (roles[worker.role] || 0) + 1
    const roleText = Object.entries(roles).map(([role, n]) => `${role}x${n}`).join(', ')
    const lines = [`Colônia: ${workers.length + 1}/${maxColonyBots} | auto: ${colony.auto ? 'ON' : 'OFF'} | ${roleText}`]
    for (let i = 0; i < workers.length; i += 4) {
      lines.push(workers.slice(i, i + 4).map((w) => {
        const task = w.task ? `:${w.task}${w.resource ? '/' + w.resource : ''}` : ''
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
      colony.setAuto(enabled)
      bot.chat(`Modo automático da colônia: ${enabled ? 'ATIVADO' : 'DESATIVADO'}.`)
      return
    }
    for (const line of colonySummary()) bot.chat(line)
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
    if (!['casa', 'abrigo'].includes(String(args[0] || '').toLowerCase())) {
      bot.chat('Uso: !construir casa')
      return
    }
    try {
      const name = await colony.buildHouse()
      bot.chat(`${name} recebeu a ordem de construir um abrigo 3x3.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a construção: ${err.message}`)
    }
  })

  commandRouter.register('base', async (_context, args) => {
    if (String(args[0] || '').toLowerCase() !== 'aqui' || !bot.entity) {
      bot.chat('Uso: !base aqui')
      return
    }
    colonyHome = bot.entity.position.clone()
    bot.chat(`Base definida em X=${Math.floor(colonyHome.x)}, Y=${Math.floor(colonyHome.y)}, Z=${Math.floor(colonyHome.z)}.`)
  })

  commandRouter.register('tarefas', async () => {
    const tasks = colony.taskSummary()
    if (!tasks.length) {
      bot.chat('Nenhum bot auxiliar na colônia.')
      return
    }
    for (let i = 0; i < tasks.length; i += 4) {
      bot.chat(tasks.slice(i, i + 4).map((entry) =>
        `${entry.name}:${entry.state}${entry.task ? '/' + entry.task : ''}${entry.resource ? '/' + entry.resource : ''}`
      ).join(', '))
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
      bot.chat(botManager.remove(name) ? `${name} removido da colônia.` : `Não encontrei ${name}.`)
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
    if (username === bot.username) return
    if (OWNER && username !== OWNER) return
    if (await commandRouter.dispatch({ bot, username }, message)) return
    const [cmd, ...args] = message.toLowerCase().trim().split(/\s+/)

    switch (cmd) {
      case '!parar':
        console.log(`Comando !parar recebido de ${username}. Encerrando bot e colônia...`)
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
      case '!fabricar': {
        const item = bot.registry.itemsByName[args[0]]
        if (!item) {
          bot.chat('Uso: !fabricar <item> [quantidade]  ex.: !fabricar wooden_pickaxe (nome em inglês)')
          return
        }
        const target = craft.countItem(bot, item.id) + parseCount(args[1])
        bot.chat(`Fabricando ${item.name}...`)
        runTask('fabricar', async (isCancelled) => {
          await craft.craftItem(bot, item.name, target, isCancelled)
          if (!isCancelled()) bot.chat(`Pronto! Tenho ${craft.countItem(bot, item.id)}x ${item.name}.`)
        })
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
        bot.chat('Comandos: !seguir, !ficar, !minerar, !fabricar, !cozinhar, !comer, !comida, !ver, !status, !pos, !cancelar, !parar')
        bot.chat('Colônia: !bot, !bots, !ordem, !todos voltar, !construir casa, !colonia auto, !base aqui, !tarefas, !item, !receita')
        break
    }
  })
}

main()
