// @ts-check
// app/dashboard.js
// Painel de testes local (MBOT_DASHBOARD=1, só 127.0.0.1) e o contexto dos
// cenários do RunVerifier: só ações já existentes, com o bot real.

const gather = require('../lib/gather')
const { StatusServer } = require('../lib/status-server')
const { describeBot, describeWorkers } = require('../lib/dashboard-snapshot')
const { envPort } = require('./discovery')

// Visualizações para o painel: sem funções, só porta/endereço/estado.
function publicViews(views) {
  if (!views) return null
  const pick = (view) => view && { port: view.port, address: view.address, status: view.status, error: view.error }
  return { viewer: pick(views.viewer), inventory: pick(views.inventory) }
}

// Mesmo StatusServer (rotas antigas continuam), com a página, o retrato do
// bot/workers e os cenários do RunVerifier.
function startDashboard({ bot, CONFIG, serverProfile, botManager, storage, projectManager, eventLog, runVerifier, consoleBuffer, views, companion }) {
  const server = new StatusServer({
    botManager,
    storage,
    projectManager,
    eventLog,
    port: envPort(process.env.MBOT_DASHBOARD_PORT) || 3006,
    dashboard: {
      runVerifier,
      views,
      snapshot: () => ({
        profile: { id: serverProfile.id, version: bot.version || serverProfile.version, server: `${CONFIG.host}:${CONFIG.port}` },
        main: describeBot(bot, { role: 'orquestrador', status: bot.entity ? 'conectado' : 'desconectado', mode: companion().mode, task: companion().taskName, owner: companion().ownerName() || null }),
        workers: describeWorkers(botManager),
        views: publicViews(views()),
        logs: consoleBuffer ? consoleBuffer.recent(200) : []
      })
    }
  })
  server.start()
  console.log(`[painel] http://127.0.0.1:${server.port}/dashboard`)
  return server
}

function setScenarioContext({ runVerifier, bot, storage, botManager, smokeTest, places, companion, views, persistSoon }) {
  const { runTask, withoutFollowing } = companion
  const LOG_BLOCK_IDS = () => Object.values(bot.registry.blocksByName).filter((b) => /_log$/.test(b.name)).map((b) => b.id)
  runVerifier.setScenarioContext({
    get bot() { return bot },
    storage,
    botManager,
    dimension: () => places.currentDimension(),
    views,
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
}

module.exports = { publicViews, startDashboard, setScenarioContext }
