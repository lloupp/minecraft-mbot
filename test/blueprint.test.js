const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const zlib = require('node:zlib')
const nbt = require('prismarine-nbt')
const { Vec3 } = require('vec3')

const bp = require('../lib/blueprint')
const { buildBlueprint, placementHint, verifyBlueprint } = require('../lib/blueprintBuilder')
const { ProjectManager } = require('../core/ProjectManager')
const { DemandPlanner } = require('../core/DemandPlanner')

const PLANTAS = path.join(__dirname, '..', 'plantas')

// ---------- NBT de teste ----------

const int = (value) => ({ type: 'int', value })
const str = (value) => ({ type: 'string', value })
const compound = (value) => ({ type: 'compound', value })

function gz(root) {
  return zlib.gzipSync(nbt.writeUncompressed(root))
}

function varintBytes(values) {
  const out = []
  for (let v of values) {
    while (v & ~0x7f) {
      out.push(((v & 0x7f) | 0x80) << 24 >> 24)
      v >>>= 7
    }
    out.push(v)
  }
  return out
}

// Empacota índices como o Litematica (valores podem atravessar dois longs).
function packLitematic(values, bits) {
  const words = new Array(Math.ceil(values.length * bits / 64)).fill(0n)
  values.forEach((value, index) => {
    const start = BigInt(index * bits)
    const word = Number(start >> 6n)
    const offset = start & 63n
    words[word] |= (BigInt(value) << offset) & ((1n << 64n) - 1n)
    if (offset + BigInt(bits) > 64n) words[word + 1] |= BigInt(value) >> (64n - offset)
  })
  // prismarine-nbt grava long como [alto, baixo] com sinal.
  return words.map((w) => {
    const signed = BigInt.asIntN(64, w)
    return [Number(signed >> 32n), Number(BigInt.asIntN(32, signed & 0xffffffffn))]
  })
}

// ---------- Leitura ----------

test('lê a planta de exemplo .schem (Sponge v2 via prismarine-schematic)', async () => {
  const cabana = await bp.loadBlueprint('cabana', { dir: PLANTAS })
  assert.deepEqual(cabana.size, { x: 5, y: 5, z: 5 })
  const { materials, ignored } = bp.materialList(cabana.blocks)
  assert.deepEqual(materials, {
    cobblestone: 45,
    oak_planks: 41,
    oak_log: 8,
    oak_door: 1, // só a metade de baixo conta
    glass: 2,
    oak_stairs: 1,
    torch: 1 // wall_torch vira item torch
  })
  assert.deepEqual(ignored, {})
  const door = cabana.blocks.find((b) => b.name === 'oak_door' && b.properties.half === 'lower')
  assert.equal(door.properties.facing, 'south')
  assert.ok(cabana.air.length > 0, 'o ar interno fica registrado para limpar a área')
  assert.deepEqual(bp.listBlueprints(PLANTAS).map((p) => p.name), ['cabana', 'marco'])
})

