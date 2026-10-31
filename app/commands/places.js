// app/commands/places.js
// Lugares: base, locais salvos, viagem, patrulha e envio de workers.

const { dito } = require('../../core/Memory')

function registerPlacesCommands(commandRouter, ctx) {
  const { bot, colony, memory, waypointManager, worldMemory, projectManager, homeProvider, homeDimension, persistSoon, companion, places } = ctx
  const { travelTo, startPatrol, clearPatrolState, cancelTask } = companion
  const { currentDimension, waypointOrBase, resolvePlace, assertWaypointReachable } = places

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
      bot.chat(companion.patrolActive
        ? `Patrulha ativa: ${companion.patrolRoute.join(' -> ')}.`
        : 'Nenhuma patrulha ativa.')
      return
    }

    if (['off', 'parar', 'cancelar'].includes(action)) {
      clearPatrolState()
      if (companion.taskName === 'patrulhar') cancelTask()
      companion.mode = 'ficar'
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
}

module.exports = { registerPlacesCommands }
