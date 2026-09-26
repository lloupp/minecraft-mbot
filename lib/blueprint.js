// lib/blueprint.js
// Plantas de construção (.schem / .schematic / .litematic / .nbt): leitura,
// lista de materiais, ordem de construção e divisão entre construtores.
// Só dados: quem coloca os blocos no mundo é lib/blueprintBuilder.js.

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const nbt = require('prismarine-nbt')

const DEFAULT_DIR = path.join(__dirname, '..', 'plantas')
const DEFAULT_VERSION = '1.20.1'
const EXTENSIONS = ['.schem', '.litematic', '.schematic', '.nbt']

// Não viram passo de construção nem material.
const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void'])
// Não dá para colocar com um item na mão (ou não vale a pena): relatados à parte.
const UNPLACEABLE = new Set([
  'water', 'lava', 'bubble_column', 'fire', 'soul_fire', 'nether_portal',
  'end_portal', 'end_gateway', 'piston_head', 'moving_piston', 'frosted_ice',
  'farmland', 'dirt_path', 'barrier', 'light', 'structure_block', 'jigsaw',
  'command_block', 'chain_command_block', 'repeating_command_block', 'spawner',
  'kelp_plant', 'tall_seagrass'
])

// Bloco -> item que o coloca, quando os nomes diferem.
const BLOCK_ITEM = {
  redstone_wire: 'redstone',
  tripwire: 'string',
  wheat: 'wheat_seeds',
  carrots: 'carrot',
  potatoes: 'potato',
  beetroots: 'beetroot_seeds',
  cocoa: 'cocoa_beans',
  pumpkin_stem: 'pumpkin_seeds',
  attached_pumpkin_stem: 'pumpkin_seeds',
  melon_stem: 'melon_seeds',
  attached_melon_stem: 'melon_seeds',
  sweet_berry_bush: 'sweet_berries',
  bamboo_sapling: 'bamboo',
  cave_vines: 'glow_berries',
  cave_vines_plant: 'glow_berries',
  twisting_vines_plant: 'twisting_vines',
  weeping_vines_plant: 'weeping_vines',
  powder_snow: 'powder_snow_bucket',
  tall_seagrass: 'seagrass'
}

// Terreno natural: pode ser quebrado para abrir espaço para a planta.
// Qualquer outra coisa pode ser obra de jogador e fica intocada.
const GROUND = [
  'dirt', 'grass_block', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'mud',
  'stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'calcite',
  'sand', 'red_sand', 'gravel', 'clay', 'snow_block', 'ice', 'moss_block'
]
// Plantas e cobertura do chão: naturais e, numa planta, dependem do bloco de baixo.
const PLANTS = new Set([
  'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
  'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
  'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pink_petals',
  'torchflower', 'vine', 'seagrass', 'tall_seagrass', 'moss_carpet',
  'sweet_berry_bush', 'brown_mushroom', 'red_mushroom', 'glow_lichen', 'hanging_roots'
])
const NATURAL_TERRAIN = new Set([...GROUND, ...PLANTS])

function isNaturalTerrain(name) {
  return NATURAL_TERRAIN.has(name) || /_leaves$/.test(name)
}

// ---------- Leitura ----------

// "minecraft:oak_stairs[facing=north,half=bottom]" -> { name, properties }
function parseStateString(str) {
  const text = String(str || '')
  const open = text.indexOf('[')
  const rawName = open === -1 ? text : text.slice(0, open)
  const properties = {}
  if (open !== -1) {
    for (const pair of text.slice(open + 1, text.lastIndexOf(']')).split(',')) {
      const [key, value] = pair.split('=')
      if (key) properties[key.trim()] = String(value ?? '').trim()
    }
  }
  return { name: rawName.replace(/^minecraft:/, ''), properties }
}

function propsFromNbt(props) {
  const out = {}
  for (const [key, value] of Object.entries(props || {})) out[key] = String(value)
  return out
}

function varints(bytes) {
  const out = []
  let i = 0
  while (i < bytes.length) {
    let value = 0
    let shift = 0
    let byte
    do {
      byte = bytes[i++] & 0xff
      value |= (byte & 0x7f) << shift
      shift += 7
    } while (byte & 0x80)
    out.push(value)
  }
  return out
}

