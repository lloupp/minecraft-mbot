// core/References.js
// Resolve referências do jogador ("casa", "ferro") para algo concreto. Quando
// há mais de uma leitura possível, devolve as opções para o bot PERGUNTAR em
// vez de chutar (referência errada é uma das causas mais comuns de falha).

const { normalizeWaypointName } = require('./WaypointManager')

const MAX_OPCOES = 5

function distancia(a, b) {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

const tokens = (chave) => chave.split('-').filter(Boolean)

// entries: [{ name, ... }]. preferido: nome que o jogador escolheu antes como padrão.
// Retorna { match, candidates, reason }:
//   match      -> entrada escolhida sem dúvida (ou null)
//   candidates -> opções para perguntar (quando match é null)
//   reason     -> exato | preferido | unico | ambiguo | parecido | nenhum
function resolveReference(query, entries, { preferido = null } = {}) {
  const q = normalizeWaypointName(query)
  const list = (entries || []).filter((e) => e && normalizeWaypointName(e.name))
  if (!q) return { match: null, candidates: [], reason: 'nenhum' }

  if (preferido) {
    const pref = list.find((e) => normalizeWaypointName(e.name) === normalizeWaypointName(preferido))
    if (pref) return { match: pref, candidates: [], reason: 'preferido' }
  }

  const qTokens = tokens(q)
  const exatos = []
  const parciais = []
  for (const entry of list) {
    const key = normalizeWaypointName(entry.name)
    if (key === q) exatos.push(entry)
    else if (key.includes(q) || qTokens.every((t) => tokens(key).includes(t))) parciais.push(entry)
  }

  if (exatos.length === 1 && !parciais.length) return { match: exatos[0], candidates: [], reason: 'exato' }
  const todos = [...exatos, ...parciais.sort((a, b) => a.name.length - b.name.length)]
  if (todos.length === 1) return { match: todos[0], candidates: [], reason: 'unico' }
  if (todos.length > 1) return { match: null, candidates: todos.slice(0, MAX_OPCOES), reason: 'ambiguo' }

  // Nada parecido pelo nome: tenta erros de digitação ("csa" -> "casa").
  const limite = q.length <= 4 ? 1 : 2
  const parecidos = list
    .map((entry) => ({ entry, d: distancia(q, normalizeWaypointName(entry.name)) }))
    .filter(({ d }) => d <= limite)
    .sort((a, b) => a.d - b.d)
    .map(({ entry }) => entry)
  if (parecidos.length) return { match: null, candidates: parecidos.slice(0, MAX_OPCOES), reason: 'parecido' }
  return { match: null, candidates: [], reason: 'nenhum' }
}

// Palavras em português que valem para mais de um bloco.
const BLOCK_ALIASES = {
  ferro: ['iron_ore', 'deepslate_iron_ore'],
  ouro: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  diamante: ['diamond_ore', 'deepslate_diamond_ore'],
  esmeralda: ['emerald_ore', 'deepslate_emerald_ore'],
  carvao: ['coal_ore', 'deepslate_coal_ore'],
  cobre: ['copper_ore', 'deepslate_copper_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  madeira: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
  tronco: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
  pedra: ['stone'],
  terra: ['dirt'],
  areia: ['sand'],
  cascalho: ['gravel'],
  argila: ['clay']
}

function aliasKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Blocos que uma palavra pode significar. Nome exato do registro não é ambíguo.
function blockVariants(query, blocksByName = null) {
  const raw = String(query || '').toLowerCase().trim()
  if (blocksByName?.[raw]) return [raw]
  const variants = BLOCK_ALIASES[aliasKey(raw)] || []
  return blocksByName ? variants.filter((name) => blocksByName[name]) : variants
}

// Termos de busca para !onde (ex.: "diamante" -> "diamond").
const ONDE_ALIASES = {
  diamante: ['diamond'],
  ferro: ['iron'],
  ouro: ['gold'],
  esmeralda: ['emerald'],
  carvao: ['coal'],
  cobre: ['copper'],
  morte: ['morri', 'morte'],
  morri: ['morri', 'morte']
}

function searchTerms(query) {
  const key = aliasKey(query)
  return [key, ...(ONDE_ALIASES[key] || [])]
}

module.exports = { resolveReference, distancia, blockVariants, searchTerms, BLOCK_ALIASES, MAX_OPCOES }
