'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { PriorityCollection } = require('../core/PriorityCollection')
const { mineralResourcesFor, resolveBlockNames, isMineralGroup } = require('../core/resources')

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
}
function mockWorker(name, opts = {}) {
  const bot = { entity: {}, registry: { blocksByName: {
    iron_ore: { id: 1 }, deepslate_iron_ore: { id: 2 },
    diamond_ore: { id: 3 }, deepslate_diamond_ore: { id: 4 },
    coal_ore: { id: 5 }, nether_quartz_ore: { id: 6 },
    ancient_debris: { id: 7 }, custom_ore: { id: 8 }
  } }, game: { dimension: 'overworld' }, ...opts.bot }
  const controller = {
    bot, state: 'ocioso', currentTask: null, taskVersion: 0,
    isIdle() { return this.state === 'ocioso' && !this.activeTaskPromise },
    cancel() { this.taskVersion++; this.state = 'ocioso'; this.currentTask = null },
    async run(task, { canStart } = {}) {
      if (canStart && !canStart()) return { ok: false, cancelled: true, code: 'CANCELLED' }
      this.state = 'trabalhando'
      this.currentTask = task
      this.taskVersion++
      this.activeTaskPromise = Promise.resolve(opts.result ? opts.result(task) : { ok: true, gathered: task.count })
      try { return await this.activeTaskPromise } finally {
        this.currentTask = null
        this.state = 'ocioso'
        this.activeTaskPromise = null
      }
    }
  }
  return { worker: { name, role: 'minerador' }, controller }
}

test('resolve todos os minérios vanilla e variantes deepslate / Nether / modpack', () => {
  const { controller } = mockWorker('m')
  assert.deepEqual(resolveBlockNames(controller.bot, 'ferro'), ['iron_ore', 'deepslate_iron_ore'])
  assert.deepEqual(resolveBlockNames(controller.bot, 'diamante'), ['diamond_ore', 'deepslate_diamond_ore'])
  assert.deepEqual(resolveBlockNames(controller.bot, 'quartzo'), ['nether_quartz_ore'])
  assert.deepEqual(resolveBlockNames(controller.bot, 'detritos ancestrais'), ['ancient_debris'])
  assert.equal(isMineralGroup('minérios'), true)
  const normal = mineralResourcesFor(controller.bot)
  assert(normal.includes('ferro'))
  assert(normal.includes('diamante'))
  assert(normal.includes('custom_ore'))
  assert(!normal.includes('quartzo'))
  controller.bot.game.dimension = 'minecraft:the_nether'
  assert(mineralResourcesFor(controller.bot).includes('quartzo'))
  assert(mineralResourcesFor(controller.bot).includes('detritos_ancestrais'))
  assert(!mineralResourcesFor(controller.bot).includes('diamante'))
})

test('prioridade distribui a coleta confirmada entre os auxiliares, sem estimar inventário', async () => {
  const workers = [mockWorker('a'), mockWorker('b'), mockWorker('c')]
  const priority = new PriorityCollection({ controllers: () => workers })
  const start = priority.start('ferro', 30)
  assert.equal(start.target, 30)
  await flush()
  assert.equal(priority.status().status, 'concluida')
  assert.equal(priority.status().gathered, 30)
  assert.equal(priority.status().remaining, 0)
})

test('fila permite reordenar, remover e restaurar com estado salvo', async () => {
  const priority = new PriorityCollection({ controllers: () => [] })
  priority.pause()
  const a = priority.enqueue('diamante', 7)
  const b = priority.enqueue('ferro', 19)
  const c = priority.enqueue('minerais', 11)
  priority.move(c.id, 0)
  priority.remove(b.id)
  assert.deepEqual(priority.queueState().pending.map(x => x.resource), ['minerais', 'diamante'])
  const stored = priority.exportState()
  const restored = new PriorityCollection({ controllers: () => [] })
  restored.restore(stored)
  assert.equal(restored.queueState().paused, true)
  assert.deepEqual(restored.queueState().pending.map(x => x.id), [c.id, a.id])
  assert.throws(() => restored.enqueue('ouro', -5), /quantidade/)
  assert.throws(() => restored.move(a.id, 42), /posição/)
})

test('fila executa uma tarefa por vez e libera a próxima após confirmação', async () => {
  const workers = [mockWorker('a')]
  const priority = new PriorityCollection({ controllers: () => workers })
  priority.pause()
  priority.enqueue('ferro', 4)
  priority.enqueue('diamante', 3)
  priority.resume()
  await flush()
  assert.equal(priority.queueState().pending.length, 0)
  assert.equal(priority.status().resource, 'diamante')
  assert.equal(priority.status().gathered, 3)
  assert.equal(priority.status().status, 'concluida')
})

test('cancelamento físico em andamento não conta como sucesso', async () => {
  const workers = [mockWorker('a', { result: () => ({ ok: false, code: 'CANCELLED', cancelled: true, gathered: 0 }) })]
  const priority = new PriorityCollection({ controllers: () => workers })
  priority.start('ferro', 2)
  await flush()
  assert.equal(priority.status().gathered, 0)
  assert.equal(priority.status().blocked.length, 0)
  priority.stop()
  assert.equal(priority.status().status, 'cancelada')
})

test('tarefa sem drain físico não sofre preempção insegura', async () => {
  const active = mockWorker('a')
  active.controller.state = 'trabalhando'
  active.controller.currentTask = { type: 'fabricar' }
  let canceled = 0
  active.controller.cancel = () => { canceled++ }
  const priority = new PriorityCollection({ controllers: () => [active] })
  priority.start('ferro', 8)
  await flush()
  assert.equal(canceled, 0)
  assert.equal(priority.status().gathered, 0)
  priority.stop()
})
