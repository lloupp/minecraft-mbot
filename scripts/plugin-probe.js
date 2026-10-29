'use strict'
// Pré-voo: resolve o export de UM plugin por vez sem conectar a um servidor.
// Não comprova gameplay, mas detecta pacote ausente/export incorreto e regressão
// do carregador antes de testar no Minecraft real.
const { PLUGINS, loadPlugins } = require('../lib/plugins')
const { EventEmitter } = require('node:events')
let failed = false
for (const [name] of PLUGINS) {
  const errors = []
  const bot = new EventEmitter()
  bot.loadPlugin = fn => {
    if (typeof fn !== 'function') throw new TypeError('export não é uma função')
  }
  const loaded = loadPlugins(bot, {
    only: name,
    skip: '',
    enabled: true,
    log: msg => { if (msg.includes('indisponível')) errors.push(msg) }
  })
  const ok = loaded.length === 1 && loaded[0] === name && !errors.length
  console.log(`[probe] ${name}: ${ok ? 'PASS' : 'FAIL'}${errors.length ? ` (${errors.join('; ')})` : ''}`)
  if (!ok) failed = true
}
process.exitCode = failed ? 1 : 0
