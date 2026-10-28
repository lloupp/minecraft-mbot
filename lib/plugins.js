// lib/plugins.js
// Plugins prontos do mineflayer. Cada um é opcional: se não carregar (ex.: numa
// versão sem suporte), o bot continua com a implementação própria em lib/.
//
// - mineflayer-pvp: combate corpo a corpo (persegue, bate no tempo certo)
// - mineflayer-tool + mineflayer-collectblock: coletar blocos com a ferramenta
//   certa, recolhendo os itens
// - minecrafthawkeye: mira com arco
// - mineflayer-auto-eat: come sozinho quando a fome baixa (o laço principal
//   deixa de comer por conta própria quando este plugin está ativo)
// - mineflayer-statemachine: biblioteca de máquina de estados usada por
//   lib/stateMachineExplore.js (não é um plugin de bot; não entra na lista)
// - prismarine-viewer / mineflayer-web-inventory: ver o bot e o inventário no
//   navegador (só com MBOT_VIEWER_PORT / MBOT_INVENTORY_PORT, em 127.0.0.1)
//
// Fora de propósito: mineflayer-armor-manager. Ele clica no inventário a cada
// item recolhido e atropela os cliques do craft (no teste: 153 reenvios de
// inventário pelo servidor contra 42 sem ele, e a espada não saía).
// lib/equipment.js veste a armadura só quando o bot está livre.

// Come sozinho quando a fome chega a 14/20, com erro só no log (nunca
// derruba o bot) e devolvendo o item que estava na mão.
// O mineflayer só executa os plugins em `inject_allowed`; por isso a
// configuração espera esse evento em vez de rodar logo após loadPlugin().
function setupAutoEat(bot, log) {
  const apply = () => {
    if (!bot.autoEat) {
      log('[plugins] autoeat indisponível: bot.autoEat não foi criado')
      return
    }
    if (process.env.MBOT_AUTO_EAT === '0') {
      bot.autoEat.disableAuto()
      log('[plugins] autoeat carregado (automático desligado por MBOT_AUTO_EAT=0)')
      return
    }
    bot.autoEat.setOpts({
      minHunger: 15,
      minHealth: 14,
      returnToLastItem: true,
      strictErrors: false
    })
    bot.autoEat.on('eatFail', (err) => log(`[plugins] autoeat: ${err?.message || err}`))
    bot.autoEat.enableAuto()
  }
  if (bot.autoEat) apply()
  else bot.once('inject_allowed', apply)
}

const PLUGINS = [
  ['pvp', () => require('mineflayer-pvp').plugin],
  ['custompvp', () => require('@nxg-org/mineflayer-custom-pvp').default],
  ['tool', () => require('mineflayer-tool').plugin],
  ['collectblock', () => require('mineflayer-collectblock').plugin],
  ['hawkeye', () => require('minecrafthawkeye').default],
  ['autoeat', () => require('mineflayer-auto-eat').loader, setupAutoEat]
]

function pluginSet(value) {
  return new Set(String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean))
}

// Compatível com o isolamento da PR #93. AutoEat é opt-in até haver
// arbitragem única do inventário entre alimentação, crafting e equipamentos.
function loadPlugins(bot, {
  log = console.log,
  enabled = process.env.MBOT_PLUGINS !== '0',
  only = process.env.MBOT_PLUGINS_ONLY,
  skip = process.env.MBOT_PLUGINS_SKIP,
  autoEatEnabled = process.env.MBOT_AUTO_EAT === '1',
  plugins = PLUGINS
} = {}) {
  const loaded = []
  if (!enabled) {
    log('[plugins] desligados (MBOT_PLUGINS=0)')
    return loaded
  }
  const allowed = only == null ? null : pluginSet(only)
  const skipped = pluginSet(skip)
  const known = new Set(plugins.map(([name]) => name))
  if (allowed) {
    for (const name of allowed) {
      if (!known.has(name)) log(`[plugins] nome desconhecido em MBOT_PLUGINS_ONLY: ${name}`)
    }
  }
  for (const [name, get, afterLoad] of plugins) {
    if ((allowed && !allowed.has(name)) || skipped.has(name)) continue
    if (name === 'autoeat' && !autoEatEnabled) {
      log('[plugins] autoeat opt-in: requer MBOT_AUTO_EAT=1')
      continue
    }
    try {
      bot.loadPlugin(get())
      if (afterLoad) afterLoad(bot, log)
      loaded.push(name)
    } catch (err) {
      log(`[plugins] ${name} indisponível: ${String(err?.message || err).split('\\n')[0]}`)
    }
  }
  log(`[plugins] carregados: ${loaded.join(', ') || 'nenhum'}`)
  return loaded
}

// Visualizador 3D e inventário no navegador (chamar depois do spawn), só em
// 127.0.0.1 (ver lib/web-views.js); sem as variáveis de ambiente, nada é iniciado.
// Devolve o estado de cada um (porta, endereço real, erro) para o painel mostrar.
function startWebViews(bot, {
  viewerPort = Number(process.env.MBOT_VIEWER_PORT) || 0,
  inventoryPort = Number(process.env.MBOT_INVENTORY_PORT) || 0,
  log = console.log
} = {}) {
  const { startViewer, startInventory } = require('./web-views')
  return {
    viewer: startViewer(bot, { port: viewerPort, firstPerson: false, log }),
    inventory: startInventory(bot, { port: inventoryPort, log })
  }
}

function startStatusServer(bot, { statusPort = Number(process.env.STATUS_PORT) || 0, eventLog = null, botManager = null, storage = null, projectManager = null, log = console.log } = {}) {
  if (!statusPort) return null
  try {
    // Lazy require to avoid circular dependency
    const { StatusServer } = require('./status-server')
    const server = new StatusServer({ botManager, storage, projectManager, eventLog, port: statusPort })
    server.start()
    log(`[plugins] status server: http://localhost:${statusPort}`)
    return server
  } catch (err) {
    log(`[plugins] status server indisponível: ${err.message.split('\n')[0]}`)
    return null
  }
}

module.exports = { PLUGINS, loadPlugins, startWebViews, startStatusServer }
