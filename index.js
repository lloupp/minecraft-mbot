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

const HOST = process.env.MINECRAFT_HOST || '127.0.0.1'
const DEFAULT_PORT = 25565
// Jogador que o bot segue e obedece. Sem valor, usa o primeiro jogador online.
const OWNER = process.env.MINECRAFT_OWNER || null

const FOLLOW_DISTANCE = 2   // blocos de distância ao seguir o dono
const FLEE_DISTANCE = 16    // distância que tenta manter do agressor
const FLEE_MS = 4000        // tempo fugindo depois de tomar dano
const LOW_HEALTH = 10       // com HP baixo, foge de hostis próximos antes de apanhar
const MINE_RANGE = 32       // raio de busca de blocos para minerar

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

// No 26.3 os pacotes de movimento de entidades mudaram de formato (`delta` e
// `position`), mas o mineflayer ainda lê os campos antigos e as posições dos
// outros jogadores/mobs viram NaN. Converte para o formato antigo antes dele.
function fixEntityMovement(client) {
  const fixDelta = (packet) => {
    const d = packet.delta
    if (!d || packet.dX !== undefined) return
    let x = 0; let y = 0; let z = 0
    if (d.steps?.length) {
      for (const step of d.steps) { x += step.x; y += step.y; z += step.z }
    } else {
      x = d.dX; y = d.dY; z = d.dZ
    }
    // mineflayer divide por 128 * 32 (fixedPointDelta128).
    packet.dX = x * 4096
    packet.dY = y * 4096
    packet.dZ = z * 4096
  }
  client.prependListener('rel_entity_move', fixDelta)
  client.prependListener('entity_move_look', fixDelta)
  client.prependListener('sync_entity_position', (packet) => {
    const path = packet.position?.path
    if (!path || packet.x !== undefined) return
    const pos = path.endPosition || path.steps?.at(-1)?.position
    if (!pos) return
    packet.x = pos.x
    packet.y = pos.y
    packet.z = pos.z
    packet.dx = 0
    packet.dy = 0
    packet.dz = 0
  })
}

