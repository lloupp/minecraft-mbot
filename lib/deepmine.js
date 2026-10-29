// lib/deepmine.js
// Descer cavando degraus e procurar minério profundo. Lápis não aparece na
// superfície: sem descer, `!minerar lapis` só responde RESOURCE_NOT_FOUND.
// Cada degrau é validado antes de cavar: não abre buraco na lava/água nem
// escava o bloco sob os próprios pés.

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { mineBlocks } = require('./gather')

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]
const FLOOR_DEFAULT = -58      // acima da bedrock; lápis aparece bem antes
const UNSAFE = /^(lava|water|flowing_lava|flowing_water|fire|soul_fire|magma_block|cactus|powder_snow|sweet_berry_bush)$/
const isOpen = (block) => !block || block.boundingBox === 'empty'
const isUnsafe = (name) => UNSAFE.test(String(name || ''))

// Plano de um degrau: desce um bloco na direção `dir` e libera a cabeça.
function stepPlan(bot, dir, from = bot.entity?.position) {
  if (!from) return { ok: false, reason: 'sem posição' }
  const base = new Vec3(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z))
  const foot = base.offset(dir[0], -1, dir[1])
  const head = foot.offset(0, 1, 0)
  const footBlock = bot.blockAt(foot)
  const headBlock = bot.blockAt(head)
  const ground = bot.blockAt(foot.offset(0, -1, 0))
  if (!footBlock || !headBlock || !ground) return { ok: false, reason: 'chunk não carregado' }
  if (isUnsafe(footBlock.name) || isUnsafe(ground.name)) return { ok: false, reason: `perigo (${footBlock.name}/${ground.name})` }
  // Degrau já aberto (caverna): só vale se tiver chão firme embaixo; senão é queda.
  if (isOpen(footBlock) && isOpen(ground)) return { ok: false, reason: 'degrau aberto sem chão' }
  const dig = isOpen(footBlock) ? [] : [footBlock]
  if (!isOpen(headBlock)) {
    if (isUnsafe(headBlock.name)) return { ok: false, reason: `perigo (${headBlock.name})` }
    dig.push(headBlock)
  }
  return { ok: true, foot, head, dig }
}

// Primeira direção segura, começando em `start` para não repetir a recusada.
function firstViableStep(bot, start = 0) {
  for (let i = 0; i < DIRS.length; i++) {
    const index = (start + i) % DIRS.length
    const plan = stepPlan(bot, DIRS[index])
    if (plan.ok) return { ...plan, index }
  }
  return { ok: false, reason: 'nenhuma direção segura' }
}

// Para pedra comum, a picareta mais barata que dá conta: a de ferro fica para o minério
// (visto no jogo: a escada gastava os ~250 usos da picareta de ferro antes do diamante).
const PICKAXES_CHEAP_FIRST = ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe', 'golden_pickaxe', 'wooden_pickaxe']
function cheapestPickaxe(bot, block) {
  if (!/pickaxe/.test(String(block?.material || ''))) return null
  const items = bot.inventory?.items?.() || []
  for (const name of PICKAXES_CHEAP_FIRST) {
    const item = items.find((i) => i.name === name)
    if (item && (typeof block.canHarvest !== 'function' || block.canHarvest(item.type))) return item
  }
  return null
}

async function digPlan(bot, plan, isCancelled, stepTimeoutMs = STEP_TIMEOUT_MS) {
  for (const block of plan.dig) {
    if (isCancelled()) return false
    const tool = cheapestPickaxe(bot, block) || bot.pathfinder?.bestHarvestTool?.(block)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    await bot.dig(block).catch(() => {})
  }
  // Sem prazo, o pathfinder pode ficar minutos tentando (visto: 3 min parado num degrau).
  let timer
  await Promise.race([
    bot.pathfinder.goto(new goals.GoalBlock(plan.foot.x, plan.foot.y, plan.foot.z)).catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(() => { bot.pathfinder.setGoal?.(null); resolve() }, stepTimeoutMs) })
  ])
  clearTimeout(timer)
  return true
}

// Chegou ao degrau planejado?
function reached(bot, foot) {
  const p = bot.entity?.position
  return Boolean(p) && Math.floor(p.x) === foot.x && Math.floor(p.z) === foot.z && Math.abs(Math.floor(p.y) - foot.y) <= 1
}

const MAX_SIDESTEPS = 4
const STEP_TIMEOUT_MS = 10000
const MAX_MISSED_STEPS = 4
const PATHFINDER_DROP = 8

async function descendByPathfinder(bot, y, timeoutMs) {
  if (!bot.pathfinder?.goto || typeof goals.GoalY !== 'function') return
  let timer
  await Promise.race([
    bot.pathfinder.goto(new goals.GoalY(y)).catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(() => { bot.pathfinder.setGoal?.(null); resolve() }, timeoutMs) })
  ])
  clearTimeout(timer)
}

// Passo lateral no mesmo nível: cava pés e cabeça se preciso, só com chão firme e sem líquido.
async function sidestep(bot, startIndex, isCancelled) {
  const from = bot.entity?.position
  if (!from) return false
  const base = new Vec3(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z))
  for (let i = 0; i < DIRS.length; i++) {
    const [dx, dz] = DIRS[(startIndex + i) % DIRS.length]
    const foot = base.offset(dx, 0, dz)
    const head = foot.offset(0, 1, 0)
    const blocks = [bot.blockAt(foot), bot.blockAt(head)]
    const ground = bot.blockAt(foot.offset(0, -1, 0))
    if (!ground || blocks.some((b) => !b)) continue
    if (isOpen(ground) || isUnsafe(ground.name) || blocks.some((b) => isUnsafe(b.name))) continue
    const dig = blocks.filter((b) => !isOpen(b))
    const moved = await digPlan(bot, { foot, dig }, isCancelled)
    if (!moved || isCancelled()) return false
    return true
  }
  return false
}

