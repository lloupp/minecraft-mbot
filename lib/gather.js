// lib/gather.js
// Coletar blocos do mundo: escolhe blocos alcançáveis (de preferência expostos),
// pula os que não consegue alcançar e recolhe os itens que caem.

const { goals } = require('mineflayer-pathfinder')
const { goTo, collectDrops } = require('./food')

const RANGE = 48
const MAX_FAILURES = 6
// Blocos que não deu para alcançar ficam de fora por um tempo também nas
// próximas tarefas: no 1.20.1 o lenhador tentou as mesmas 6 toras
// inalcançáveis em 19 tarefas seguidas e coletou 0.
const UNREACHABLE_MS = 10 * 60 * 1000
const unreachable = new WeakMap() // bot -> Map(posição -> até quando)
const AIR = new Set(['air', 'cave_air', 'void_air'])
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
// Caem quando o bloco de baixo some: cavar embaixo deles pode soterrar o bot.
const FALLING = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel'])

function hasFallingAbove(bot, pos) {
  return FALLING.has(bot.blockAt(pos.offset(0, 1, 0))?.name)
}

// Bloco encostado em ar: dá para chegar sem cavar túnel.
function isExposed(bot, pos) {
  return SIDES.some(([x, y, z]) => AIR.has(bot.blockAt(pos.offset(x, y, z))?.name))
}

function blockIds(bot, predicate) {
  return bot.registry.blocksArray.filter((b) => predicate(b.name)).map((b) => b.id)
}

// Sem filtro mantém a API antiga; coleta confirma apenas os drops esperados.
function inventoryCount(bot, names = null) {
  return bot.inventory.items().filter((item) => !names || names.has(item.name)).reduce((sum, item) => sum + (item.count || 0), 0)
}

