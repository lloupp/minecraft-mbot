// lib/blueprintBuilder.js
// Constrói no mundo os passos de uma planta (lib/blueprint.js): abre espaço
// quebrando só terreno natural, coloca cada bloco com a orientação pedida e
// confere o resultado com bot.blockAt.

const { Vec3 } = require('vec3')
const { goals, Movements } = require('mineflayer-pathfinder')
const { isNaturalTerrain } = require('./blueprint')

const AIR = new Set(['air', 'cave_air', 'void_air'])
const FLUIDS = new Set(['water', 'lava', 'bubble_column'])
const DIRS = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 }
}
const ALL_REFS = [DIRS.down, DIRS.north, DIRS.south, DIRS.west, DIRS.east, DIRS.up]
const SIDE_REFS = [DIRS.north, DIRS.south, DIRS.west, DIRS.east]
const neg = (d) => ({ x: -d.x, y: -d.y, z: -d.z })

// Presos à parede atrás deles (facing aponta para fora da parede).
const WALL_MOUNTED = /(wall_torch|_wall_sign|_wall_hanging_sign|_wall_banner|_wall_head|_wall_skull|_wall_fan|^ladder$|^tripwire_hook$)/
// Precisam de chão.
const FLOOR_MOUNTED = /(^torch$|^soul_torch$|^redstone_torch$|_sign$|_banner$|_carpet$|rail$|_pressure_plate$|^redstone_wire$|^repeater$|^comparator$|_sapling$|^flower_pot$|^potted_|candle|_door$|_bed$|^snow$|^(wheat|carrots|potatoes|beetroots)$|_head$|_skull$)/
// A face "facing" é a direção para onde o jogador olha ao colocar.
const LOOK_SAME = /(_stairs$|_door$|_fence_gate$|_bed$|^anvil$|^chipped_anvil$|^damaged_anvil$)/
// A face "facing" é o contrário da direção do jogador (a frente vira para ele).
const LOOK_OPPOSITE = /(^chest$|^trapped_chest$|furnace$|^smoker$|^carved_pumpkin$|^jack_o_lantern$|^lectern$|^loom$|^beehive$|^bee_nest$|^repeater$|^comparator$|^stonecutter$|^ender_chest$|^barrel$|^observer$|^dispenser$|^dropper$|^piston$|^sticky_piston$|_glazed_terracotta$)/

// Como colocar o bloco para sair com a orientação da planta: onde encostar
// (vizinhos, relativos ao alvo), para onde olhar e em que metade clicar.
function placementHint(step) {
  const name = step.name
  const p = step.properties || {}
  const facing = DIRS[p.facing] && !['up', 'down'].includes(p.facing) ? DIRS[p.facing] : null

  if (WALL_MOUNTED.test(name) && facing) return { refs: [neg(facing)], strict: true, look: null, half: null }

  if (/_button$|^lever$/.test(name) && p.face) {
    if (p.face === 'floor') return { refs: [DIRS.down], strict: true, look: facing, half: null }
    if (p.face === 'ceiling') return { refs: [DIRS.up], strict: true, look: facing, half: null }
    if (facing) return { refs: [neg(facing)], strict: true, look: null, half: null }
  }

  if (/_trapdoor$/.test(name) && facing) {
    // Clicando na lateral de um bloco, o alçapão vira para a face clicada.
    return { refs: [neg(facing)], strict: false, look: null, half: p.half === 'top' ? 'top' : 'bottom' }
  }

  if (/lantern$/.test(name)) {
    return { refs: [p.hanging === 'true' ? DIRS.up : DIRS.down], strict: true, look: null, half: null }
  }

  if (FLOOR_MOUNTED.test(name)) {
    const look = facing && (LOOK_SAME.test(name) ? facing : LOOK_OPPOSITE.test(name) ? neg(facing) : null)
    return { refs: [DIRS.down], strict: true, look, half: null }
  }

  if (/_stairs$/.test(name)) {
    const top = p.half === 'top'
    return { refs: top ? [DIRS.up, ...SIDE_REFS] : [DIRS.down, ...SIDE_REFS], strict: false, look: facing, half: top ? 'top' : 'bottom' }
  }

  if (/_slab$/.test(name)) {
    const top = p.type === 'top'
    return { refs: top ? [DIRS.up, ...SIDE_REFS] : [DIRS.down, ...SIDE_REFS], strict: false, look: null, half: top ? 'top' : 'bottom' }
  }

  if (p.axis) {
    // Troncos/pilares seguem o eixo da face clicada.
    const refs = p.axis === 'x' ? [DIRS.west, DIRS.east] : p.axis === 'z' ? [DIRS.north, DIRS.south] : [DIRS.down, DIRS.up]
    return { refs, strict: false, look: null, half: null }
  }

  if (facing) {
    if (LOOK_SAME.test(name)) return { refs: ALL_REFS, strict: false, look: facing, half: null }
    if (LOOK_OPPOSITE.test(name)) return { refs: ALL_REFS, strict: false, look: neg(facing), half: null }
  }
  return { refs: ALL_REFS, strict: false, look: null, half: null }
}

