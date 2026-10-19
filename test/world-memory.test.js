const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { WorldMemory, STATUS } = require('../lib/world-memory')

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-')), 'world-memory.json')
}
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms } }
  return c
}
const HOUR = 3600 * 1000

test('persiste e recarrega places, cobertura e métricas', async () => {
  const file = tmpFile()
  const a = new WorldMemory({ file })
  a.discover('wood', 'overworld', { x: 40, y: 70, z: -20 }, { count: 6, by: 'lenhador_01' })
  a.discover('crafting_table', 'minecraft:overworld', { x: 5, y: 70, z: 5 })
  a.visit('overworld', { x: 40, y: 70, z: -20 })
  await a.flush()
  const b = new WorldMemory({ file }).load()
  assert.equal(b.loadStatus, 'loaded')
  assert.equal(b.places.size, 2)
  assert.equal(b.find('crafting_table', 'overworld', { x: 5, y: 70, z: 5 }).status, STATUS.CONFIRMED)
  assert.equal(b.exploredRecently('overworld', { x: 41, y: 70, z: -19 }), true)
  assert.equal(b.metrics.created, 2)
})

test('arquivo inexistente, vazio ou corrompido não derruba e preserva a evidência', () => {
  const missing = new WorldMemory({ file: tmpFile() }).load()
  assert.equal(missing.loadStatus, 'missing')
  assert.equal(missing.places.size, 0)

  const file = tmpFile()
  fs.writeFileSync(file, '{"version":1,"places":[{"kind":"wood"')
  const corrupt = new WorldMemory({ file }).load()
  assert.equal(corrupt.loadStatus, 'corrupt')
  assert.equal(corrupt.places.size, 0)
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('.corrupt-')))
})

test('entradas inválidas são descartadas individualmente; campos desconhecidos viram extra', () => {
  const file = tmpFile()
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    places: [{ kind: 'wood', dim: 'overworld', x: 1, y: 2, z: 3, status: 'CONFIRMED' }, { kind: 'wood', x: 'abc' }, null],
    explored: [['overworld|0,0', 5, 2], ['bad']],
    extra: { futuro: true }
  }))
  const wm = new WorldMemory({ file }).load()
  assert.equal(wm.places.size, 1)
  assert.equal(wm.explored.size, 1)
  assert.match(wm.loadStatus, /dropped/)
  assert.deepEqual(wm.extra, { futuro: true })
})

test('versão futura: somente leitura, arquivo nunca sobrescrito', async () => {
  const file = tmpFile()
  const original = JSON.stringify({ version: 99, places: [], novo: 'formato' })
  fs.writeFileSync(file, original)
  const wm = new WorldMemory({ file }).load()
  assert.equal(wm.readOnly, true)
  wm.discover('wood', 'overworld', { x: 1, y: 1, z: 1 })
  await wm.flush()
  wm.flushSync()
  assert.equal(fs.readFileSync(file, 'utf8'), original)
})

test('dimensões não se misturam', () => {
  const wm = new WorldMemory()
  wm.discover('crafting_table', 'overworld', { x: 10, y: 64, z: 10 })
  wm.discover('crafting_table', 'the_nether', { x: 10, y: 64, z: 10 })
  assert.equal(wm.places.size, 2)
  assert.equal(wm.suggest('crafting_table', 'overworld', { x: 0, y: 64, z: 0 }).length, 1)
  assert.equal(wm.suggest('crafting_table', 'the_end', { x: 0, y: 64, z: 0 }).length, 0)
  wm.visit('overworld', { x: 0, y: 64, z: 0 })
  assert.equal(wm.exploredRecently('the_nether', { x: 0, y: 64, z: 0 }), false)
})

test('deduplicação: mesmo bloco ou mesmo chunk de recurso vira um registro', () => {
  const wm = new WorldMemory()
  wm.discover('crafting_table', 'overworld', { x: 10.7, y: 64, z: 10.2 })
  wm.discover('crafting_table', 'overworld', { x: 10, y: 64, z: 10 })
  wm.discover('wood', 'overworld', { x: 33, y: 70, z: 1 }, { count: 3 })
  wm.discover('wood', 'overworld', { x: 40, y: 71, z: 9 }, { count: 7 })
  assert.equal(wm.places.size, 2)
  const wood = [...wm.places.values()].find((p) => p.kind === 'wood')
  assert.equal(wood.count, 7)
  assert.deepEqual([wood.x, wood.y, wood.z], [40, 71, 9]) // âncora = amostra mais recente
})