// mineflayer-collectblock: anda até o bloco, escolhe a ferramenta, cava e
// recolhe os itens. Com limite de tempo (caminhos impossíveis podem travar).
async function collectWithPlugin(bot, block, ms = 45000) {
  let timer
  try {
    await Promise.race([
      bot.collectBlock.collect(block),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          bot.collectBlock.cancelTask().catch(() => {})
          reject(new Error('coleta demorou demais'))
        }, ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const COLLECTION_FAILURE = Object.freeze({
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND', RESOURCE_UNREACHABLE: 'RESOURCE_UNREACHABLE',
  PATH_FAILED: 'PATH_FAILED', DIG_FAILED: 'DIG_FAILED', ITEM_NOT_CONFIRMED: 'ITEM_NOT_CONFIRMED',
  INVENTORY_FULL: 'INVENTORY_FULL', TARGET_BLOCKED: 'TARGET_BLOCKED', CANCELLED: 'CANCELLED'
})

function expectedDrops(bot, block, tool = bot.heldItem) {
  const data = bot.registry.blocksByName?.[block.name] || bot.registry.blocksArray.find((b) => b.name === block.name)
  const silk = tool?.enchants?.some((e) => e.name === 'silk_touch')
  if (silk && bot.registry.itemsByName?.[block.name]) return new Set([block.name])
  // Dados reais mapeiam stone -> cobblestone, iron_ore -> raw_iron etc.
  return new Set(data?.drops ? data.drops.map((id) => bot.registry.items?.[id]?.name).filter(Boolean) : [block.name])
}

function canAcceptDrop(bot, names) {
  const { slots, inventoryStart, inventoryEnd } = bot.inventory
  if (!slots || !Number.isInteger(inventoryStart) || !Number.isInteger(inventoryEnd)) return true
  return slots.slice(inventoryStart, inventoryEnd).some((item) => !item ||
    (names.has(item.name) && item.count < (item.stackSize || bot.registry.itemsByName?.[item.name]?.stackSize || 64)))
}

// Mantém o retorno numérico dos callers existentes; onAttempt recebe evidência
// transitória, nunca checkpoint ou objetos Mineflayer.
async function mineBlocks(bot, predicate, count, isCancelled, { onAttempt = () => {}, allowedPositions = null, preferInReach = false, requireInReach = false } = {}) {
  const ids = blockIds(bot, predicate)
  const skip = new Set()
  if (!unreachable.has(bot)) unreachable.set(bot, new Map())
  const remembered = unreachable.get(bot)
  for (const [key, until] of remembered) {
    if (until > Date.now()) skip.add(key)
    else remembered.delete(key)
  }
  let mined = 0
  let failures = 0
  while (mined < count && failures < MAX_FAILURES && !isCancelled()) {
    const candidates = bot.findBlocks({ matching: ids, maxDistance: RANGE, count: 64 })
      .filter((p) => (!allowedPositions || allowedPositions.has(p.toString())) && !skip.has(p.toString()) && !hasFallingAbove(bot, p))
    const pos = candidates.find((p) => isExposed(bot, p)) || candidates[0]
    if (!pos) { if (!mined && !failures) onAttempt({ code: COLLECTION_FAILURE.RESOURCE_NOT_FOUND }); break }
    const block = bot.blockAt(pos)
    if (!block || !predicate(block.name)) { skip.add(pos.toString()); onAttempt({ code: COLLECTION_FAILURE.RESOURCE_NOT_FOUND }); continue }
    const tool = bot.pathfinder.bestHarvestTool(block)
    const names = expectedDrops(bot, block, tool || bot.heldItem)
    const before = inventoryCount(bot, names)
    const alternativeCandidates = candidates.filter((candidate) => candidate.toString() !== pos.toString())
    const evidence = {
      targetBlock: block.name,
      targetPosition: { x: pos.x, y: pos.y, z: pos.z },
      candidateCount: candidates.length,
      alternateTargetCandidateObserved: alternativeCandidates.length > 0,
      alternateTargetCandidateCount: alternativeCandidates.length,
      expectedItems: [...names],
      inventoryBefore: before,
      inventoryAfter: before,
      delta: 0,
      itemConfirmed: false
    }
    let stage = COLLECTION_FAILURE.PATH_FAILED
    try {
      if (!canAcceptDrop(bot, names)) { stage = COLLECTION_FAILURE.INVENTORY_FULL; throw new Error('sem espaço para o drop esperado') }
      // Plugin continua opt-in; ambos os caminhos usam a mesma confirmação.
      if (bot.collectBlock && process.env.MBOT_COLLECTBLOCK === '1' && !requireInReach) {
        stage = COLLECTION_FAILURE.DIG_FAILED
        await collectWithPlugin(bot, block)
      } else {
        let visibleInReach = false
        if ((preferInReach || requireInReach) && bot.canDigBlock?.(block) && bot.blockAtCursor && bot.lookAt) {
          await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true)
          visibleInReach = bot.blockAtCursor(5)?.position?.equals(pos) === true
        }
        evidence.navigation = visibleInReach ? 'visible_in_reach' : 'pathfinder'
        evidence.positionBeforeDig = bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null
        if (requireInReach && !visibleInReach) {
          evidence.navigation = 'refused_blocked_target'
          stage = COLLECTION_FAILURE.TARGET_BLOCKED
          throw new Error('authorized target is not visible in physical reach')
        }
        if (!visibleInReach) await goTo(bot, new goals.GoalGetToBlock(pos.x, pos.y, pos.z), 20000)
        if (isCancelled()) break
        const live = bot.blockAt(pos)
        if (!live || live.name !== block.name) { stage = COLLECTION_FAILURE.RESOURCE_NOT_FOUND; throw new Error('recurso desapareceu antes de cavar') }
        if (bot.canDigBlock && !bot.canDigBlock(live)) { stage = COLLECTION_FAILURE.RESOURCE_UNREACHABLE; throw new Error('bloco fora do alcance físico') }
        if (tool) await bot.equip(tool, 'hand')
        if (isCancelled()) break
        stage = COLLECTION_FAILURE.DIG_FAILED
        await bot.dig(live)
      }
      if (isCancelled()) break
      stage = COLLECTION_FAILURE.ITEM_NOT_CONFIRMED
      if (inventoryCount(bot, names) <= before) {
        await collectDrops(bot, pos, isCancelled, { timeoutMs: 3000,
          matches: (entity) => names.has(entity.getDroppedItem?.()?.name),
          done: () => inventoryCount(bot, names) > before })
      }
      if (isCancelled()) break
      evidence.inventoryAfter = inventoryCount(bot, names)
      evidence.delta = evidence.inventoryAfter - before
      evidence.itemConfirmed = evidence.delta >= 1
      if (evidence.itemConfirmed) mined++
      else { evidence.code = COLLECTION_FAILURE.ITEM_NOT_CONFIRMED; failures++; skip.add(pos.toString()) }
    } catch (err) {
      evidence.code = isCancelled() ? COLLECTION_FAILURE.CANCELLED : stage
      evidence.message = err.message
      if (!isCancelled()) {
        skip.add(pos.toString())
        if ([COLLECTION_FAILURE.PATH_FAILED, COLLECTION_FAILURE.RESOURCE_UNREACHABLE].includes(stage)) remembered.set(pos.toString(), Date.now() + UNREACHABLE_MS)
        failures++
      }
    } finally {
      evidence.inventoryAfter = inventoryCount(bot, names)
      evidence.delta = evidence.inventoryAfter - before
      // Cancellation cannot roll back an item the server already delivered.
      if (evidence.delta >= 1 && !evidence.itemConfirmed) { evidence.itemConfirmed = true; mined++ }
      if (isCancelled()) evidence.code = COLLECTION_FAILURE.CANCELLED
      onAttempt(evidence)
    }
  }
  if (isCancelled()) onAttempt({ code: COLLECTION_FAILURE.CANCELLED })
  return mined
}

const hasPickaxe = (bot) => bot.inventory.items().some((i) => i.name.endsWith('_pickaxe'))

module.exports = { mineBlocks, hasPickaxe, isExposed, hasFallingAbove, FALLING, inventoryCount, expectedDrops, COLLECTION_FAILURE }
