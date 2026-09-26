// plantas/gerar.js
// Gera as plantas de exemplo em formato Sponge .schem (v2) para 1.20.1.
// Uso: node plantas/gerar.js
// Os arquivos são pequenos de propósito: servem de teste e de modelo.

const fs = require('fs')
const path = require('path')
const { Vec3 } = require('vec3')
const { Schematic } = require('prismarine-schematic')

const VERSION = '1.20.1'
const Block = require('prismarine-block')(VERSION)

// Monta a planta a partir de uma função (x, y, z) -> [nome, propriedades] | null (ar).
async function makeSchem(size, fill) {
  const palette = [Block.fromProperties('air', {}, 0).stateId]
  const blocks = []
  for (let y = 0; y < size.y; y++) {
    for (let z = 0; z < size.z; z++) {
      for (let x = 0; x < size.x; x++) {
        const entry = fill(x, y, z)
        const stateId = entry ? Block.fromProperties(entry[0], entry[1] || {}, 0).stateId : palette[0]
        let index = palette.indexOf(stateId)
        if (index === -1) {
          index = palette.length
          palette.push(stateId)
        }
        blocks.push(index)
      }
    }
  }
  const schem = new Schematic(VERSION, new Vec3(size.x, size.y, size.z), new Vec3(0, 0, 0), palette, blocks)
  return schem.write()
}

// Marco 3x4x3: base de tijolos de pedra, coluna de 2 e uma tocha no topo.
function marco(x, y, z) {
  if (y === 0) return ['stone_bricks']
  if (x === 1 && z === 1 && y <= 2) return ['stone_bricks']
  if (x === 1 && z === 1 && y === 3) return ['torch']
  return null
}

// Cabana 5x5x5: piso de pedregulho, paredes com cantos de tronco, porta ao norte,
// janelas de vidro, banco de escada, tocha na parede e teto de tábuas.
function cabana(x, y, z) {
  const edge = x === 0 || x === 4 || z === 0 || z === 4
  const corner = (x === 0 || x === 4) && (z === 0 || z === 4)
  if (y === 0) return ['cobblestone']
  if (y === 4) return ['oak_planks']
  if (y === 3) return edge ? ['oak_planks'] : null
  if (corner) return ['oak_log', { axis: 'y' }]
  if (x === 2 && z === 0) {
    return ['oak_door', { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left', open: 'false', powered: 'false' }]
  }
  if (y === 2 && (x === 0 || x === 4) && z === 2) return ['glass']
  if (edge) return ['cobblestone']
  if (x === 1 && y === 1 && z === 3) return ['oak_stairs', { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false' }]
  if (x === 2 && y === 2 && z === 3) return ['wall_torch', { facing: 'north' }]
  return null
}

async function main() {
  const dir = __dirname
  fs.writeFileSync(path.join(dir, 'marco.schem'), await makeSchem({ x: 3, y: 4, z: 3 }, marco))
  fs.writeFileSync(path.join(dir, 'cabana.schem'), await makeSchem({ x: 5, y: 5, z: 5 }, cabana))
  console.log('Plantas geradas em', dir)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