test('lê Sponge v3, .litematic (com longs atravessados e tamanho negativo) e .nbt de estrutura', async () => {
  // Sponge v3: 2x1x2 com uma laje no topo.
  const v3 = gz({
    type: 'compound',
    name: '',
    value: {
      Schematic: compound({
        Version: int(3),
        DataVersion: int(3465),
        Width: { type: 'short', value: 2 },
        Height: { type: 'short', value: 1 },
        Length: { type: 'short', value: 2 },
        Blocks: compound({
          Palette: compound({
            'minecraft:air': int(0),
            'minecraft:stone': int(1),
            'minecraft:oak_slab[type=top,waterlogged=false]': int(2)
          }),
          Data: { type: 'byteArray', value: varintBytes([1, 0, 2, 1]) }
        })
      })
    }
  })
  const a = await bp.parseBlueprint(v3, '.schem')
  assert.deepEqual(a.size, { x: 2, y: 1, z: 2 })
  assert.deepEqual(bp.materialList(a.blocks).materials, { stone: 2, oak_slab: 1 })
  assert.equal(a.blocks.find((b) => b.name === 'oak_slab').properties.type, 'top')
  assert.equal(a.air.length, 1)

  // Litematic: 5 estados -> 3 bits; 22 blocos cruzam a fronteira de 64 bits.
  const palette = ['air', 'stone', 'glass', 'oak_planks', 'torch']
  const size = { x: 2, y: 11, z: 1 }
  const values = Array.from({ length: 22 }, (_, i) => (i % 4) + 1)
  const litematic = gz({
    type: 'compound',
    name: '',
    value: {
      Version: int(6),
      Regions: compound({
        principal: compound({
          Position: compound({ x: int(3), y: int(0), z: int(0) }),
          Size: compound({ x: int(-size.x), y: int(size.y), z: int(size.z) }),
          BlockStatePalette: {
            type: 'list',
            value: { type: 'compound', value: palette.map((name) => ({ Name: str(`minecraft:${name}`) })) }
          },
          BlockStates: { type: 'longArray', value: packLitematic(values, 3) }
        })
      })
    }
  })
  const b = await bp.parseBlueprint(litematic, '.litematic')
  assert.deepEqual(b.size, { x: 2, y: 11, z: 1 })
  assert.equal(b.blocks.length, 22)
  for (let i = 0; i < values.length; i++) {
    const x = i % 2
    const y = Math.floor(i / 2)
    const block = b.blocks.find((bl) => bl.x === x && bl.y === y)
    assert.equal(block.name, palette[values[i]], `bloco ${i}`)
  }

  // Estrutura (.nbt): lista explícita.
  const structure = gz({
    type: 'compound',
    name: '',
    value: {
      size: { type: 'list', value: { type: 'int', value: [1, 2, 1] } },
      palette: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            { Name: str('minecraft:oak_log'), Properties: compound({ axis: str('x') }) },
            { Name: str('minecraft:air') }
          ]
        }
      },
      blocks: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            { pos: { type: 'list', value: { type: 'int', value: [0, 0, 0] } }, state: int(0) },
            { pos: { type: 'list', value: { type: 'int', value: [0, 1, 0] } }, state: int(1) }
          ]
        }
      }
    }
  })
  const c = await bp.parseBlueprint(structure, '.nbt')
  assert.deepEqual(c.size, { x: 1, y: 2, z: 1 })
  assert.deepEqual(c.blocks.map((bl) => [bl.name, bl.properties.axis]), [['oak_log', 'x']])
  assert.deepEqual(c.air, [{ x: 0, y: 1, z: 0 }])

  await assert.rejects(() => bp.parseBlueprint(Buffer.alloc(0), '.txt'), /não suportado/)
})

test('nome de planta com caminho é recusado', () => {
  assert.equal(bp.findBlueprintFile('../package', PLANTAS), null)
  assert.equal(bp.findBlueprintFile('cabana', PLANTAS), path.join(PLANTAS, 'cabana.schem'))
})

// ---------- Ordem ----------

test('ordem de construção: camadas de baixo para cima, apoio antes e acessórios no fim', async () => {
  const cabana = await bp.loadBlueprint('cabana', { dir: PLANTAS })
  const steps = bp.buildOrder(cabana)
  assert.equal(steps.length, 99)

  const structural = steps.filter((s) => s.phase < 2)
  for (let i = 1; i < structural.length; i++) {
    assert.ok(structural[i].y >= structural[i - 1].y, 'estrutura nunca desce de camada')
  }
  // Tocha e porta só depois de toda a estrutura.
  const firstAttached = steps.findIndex((s) => s.phase === 2)
  assert.deepEqual(steps.slice(firstAttached).map((s) => s.name).sort(), ['oak_door', 'wall_torch'])
  assert.ok(steps.slice(0, firstAttached).every((s) => s.phase < 2))

  // Escada no fim da própria camada (y=1), depois dos blocos sólidos.
  const layer1 = structural.filter((s) => s.y === 1)
  assert.equal(layer1.at(-1).name, 'oak_stairs')

  // Todo bloco sólido da camada 0 tem vizinho já colocado (cresce pelo apoio).
  const placed = new Set()
  for (const s of structural) {
    const k = (x, y, z) => `${x},${y},${z}`
    const supported = s.y === 0 || placed.has(k(s.x, s.y - 1, s.z)) ||
      [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => placed.has(k(s.x + dx, s.y, s.z + dz)))
    assert.ok(supported, `${s.name} em ${s.x},${s.y},${s.z} sem apoio`)
    placed.add(k(s.x, s.y, s.z))
  }
})

// ---------- Divisão ----------