// No 26.3 os pacotes de movimento de entidades mudaram de formato (`delta` e
// `position`), mas o mineflayer ainda lê os campos antigos e as posições dos
// outros jogadores/mobs viram NaN. Converte para o formato antigo antes dele.
function fixEntityMovement(client) {
  const fixDelta = (packet) => {
    const d = packet.delta
    if (!d || packet.dX !== undefined) return
    let x = 0; let y = 0; let z = 0
    if (d.steps?.length) {
      for (const step of d.steps) { x += step.x; y += step.y; z += step.z }
    } else {
      x = d.dX; y = d.dY; z = d.dZ
    }
    // mineflayer divide por 128 * 32 (fixedPointDelta128).
    packet.dX = x * 4096
    packet.dY = y * 4096
    packet.dZ = z * 4096
  }
  client.prependListener('rel_entity_move', fixDelta)
  client.prependListener('entity_move_look', fixDelta)
  client.prependListener('sync_entity_position', (packet) => {
    const path = packet.position?.path
    if (!path || packet.x !== undefined) return
    const pos = path.endPosition || path.steps?.at(-1)?.position
    if (!pos) return
    packet.x = pos.x
    packet.y = pos.y
    packet.z = pos.z
    packet.dx = 0
    packet.dy = 0
    packet.dz = 0
  })
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
    username: 'eduardo_bot',
    password: '',
    // version: false trava na detecção automática; usa a versão do ping.
    version: process.env.MINECRAFT_VERSION || server.version
  }
  console.log(`Conectando a ${CONFIG.host}:${CONFIG.port} (versão ${CONFIG.version})...`)

  // ========== CRIAÇÃO DO BOT ==========
  const bot = mineflayer.createBot(CONFIG)
  autoVersionForge(bot._client)
  fixEntityMovement(bot._client)
  bot.loadPlugin(pathfinder)

  // ========== ESTADO ==========
  let mode = 'seguir'       // 'seguir' | 'ficar' | 'minerar'
  let fleeingUntil = 0
  let lastHealth = null
  let lastAttacker = null
  let taskId = 0            // incrementado para cancelar a tarefa em andamento
  let followMoves, workMoves

  function ownerName() {
    return OWNER || Object.keys(bot.players).find((name) => name !== bot.username)
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
    if (bot.targetDigBlock) bot.stopDigging()
    bot.pathfinder.setGoal(null)
  }

  // Foge do agressor (ou do hostil mais próximo); sem ameaça visível, corre para o dono.
  function flee(attacker) {
    if (mode === 'minerar') {
      cancelTask()
      mode = 'seguir'
      bot.chat('Estou apanhando! Parei de minerar.')
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

  async function mine(blockName, count) {
    const blockType = bot.registry.blocksByName[blockName]
    if (!blockType) {
      bot.chat(`Não conheço o bloco "${blockName}". Use o nome em inglês, ex.: stone, oak_log, iron_ore.`)
      return
    }
    cancelTask()
    const myTask = taskId
    mode = 'minerar'
    let mined = 0
    bot.chat(`Minerando ${count}x ${blockName}...`)
    try {
      while (mined < count && myTask === taskId) {
        const block = bot.findBlock({ matching: blockType.id, maxDistance: MINE_RANGE })
        if (!block) {
          bot.chat(`Não encontrei mais ${blockName} num raio de ${MINE_RANGE} blocos.`)
          break
        }
        bot.pathfinder.setMovements(workMoves)
        await bot.pathfinder.goto(new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z))
        if (myTask !== taskId) return
        const tool = bot.pathfinder.bestHarvestTool(block)
        if (tool) await bot.equip(tool, 'hand')
        await bot.dig(block)
        mined++
        // Anda até onde o bloco estava para pegar o item.
        await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z)).catch(() => {})
      }
    } catch (err) {
      if (myTask !== taskId) return // cancelado (fuga, !cancelar etc.)
      bot.chat(`Não consegui minerar: ${err.message}`)
    }
    if (myTask !== taskId) return
    bot.chat(`Minerei ${mined}x ${blockName}.`)
    mode = 'seguir'
    follow()
  }

  // ========== EVENTOS ==========
  bot.on('spawn', () => {
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
  })

  bot.once('health', () => {
    console.log(`HP: ${Math.round(bot.health)}/20 | Fome: ${bot.food}/20`)
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
    if (mode === 'seguir') {
      const owner = ownerEntity()
      if (owner && bot.pathfinder.goal?.entity !== owner) follow()
    }
  }, 500)

  bot.on('kicked', (reason) => {
    console.log('Bot desconectado:', reason)
  })

  bot.on('end', () => {
    console.log('Conexão encerrada.')
  })

  bot.on('error', (err) => {
    console.error(`Erro de conexão (${err.code || 'desconhecido'}): ${err.message}`)
    if (err.code === 'ECONNREFUSED') {
      console.error(`Verifique se o mundo está aberto para LAN e se a porta ${CONFIG.port} está correta. Configure outra porta com MINECRAFT_PORT.`)
    }
  })

  // ========== COMANDOS VIA CHAT ==========
  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (OWNER && username !== OWNER) return
    const [cmd, ...args] = message.toLowerCase().trim().split(/\s+/)

    switch (cmd) {
      case '!parar':
        console.log(`Comando !parar recebido de ${username}. Encerrando bot...`)
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
        const count = Math.max(1, Math.min(64, Number.parseInt(args[1], 10) || 1))
        mine(args[0], count)
        break
      }
      case '!status':
        if (!bot.entity) {
          bot.chat('Ainda estou entrando no mundo.')
          return
        }
        bot.chat(`HP: ${Math.round(bot.health)}/20 | Fome: ${bot.food}/20 | Itens: ${bot.inventory.items().length} | Modo: ${mode}`)
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
        bot.chat('Comandos: !seguir, !ficar, !minerar <bloco> [qtd], !cancelar, !status, !pos, !parar')
        break
    }
  })
}

main()
