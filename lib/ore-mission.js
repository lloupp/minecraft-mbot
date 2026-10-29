// lib/ore-mission.js
// Missão: juntar `target` de CADA minério. Conta pelo ITEM no inventário (o
// minério bruto/drop), não por blocos cavados, e retoma de onde parou porque o
// progresso é derivado da mochila.

const ORE_FAMILIES = [
  { key: 'carvao', label: 'carvão', item: 'coal', blocks: ['coal_ore', 'deepslate_coal_ore'], tool: 'stone' },
  { key: 'ferro', label: 'ferro', item: 'raw_iron', also: ['iron_ingot'], blocks: ['iron_ore', 'deepslate_iron_ore'], tool: 'stone' },
  { key: 'cobre', label: 'cobre', item: 'raw_copper', also: ['copper_ingot'], blocks: ['copper_ore', 'deepslate_copper_ore'], tool: 'stone' },
  { key: 'lapis', label: 'lápis', item: 'lapis_lazuli', blocks: ['lapis_ore', 'deepslate_lapis_ore'], tool: 'stone' },
  { key: 'ouro', label: 'ouro', item: 'raw_gold', also: ['gold_ingot'], blocks: ['gold_ore', 'deepslate_gold_ore'], tool: 'iron' },
  { key: 'redstone', label: 'redstone', item: 'redstone', blocks: ['redstone_ore', 'deepslate_redstone_ore'], tool: 'iron' },
  { key: 'diamante', label: 'diamante', item: 'diamond', blocks: ['diamond_ore', 'deepslate_diamond_ore'], tool: 'iron' },
  { key: 'esmeralda', label: 'esmeralda', item: 'emerald', blocks: ['emerald_ore', 'deepslate_emerald_ore'], tool: 'iron' }
]

// Itens que contam para a família: o minério bruto e a versão fundida (o ferro
// usado para fazer a picareta continua contando como ferro juntado).
function itemsFor(item) {
  const family = ORE_FAMILIES.find((f) => f.item === item)
  return family ? [family.item, ...(family.also || [])] : [item]
}

const countItem = (bot, name) => bot.inventory.items()
  .filter((item) => item.name === name)
  .reduce((sum, item) => sum + item.count, 0)

function progressOf(bot, target) {
  const out = {}
  for (const family of ORE_FAMILIES) out[family.key] = Math.min(countItem(bot, family.item), target)
  return out
}

function complete(progress, target) {
  return ORE_FAMILIES.every((family) => (progress[family.key] || 0) >= target)
}

// Percorre as famílias; `mine(family, need, isCancelled)` faz o trabalho pesado.
async function mineMission(bot, {
  target = 64, isCancelled = () => false, mine, ensureTool = null, onProgress = () => {}
} = {}) {
  if (typeof mine !== 'function') throw new Error('mineMission precisa da função mine')
  const report = []
  for (const family of ORE_FAMILIES) {
    if (isCancelled()) return { ok: false, cancelled: true, progress: progressOf(bot, target), report }
    const have = countItem(bot, family.item)
    report.push({ key: family.key, item: family.item, have, target })
    if (have >= target) {
      onProgress(family, have)
      continue
    }
    if (ensureTool) {
      await ensureTool(family).catch(() => {})
      if (isCancelled()) return { ok: false, cancelled: true, progress: progressOf(bot, target), report }
    }
    await mine(family, target - have, isCancelled)
    const after = countItem(bot, family.item)
    report[report.length - 1].have = after
    onProgress(family, after)
  }
  const progress = progressOf(bot, target)
  return { ok: complete(progress, target), cancelled: false, progress, report }
}

const MAX_ATTEMPTS = 3
const MAX_SOFT_TRIES = 12