// Desce até `steps` degraus (ou até `floor`). Para também se não houver direção
// segura, em vez de insistir no mesmo bloco.
async function digStair(bot, { steps = 8, floor = FLOOR_DEFAULT, isCancelled = () => false, onStep = () => {}, stepTimeoutMs = STEP_TIMEOUT_MS } = {}) {
  let done = 0
  let dirIndex = 0
  let missed = 0
  while (done < steps && !isCancelled() && bot.entity.position.y > floor) {
    let plan = firstViableStep(bot, dirIndex)
    // Nenhuma descida segura daqui: anda um bloco de lado (cavando) e tenta de novo.
    for (let side = 0; !plan.ok && side < MAX_SIDESTEPS && !isCancelled(); side++) {
      const moved = await sidestep(bot, (dirIndex + side) % DIRS.length, isCancelled)
      if (!moved) break
      plan = firstViableStep(bot, dirIndex)
    }
    if (!plan.ok && !isCancelled()) {
      // Último recurso: o pathfinder acha a descida contornando água/lava (ele evita cavar ao lado de líquido).
      const before = bot.entity.position.y
      await descendByPathfinder(bot, Math.floor(before) - PATHFINDER_DROP, stepTimeoutMs * 3)
      if (bot.entity.position.y < before - 0.5) {
        done++
        onStep({ step: done, position: bot.entity.position })
        continue
      }
    }
    if (!plan.ok) return { ok: false, steps: done, reason: plan.reason }
    if (!(await digPlan(bot, plan, isCancelled, stepTimeoutMs))) return { ok: true, steps: done, cancelled: true }
    if (isCancelled()) return { ok: true, steps: done, cancelled: true }
    if (!reached(bot, plan.foot)) {
      // Não chegou ao degrau: tenta a próxima direção em vez de insistir.
      if (++missed >= MAX_MISSED_STEPS) return { ok: false, steps: done, reason: 'não consegui chegar ao degrau' }
      dirIndex = (plan.index + 1) % DIRS.length
      continue
    }
    missed = 0
    dirIndex = plan.index
    done++
    onStep({ step: done, position: plan.foot })
  }
  return { ok: true, steps: done }
}

// Mochila cheia: o minério novo fica no chão. Joga fora pedra comum (guarda um
// pacote de pedregulho para fabricar). Visto no jogo: 36/36 com granito/calcita.
const JUNK = /^(granite|diorite|andesite|tuff|calcite|dirt|gravel|cobbled_deepslate|cobblestone|deepslate|stone|smooth_basalt|basalt|netherrack|dripstone_block|pointed_dripstone|amethyst_block|budding_amethyst|sand|sandstone|clay_ball|flint|rotten_flesh|bone|string|spider_eye|arrow|dandelion|poppy)$/
const KEEP_COBBLE = 64
const FREE_SLOTS_MIN = 3
async function dropJunk(bot) {
  const inv = bot.inventory
  if (!inv?.items || typeof bot.tossStack !== 'function') return 0
  const free = typeof inv.emptySlotCount === 'function' ? inv.emptySlotCount() : 36 - inv.items().length
  if (free >= FREE_SLOTS_MIN) return 0
  let tossed = 0
  let keptCobble = 0
  for (const item of inv.items()) {
    if (!JUNK.test(item.name)) continue
    if (item.name === 'cobblestone' && keptCobble < KEEP_COBBLE) { keptCobble += item.count; continue }
    try {
      await bot.tossStack(item)
      tossed++
    } catch {}
  }
  return tossed
}

// Junta minério a cada nível e desce um lance quando não há alvo por perto.
async function mineDeep(bot, {
  names = [], item = '', target = 1, floor = FLOOR_DEFAULT,
  maxSteps = 160, descendChunk = 4, isCancelled = () => false, onProgress = () => {}
} = {}) {
  const counted = () => bot.inventory.items().filter((i) => i.name === item).reduce((sum, i) => sum + i.count, 0)
  let blocks = 0
  let steps = 0
  while (counted() < target && !isCancelled() && steps < maxSteps) {
    await dropJunk(bot).catch(() => 0)
    const got = await mineBlocks(bot, (name) => names.includes(name), 1, isCancelled).catch(() => 0)
    if (got) {
      blocks += got
      onProgress({ blocks, item: counted(), steps })
      continue
    }
    if (isCancelled()) break
    if (bot.entity.position.y <= floor) return { ok: counted() >= target, blocks, item: counted(), steps, reason: 'cheguei ao fundo' }
    const stair = await digStair(bot, { steps: descendChunk, floor, isCancelled, onStep: () => { steps++ } })
    if (stair.cancelled) break
    if (!stair.ok) return { ok: counted() >= target, blocks, item: counted(), steps, reason: stair.reason }
    onProgress({ blocks, item: counted(), steps })
  }
  return { ok: counted() >= target, blocks, item: counted(), steps, reason: counted() >= target ? null : 'limite de degraus' }
}

module.exports = { dropJunk, cheapestPickaxe, mineDeep, digStair, stepPlan, firstViableStep, DIRS, FLOOR_DEFAULT }