test('validade: CONFIRMED envelhece para STALE, ainda serve como hipótese de menor prioridade', () => {
  const c = clock()
  const wm = new WorldMemory({ now: c.now })
  wm.discover('wood', 'overworld', { x: 100, y: 70, z: 0 })
  wm.discover('wood', 'overworld', { x: 20, y: 70, z: 0 })
  c.advance(3 * HOUR)
  wm.discover('wood', 'overworld', { x: 100, y: 70, z: 0 }) // renovado
  const near = wm.find('wood', 'overworld', { x: 20, y: 70, z: 0 })
  assert.equal(wm.effectiveStatus(near), STATUS.STALE)
  const s = wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 })
  assert.equal(s[0].place.x, 100) // CONFIRMED vence STALE mesmo mais longe
  assert.equal(s[1].status, STATUS.STALE)
})

test('invalidação remove das sugestões e re-observação restaura', () => {
  const wm = new WorldMemory()
  const table = wm.discover('crafting_table', 'overworld', { x: 3, y: 64, z: 3 })
  wm.invalidate(table.key, 'air')
  assert.equal(wm.suggest('crafting_table', 'overworld', { x: 0, y: 64, z: 0 }).length, 0)
  assert.equal(wm.metrics.invalidated, 1)
  wm.invalidate(table.key, 'air') // idempotente
  assert.equal(wm.metrics.invalidated, 1)
  wm.discover('crafting_table', 'overworld', { x: 3, y: 64, z: 3 })
  assert.equal(wm.suggest('crafting_table', 'overworld', { x: 0, y: 64, z: 0 }).length, 1)
})

test('métricas de consulta: útil quando confirmada, stale quando invalidada', () => {
  const wm = new WorldMemory()
  const a = wm.discover('wood', 'overworld', { x: 16, y: 70, z: 0 })
  const b = wm.discover('stone', 'overworld', { x: 0, y: 70, z: 16 })
  wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 })
  wm.suggest('stone', 'overworld', { x: 0, y: 70, z: 0 })
  wm.confirm(a.key)
  wm.invalidate(b.key, 'gone')
  assert.equal(wm.metrics.queries, 2)
  assert.equal(wm.metrics.usefulQueries, 1)
  assert.equal(wm.metrics.staleQueries, 1)
})

test('falha de aproximação gera cooldown crescente sem invalidar (anti-loop)', () => {
  const c = clock()
  const wm = new WorldMemory({ now: c.now })
  const p = wm.discover('wood', 'overworld', { x: 50, y: 70, z: 0 })
  wm.noteApproachFailure(p.key)
  assert.equal(wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 }).length, 0)
  c.advance(6 * 60 * 1000)
  assert.equal(wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 }).length, 1)
  wm.noteApproachFailure(p.key); wm.noteApproachFailure(p.key)
  c.advance(6 * 60 * 1000)
  assert.equal(wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 }).length, 0) // 20 min
})

test('seleção de destino de exploração: memória vazia mantém o clássico, depois evita o já visitado', () => {
  const c = clock()
  const wm = new WorldMemory({ now: c.now })
  const cands = [{ x: 16, z: 0, order: 0 }, { x: 32, z: 0, order: 1 }, { x: 0, z: 48, order: 2 }]
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }), null)
  wm.visit('overworld', { x: 16, z: 0 })
  wm.visit('overworld', { x: 0, z: 0 })
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }).candidate.x, 32)
  c.advance(2 * HOUR) // visita antiga continua penalizada, mas menos que a recente
  wm.visit('overworld', { x: 32, z: 0 })
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }).candidate.z, 48)
})

test('exploração evita hazards e rotas que falharam', () => {
  const wm = new WorldMemory()
  wm.visit('overworld', { x: 0, z: 0 })
  wm.markHazard('lava', 'overworld', { x: 16, y: 40, z: 0 })
  wm.markHazard('route_failed', 'overworld', { x: 0, y: 64, z: 16 })
  const cands = [{ x: 16, z: 0, order: 0 }, { x: 0, z: 16, order: 1 }, { x: -16, z: 0, order: 2 }]
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }).candidate.x, -16)
})

test('recordExploreDestination conta repetições (baseline com/sem memória)', () => {
  const wm = new WorldMemory()
  wm.visit('overworld', { x: 5, z: 5 })
  assert.equal(wm.recordExploreDestination('overworld', { x: 6, z: 6 }), true)
  assert.equal(wm.recordExploreDestination('overworld', { x: 99, z: 99 }), false)
  assert.equal(wm.metrics.exploreChoices, 2)
  assert.equal(wm.metrics.exploreRepeats, 1)
})

