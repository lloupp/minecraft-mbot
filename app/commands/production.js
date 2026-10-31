// @ts-check
// app/commands/production.js
// Estoque central, fabricação e consulta de itens/receitas.

const craft = require('../../lib/craft')
const { normalizeItemName } = require('../../core/ProductionManager')

function registerProductionCommands(commandRouter, ctx) {
  const { bot, colony, storage, memory, projectManager, knowledge, planner, persistSoon, companion } = ctx
  const { runTask, withoutFollowing, withCommitment } = companion

  commandRouter.register('estoque', async (_context, args) => {
    const action = String(args[0] || 'status').toLowerCase()

    if (action === 'aqui' || action === 'definir') {
      try {
        const block = storage.configureNearest(bot, 8)
        await withoutFollowing('ler o estoque', () => storage.summary(bot))
        persistSoon()
        bot.chat(`Estoque central definido: ${block.name} em X=${block.position.x}, Y=${block.position.y}, Z=${block.position.z}.`)
      } catch (err) {
        bot.chat(`Não consegui definir o estoque: ${err.message}`)
      }
      return
    }

    if (action === 'guardar' || action === 'recolher') {
      if (!storage.configured()) {
        bot.chat('Defina primeiro o estoque com !estoque aqui.')
        return
      }
      const names = await colony.depositAll()
      bot.chat(names.length ? `Mandando ${names.length} bot(s) ociosos descarregar no estoque.` : 'Nenhum bot ocioso para descarregar.')
      return
    }

    if (action === 'limpar') {
      storage.setPosition(null)
      colony.setAuto(false)
      if (projectManager.isActive()) projectManager.cancel()
      persistSoon()
      bot.chat('Estoque central removido. O modo automático foi desativado e o projeto ativo foi cancelado.')
      return
    }

    if (!storage.configured()) {
      bot.chat('Estoque não configurado. Fique perto de um baú/barrel e use !estoque aqui.')
      return
    }

    try {
      const counts = await withoutFollowing('ler o estoque', () => storage.summary(bot))
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
      if (!entries.length) {
        bot.chat('Estoque central está vazio.')
        return
      }
      for (let i = 0; i < Math.min(entries.length, 20); i += 5) {
        bot.chat(entries.slice(i, i + 5).map(([name, count]) => `${name}x${count}`).join(', '))
      }
    } catch (err) {
      bot.chat(`Não consegui ler o estoque: ${err.message}`)
    }
  })

  // O próprio bot fabrica (coletando madeira/pedra e usando a mesa se precisar).
  function craftSelf(itemName, count) {
    const item = bot.registry.itemsByName[itemName]
    if (!item) {
      bot.chat(`Não conheço o item "${itemName}".`)
      return
    }
    const target = craft.countItem(bot, item.id) + count
    bot.chat(`Fabricando ${count}x ${item.name}...`)
    withCommitment(`fabricar ${count}x ${item.name}`, async () => {
      let result
      await runTask('fabricar', async (isCancelled) => {
        await craft.craftItem(bot, item.name, target, isCancelled)
        if (isCancelled()) return
        result = craft.countItem(bot, item.id) >= target
        bot.chat(`Pronto! Tenho ${craft.countItem(bot, item.id)}x ${item.name}.`)
      })
      return result
    }).catch(() => {})
  }

  commandRouter.register('fabricar', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !fabricar <item> [qtd]. Ex.: !fabricar picareta_ferro 2')
      return
    }
    let count = null
    if (/^\d+$/.test(args.at(-1))) count = Math.max(1, Number.parseInt(args.pop(), 10))
    const item = normalizeItemName(args.join('_'))
    // Sem quantidade: usa a preferência lembrada (ex.: tochas.quantidade=64).
    if (count == null) count = item === 'torch' ? memory.preferenciaNumero('tochas.quantidade', 1, 1, 256) : 1
    // Sem estoque central da colônia, o próprio bot fabrica para si.
    if (!storage.configured()) {
      craftSelf(item, count)
      return
    }
    try {
      const assignment = await colony.craft(item, count)
      bot.chat(`${assignment.name} vai fabricar ${count}x ${item} e guardar no estoque.`)
    } catch (err) {
      bot.chat(`Não consegui iniciar a fabricação: ${err.message}`)
    }
  })

  commandRouter.register('item', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !item <nome>')
      return
    }
    const info = knowledge.describe(args.join('_'))
    if (!info) {
      bot.chat(`Não encontrei "${args.join(' ')}" no registro do Minecraft.`)
      return
    }
    const details = [
      info.isBlock ? 'bloco' : null,
      info.isItem ? 'item' : null,
      info.stackSize ? `pilha ${info.stackSize}` : null,
      info.foodPoints != null ? `comida +${info.foodPoints}` : null
    ].filter(Boolean).join(' | ')
    bot.chat(`${info.name}: ${details || 'registrado'}`)
  })

  commandRouter.register('receita', async (_context, args) => {
    if (!args.length) {
      bot.chat('Uso: !receita <item> [qtd]')
      return
    }
    let count = 1
    if (/^\d+$/.test(args.at(-1))) count = Math.max(1, Number.parseInt(args.pop(), 10))
    const plan = planner.craftPlan(args.join('_'), count)
    if (!plan.ok) {
      bot.chat(`Não conheço o item "${args.join(' ')}".`)
      return
    }
    if (plan.reason === 'sem_receita_conhecida') {
      bot.chat(`${plan.target}: não encontrei receita de crafting no registro atual.`)
      return
    }
    if (plan.craftable) {
      bot.chat(`Consigo fabricar ${count}x ${plan.target} com o inventário atual${plan.requiresTable ? ' (precisa bancada)' : ''}.`)
      return
    }
    bot.chat(`Para ${count}x ${plan.target} faltam: ${plan.missing.map((m) => `${m.name}x${m.needed}`).join(', ')}`)
  })
}

module.exports = { registerProductionCommands }
