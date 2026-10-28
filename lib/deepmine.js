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
  if (isOpen(footBlock)) return { ok: false, reason: 'degrau já aberto' }
  if (isUnsafe(footBlock.name) || isUnsafe(ground.name)) return { ok: false, reason: `perigo (${footBlock.name}/${ground.name})` }
  const dig = [footBlock]
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

async function digPlan(bot, plan, isCancelled) {
  for (const block of plan.dig) {
    if (isCancelled()) return false
    const tool = bot.pathfinder?.bestHarvestTool?.(block)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    await bot.dig(block).catch(() => {})
  }
  await bot.pathfinder.goto(new goals.GoalBlock(plan.foot.x, plan.foot.y, plan.foot.z)).catch(() => {})
  return true
}

// Desce até `steps` degraus (ou até `floor`). Para também se não houver direção
// segura, em vez de insistir no mesmo bloco.
async function digStair(bot, { steps = 8, floor = FLOOR_DEFAULT, isCancelled = () => false, onStep = () => {} } = {}) {
  let done = 0
  let dirIndex = 0
  while (done < steps && !isCancelled() && bot.entity.position.y > floor) {
    const plan = firstViableStep(bot, dirIndex)
    if (!plan.ok) return { ok: false, steps: done, reason: plan.reason }
    if (!(await digPlan(bot, plan, isCancelled))) return { ok: true, steps: done, cancelled: true }
    dirIndex = plan.index
    done++
    onStep({ step: done, position: plan.foot })
  }
  return { ok: true, steps: done }
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

module.exports = { mineDeep, digStair, stepPlan, firstViableStep, DIRS, FLOOR_DEFAULT }