// Missão em equipe: cada membro livre pega uma família pendente; o progresso é a
// soma de `teamCount(item)` (mochilas da equipe + baú).
// - Falha sem render nada conta tentativa; depois de `maxAttempts` a família sai da fila.
// - Resultado `retry: true` (fugiu de mob, vida baixa, sem picareta ainda) não conta
//   tentativa: o membro descansa `cooldownMs` e tenta de novo (até MAX_SOFT_TRIES).
// - `canMine(member, family)` filtra quem pode pegar a família (ex.: ouro exige ferro).
//
// members: [{ name, mine(family, need, isCancelled) -> Promise }]
async function teamMission({
  target = 64, families = ORE_FAMILIES, members = () => [], teamCount, isCancelled = () => false,
  onProgress = () => {}, log = () => {}, maxAttempts = MAX_ATTEMPTS, maxSoftTries = MAX_SOFT_TRIES,
  canMine = () => true, cooldownMs = 20000, idleWaitMs = 5000, maxIdleWaits = 60,
  sleep = defaultSleep, now = Date.now, allowHelping = true
} = {}) {
  if (typeof teamCount !== 'function') throw new Error('teamMission precisa de teamCount')
  const list = typeof members === 'function' ? members : () => members
  const attempts = new Map()
  const softTries = new Map()
  const failures = new Map()
  const cooldown = new Map() // nome -> instante em que pode voltar
  const memberRests = new Map() // nome -> descansos seguidos
  const running = new Map() // nome do membro -> { family, promise }
  let idleWaits = 0
  const done = () => families.every((f) => teamCount(f.item) >= target)
  const pending = () => families.filter((f) => teamCount(f.item) < target && (attempts.get(f.key) || 0) < maxAttempts)
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1)

  // Família batida pela equipe: quem ainda está nela para (visto no jogo: 4 bots atrás de
  // 3 de ferro, e a missão esperando o último voltar do fundo para fechar).
  const stopFinished = () => {
    for (const [name, r] of running) {
      if (!r.stopped && teamCount(r.family.item) >= target && typeof r.member.stop === 'function') {
        r.stopped = true
        log(`${name}: ${r.family.label} já bateu a meta; parando`)
        try { r.member.stop() } catch {}
      }
    }
  }

  while (!isCancelled() && !done()) {
    stopFinished()
    const busy = new Set([...running.values()].map((r) => r.family.key))
    const queue = pending().filter((f) => !busy.has(f.key))
      .sort((a, b) => (attempts.get(a.key) || 0) - (attempts.get(b.key) || 0))
    const available = list()
    for (const member of available) {
      if (running.has(member.name) || (cooldown.get(member.name) || 0) > now()) continue
      let family = null
      const index = queue.findIndex((f) => canMine(member, f))
      if (index >= 0) [family] = queue.splice(index, 1)
      else if (allowHelping) {
        // Nada livre para ele: ajuda numa família que outro já está minerando.
        family = pending().find((f) => canMine(member, f) && [...running.values()].some((r) => r.family.key === f.key)) || null
      }
      if (!family) continue
      const before = teamCount(family.item)
      const need = target - before
      log(`${member.name} -> ${family.label} (faltam ${need})`)
      const promise = Promise.resolve()
        .then(() => member.mine(family, need, isCancelled))
        .catch((err) => ({ ok: false, reason: err.message }))
        .then((result) => {
          running.delete(member.name)
          const after = teamCount(family.item)
          const reason = result?.reason || result?.code || 'sem progresso'
          let note = ''
          if (after <= before) {
            if (result?.memberIssue) {
              // Problema do membro (vida baixa), não da família: descanso crescente, até 5 min.
              const rests = (memberRests.get(member.name) || 0) + 1
              memberRests.set(member.name, rests)
              cooldown.set(member.name, now() + Math.min(cooldownMs * 2 ** (rests - 1), 300000))
              note = ` (${reason}; descansando)`
            } else if (result?.retry && (softTries.get(family.key) || 0) < maxSoftTries) {
              bump(softTries, family.key)
              cooldown.set(member.name, now() + cooldownMs)
              note = ` (interrompido: ${reason}; tento de novo)`
            } else {
              bump(attempts, family.key)
              failures.set(family.key, reason)
              note = ` (sem progresso: ${reason})`
            }
          }
          if (after > before) memberRests.delete(member.name)
          log(`${member.name} terminou ${family.label}: ${after}/${target}${note}`)
          onProgress(family, after)
        })
      running.set(member.name, { family, promise, member })
    }
    if (running.size) {
      idleWaits = 0
      await Promise.race([...running.values()].map((r) => r.promise))
    } else if (!pending().length) break
    else if (!available.length && ++idleWaits > maxIdleWaits) {
      log('ninguém disponível para minerar; parei')
      break
    } else if (available.length && ![...cooldown.values()].some((t) => t > now())) {
      // Há membros livres, mas nenhum pode pegar o que falta (ex.: falta picareta de ferro).
      log(`ninguém pode minerar ${pending().map((f) => f.label).join(', ')} agora; parei`)
      for (const f of pending()) if (!failures.has(f.key)) failures.set(f.key, 'ninguém com a ferramenta certa')
      break
    } else await sleep(idleWaitMs) // ajudante conectando ou descansando
  }
  stopFinished()
  if (running.size) await Promise.allSettled([...running.values()].map((r) => r.promise))
  const progress = Object.fromEntries(families.map((f) => [f.key, Math.min(teamCount(f.item), target)]))
  return {
    ok: families.every((f) => progress[f.key] >= target),
    cancelled: isCancelled(),
    progress,
    gaveUp: families.filter((f) => progress[f.key] < target && failures.has(f.key))
      .map((f) => ({ key: f.key, reason: failures.get(f.key) }))
  }
}

function defaultSleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

module.exports = { itemsFor, ORE_FAMILIES, mineMission, teamMission, progressOf, complete, countItem, MAX_ATTEMPTS, MAX_SOFT_TRIES }
