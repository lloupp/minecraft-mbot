// lib/plugins.js
// Plugins prontos do mineflayer. Cada um é opcional: se não carregar (ex.: numa
// versão sem suporte), o bot continua com a implementação própria em lib/.
//
// - mineflayer-pvp: combate corpo a corpo (persegue, bate no tempo certo)
// - mineflayer-tool + mineflayer-collectblock: coletar blocos com a ferramenta
//   certa, recolhendo os itens
// - mineflayer-armor-manager: veste armadura assim que pega
// - minecrafthawkeye: mira com arco
// - prismarine-viewer / mineflayer-web-inventory: ver o bot e o inventário no
//   navegador (só com MBOT_VIEWER_PORT / MBOT_INVENTORY_PORT)

const PLUGINS = [
  ['pvp', () => require('mineflayer-pvp').plugin],
  ['tool', () => require('mineflayer-tool').plugin],
  ['collectblock', () => require('mineflayer-collectblock').plugin],
  ['armor', () => require('mineflayer-armor-manager')],
  ['hawkeye', () => require('minecrafthawkeye').default]
]

function loadPlugins(bot, { log = console.log } = {}) {
  const loaded = []
  for (const [name, get] of PLUGINS) {
    try {
      bot.loadPlugin(get())
      loaded.push(name)
    } catch (err) {
      log(`[plugins] ${name} indisponível: ${err.message.split('\n')[0]}`)
    }
  }
  log(`[plugins] carregados: ${loaded.join(', ') || 'nenhum'}`)
  return loaded
}

// Visualização no navegador (chamar depois do spawn). As portas ficam abertas
// na rede local; sem as variáveis de ambiente, nada é iniciado.
function startWebViews(bot, {
  viewerPort = Number(process.env.MBOT_VIEWER_PORT) || 0,
  inventoryPort = Number(process.env.MBOT_INVENTORY_PORT) || 0,
  log = console.log
} = {}) {
  if (viewerPort) {
    try {
      const { supportedVersions } = require('prismarine-viewer/viewer/lib/version')
      if (!supportedVersions.includes(bot.version)) {
        log(`[plugins] visualizador 3D não suporta ${bot.version} (suporta até ${supportedVersions.at(-1)})`)
      } else {
        require('prismarine-viewer/lib/mineflayer')(bot, { port: viewerPort, firstPerson: false })
        log(`[plugins] visualizador 3D: http://localhost:${viewerPort}`)
      }
    } catch (err) {
      log(`[plugins] visualizador 3D indisponível: ${err.message.split('\n')[0]}`)
    }
  }
  if (inventoryPort) {
    try {
      require('mineflayer-web-inventory')(bot, { port: inventoryPort })
      log(`[plugins] inventário no navegador: http://localhost:${inventoryPort}`)
    } catch (err) {
      log(`[plugins] inventário web indisponível: ${err.message.split('\n')[0]}`)
    }
  }
}

module.exports = { loadPlugins, startWebViews }