// Orientação só vale como "certa" quando as propriedades relevantes batem.
const ORIENTATION_KEYS = ['facing', 'half', 'axis', 'type', 'face', 'hanging']

function sameName(block, step) {
  return block?.name === step.name
}

function sameOrientation(block, step) {
  const props = typeof block?.getProperties === 'function' ? block.getProperties() : {}
  return ORIENTATION_KEYS.every((k) => step.properties?.[k] == null || props[k] == null ||
    String(props[k]) === String(step.properties[k]))
}

function isEmpty(block) {
  return !block || AIR.has(block.name) || FLUIDS.has(block.name)
}

function isSolid(block) {
  return Boolean(block) && !AIR.has(block.name) && !FLUIDS.has(block.name) && block.boundingBox === 'block'
}

function worldPos(origin, step) {
  return new Vec3(origin.x + step.x, origin.y + step.y, origin.z + step.z)
}

function bounds(origin, positions) {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of positions) {
    for (const axis of ['x', 'y', 'z']) {
      min[axis] = Math.min(min[axis], origin[axis] + p[axis])
      max[axis] = Math.max(max[axis], origin[axis] + p[axis])
    }
  }
  return { min, max }
}

function insideBox(pos, box) {
  return pos.x >= box.min.x && pos.x <= box.max.x &&
    pos.y >= box.min.y && pos.y <= box.max.y &&
    pos.z >= box.min.z && pos.z <= box.max.z
}

// Caminhos durante a obra: não quebra nada dentro da área da planta nem blocos
// não naturais fora dela, e não deixa andaimes dentro da área.
function buildMovements(bot, box) {
  try {
    const moves = new Movements(bot)
    moves.canDig = true
    moves.allow1by1towers = false
    moves.exclusionAreasBreak = [(block) =>
      insideBox(block.position, box) || !isNaturalTerrain(block.name) ? 100 : 0]
    moves.exclusionAreasPlace = [(block) => insideBox(block.position, box) ? 100 : 0]
    return moves
  } catch {
    return null
  }
}

async function goToWithTimeout(bot, goal, ms = 15000) {
  if (!bot.pathfinder?.goto) return
  let timer
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          bot.pathfinder.setGoal?.(null)
          reject(new Error('caminho demorou demais'))
        }, ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function occupies(bot, pos) {
  const feet = bot.entity?.position?.floored?.()
  if (!feet) return false
  return feet.x === pos.x && feet.z === pos.z && (feet.y === pos.y || feet.y + 1 === pos.y)
}

async function approach(bot, pos) {
  if (!bot.entity?.position) return
  const eye = bot.entity.position.offset(0, 1.6, 0)
  const center = pos.offset(0.5, 0.5, 0.5)
  if (eye.distanceTo(center) > 4.2) {
    await goToWithTimeout(bot, new goals.GoalNear(pos.x, pos.y, pos.z, 3)).catch(() => {})
  }
  if (occupies(bot, pos)) {
    // Parado onde o bloco vai: sai de cima sem se afastar demais.
    await goToWithTimeout(bot, new goals.GoalInvert(new goals.GoalNear(pos.x, pos.y, pos.z, 1)), 6000).catch(() => {})
  }
}

function countItem(bot, name) {
  return bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0)
}

