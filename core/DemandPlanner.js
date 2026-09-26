const FOOD_NAMES = new Set([
  'bread', 'baked_potato', 'potato', 'carrot', 'beetroot', 'apple',
  'sweet_berries', 'glow_berries', 'beef', 'porkchop', 'mutton', 'rabbit',
  'cod', 'salmon', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'beetroot_soup',
  'mushroom_stew', 'rabbit_stew', 'pumpkin_pie', 'melon_slice'
])

const DEFAULT_TARGETS = {
  food: 32,
  wood: 64,
  fuel: 24,
  ironTotal: 32,
  ironIngot: 12,
  building: 64,
  ironPickaxe: 2,
  ironAxe: 2,
  ironSword: 1
}

function sumMatching(stock, predicate) {
  return Object.entries(stock || {}).reduce(
    (sum, [name, count]) => predicate(name) ? sum + Number(count || 0) : sum,
    0
  )
}

function stockMetrics(stock = {}) {
  const food = sumMatching(stock, (name) => FOOD_NAMES.has(name))
  const logs = sumMatching(stock, (name) => name.endsWith('_log') || name.endsWith('_stem'))
  const planks = sumMatching(stock, (name) => name.endsWith('_planks'))
  const fuel = Number(stock.coal || 0) + Number(stock.charcoal || 0)
  const rawIron = Number(stock.raw_iron || 0) +
    Number(stock.iron_ore || 0) +
    Number(stock.deepslate_iron_ore || 0)
  const ironIngot = Number(stock.iron_ingot || 0)
  const building = sumMatching(stock, (name) =>
    ['cobblestone', 'stone', 'deepslate', 'cobbled_deepslate', 'dirt'].includes(name) ||
    name.endsWith('_planks')
  )

  return {
    food,
    wood: logs + planks,
    logs,
    planks,
    fuel,
    rawIron,
    ironIngot,
    ironTotal: rawIron + ironIngot,
    building,
    ironPickaxe: Number(stock.iron_pickaxe || 0),
    ironAxe: Number(stock.iron_axe || 0),
    ironSword: Number(stock.iron_sword || 0)
  }
}

function deficits(metrics, targets = DEFAULT_TARGETS) {
  const out = {}
  for (const [key, target] of Object.entries(targets)) {
    out[key] = Math.max(0, target - Number(metrics[key] || 0))
  }
  return out
}

class DemandPlanner {
  constructor({ targets = {} } = {}) {
    this.targets = { ...DEFAULT_TARGETS, ...targets }
  }

  effectiveTargets(extraTargets = {}) {
    const targets = { ...this.targets }
    for (const [key, value] of Object.entries(extraTargets || {})) {
      targets[key] = Math.max(Number(targets[key] || 0), Number(value || 0))
    }
    return targets
  }

  report(stock, extraTargets = {}) {
    const metrics = stockMetrics(stock)
    const targets = this.effectiveTargets(extraTargets)
    return { metrics, deficits: deficits(metrics, targets), targets }
  }

  buildPlan(workers, stock, extraTargets = {}) {
    const report = this.report(stock, extraTargets)
    const targets = report.targets
    const m = { ...report.metrics }
    const d = () => deficits(m, targets)
    const idle = workers.filter((entry) => entry.controller?.isIdle?.())
    const priority = {
      minerador: 10,
      lenhador: 20,
      fazendeiro: 30,
      artesao: 40,
      guarda: 50,
      explorador: 60,
      ajudante: 70,
      construtor: 80
    }
    idle.sort((a, b) => (priority[a.worker.role] || 99) - (priority[b.worker.role] || 99))

    const plan = []
    for (const entry of idle) {
      const role = entry.worker.role
      const need = d()
      let task = null

      if (role === 'minerador') {
        if (need.fuel > 0) {
          const count = Math.min(8, need.fuel)
          task = { type: 'coletar_blocos', resource: 'carvao', count, reason: 'estoque_baixo_combustivel' }
          m.fuel += count
        } else if (need.ironTotal > 0) {
          const count = Math.min(8, need.ironTotal)
          task = { type: 'coletar_blocos', resource: 'ferro', count, reason: 'estoque_baixo_ferro' }
          m.rawIron += count
          m.ironTotal += count
        } else if (need.building > 0) {
          const count = Math.min(12, need.building)
          task = { type: 'coletar_blocos', resource: 'pedra', count, reason: 'estoque_baixo_construcao' }
          m.building += count
        }
      } else if (role === 'lenhador' && need.wood > 0) {
        const count = Math.min(12, need.wood)
        task = { type: 'coletar_blocos', resource: 'madeira', count, reason: 'estoque_baixo_madeira' }
        m.wood += count
        m.logs += count
      } else if (role === 'fazendeiro' && need.food > 0) {
        const count = Math.min(8, need.food)
        task = { type: 'fazenda', resource: 'comida', count, reason: 'estoque_baixo_comida' }
        m.food += count
      } else if (role === 'artesao') {
        const hasStickMaterial = m.logs >= 1 || m.planks >= 2
        if (need.ironIngot > 0 && m.rawIron > 0 && m.fuel > 0) {
          const count = Math.min(8, need.ironIngot, m.rawIron)
          task = { type: 'fabricar', item: 'iron_ingot', count, reason: 'converter_ferro_bruto' }
          m.rawIron -= count
          m.ironIngot += count
        } else if (need.ironPickaxe > 0 && m.ironIngot >= 3 && hasStickMaterial) {
          task = { type: 'fabricar', item: 'iron_pickaxe', count: 1, reason: 'reserva_picaretas' }
          m.ironPickaxe += 1
          m.ironIngot -= 3
        } else if (need.ironAxe > 0 && m.ironIngot >= 3 && hasStickMaterial) {
          task = { type: 'fabricar', item: 'iron_axe', count: 1, reason: 'reserva_machados' }
          m.ironAxe += 1
          m.ironIngot -= 3
        } else if (need.ironSword > 0 && m.ironIngot >= 2 && hasStickMaterial) {
          task = { type: 'fabricar', item: 'iron_sword', count: 1, reason: 'reserva_espadas' }
          m.ironSword += 1
          m.ironIngot -= 2
        }
      } else if (role === 'guarda') {
        task = { type: 'guardar', durationMs: 15000, reason: 'proteger_dono' }
      } else if (role === 'explorador') {
        const critical = need.food + need.wood + need.fuel + need.ironTotal
        if (critical === 0) task = { type: 'explorar', radius: 96, reason: 'estoque_estavel' }
      }

      if (task) plan.push({ ...entry, task })
    }

    return { plan, report }
  }
}

module.exports = {
  DemandPlanner,
  DEFAULT_TARGETS,
  FOOD_NAMES,
  stockMetrics,
  deficits
}
