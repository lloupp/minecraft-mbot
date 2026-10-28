const test = require('node:test')
const assert = require('node:assert/strict')
const { WorkerController } = require('../core/WorkerController')

const home = { x: 0, y: 64, z: 0 }
function workerWithTerrain(blockAt) {
  const worker = Object.create(WorkerController.prototype)
  worker.homeProvider = () => home
  worker.bot = { blockAt }
  return worker
}
const flat = (p) => p.y <= 63
  ? { name: 'stone', boundingBox: 'block' }
  : { name: 'air', boundingBox: 'empty' }

test('anel 9x9 possui 32 células: 31 cercas e 1 portão', () => {
  const worker = workerWithTerrain(flat)
  const plan = worker.baseFencePlan(home, 4)
  assert.equal(plan.size, 9)
  assert.equal(plan.fenceCount, 31)
  assert.equal(plan.gateCount, 1)
  assert.equal(new Set([...plan.fences, plan.gate].map((p) => `${p.x},${p.z}`)).size, 32)
})

test('não tenta construir anel com uma célula de chão ausente', () => {
  const worker = workerWithTerrain((p) => p.x === 4 && p.z === 4
    ? { name: 'air', boundingBox: 'empty' } : flat(p))
  assert.throws(() => worker.baseFencePlan(home, 4), /perímetro da base incompleto/)
})

test('declividade que abre buraco impede aprovação falsa', () => {
  const worker = workerWithTerrain((p) => p.x === 4 && p.z === 4 && p.y === 64
    ? { name: 'stone', boundingBox: 'block' } : flat(p))
  assert.throws(() => worker.baseFencePlan(home, 4), /alturas diferentes/)
})

test('retorno de placeGroundItem sem observação no mundo não aprova cerca', async () => {
  const worker = workerWithTerrain(flat)
  worker.ensurePenKit = async () => ({ fence: 'oak_fence', gate: 'oak_fence_gate' })
  worker.placeGroundItem = async () => true
  worker.placePenGate = async () => true
  const result = await worker.buildBaseFence(() => false, 4)
  assert.equal(result.ok, false)
  assert.equal(result.fencesPlaced, 31)
  assert.equal(result.fencesVerified, 0)
  assert.equal(result.gateVerified, false)
})
