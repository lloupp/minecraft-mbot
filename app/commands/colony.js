// @ts-check
// app/commands/colony.js
// Comandos da colônia: resumo, modo automático, ordens, workers e smoke test.

const { normalizeItemName } = require('../../core/ProductionManager')

function registerColonyCommands(commandRouter, ctx) {
  const { bot, botManager, colony, storage, homeProvider, maxColonyBots, smokeTest, persistSoon, companion } = ctx
  const { withoutFollowing } = companion

  function colonySummary() {
    const workers = botManager.list()
    const roles = {}
    for (const worker of workers) roles[worker.role] = (roles[worker.role] || 0) + 1
    const roleText = Object.entries(roles).map(([role, n]) => `${role}x${n}`).join(', ') || 'sem workers'
    const home = homeProvider()
    const baseText = home
      ? `${Math.floor(home.x)},${Math.floor(home.y)},${Math.floor(home.z)}`
      : 'NÃO'
    const lines = [`Colônia: ${workers.length + 1}/${maxColonyBots} | auto: ${colony.auto ? 'ON' : 'OFF'} | base: ${baseText} | estoque: ${storage.configured() ? 'OK' : 'NÃO'} | ${roleText}`]
    for (let i = 0; i < workers.length; i += 4) {
      lines.push(workers.slice(i, i + 4).map((w) => {
        const detail = w.resource || w.item || ''
        const task = w.task ? `:${w.task}${detail ? '/' + detail : ''}` : ''
        return `${w.name}(${w.status}${task})`
      }).join(', '))
    }
    return lines
  }

  commandRouter.register('bots', async () => {
    for (const line of colonySummary()) bot.chat(line)
  })

  commandRouter.register('colonia', async (_context, args) => {
    const action = String(args[0] || '').toLowerCase()
    if (action === 'auto') {
      const value = String(args[1] || 'on').toLowerCase()
      const enabled = !['off', '0', 'nao', 'não', 'false'].includes(value)

      if (!enabled) {
        colony.setAuto(false)
        persistSoon()
        bot.chat('Modo automático da colônia: DESATIVADO.')
        return
      }

      const readiness = colony.autoReadiness()
      if (!readiness.ready) {
        bot.chat(`Não posso ativar o automático. Falta definir: ${readiness.missing.join(', ')}.`)
        return
      }

      colony.setAuto(true)
      persistSoon()
      bot.chat('Modo automático por demanda: ATIVADO.')
      return
    }

    if (action === 'necessidades' || action === 'demanda') {
      if (!storage.configured()) {
        bot.chat('Defina primeiro o estoque com !estoque aqui.')
        return
      }
      try {
        if (!storage.snapshotFresh(5000)) await withoutFollowing('ler o estoque', () => storage.summary(bot))
        const report = colony.demandReport()
        const d = report?.deficits || {}
        bot.chat(`Faltas: comida ${d.food || 0}, madeira ${d.wood || 0}, combustível ${d.fuel || 0}, ferro ${d.ironTotal || 0}, construção ${d.building || 0}.`)
        bot.chat(`Reserva: lingotes ${d.ironIngot || 0}, picaretas ${d.ironPickaxe || 0}, machados ${d.ironAxe || 0}, espadas ${d.ironSword || 0}.`)
      } catch (err) {
        bot.chat(`Não consegui analisar a demanda: ${err.message}`)
      }
      return
    }

    for (const line of colonySummary()) bot.chat(line)
  })

  commandRouter.register('ordem', async (_context, args) => {
    if (args.length < 2) {
      bot.chat('Uso: !ordem <papel> <recurso> [qtd]. Ex.: !ordem mineradores ferro 64')
      return
    }
    const role = args[0]
    const resource = args[1]
    const count = Math.max(1, Number.parseInt(args[2], 10) || 1)
    try {
      const assignments = await colony.assign(role, resource, count)
      bot.chat(`Ordem enviada a ${assignments.length} bot(s): ${resource} x${count}.`)
    } catch (err) {
      bot.chat(`Não consegui distribuir a ordem: ${err.message}`)
    }
  })

  commandRouter.register('todos', async (_context, args) => {
    if (String(args[0] || '').toLowerCase() !== 'voltar') {
      bot.chat('Uso: !todos voltar')
      return
    }
    const names = await colony.returnAll()
    bot.chat(names.length ? `Chamando ${names.length} bot(s) de volta para a base.` : 'Não há bots auxiliares.')
  })

  commandRouter.register('smoke', async () => {
    bot.chat('Executando smoke test da colônia...')
    const result = await withoutFollowing('smoke test', () => smokeTest.run())
    const status = result.ok ? 'PASSOU' : 'FALHOU'
    bot.chat(`Smoke: ${status} | ${result.passed} ok | ${result.failed} falha(s).`)
    for (const check of result.checks) {
      if (check.ok === false) bot.chat(`FALHA ${check.name}: ${check.detail}`)
    }
  })

  commandRouter.register('tarefas', async () => {
    const tasks = colony.taskSummary()
    if (!tasks.length) {
      bot.chat('Nenhum bot auxiliar na colônia.')
      return
    }
    for (let i = 0; i < tasks.length; i += 4) {
      bot.chat(tasks.slice(i, i + 4).map((entry) =>
        `${entry.name}:${entry.state}${entry.task ? '/' + entry.task : ''}${entry.resource || entry.item ? '/' + (entry.resource || entry.item) : ''}`
      ).join(', '))
    }
  })

  commandRouter.register('abastecer', async (_context, args) => {
    if (args.length < 2) {
      bot.chat('Uso: !abastecer <bot> <item> [qtd]')
      return
    }
    const name = String(args[0]).toLowerCase()
    const item = normalizeItemName(args[1])
    const count = Math.max(1, Number.parseInt(args[2], 10) || 1)
    try {
      await colony.supply(name, item, count)
      bot.chat(`${name} vai retirar ${count}x ${item} do estoque.`)
    } catch (err) {
      bot.chat(`Não consegui abastecer: ${err.message}`)
    }
  })

  commandRouter.register('bot', async (_context, args) => {
    const action = String(args[0] || '').toLowerCase()
    if (action === 'criar') {
      let role = String(args[1] || 'ajudante').toLowerCase()
      let count = Number.parseInt(args[2], 10) || 1
      if (/^\d+$/.test(role)) {
        count = Number.parseInt(role, 10)
        role = 'ajudante'
      }
      try {
        const created = await botManager.create(role, count)
        persistSoon()
        bot.chat(`Criados ${created.length}: ${created.map((w) => w.name).join(', ')}`)
      } catch (err) {
        bot.chat(`Não consegui criar bot: ${err.message}`)
      }
      return
    }

    if (action === 'remover' || action === 'parar') {
      const name = String(args[1] || '').toLowerCase()
      if (!name) {
        bot.chat('Uso: !bot remover <nome>')
        return
      }
      const removed = botManager.remove(name)
      if (removed) persistSoon()
      bot.chat(removed ? `${name} removido da colônia.` : `Não encontrei ${name}.`)
      return
    }

    bot.chat('Uso: !bot criar [papel] [qtd] | !bot remover <nome> | !bots')
  })
}

module.exports = { registerColonyCommands }