async function digBlock(bot, block) {
  const tool = bot.pathfinder?.bestHarvestTool?.(block)
  if (tool) await bot.equip(tool, 'hand').catch(() => {})
  await bot.dig(block)
}

// Olha na direção horizontal `dir` (yaw do mineflayer: 0 = norte, cresce para oeste).
async function lookToward(bot, dir) {
  const yaw = Math.atan2(-dir.x, -dir.z)
  await bot.look(yaw, 0, true)
}

async function clickPlace(bot, reference, face, hint) {
  if (typeof bot._placeBlockWithOptions !== 'function') {
    await bot.placeBlock(reference, face)
    return
  }
  const options = { swingArm: 'right' }
  if (hint.half) options.half = hint.half
  if (hint.look) {
    await lookToward(bot, hint.look)
    // A orientação vem do yaw já enviado ao servidor; olhar o bloco a desfaria.
    options.forceLook = 'ignore'
  } else {
    options.forceLook = true
  }
  await bot._placeBlockWithOptions(reference, face, options)
}

// Opções:
//   isCancelled()        interrompe entre blocos
//   acquire(item, n)     busca material que acabou (estoque); retorna se conseguiu
//   clear                posições relativas que a planta quer vazias (ar)
//   passes               voltas para refazer blocos que ficaram sem apoio
//   log(msg)
async function buildBlueprint(bot, steps, origin, options = {}) {
  const isCancelled = options.isCancelled || (() => false)
  const acquire = options.acquire || null
  const log = options.log || (() => {})
  const passes = Math.max(1, options.passes || 3)
  const started = Date.now()
  const report = {
    total: steps.length,
    alreadyOk: 0,
    placed: 0,
    wrongOrientation: 0,
    cleared: 0,
    obstructed: [],
    missing: {},
    failed: [],
    cancelled: false,
    durationMs: 0
  }
  const obstructedKeys = new Set()
  const obstruct = (pos, name) => {
    if (obstructedKeys.has(pos.toString())) return
    obstructedKeys.add(pos.toString())
    report.obstructed.push({ x: pos.x, y: pos.y, z: pos.z, name })
  }

  const box = bounds(origin, [...steps, ...(options.clear || [])])
  const previousMoves = bot.pathfinder?.movements
  const moves = options.movements === false ? null : buildMovements(bot, box)
  if (moves) bot.pathfinder.setMovements(moves)

  try {
    // Abre espaço de cima para baixo (areia/cascalho não caem no bot).
    const clear = [...(options.clear || [])].sort((a, b) => b.y - a.y)
    for (const rel of clear) {
      if (isCancelled()) break
      const pos = worldPos(origin, rel)
      let block = bot.blockAt(pos)
      if (!block) {
        await approach(bot, pos)
        block = bot.blockAt(pos)
      }
      if (isEmpty(block)) continue
      if (!isNaturalTerrain(block.name)) {
        obstruct(pos, block.name)
        continue
      }
      try {
        await approach(bot, pos)
        await digBlock(bot, block)
        report.cleared++
      } catch (err) {
        log(`não consegui limpar ${block.name} em ${pos}: ${err.message}`)
      }
    }

    let pending = steps.map((step) => ({ step, reason: null }))
    for (let pass = 0; pass < passes && pending.length && !isCancelled(); pass++) {
      const retry = []
      for (const entry of pending) {
        if (isCancelled()) break
        const reason = await placeStep(entry.step)
        if (reason === 'sem_apoio' || reason === 'erro') retry.push({ step: entry.step, reason })
        else if (reason === 'sem_material') report.missing[entry.step.item] = (report.missing[entry.step.item] || 0) + 1
      }
      pending = retry
    }
    for (const { step, reason } of pending) {
      const pos = worldPos(origin, step)
      report.failed.push({ x: pos.x, y: pos.y, z: pos.z, name: step.name, reason })
    }
  } finally {
    report.cancelled = isCancelled()
    report.durationMs = Date.now() - started
    if (moves && previousMoves) bot.pathfinder.setMovements(previousMoves)
  }
  return report

  // Retorna null quando o bloco ficou certo, ou o motivo da falha.
  async function placeStep(step) {
    const pos = worldPos(origin, step)
    let current = bot.blockAt(pos)
    if (!current) {
      await approach(bot, pos)
      current = bot.blockAt(pos)
      if (!current) return 'erro'
    }

    const hint = placementHint(step)
    let doubleSlab = false
    if (sameName(current, step)) {
      const props = typeof current.getProperties === 'function' ? current.getProperties() : {}
      // Laje dupla: a primeira metade já está lá, falta clicar em cima dela.
      if (step.properties?.type === 'double' && props.type && props.type !== 'double') {
        doubleSlab = true
      } else {
        report.alreadyOk++
        return null
      }
    }

    if (!doubleSlab && !isEmpty(current)) {
      if (!isNaturalTerrain(current.name)) {
        obstruct(pos, current.name)
        return 'obstruido'
      }
      try {
        await approach(bot, pos)
        await digBlock(bot, current)
        report.cleared++
      } catch {
        return 'erro'
      }
    }

    if (countItem(bot, step.item) < 1) {
      const got = acquire ? await acquire(step.item, 1).catch(() => false) : false
      if (!got || countItem(bot, step.item) < 1) return 'sem_material'
    }

    let reference = null
    let face = null
    if (doubleSlab) {
      reference = bot.blockAt(pos)
      face = new Vec3(0, current.getProperties().type === 'top' ? -1 : 1, 0)
    } else {
      const candidates = hint.strict ? hint.refs : [...hint.refs, ...ALL_REFS.filter((d) => !hint.refs.includes(d))]
      for (const d of candidates) {
        const block = bot.blockAt(pos.offset(d.x, d.y, d.z))
        if (isSolid(block)) {
          reference = block
          face = new Vec3(-d.x, -d.y, -d.z)
          break
        }
      }
    }
    if (!reference) return 'sem_apoio'

    try {
      await approach(bot, pos)
      if (isCancelled()) return 'erro'
      const item = bot.inventory.items().find((i) => i.name === step.item)
      if (!item) return 'sem_material'
      await bot.equip(item, 'hand')
      await clickPlace(bot, reference, face, doubleSlab ? { ...hint, half: null, look: null } : hint)
    } catch (err) {
      log(`falhei ${step.name} em ${pos}: ${err.message}`)
    }

    const after = bot.blockAt(pos)
    if (!sameName(after, step)) return 'erro'
    const props = typeof after.getProperties === 'function' ? after.getProperties() : {}
    if (step.properties?.type === 'double' && props.type && props.type !== 'double') return 'erro'
    report.placed++
    if (!sameOrientation(after, step)) report.wrongOrientation++
    return null
  }
}