test('suggestPreparationSite exige mesa + madeira + pedra próximas e ignora mesa invalidada', () => {
  const wm = new WorldMemory()
  const table = wm.discover('crafting_table', 'overworld', { x: 0, y: 64, z: 0 })
  assert.equal(wm.suggestPreparationSite('overworld', { x: 50, y: 64, z: 0 }), null)
  wm.discover('wood', 'overworld', { x: 5, y: 64, z: 5 })
  wm.discover('stone', 'overworld', { x: -5, y: 64, z: 2 })
  const site = wm.suggestPreparationSite('overworld', { x: 50, y: 64, z: 0 })
  assert.equal(site.table.key, table.key)
  wm.invalidate(table.key)
  assert.equal(wm.suggestPreparationSite('overworld', { x: 50, y: 64, z: 0 }), null)
})

test('limites: places e cobertura não crescem sem fim; inválidos/antigos saem primeiro', () => {
  const c = clock()
  const wm = new WorldMemory({ now: c.now, options: { maxPlaces: 5, maxExplored: 4 } })
  for (let i = 0; i < 4; i++) { c.advance(1000); wm.discover('crafting_table', 'overworld', { x: i, y: 64, z: 0 }) }
  wm.invalidate(wm.find('crafting_table', 'overworld', { x: 2, y: 64, z: 0 }).key)
  for (let i = 10; i < 14; i++) { c.advance(1000); wm.discover('crafting_table', 'overworld', { x: i, y: 64, z: 0 }) }
  assert.equal(wm.places.size, 5)
  assert.equal(wm.find('crafting_table', 'overworld', { x: 2, y: 64, z: 0 }), undefined)
  for (let i = 0; i < 10; i++) { c.advance(1000); wm.visit('overworld', { x: i * 16, z: 0 }) }
  assert.equal(wm.explored.size, 4)
  assert.equal(wm.exploredRecently('overworld', { x: 9 * 16, z: 0 }), true) // os mais novos ficam
})

test('escritas concorrentes serializam e o arquivo continua JSON válido', async () => {
  const file = tmpFile()
  const wm = new WorldMemory({ file })
  const jobs = []
  for (let i = 0; i < 25; i++) {
    wm.discover('wood', 'overworld', { x: i * 16, y: 70, z: 0 })
    jobs.push(wm.flush())
  }
  await Promise.all(jobs)
  const second = new WorldMemory({ file })
  const jobs2 = []
  for (let i = 0; i < 10; i++) { second.visit('overworld', { x: i * 16, z: 0 }); jobs2.push(second.flush()) }
  await Promise.all(jobs2)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.version, 1)
  assert.ok(Array.isArray(data.places))
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-')), [])
})

test('persistência por eventos: debounce agrupa escritas e visita repetida não suja', async () => {
  const file = tmpFile()
  const wm = new WorldMemory({ file, options: { persistDebounceMs: 20 } })
  wm.visit('overworld', { x: 0, z: 0 })
  wm.visit('overworld', { x: 1, z: 1 })
  assert.equal(fs.existsSync(file), false)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(fs.existsSync(file), true)
  const mtime = fs.statSync(file).mtimeMs
  wm.visit('overworld', { x: 2, z: 2 }) // mesmo chunk: sem escrita
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(fs.statSync(file).mtimeMs, mtime)
})

test('landmarks base/storage vêm dos providers; só o carimbo de confirmação é guardado', () => {
  const file = tmpFile()
  let base = { x: 1, y: 64, z: 1, dimension: 'minecraft:overworld' }
  const wm = new WorldMemory({ file, providers: { base: () => base, storage: () => null } })
  assert.equal(wm.landmark('storage'), null)
  wm.confirmLandmark('base')
  wm.flushSync()
  base = { x: 9, y: 64, z: 9, dimension: 'overworld' }
  const wm2 = new WorldMemory({ file, providers: { base: () => base } }).load()
  const lm = wm2.landmark('base')
  assert.equal(lm.x, 9) // posição atual do provider, nunca cópia persistida
  assert.ok(lm.lastConfirmedAt)
})

