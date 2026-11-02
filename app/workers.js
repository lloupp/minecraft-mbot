// @ts-check
// app/workers.js
// Criação dos bots auxiliares da colônia e reforço de workers por projeto.

const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { configureClient } = require('../lib/serverProfile')
const { loadPlugins } = require('../lib/plugins')
const { createBot } = require('../lib/botFactory')
const { WorkerController } = require('../core/WorkerController')

function createWorkerFactory({ CONFIG, serverProfile, homeProvider, ownerEntity, storage, production, shadow, worldMemory, juliaAuthority, toolApi }) {
  return function createWorker({ name, role }) {
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
      shadow,
      worldMemory,
      juliaAuthority
    })
    toolApi()?.attach(worker, name)

    worker.once('spawn', () => {
      console.log(`[colônia] ${name} conectado como ${role}`)
    })
    worker.on('kicked', (reason) => console.log(`[colônia] ${name} expulso:`, reason))
    worker.on('error', (err) => console.log(`[colônia] ${name} erro: ${err.message}`))
    return worker
  }
}

// Cria só os workers que faltam para os papéis do projeto (ou de `roles`).
async function ensureProjectWorkers({ projectManager, botManager }, type, roles = null) {
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

module.exports = { createWorkerFactory, ensureProjectWorkers }
