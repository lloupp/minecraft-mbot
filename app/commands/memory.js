// app/commands/memory.js
// Memória do dono: lugares, preferências, anotações e "onde fica".

const { TIPOS, dito, tipoDe, normalizarChave, parseValor, fmtPos, fmtOrigem } = require('../../core/Memory')
const { normalizeItemName } = require('../../core/ProductionManager')
const { resolveReference, searchTerms } = require('../../core/References')

function registerMemoryCommands(commandRouter, ctx) {
  const { bot, memory, waypointManager, persistSoon, companion, places } = ctx
  const { follow } = companion
  const { currentDimension, placeEntries, placeLabel } = places

  // Distância (em blocos) do bot até uma posição, para as respostas do !onde.
  function distanceText(position) {
    if (!bot.entity || !position) return ''
    const dx = position.x - bot.entity.position.x
    const dz = position.z - bot.entity.position.z
    return ` | a ${Math.round(Math.hypot(dx, dz))} blocos`
  }

  commandRouter.register('lembrar', async (context, args) => {
    const text = args.join(' ').trim()
    if (!text) {
      bot.chat('Uso: !lembrar <nome> aqui | !lembrar <chave> = <valor> | !lembrar <anotação>')
      return
    }

    // Preferência: "!lembrar tochas.quantidade = 64"
    const eq = text.indexOf('=')
    if (eq > 0) {
      const key = normalizarChave(text.slice(0, eq))
      let value = parseValor(text.slice(eq + 1))
      if (!key || value === '') {
        bot.chat('Uso: !lembrar <chave> = <valor>  ex.: !lembrar seguir.distancia = 3')
        return
      }
      if (key === 'comida.preferida') value = normalizeItemName(value)
      memory.definirPreferencia(key, value, dito(context.username))
      bot.chat(`Anotado: ${key}=${value}.`)
      if (key === 'seguir.distancia' && companion.mode === 'seguir' && !companion.autonomous) follow()
      return
    }

    // Lugar: "!lembrar casa" (ou a forma antiga "!lembrar casa aqui").
    if (args.length >= 1 && (args.length === 1 || args.at(-1).toLowerCase() === 'aqui')) {
      const name = args.at(-1).toLowerCase() === 'aqui' ? args.slice(0, -1).join(' ') : args.join(' ')
      const source = bot.players[context.username]?.entity?.position || bot.entity?.position
      if (!source) {
        bot.chat('Não consigo determinar sua posição agora.')
        return
      }
      try {
        const entry = waypointManager.save(name, source, currentDimension())
        const item = memory.lembrarLugar(entry.name, dito(context.username), 'local lembrado pelo jogador')
        persistSoon()
        bot.chat(`Vou lembrar: ${entry.name} ${fmtPos(entry.position)} ${fmtOrigem(item.origem)}.`)
      } catch (err) {
        bot.chat(`Não consegui lembrar: ${err.message}`)
      }
      return
    }

    // Qualquer outra coisa vira uma anotação dita pelo jogador.
    memory.registrarFato(text, { assunto: 'nota' }, dito(context.username))
    bot.chat('Anotado.')
  })

  commandRouter.register('esquecer', async (_context, args) => {
    const name = args.join(' ').trim()
    if (!name) {
      bot.chat('Uso: !esquecer <nome>')
      return
    }
    let removed = memory.esquecer(name)
    if (waypointManager.remove(name)) {
      removed++
      persistSoon()
    }
    bot.chat(removed ? `Esqueci ${name}.` : `Não lembro de nada chamado ${name}.`)
  })

  commandRouter.register(['memoria', 'memória'], async (_context, args) => {
    const raw = args[0]
    const type = raw ? tipoDe(raw) : null
    if (raw && !type) {
      bot.chat('Uso: !memoria [lugares|preferencias|compromissos|fatos]')
      return
    }
    const counts = TIPOS.map((t) => `${memory.listar(t).length} ${t}`).join(', ')
    const items = memory.listar(type).slice(0, 6)
    bot.chat(`Memória: ${counts}.`)
    if (!items.length) {
      bot.chat(type ? `Nada do tipo ${type}.` : 'Ainda não lembro de nada. Use !lembrar <nome> aqui.')
      return
    }
    for (let i = 0; i < items.length; i += 2) {
      bot.chat(items.slice(i, i + 2).map((item) => memory.formatar(item)).join(' | ').slice(0, 250))
    }
  })

  commandRouter.register('onde', async (_context, args) => {
    const query = args.join(' ').trim()
    if (!query) {
      bot.chat('Uso: !onde <coisa>  ex.: !onde casa, !onde diamante, !onde morri')
      return
    }
    const place = resolveReference(query, placeEntries())
    const entry = place.match || (place.reason === 'ambiguo' ? place.candidates[0] : null)
    const facts = memory.buscarFatos(searchTerms(query))
    if (!entry && !facts.length) {
      bot.chat(`Não sei onde fica ${query}. Use !lembrar ${query} aqui.`)
      return
    }
    if (entry) {
      const tag = entry.origem ? ` ${fmtOrigem(entry.origem)}` : ''
      const others = place.reason === 'ambiguo' ? ` (também: ${place.candidates.slice(1, 3).map((e) => e.name).join(', ')})` : ''
      bot.chat(`${placeLabel(entry)}${tag}${distanceText(entry.position)}${others}`.slice(0, 250))
    }
    if (facts.length) {
      const [fact] = facts
      const more = facts.length > 1 ? ` (+${facts.length - 1})` : ''
      bot.chat(`${memory.formatar(fact)}${distanceText(fact.posicao)}${more}`.slice(0, 250))
    }
  })
}

module.exports = { registerMemoryCommands }
