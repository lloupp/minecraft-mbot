// @ts-check
// app/lifecycle.js
// Entrada no mundo (log e restauração da colônia salva), sinais do sistema e
// queda da conexão. Queda inesperada sai com código 1 para o supervisor
// (systemd ou `npm run sempre`) reconectar; !parar e SIGINT/SIGTERM saem com 0.

function createLifecycle() {
  let quitRequested = false
  return {
    requestQuit() { quitRequested = true },
    get quitRequested() { return quitRequested }
  }
}

function installSignalHandlers({ lifecycle, bot, toolApiRuntime, worldMemory }) {
  const flushWorld = () => {
    try { worldMemory?.flushSync() } catch (err) { console.log(`[world-memory] falha ao salvar: ${err.message}`) }
  }
  if (toolApiRuntime) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      lifecycle.requestQuit()
      flushWorld()
      toolApiRuntime.close().catch(error => console.log(`[tool-api] shutdown: ${error.message}`))
      bot.quit()
    })
  } else if (worldMemory) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { flushWorld(); process.exit(0) })
  }
}

// Na primeira entrada: recria os workers salvos, completa os do projeto ativo
// e religa o modo automático se base/estoque/planejador estiverem prontos.
function restoreOnFirstSpawn({ bot, savedState, botManager, projectManager, colony, storage, homeProvider, ensureProjectWorkers, persistSoon, ownerName }) {
  let restoredWorkers = false
  bot.on('spawn', async () => {
    console.log('=== Bot conectado! ===')
    console.log(`Jogador: ${bot.username}`)
    console.log(`Posição: X=${bot.entity.position.x.toFixed(1)}, Y=${bot.entity.position.y.toFixed(1)}, Z=${bot.entity.position.z.toFixed(1)}`)
    console.log(`Modo: ${bot.game?.gameMode ?? 'desconhecido'} | Ping: ${bot.players[bot.username]?.ping ?? 'N/A'}ms`)
    console.log(`Dono: ${ownerName() ?? '(ninguém online)'}`)
    console.log('\n--- Bot ativo! Digite !ajuda no chat ---\n')

    if (restoredWorkers) return
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
  })
}

function installConnectionHandlers({ bot, CONFIG, lifecycle, shutdown }) {
  bot.on('kicked', (reason) => {
    console.log('Bot desconectado:', reason)
  })

  bot.on('end', async (reason) => {
    await shutdown()
    console.log(`Conexão encerrada${reason ? ` (${reason})` : ''}.`)
    setTimeout(() => process.exit(lifecycle.quitRequested ? 0 : 1), 500)
  })

  bot.on('error', (err) => {
    console.error(`Erro de conexão (${err.code || 'desconhecido'}): ${err.message}`)
    if (err.code === 'ECONNREFUSED') {
      console.error(`Verifique se o mundo está aberto para LAN e se a porta ${CONFIG.port} está correta. Configure outra porta com MINECRAFT_PORT.`)
    }
  })
}

module.exports = { createLifecycle, installSignalHandlers, restoreOnFirstSpawn, installConnectionHandlers }