// prismarine-nbt simplifica long como [alto, baixo] (int32 com sinal).
function toUnsignedLong(value) {
  if (typeof value === 'bigint') return BigInt.asUintN(64, value)
  const [hi, lo] = value
  return BigInt.asUintN(64, (BigInt(hi) << 32n) | BigInt(lo >>> 0))
}

// Sponge v3: tudo dentro de "Schematic", blocos em Blocks.{Palette,Data}.
function readSpongeV3(data) {
  const s = data.Schematic || data
  const size = { x: s.Width, y: s.Height, z: s.Length }
  const palette = []
  for (const [state, id] of Object.entries(s.Blocks.Palette)) palette[id] = parseStateString(state)
  const ids = varints(s.Blocks.Data)
  const blocks = []
  ids.forEach((id, index) => {
    const x = index % size.x
    const z = Math.floor(index / size.x) % size.z
    const y = Math.floor(index / (size.x * size.z))
    blocks.push({ x, y, z, ...palette[id] })
  })
  return { size, blocks }
}

// Sponge v2 e MCEdit legado: prismarine-schematic converte para estados da versão alvo.
async function readWithPrismarine(buffer, version) {
  const { Schematic } = require('prismarine-schematic')
  const schematic = await Schematic.read(buffer, version)
  const { x: sx, y: sy, z: sz } = schematic.size
  const byState = new Map()
  const blocks = []
  schematic.blocks.forEach((paletteIndex, index) => {
    const stateId = schematic.palette[paletteIndex]
    if (!byState.has(stateId)) {
      const block = schematic.Block.fromStateId(stateId, 0)
      byState.set(stateId, { name: block.name, properties: propsFromNbt(block.getProperties()) })
    }
    const x = index % sx
    const z = Math.floor(index / sx) % sz
    const y = Math.floor(index / (sx * sz))
    blocks.push({ x, y, z, ...byState.get(stateId) })
  })
  return { size: { x: sx, y: sy, z: sz }, blocks }
}

// .litematic (Litematica): regiões com paleta e índices empacotados em longs,
// que podem atravessar de um long para o próximo.
function readLitematic(data) {
  const regions = Object.values(data.Regions || {})
  if (!regions.length) throw new Error('litematic sem regiões')
  const raw = []
  for (const region of regions) {
    const size = { x: region.Size.x, y: region.Size.y, z: region.Size.z }
    const abs = { x: Math.abs(size.x), y: Math.abs(size.y), z: Math.abs(size.z) }
    // Tamanho negativo: a região cresce para o lado negativo a partir de Position.
    const min = {
      x: region.Position.x + (size.x < 0 ? size.x + 1 : 0),
      y: region.Position.y + (size.y < 0 ? size.y + 1 : 0),
      z: region.Position.z + (size.z < 0 ? size.z + 1 : 0)
    }
    const palette = region.BlockStatePalette.map((entry) => ({
      name: String(entry.Name).replace(/^minecraft:/, ''),
      properties: propsFromNbt(entry.Properties)
    }))
    const bits = BigInt(Math.max(2, Math.ceil(Math.log2(palette.length))))
    const mask = (1n << bits) - 1n
    const longs = region.BlockStates.map(toUnsignedLong)
    const volume = abs.x * abs.y * abs.z
    for (let index = 0; index < volume; index++) {
      const start = BigInt(index) * bits
      const word = Number(start >> 6n)
      const offset = start & 63n
      let value = longs[word] >> offset
      if (offset + bits > 64n) value |= longs[word + 1] << (64n - offset)
      const entry = palette[Number(value & mask)]
      const x = index % abs.x
      const z = Math.floor(index / abs.x) % abs.z
      const y = Math.floor(index / (abs.x * abs.z))
      raw.push({ x: min.x + x, y: min.y + y, z: min.z + z, ...entry })
    }
  }
  return normalizeOrigin(raw)
}