// Confere bloco a bloco: quantos estão com o nome certo e quantos com a
// orientação certa. Útil para o teste ao vivo e para relatórios.
function verifyBlueprint(bot, steps, origin) {
  const result = { total: steps.length, rightName: 0, rightOrientation: 0, wrong: [] }
  for (const step of steps) {
    const pos = worldPos(origin, step)
    const block = bot.blockAt(pos)
    if (sameName(block, step)) {
      result.rightName++
      if (sameOrientation(block, step)) result.rightOrientation++
      else result.wrong.push({ x: pos.x, y: pos.y, z: pos.z, want: step.name, got: `${block.name} (orientação)` })
    } else {
      result.wrong.push({ x: pos.x, y: pos.y, z: pos.z, want: step.name, got: block?.name || 'descarregado' })
    }
  }
  return result
}

function describeReport(report) {
  const done = report.alreadyOk + report.placed
  const parts = [`${done}/${report.total} blocos certos`]
  if (report.placed) parts.push(`${report.placed} colocados`)
  if (report.cleared) parts.push(`${report.cleared} de terreno removidos`)
  if (report.wrongOrientation) parts.push(`${report.wrongOrientation} com orientação diferente`)
  if (report.obstructed.length) parts.push(`${report.obstructed.length} obstruídos por blocos não naturais`)
  const missing = Object.values(report.missing).reduce((a, b) => a + b, 0)
  if (missing) parts.push(`${missing} sem material`)
  if (report.failed.length) parts.push(`${report.failed.length} falharam`)
  return parts.join(', ')
}

module.exports = {
  placementHint,
  buildBlueprint,
  verifyBlueprint,
  describeReport,
  sameOrientation,
  worldPos,
  bounds,
  insideBox
}
