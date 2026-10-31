// app/commands/index.js
// Registra todos os comandos de chat no router.

const { registerColonyCommands } = require('./colony')
const { registerProjectsCommands } = require('./projects')
const { registerPlacesCommands } = require('./places')
const { registerAnimalsCommands } = require('./animals')
const { registerProductionCommands } = require('./production')
const { registerMemoryCommands } = require('./memory')
const { registerCompanionCommands } = require('./companion')

function registerAllCommands(router, ctx) {
  for (const register of [
    registerColonyCommands, registerProjectsCommands, registerPlacesCommands, registerAnimalsCommands,
    registerProductionCommands, registerMemoryCommands, registerCompanionCommands
  ]) register(router, ctx)
  return router
}

// Só o dono (ou, sem dono configurado, o primeiro jogador que falar) comanda.
function attachChat({ bot, botManager, clarifier, commandRouter, companion }) {
  bot.on('chat', async (username, message) => {
    if (username === bot.username || botManager.get(username)) return
    const owner = companion.ownerName()
    if (owner && username !== owner) return
    if (!companion.resolvedOwner) companion.resolvedOwner = username
    // Resposta a uma pergunta pendente ("Qual casa? 1) ... 2) ...").
    if (clarifier.handleMessage(username, message)) return
    await commandRouter.dispatch({ bot, username }, message)
  })
}

module.exports = { registerAllCommands, attachChat }