test('divisão entre construtores cobre a planta sem sobreposição e equilibra', async () => {
  const cabana = await bp.loadBlueprint('cabana', { dir: PLANTAS })
  const total = bp.buildOrder(cabana).length
  for (const n of [1, 2, 3, 5, 9]) {
    const regions = bp.splitRegions(cabana, n)
    assert.equal(regions.length, Math.min(n, 5))
    assert.equal(regions[0].from, 0)
    assert.equal(regions.at(-1).to, 4)
    for (let i = 1; i < regions.length; i++) assert.equal(regions[i].from, regions[i - 1].to + 1)
    const counts = regions.map((r) => bp.stepsForRegion(cabana, r).length)
    assert.equal(counts.reduce((a, b) => a + b, 0), total)
    assert.ok(counts.every((c) => c > 0))
  }
  const two = bp.splitRegions(cabana, 2).map((r) => bp.stepsForRegion(cabana, r).length)
  assert.ok(Math.abs(two[0] - two[1]) <= 25, `fatias equilibradas: ${two}`)

  const mats = bp.splitRegions(cabana, 2).map((r) => bp.regionMaterials(cabana, r))
  const summed = {}
  for (const m of mats) for (const [k, v] of Object.entries(m)) summed[k] = (summed[k] || 0) + v
  assert.deepEqual(summed, bp.materialList(cabana.blocks).materials)
})

// ---------- Material faltante ----------

test('detecta material faltante comparando com o inventário', async () => {
  const marco = await bp.loadBlueprint('marco', { dir: PLANTAS })
  const { materials } = bp.materialList(marco.blocks)
  assert.deepEqual(materials, { stone_bricks: 11, torch: 1 })
  const inventory = bp.inventoryCounts([
    { name: 'stone_bricks', count: 8 },
    { name: 'stone_bricks', count: 1 },
    { name: 'dirt', count: 64 }
  ])
  assert.deepEqual(bp.missingMaterials(materials, inventory), { stone_bricks: 2, torch: 1 })
  assert.deepEqual(bp.missingMaterials(materials, { stone_bricks: 20, torch: 3 }), {})
  assert.equal(bp.formatMaterials({ a: 1, b: 5 }), 'bx5, ax1')
})

// ---------- Construção com bot falso ----------

const DIR_BY_FACE = { '0,0,-1': 'north', '0,0,1': 'south', '-1,0,0': 'west', '1,0,0': 'east' }

function fakeBuilderBot({ world = {}, items = {} } = {}) {
  const inv = { ...items }
  const bot = {
    version: '1.20.1',
    yaw: 0,
    heldItem: null,
    placements: [],
    dug: [],
    entity: { position: new Vec3(100, 64, 100) },
    inventory: {
      items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count }))
    },
    pathfinder: { goto: async () => {}, setGoal: () => {}, setMovements: () => {}, bestHarvestTool: () => null },
    blockAt(pos) {
      const entry = world[pos.toString()] || { name: 'air' }
      return {
        name: entry.name,
        position: pos,
        boundingBox: ['air', 'torch', 'wall_torch', 'short_grass'].includes(entry.name) ? 'empty' : 'block',
        getProperties: () => ({ ...(entry.props || {}) })
      }
    },
    async dig(block) {
      bot.dug.push(block.name)
      world[block.position.toString()] = { name: 'air' }
    },
    async equip(item) { bot.heldItem = { name: item.name } },
    async look(yaw) { bot.yaw = yaw },
    async _placeBlockWithOptions(ref, face, options) {
      const dest = ref.position.plus(face)
      const name = bot.heldItem.name
      if (!inv[name]) throw new Error('sem item')
      inv[name]--
      bot.placements.push({ name, dest: dest.toString(), face: face.toString(), options })
      const faceKey = `${face.x},${face.y},${face.z}`
      let block = { name, props: {} }
      if (name === 'torch' && DIR_BY_FACE[faceKey]) block = { name: 'wall_torch', props: { facing: DIR_BY_FACE[faceKey] } }
      if (name.endsWith('_stairs')) {
        // Mesmo cálculo do jogo: facing = direção horizontal do olhar.
        const dx = Math.round(-Math.sin(bot.yaw))
        const dz = Math.round(-Math.cos(bot.yaw))
        block.props = { facing: DIR_BY_FACE[`${dx},0,${dz}`], half: options.half || 'bottom' }
      }
      world[dest.toString()] = block
    }
  }
  return { bot, world, inv }
}

