'use strict'

const { MinecraftToolLayer } = require('../core/MinecraftToolLayer')
const { TaskCheckpointStore } = require('../core/TaskCheckpointStore')
const { ToolApiServer } = require('./tool-api-server')

async function bounded(promise, ms = 2000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Tool API shutdown timeout')), ms)
    })])
  } finally { clearTimeout(timer) }
}

// The same integration is used by index.js and runtime tests. Disabled means no
// listener, checkpoint reads/writes or worker mutation.
class ToolApiRuntime {
  constructor({ botManager, checkpointStore, port = 3091, logger = console }) {
    this.botManager = botManager
    this.checkpointStore = checkpointStore
    this.logger = logger
    this.layers = new Map()
    this.endHandlers = new Map()
    this.closed = false
    this.server = new ToolApiServer({ botManager, port, host: '127.0.0.1', logger })
  }

  attach(bot, name) {
    if (this.closed || !bot.colonyController) return null
    if (this.layers.has(bot)) return this.layers.get(bot)
    const layer = new MinecraftToolLayer({ worker: bot.colonyController, workerId: name, checkpointStore: this.checkpointStore, logger: this.logger })
    bot.minecraftTools = layer
    this.layers.set(bot, layer)
    const onEnd = () => {
      layer.close?.().catch(error => this.logger.log?.(`[tool-api] worker end: ${error.message}`))
      if (bot.minecraftTools === layer) delete bot.minecraftTools
      this.layers.delete(bot)
      this.endHandlers.delete(bot)
    }
    this.endHandlers.set(bot, onEnd)
    bot.once('end', onEnd)
    return layer
  }

  async start() {
    const server = this.server.start()
    await new Promise((resolve, reject) => {
      const onError = error => { server.removeListener('listening', onListening); reject(error) }
      const onListening = () => { server.removeListener('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
    })
    // Prevent an optional listener error from crashing the Minecraft session.
    server.on('error', error => this.logger.log?.(`[tool-api] listener error: ${error.message}`))
    for (const worker of this.botManager.workers.values()) this.attach(worker.bot, worker.name)
    return this
  }

  close() {
    if (this._closing) return this._closing
    this.closed = true
    const pending = []
    for (const [bot, layer] of this.layers) {
      pending.push(layer.close())
      if (bot.minecraftTools === layer) delete bot.minecraftTools
      bot.removeListener('end', this.endHandlers.get(bot))
    }
    this.layers.clear()
    this.endHandlers.clear()
    this._closing = (async () => {
      // Close HTTP connections rather than waiting forever on a slow task/client.
      const stop = this.server.stop()
      await stop
      try { await bounded(Promise.allSettled(pending)) } catch (error) { this.logger.log?.(`[tool-api] ${error.message}; checkpoints running require recovery on restart`) }
      await bounded(this.checkpointStore.save())
    })()
    return this._closing
  }
}

async function startToolApiRuntime({ enabled = process.env.MBOT_TOOL_API === '1', botManager, port = Number(process.env.MBOT_TOOL_API_PORT || 3091), checkpointFile = process.env.MBOT_TASK_CHECKPOINT_FILE, logger = console } = {}) {
  if (!enabled) return null
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MBOT_TOOL_API_PORT inválida')
  const checkpointStore = new TaskCheckpointStore(checkpointFile)
  await checkpointStore.load()
  if (checkpointStore.lastLoadError) throw new Error('Tool API bloqueada: preserve e recupere o arquivo de checkpoints inválido')
  const runtime = new ToolApiRuntime({ botManager, checkpointStore, port, logger })
  try { return await runtime.start() } catch (error) {
    await runtime.server.stop().catch(() => {})
    throw error
  }
}

module.exports = { ToolApiRuntime, startToolApiRuntime }
