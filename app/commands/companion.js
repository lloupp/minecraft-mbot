// app/commands/companion.js
// Comandos do companheiro (seguir, ficar, comer, lutar, minerar...) e de
// diagnóstico. Os argumentos chegam em minúsculas, como no chat original.

const { execFileSync } = require('child_process')
const food = require('../../lib/food')
const craft = require('../../lib/craft')
const perception = require('../../lib/perception')
const { describeProfile } = require('../../lib/serverProfile')
const { parseCount } = require('./parse')

function registerCompanionCommands(commandRouter, ctx) {
  const { bot, CONFIG, serverProfile, botManager, runVerifier, eventLog, statusServer, persistState, persistSoon, requestQuit, companion, places } = ctx
  const { autonomy, follow, cancelTask, clearPatrolState, defend, mine, eatNow, searchFood, runTask, ownerEntity } = companion
  const { resolveBlocks } = places

  const register = (names, handler) => commandRouter.register(names, (context, args) =>
    handler(context, args.map((arg) => arg.toLowerCase())))

  // Larga patrulha/autônomo e volta para `mode` (seguir ou ficar).
  function stopEverything(mode) {
    companion.autonomous = false
    clearPatrolState()
    persistSoon()
    cancelTask()
    companion.mode = mode
  }

  register('parar', async (context) => {
    console.log(`Comando !parar recebido de ${context.username}. Encerrando bot e colônia...`)
    requestQuit()
    await persistState().catch(() => {})
    botManager.stopAll()
    bot.quit()
  })

  register('seguir', async () => {
    stopEverything('seguir')
    if (ownerEntity()) {
      follow()
      bot.chat('Seguindo você!')
    } else {
      bot.chat('Não estou te vendo; vou seguir quando você chegar perto.')
    }
  })

  register('ficar', async () => {
    stopEverything('ficar')
    bot.chat('Ok, fico aqui.')
  })

  register('cancelar', async () => {
    stopEverything('seguir')
    bot.chat('Tarefa cancelada. Voltando a te seguir.')
  })

  register('comer', async () => {
    if (!food.hasFood(bot)) {
      bot.chat('Não tenho comida. Use !comida para eu buscar.')
      return
    }
    eatNow().then((eaten) => eaten && bot.chat(`Comi ${eaten}. Fome: ${bot.food}/20`))
  })

  register('comida', async () => {
    searchFood(true)
  })

  register('ver', async () => {
    if (!bot.entity) return
    for (const line of perception.describe(bot)) bot.chat(line)
  })

  register('atacar', async (_context, args) => {
    const name = args[0]
    const target = bot.nearestEntity((e) => e !== bot.entity && e.type !== 'player' &&
      (name ? e.name === name : e.type === 'hostile') && e.position.distanceTo(bot.entity.position) <= 24)
    if (!target) {
      bot.chat(name ? `Não vejo ${name} por perto.` : 'Não vejo nenhum monstro por perto.')
      return
    }
    bot.chat(`Atacando ${target.name}!`)
    defend(target)
  })

  register(['autonomo', 'autônomo'], async (_context, args) => {
    clearPatrolState()
    if (args[0] === 'off' || args[0] === 'parar') {
      companion.autonomous = false
      cancelTask()
      companion.mode = 'seguir'
      persistSoon()
      bot.chat('Modo autônomo desligado. Voltando a te seguir.')
      return
    }
    companion.autonomous = true
    cancelTask()
    companion.mode = 'seguir'
    persistSoon()
    bot.chat(`Modo autônomo ligado! ${autonomy.progress()}`)
  })

  register('metas', async () => {
    bot.chat(autonomy.progress())
  })

  register('servidor', async () => {
    bot.chat(`Servidor: ${CONFIG.host}:${CONFIG.port} | ${describeProfile(serverProfile)} | protocolo ${bot._client?.protocolVersion ?? 'N/A'}`)
  })

  register('minerar', async (context, args) => {
    if (!args[0]) {
      bot.chat('Uso: !minerar <bloco> [quantidade]  ex.: !minerar oak_log 5')
      return
    }
    const count = parseCount(args[1])
    resolveBlocks(args[0], context.username)
      .then((blocks) => blocks && mine(blocks, count))
      .catch((err) => bot.chat(`Não consegui minerar: ${err.message}`))
  })

  register('cozinhar', async (_context, args) => {
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
  })

  register('status', async (_context, args) => {
    if (args[0] === 'server') {
      bot.chat(process.env.STATUS_SERVER === '1'
        ? `Status server: http://127.0.0.1:${statusServer.port}`
        : 'Status server desativado. Defina STATUS_SERVER=1 para ativar.')
      return
    }
    if (!bot.entity) {
      bot.chat('Ainda estou entrando no mundo.')
      return
    }
    bot.chat(`HP: ${Math.round(bot.health * 10) / 10}/20 | Fome: ${bot.food}/20 | Itens: ${bot.inventory.items().length} | Modo: ${companion.taskName ?? companion.mode}`)
    const pos = bot.entity.position
    bot.chat(`Posição: X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}`)
  })

  register('pos', async () => {
    if (!bot.entity) {
      bot.chat('Ainda estou entrando no mundo.')
      return
    }
    const p = bot.entity.position
    bot.chat(`X=${p.x.toFixed(1)}, Y=${p.y.toFixed(1)}, Z=${p.z.toFixed(1)}`)
  })

  register('ajuda', async () => {
    bot.chat('Memória: !lembrar <nome> aqui, !lembrar <chave> = <valor>, !esquecer <nome>, !memoria [tipo], !onde <coisa>')
    bot.chat('Comandos: !seguir, !ficar, !autonomo [off], !metas, !local, !ir, !voltar, !patrulha, !explorar, !enviar, !animais, !curral, !capturar, !reproduzir, !manejo, !produto, !tosquiar, !servidor, !minerar, !fabricar, !cozinhar, !atacar, !comer, !comida, !ver, !status, !pos, !cancelar, !parar')
    bot.chat('Colônia: !base aqui, !estoque aqui, !projeto <casa|fazenda|mina|vila>, !projeto planta <nome>, !projeto status, !smoke, !colonia auto, !colonia necessidades, !bot, !bots, !ordem, !abastecer, !construir <casa|fazenda|mina|curral|planta>, !plantas, !todos voltar, !tarefas')
    bot.chat('Auditoria: !verify, !events [n], !freeze [nome], !status server')
  })

  register('verify', async () => {
    const proof = runVerifier.verify()
    bot.chat(`Verificação: ${proof.passed}/${proof.total} passaram, ${proof.failed} falharam`)
    bot.chat(`All passed: ${proof.allPassed ? 'SIM' : 'NÃO'}`)
  })

  register('events', async (_context, args) => {
    const limit = Math.max(1, Math.min(50, Number(args[0]) || 10))
    const events = eventLog.getRecent(limit)
    bot.chat(`Últimos ${events.length} eventos:`)
    for (const e of events.slice(-5)) {
      bot.chat(`[${e.type}] ${e.worker || 'geral'} - ${new Date(e.time).toLocaleTimeString()}`)
    }
  })

  register('freeze', async (_context, args) => {
    const name = args[0] || `freeze-${Date.now()}`
    bot.chat(`Freeze iniciado: ${name}`)
    try {
      execFileSync(process.execPath, ['scripts/freeze-colony.js', name], { cwd: process.cwd(), timeout: 30000 })
      bot.chat(`Freeze concluído: ${name}`)
    } catch (err) {
      bot.chat(`Freeze erro: ${err.message}`)
    }
  })
}

module.exports = { registerCompanionCommands }