test('construtor coloca a planta, limpa só terreno natural e relata obstruções', async () => {
  const origin = { x: 0, y: 64, z: 0 }
  const world = {}
  // Chão natural embaixo da planta.
  for (let x = -1; x <= 3; x++) for (let z = -1; z <= 3; z++) world[new Vec3(x, 63, z).toString()] = { name: 'grass_block' }
  world[new Vec3(0, 64, 0).toString()] = { name: 'dirt' } // natural onde vai bloco: quebra
  world[new Vec3(2, 65, 2).toString()] = { name: 'short_grass' } // natural onde a planta quer ar: limpa
  world[new Vec3(2, 64, 2).toString()] = { name: 'chest' } // obra de jogador: não mexe
  const { bot } = fakeBuilderBot({ world, items: { stone_bricks: 20, torch: 1 } })

  const marco = await bp.loadBlueprint('marco', { dir: PLANTAS })
  const steps = bp.buildOrder(marco)
  const report = await buildBlueprint(bot, steps, origin, { clear: marco.air, movements: false })

  assert.equal(report.total, 12)
  assert.equal(report.placed, 11)
  assert.deepEqual(report.obstructed, [{ x: 2, y: 64, z: 2, name: 'chest' }])
  assert.equal(world[new Vec3(2, 64, 2).toString()].name, 'chest')
  assert.ok(bot.dug.includes('dirt') && bot.dug.includes('short_grass'))
  assert.ok(!bot.dug.includes('chest'))
  assert.equal(world[new Vec3(1, 67, 1).toString()].name, 'torch')

  const check = verifyBlueprint(bot, steps, new Vec3(0, 64, 0))
  assert.equal(check.rightName, 11)
  assert.equal(check.wrong.length, 1)
})

test('construtor relata material faltante e não trava', async () => {
  const world = {}
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) world[new Vec3(x, 63, z).toString()] = { name: 'stone' }
  const { bot } = fakeBuilderBot({ world, items: { stone_bricks: 5 } })
  const marco = await bp.loadBlueprint('marco', { dir: PLANTAS })
  const report = await buildBlueprint(bot, bp.buildOrder(marco), { x: 0, y: 64, z: 0 }, { movements: false })
  assert.equal(report.placed, 5)
  assert.deepEqual(report.missing, { stone_bricks: 6, torch: 1 })
})

test('orientação: tocha de parede encosta na parede certa e escada olha para o lado da planta', async () => {
  assert.deepEqual(placementHint({ name: 'wall_torch', properties: { facing: 'north' } }).refs, [{ x: -0, y: -0, z: 1 }])
  const stairsHint = placementHint({ name: 'oak_stairs', properties: { facing: 'east', half: 'top' } })
  assert.deepEqual(stairsHint.look, { x: 1, y: 0, z: 0 })
  assert.equal(stairsHint.half, 'top')
  assert.deepEqual(placementHint({ name: 'furnace', properties: { facing: 'south' } }).look, { x: -0, y: -0, z: -1 })
  assert.deepEqual(placementHint({ name: 'oak_log', properties: { axis: 'x' } }).refs.map((r) => r.x), [-1, 1])

  const world = {}
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) world[new Vec3(x, 63, z).toString()] = { name: 'stone' }
  const { bot } = fakeBuilderBot({ world, items: { cobblestone: 45, oak_planks: 41, oak_log: 8, oak_door: 1, glass: 2, oak_stairs: 1, torch: 1 } })
  const cabana = await bp.loadBlueprint('cabana', { dir: PLANTAS })
  const steps = bp.buildOrder(cabana)
  const report = await buildBlueprint(bot, steps, { x: 0, y: 64, z: 0 }, { clear: cabana.air, movements: false })
  assert.equal(report.failed.length, 0)
  assert.equal(report.placed, 99)
  assert.deepEqual(world[new Vec3(2, 66, 3).toString()], { name: 'wall_torch', props: { facing: 'north' } })
  assert.equal(world[new Vec3(1, 65, 3).toString()].props.facing, 'east')
  assert.equal(report.wrongOrientation, 0)
})

// ---------- Colônia ----------

function blueprintProject() {
  const pm = new ProjectManager({ storage: { configured: () => true }, homeProvider: () => ({ x: 0, y: 64, z: 0 }) })
  return pm
}