test('route_failed acumula falhas por destino e hazard velho deixa de pesar', () => {
  const c = clock()
  const wm = new WorldMemory({ now: c.now })
  wm.markHazard('route_failed', 'overworld', { x: 16, y: 64, z: 0 })
  wm.markHazard('route_failed', 'overworld', { x: 17, y: 64, z: 1 })
  assert.equal(wm.find('route_failed', 'overworld', { x: 16, y: 64, z: 0 }).failures, 2)
  wm.visit('overworld', { x: 0, z: 0 })
  const cands = [{ x: 16, z: 0, order: 0 }, { x: 0, z: 16, order: 1 }]
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }).candidate.z, 16)
  c.advance(25 * HOUR)
  assert.equal(wm.chooseExploreTarget('overworld', cands, { x: 0, z: 0 }).candidate.x, 16)
})

test('refresh de lugar confirmado persiste âncora, validade e métricas após restart', async () => {
  const file = tmpFile()
  const c = clock()
  const wm = new WorldMemory({ file, now: c.now })
  const first = wm.discover('wood', 'overworld', { x: 16, y: 70, z: 0 }, { count: 2 })
  await wm.flush()
  c.advance(HOUR)
  wm.discover('wood', 'overworld', { x: 20, y: 71, z: 5 }, { count: 7 })
  wm.suggest('wood', 'overworld', { x: 0, y: 70, z: 0 })
  wm.confirm(first.key)
  await wm.flush()
  const restored = new WorldMemory({ file, now: c.now }).load()
  const place = restored.find('wood', 'overworld', { x: 16, y: 70, z: 0 })
  assert.deepEqual([place.x, place.y, place.z, place.count], [20, 71, 5, 7])
  assert.equal(place.lastConfirmedAt, c.t)
  assert.equal(place.confirmations, 3)
  assert.equal(restored.metrics.verified, 1)
  assert.equal(restored.metrics.usefulQueries, 1)
  c.advance(90 * 60 * 1000)
  assert.equal(restored.effectiveStatus(place), STATUS.CONFIRMED)
})

test('flush com falha conserva snapshot pendente e permite retry sem novo evento', async () => {
  const file = tmpFile()
  fs.mkdirSync(file) // rename cannot replace a directory with the snapshot
  const wm = new WorldMemory({ file })
  wm.discover('wood', 'overworld', { x: 16, y: 70, z: 0 })
  await assert.rejects(wm.flush())
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-')), [])
  fs.rmdirSync(file)
  await wm.flush()
  const restored = new WorldMemory({ file }).load()
  assert.equal(restored.places.size, 1)
  assert.equal(restored.metrics.created, 1)
})

test('flushSync com falha limpa temporário e permite retry sem novo evento', () => {
  const file = tmpFile()
  fs.mkdirSync(file)
  const wm = new WorldMemory({ file })
  wm.discover('wood', 'overworld', { x: 16, y: 70, z: 0 })
  assert.throws(() => wm.flushSync())
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-')), [])
  fs.rmdirSync(file)
  wm.flushSync()
  assert.equal(new WorldMemory({ file }).load().places.size, 1)
})

test('flushSync salva snapshot pendente e impede async antigo de sobrescrever estado atual', async (t) => {
  for (const addNewPlace of [false, true]) {
    await t.test(addNewPlace ? 'com alterações posteriores' : 'somente snapshot pendente', async () => {
      const file = tmpFile()
      const wm = new WorldMemory({ file })
      const writeFile = fs.promises.writeFile
      let releaseWrite
      const gate = new Promise((resolve) => { releaseWrite = resolve })
      let reportStarted
      const started = new Promise((resolve) => { reportStarted = resolve })
      const mock = t.mock.method(fs.promises, 'writeFile', async (...args) => {
        if (String(args[0]).startsWith(`${file}.tmp-`)) {
          reportStarted()
          await gate
        }
        return writeFile(...args)
      })
      let pending
      try {
        wm.discover('wood', 'overworld', { x: 16, y: 70, z: 0 })
        pending = wm.flush()
        await started
        if (addNewPlace) wm.discover('stone', 'overworld', { x: 0, y: 70, z: 16 })
        wm.flushSync()
        const snapshot = fs.readFileSync(file, 'utf8')
        assert.equal(JSON.parse(snapshot).places.length, addNewPlace ? 2 : 1)
        releaseWrite()
        await pending
        assert.equal(fs.readFileSync(file, 'utf8'), snapshot)
        assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.tmp-')), [])
        assert.equal(wm._dirty, false)
      } finally {
        releaseWrite()
        if (pending) await pending.catch(() => {})
        mock.mock.restore()
      }
    })
  }
})