// Estrutura do jogo (structure block, .nbt): lista explícita de blocos.
function readStructure(data) {
  const paletteRaw = data.palette || data.palettes?.[0]
  if (!paletteRaw || !data.blocks) throw new Error('arquivo .nbt não é uma estrutura')
  const palette = paletteRaw.map((entry) => ({
    name: String(entry.Name).replace(/^minecraft:/, ''),
    properties: propsFromNbt(entry.Properties)
  }))
  const blocks = data.blocks.map((entry) => ({
    x: entry.pos[0], y: entry.pos[1], z: entry.pos[2], ...palette[entry.state]
  }))
  return { size: { x: data.size[0], y: data.size[1], z: data.size[2] }, blocks }
}

// Leva o menor canto para (0,0,0) e calcula o tamanho.
function normalizeOrigin(blocks) {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const b of blocks) {
    for (const axis of ['x', 'y', 'z']) {
      min[axis] = Math.min(min[axis], b[axis])
      max[axis] = Math.max(max[axis], b[axis])
    }
  }
  if (!blocks.length) return { size: { x: 0, y: 0, z: 0 }, blocks: [] }
  return {
    size: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 },
    blocks: blocks.map((b) => ({ ...b, x: b.x - min.x, y: b.y - min.y, z: b.z - min.z }))
  }
}

async function parseNbtBuffer(buffer) {
  // prismarine-nbt descompacta gzip sozinho; .nbt de estrutura às vezes vem sem gzip.
  const { parsed } = await nbt.parse(buffer)
  return nbt.simplify(parsed)
}

// Lê a planta a partir do conteúdo do arquivo. `format` é a extensão (".schem"...).
async function parseBlueprint(buffer, format, { name = 'planta', version = DEFAULT_VERSION } = {}) {
  const ext = String(format || '').toLowerCase()
  let result
  if (ext === '.schem' || ext === '.schematic') {
    const data = await parseNbtBuffer(buffer)
    result = data.Schematic || data.Blocks?.Palette
      ? readSpongeV3(data)
      : await readWithPrismarine(buffer, version)
  } else if (ext === '.litematic') {
    result = readLitematic(await parseNbtBuffer(buffer))
  } else if (ext === '.nbt') {
    result = readStructure(await parseNbtBuffer(buffer))
  } else {
    throw new Error(`formato de planta não suportado: ${format}`)
  }

  const blocks = result.blocks.filter((b) => b.name && !AIR.has(b.name))
  // Ar explícito da planta (não structure_void): posições a desocupar antes de construir.
  const air = result.blocks
    .filter((b) => b.name && AIR.has(b.name) && b.name !== 'structure_void')
    .map(({ x, y, z }) => ({ x, y, z }))
  return { name, format: ext, size: result.size, blocks, air }
}