function idleBuilder(name) {
  return { worker: { name, role: 'construtor' }, controller: { isIdle: () => true } }
}

test('projeto de planta distribui fatias e espera o material de cada uma no estoque', async () => {
  const cabana = await bp.loadBlueprint('cabana', { dir: PLANTAS })
  const regions = bp.splitRegions(cabana, 2).map((region) => ({ region, materials: bp.regionMaterials(cabana, region) }))
  const pm = blueprintProject()
  pm.startBlueprint({ name: 'cabana', origin: { x: 10.7, y: 64, z: -3.2 }, size: cabana.size, regions })

  assert.deepEqual(pm.requiredRoles(), { construtor: 2, minerador: 1, lenhador: 1, artesao: 1 })
  assert.deepEqual(pm.materialTargets(), bp.materialList(cabana.blocks).materials)
  // Pedregulho/tábuas/troncos viram metas de categoria para mineradores e lenhadores.
  assert.ok(pm.targets().building >= 45 + 41)
  assert.ok(pm.targets().wood >= 41 + 8)

  const workers = [idleBuilder('construtor_01'), idleBuilder('construtor_02')]
  assert.equal(pm.planActions(workers, { stock: {} }).length, 0, 'sem material ninguém começa')

  // Estoque só para uma fatia: a reserva impede a segunda de começar junto.
  const stock = {}
  for (const [k, v] of Object.entries(regions[0].materials)) stock[k] = v
  for (const [k, v] of Object.entries(regions[1].materials)) stock[k] = Math.max(stock[k] || 0, v)
  const planned = pm.planActions(workers, { stock })
  assert.equal(planned.length, 1)
  assert.equal(planned[0].task.type, 'construir_planta')
  assert.deepEqual(planned[0].task.origin, { x: 10, y: 64, z: -4 })
  assert.deepEqual(planned[0].task.region, regions[0].region)

  // Falha parcial: a próxima tentativa só pede o que faltou.
  pm.completeAction(planned[0].task.projectActionId, { ok: false, remaining: { torch: 1 }, missing: { torch: 1 } })
  const action = pm.active.actions.find((a) => a.id === planned[0].task.projectActionId)
  assert.equal(action.status, 'pendente')
  assert.deepEqual(action.task.materials, { torch: 1 })
  assert.match(action.lastError, /torch/)

  // Persistência: sai e volta igual.
  const saved = JSON.parse(JSON.stringify(pm.exportState()))
  const restored = blueprintProject()
  assert.equal(restored.restore(saved), true)
  assert.equal(restored.active.type, 'planta')
  assert.deepEqual(restored.active.actions.map((a) => a.task.materials), pm.active.actions.map((a) => a.task.materials))
  assert.deepEqual(restored.requiredRoles(), pm.requiredRoles())

  // Conclui quando todas as fatias terminam, mesmo com metas de estoque abertas.
  for (const a of restored.active.actions) {
    a.status = 'executando'
    restored.completeAction(a.id, { ok: true })
  }
  assert.equal(restored.maybeComplete({ deficits: { building: 99 } }), true)
})

test('planejador de demanda manda os papéis buscarem o material específico da planta', () => {
  const planner = new DemandPlanner({ targets: { food: 0, wood: 0, fuel: 0, ironTotal: 0, ironIngot: 0, building: 0, ironPickaxe: 0, ironAxe: 0, ironSword: 0 } })
  const idle = (name, role) => ({ worker: { name, role }, controller: { isIdle: () => true } })
  const { plan, report } = planner.buildPlan(
    [idle('m', 'minerador'), idle('l', 'lenhador'), idle('a', 'artesao')],
    { glass: 1 },
    {},
    { glass: 3, spruce_log: 4, sand: 2 }
  )
  const byRole = Object.fromEntries(plan.map((p) => [p.worker.role, p.task]))
  assert.deepEqual(report.materialDeficits, { glass: 2, spruce_log: 4, sand: 2 })
  assert.deepEqual(byRole.minerador, { type: 'coletar_blocos', resource: 'sand', count: 2, reason: 'planta_sand' })
  assert.deepEqual(byRole.lenhador, { type: 'coletar_blocos', resource: 'spruce_log', count: 4, reason: 'planta_spruce_log' })
  assert.deepEqual(byRole.artesao, { type: 'fabricar', item: 'glass', count: 2, reason: 'planta_glass' })
})
