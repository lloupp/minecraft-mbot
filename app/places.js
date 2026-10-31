// app/places.js
// Lugares conhecidos (waypoints + memória) e resolução de referências ditas
// no chat ("casa", "ferro"), perguntando ao dono quando há ambiguidade.

const { normalizeWaypointName } = require('../core/WaypointManager')
const { dito, normalizarChave, fmtPos } = require('../core/Memory')
const { resolveReference, blockVariants } = require('../core/References')

function createPlaces({ bot, memory, waypointManager, clarifier }) {
  function currentDimension() {
    const value = bot.game?.dimension
    if (value == null) return null
    if (typeof value === 'string') return value
    if (typeof value?.name === 'string') return value.name
    return String(value)
  }

  // A memória referencia um waypoint, mas suas coordenadas vivem somente no WaypointManager.
  function memoryPlace(name) {
    const metadata = memory.lugar(name)
    const entry = waypointManager.get(metadata?.waypoint || name)
    return entry ? { ...entry, origem: metadata?.origem, contexto: metadata?.contexto } : null
  }

  function waypointOrBase(name) {
    if (String(name || '').toLowerCase() === 'base') {
      const base = waypointManager.get('base')
      if (base) return base
      // Sem base da colônia, a "casa" lembrada serve de destino padrão.
      return memoryPlace('base') || memoryPlace('casa')
    }
    return waypointManager.get(name) || memoryPlace(name)
  }

  // Todos os lugares conhecidos (memória, base e locais salvos), sem repetir nomes.
  function placeEntries() {
    const byKey = new Map()
    const add = (entry) => {
      const key = normalizeWaypointName(entry?.name)
      if (key && !byKey.has(key)) byKey.set(key, entry)
    }
    for (const entry of waypointManager.list()) {
      const metadata = memory.lugar(entry.name)
      add({ ...entry, origem: metadata?.origem, contexto: metadata?.contexto })
    }
    return [...byKey.values()]
  }

  const placeLabel = (entry) => `${entry.name} ${fmtPos(entry.position)}`

  // Depois de uma escolha, oferece torná-la padrão (sem travar a tarefa).
  function offerDefault(key, value, username) {
    clarifier.confirm('Usar sempre essa? sim/não', { who: username, timeoutMs: 20000, quiet: true })
      .then((yes) => {
        if (!yes) return
        memory.definirPreferencia(key, value, dito(username))
        bot.chat('Ok, vou lembrar.')
      })
      .catch(() => {})
  }

  // Resolve "casa", "mina"... Se houver mais de um lugar parecido, PERGUNTA ao dono.
  // Retorna a entrada ou null (desconhecido, cancelado ou sem resposta).
  async function resolvePlace(query, username) {
    const prefKey = `ref.lugar.${normalizeWaypointName(query)}`
    const result = resolveReference(query, placeEntries(), { preferido: memory.preferencia(prefKey) })
    if (result.match) return result.match
    if (!result.candidates.length) {
      bot.chat(`Não conheço "${query}". Use !lembrar ${query} aqui ou !memoria lugares.`)
      return null
    }
    const question = result.reason === 'parecido' ? `Não achei "${query}". Quis dizer:` : `Qual ${query}?`
    const choice = await clarifier.ask(question, result.candidates.map(placeLabel), { who: username })
    if (!choice) return null
    const entry = result.candidates[choice.index]
    if (result.reason === 'ambiguo') offerDefault(prefKey, entry.name, username)
    return entry
  }

  // "ferro" pode ser iron_ore ou deepslate_iron_ore: pergunta, a menos que já haja preferência.
  async function resolveBlocks(word, username) {
    const variants = blockVariants(word, bot.registry.blocksByName)
    if (!variants.length) {
      bot.chat(`Não conheço o bloco "${word}". Use o nome em inglês, ex.: stone, oak_log, iron_ore.`)
      return null
    }
    if (variants.length === 1) return variants
    const prefKey = `minerar.${normalizarChave(word)}`
    const saved = memory.preferencia(prefKey)
    if (saved === 'qualquer') return variants
    if (variants.includes(saved)) return [saved]

    const choice = await clarifier.ask(`Qual ${word}?`, [...variants, 'qualquer um'], { who: username })
    if (!choice) return null
    const any = choice.index === variants.length
    offerDefault(prefKey, any ? 'qualquer' : variants[choice.index], username)
    return any ? variants : [variants[choice.index]]
  }

  function assertWaypointReachable(entry) {
    if (!entry) throw new Error('local não encontrado')
    if (!waypointManager.sameDimension(entry, currentDimension())) {
      throw new Error(`o local ${entry.name} está em outra dimensão (${entry.dimension})`)
    }
  }

  return { currentDimension, memoryPlace, waypointOrBase, placeEntries, placeLabel, resolvePlace, resolveBlocks, assertWaypointReachable }
}

module.exports = { createPlaces }