function listBlueprints(dir = DEFAULT_DIR) {
  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }
  return files
    .filter((file) => EXTENSIONS.includes(path.extname(file).toLowerCase()))
    .map((file) => ({ name: path.basename(file, path.extname(file)).toLowerCase(), file: path.join(dir, file) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function findBlueprintFile(name, dir = DEFAULT_DIR) {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return null
  if (/[\\/]/.test(wanted) || wanted.includes('..')) return null
  return listBlueprints(dir).find((entry) => entry.name === wanted)?.file || null
}

const cache = new Map()

async function loadBlueprint(name, { dir = DEFAULT_DIR, version = DEFAULT_VERSION } = {}) {
  const file = findBlueprintFile(name, dir)
  if (!file) throw new Error(`planta não encontrada: ${name}`)
  const mtime = fs.statSync(file).mtimeMs
  const key = `${file}|${version}`
  const cached = cache.get(key)
  if (cached && cached.mtime === mtime) return cached.blueprint
  const buffer = fs.readFileSync(file)
  const blueprint = await parseBlueprint(buffer, path.extname(file), {
    name: path.basename(file, path.extname(file)).toLowerCase(),
    version
  })
  cache.set(key, { mtime, blueprint })
  return blueprint
}

// ---------- Materiais ----------

// Metade de cima de porta/planta alta e cabeceira da cama nascem sozinhas.
function isSecondaryPart(block) {
  const p = block.properties || {}
  return p.half === 'upper' || p.part === 'head' || block.name === 'piston_head'
}

function itemForBlock(name) {
  if (BLOCK_ITEM[name]) return BLOCK_ITEM[name]
  if (name.includes('_wall_')) return name.replace('_wall_', '_') // wall_torch não passa aqui
  if (name === 'wall_torch') return 'torch'
  if (name.startsWith('potted_')) return 'flower_pot'
  return name
}

function itemCountForBlock(block) {
  const p = block.properties || {}
  if (/_slab$/.test(block.name) && p.type === 'double') return 2
  if (p.candles) return Number(p.candles) || 1
  if (block.name === 'snow' && p.layers) return Number(p.layers) || 1
  if (p.pickles) return Number(p.pickles) || 1
  if (p.eggs) return Number(p.eggs) || 1
  return 1
}

// Materiais necessários (item -> quantidade) e o que não dá para colocar.
function materialList(blocks) {
  const materials = {}
  const ignored = {}
  for (const block of blocks) {
    if (AIR.has(block.name) || isSecondaryPart(block)) continue
    if (UNPLACEABLE.has(block.name)) {
      ignored[block.name] = (ignored[block.name] || 0) + 1
      continue
    }
    const item = itemForBlock(block.name)
    materials[item] = (materials[item] || 0) + itemCountForBlock(block)
  }
  return { materials, ignored }
}

function inventoryCounts(items) {
  const counts = {}
  for (const item of items || []) {
    if (item?.name) counts[item.name] = (counts[item.name] || 0) + (item.count || 0)
  }
  return counts
}

// O que falta: necessário - disponível (só itens com falta).
function missingMaterials(needed, available = {}) {
  const missing = {}
  for (const [name, count] of Object.entries(needed || {})) {
    const lack = Number(count || 0) - Number(available[name] || 0)
    if (lack > 0) missing[name] = lack
  }
  return missing
}

function formatMaterials(materials, limit = 8) {
  const entries = Object.entries(materials || {}).sort((a, b) => b[1] - a[1])
  const text = entries.slice(0, limit).map(([name, count]) => `${name}x${count}`).join(', ')
  return entries.length > limit ? `${text} e mais ${entries.length - limit}` : text
}

// ---------- Ordem de construção ----------

// Dependem de um bloco vizinho para existir: ficam para o fim, depois da estrutura.
const ATTACHED = /(torch|lantern|_door$|^ladder$|_sign$|_banner$|_button$|^lever$|_carpet$|rail$|_pressure_plate$|^redstone_wire$|^repeater$|^comparator$|_sapling$|^vine$|_bed$|^flower_pot$|^potted_|_trapdoor$|tripwire|^cocoa$|candle|_head$|_skull$|^snow$|_fan$|^lily_pad$|^chain$|^bell$|amethyst_(bud|cluster)$|^(wheat|carrots|potatoes|beetroots)$)/
// Têm formato/orientação: no fim da camada, com as paredes já de pé.
const SHAPED = /(_stairs$|_slab$|_fence$|_fence_gate$|_wall$|_pane$|^iron_bars$)/

function isAttached(name) {
  return ATTACHED.test(name) || PLANTS.has(name)
}

function blockPhase(name) {
  if (isAttached(name)) return 2
  if (SHAPED.test(name)) return 1
  return 0
}

const key = (x, y, z) => `${x},${y},${z}`

// Dentro de uma camada: começa pelos blocos apoiados (chão ou bloco da planta
// embaixo) e cresce pelos vizinhos, para cada bloco ter onde encostar.
function orderLayer(layer, placed) {
  const pending = new Map(layer.map((b) => [key(b.x, b.y, b.z), b]))
  const out = []
  const queue = []
  for (const b of layer) {
    if (b.y === 0 || placed.has(key(b.x, b.y - 1, b.z))) queue.push(b)
  }
  const sideways = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const take = (b) => {
    const k = key(b.x, b.y, b.z)
    if (!pending.has(k)) return
    pending.delete(k)
    out.push(b)
    placed.add(k)
    for (const [dx, dz] of sideways) {
      const next = pending.get(key(b.x + dx, b.y, b.z + dz))
      if (next) queue.push(next)
    }
  }
  while (queue.length || pending.size) {
    // Sem apoio conhecido (beiral, blocos pendurados): segue na ordem original.
    const b = queue.length ? queue.shift() : pending.values().next().value
    take(b)
  }
  return out
}

// Passos de construção: estrutura e blocos de formato camada a camada (y
// crescente) e, por último, os que dependem de apoio (tochas, portas, escadas de mão...).
function buildOrder(blueprint) {
  const steps = []
  const deferred = []
  const byLayer = new Map()
  for (const block of blueprint.blocks) {
    if (AIR.has(block.name) || isSecondaryPart(block) || UNPLACEABLE.has(block.name)) continue
    const step = { ...block, item: itemForBlock(block.name), phase: blockPhase(block.name) }
    if (step.phase === 2) {
      deferred.push(step)
      continue
    }
    if (!byLayer.has(block.y)) byLayer.set(block.y, [])
    byLayer.get(block.y).push(step)
  }

  const placed = new Set()
  for (const y of [...byLayer.keys()].sort((a, b) => a - b)) {
    const layer = byLayer.get(y)
    // Sólidos primeiro; escadas/lajes/cercas no fim da camada.
    steps.push(...orderLayer(layer.filter((b) => b.phase === 0), placed))
    steps.push(...orderLayer(layer.filter((b) => b.phase === 1), placed))
  }
  deferred.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
  steps.push(...deferred)
  return steps
}

// ---------- Divisão entre construtores ----------

// Fatias contíguas no eixo horizontal mais comprido, equilibradas por número de
// blocos: cada construtor ergue a sua fatia de baixo para cima sem esperar os outros.
function splitRegions(blueprint, count) {
  const axis = blueprint.size.x >= blueprint.size.z ? 'x' : 'z'
  const length = blueprint.size[axis]
  const wanted = Math.max(1, Math.min(Number(count) || 1, length))
  const perColumn = new Array(length).fill(0)
  for (const step of buildOrder(blueprint)) perColumn[step[axis]]++
  const total = perColumn.reduce((a, b) => a + b, 0)

  const regions = []
  let from = 0
  let acc = 0
  for (let i = 0; i < length; i++) {
    acc += perColumn[i]
    const remainingRegions = wanted - regions.length
    const remainingColumns = length - i - 1
    const share = total * (regions.length + 1) / wanted
    // Fecha a fatia ao atingir sua cota, mas deixa ao menos uma coluna por fatia restante.
    if (remainingRegions > 1 && (acc >= share || remainingColumns < remainingRegions)) {
      regions.push({ axis, from, to: i })
      from = i + 1
    }
  }
  regions.push({ axis, from, to: length - 1 })
  return regions.filter((r) => r.from <= r.to)
}

function inRegion(block, region) {
  if (!region) return true
  const v = block[region.axis]
  return v >= region.from && v <= region.to
}

function stepsForRegion(blueprint, region) {
  return buildOrder(blueprint).filter((step) => inRegion(step, region))
}

function clearForRegion(blueprint, region) {
  return (blueprint.air || []).filter((pos) => inRegion(pos, region))
}

function regionMaterials(blueprint, region) {
  return materialList(blueprint.blocks.filter((b) => inRegion(b, region))).materials
}

function summarize(blueprint) {
  const { materials, ignored } = materialList(blueprint.blocks)
  return {
    name: blueprint.name,
    size: { ...blueprint.size },
    blocks: buildOrder(blueprint).length,
    materials,
    ignored
  }
}

module.exports = {
  DEFAULT_DIR,
  DEFAULT_VERSION,
  EXTENSIONS,
  NATURAL_TERRAIN,
  isNaturalTerrain,
  parseStateString,
  parseBlueprint,
  listBlueprints,
  findBlueprintFile,
  loadBlueprint,
  isSecondaryPart,
  itemForBlock,
  materialList,
  inventoryCounts,
  missingMaterials,
  formatMaterials,
  blockPhase,
  buildOrder,
  splitRegions,
  inRegion,
  stepsForRegion,
  clearForRegion,
  regionMaterials,
  summarize
}
