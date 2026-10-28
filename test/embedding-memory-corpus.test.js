const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  POST_DECISION_FIELDS, QUERY_VARIANTS, stateToQuery, cycleToEpisode, parseJsonl, buildEpisodes,
  priorEpisodeIndices, corpusStats, situationCategory
} = require('../lib/embedding-memory-corpus')

test('stateToQuery creates compact retrieval text without executing anything', () => {
  const q = stateToQuery({
    health: 20, food: 7, time: 'night', atBase: false,
    threat: { type: 'zombie', distance: 6 },
    nearby: { food: false, wood: true, woodDistance: 4 },
    inventory: { stone_sword: 1, dirt: 0 },
    objective: { type: 'explore' }
  }, ['fight_threat', 'escape_danger'])
  assert.match(q, /zombie at distance 6/)
  assert.match(q, /wood=yes@4\.0/)
  assert.match(q, /stone_sword:1/)
  assert.match(q, /fight_threat, escape_danger/)
})

test('cycleToEpisode keeps outcome in document but not in query (no label leakage)', () => {
  const e = cycleToEpisode({
    type: 'julia_authority_cycle',
    decisionId: 'w-1',
    state: { health: 20, food: 20, nearby: {}, inventory: {} },
    candidates: ['fight_threat', 'escape_danger'],
    choice: 'escape_danger',
    result: { ok: true, intent: 'escape_danger', threatHandled: 'escape_danger' },
    nextState: { health: 20, food: 20, threat: null, atBase: true }
  })
  assert.equal(e.action, 'escape_danger')
  assert.equal(e.success, true)
  assert.deepEqual(e.candidates, ['fight_threat', 'escape_danger'])
  assert.doesNotMatch(e.query, /chosen_action/)
  assert.match(e.document, /chosen_action=escape_danger/)
  assert.match(e.document, /ok=yes/)
})

const baseEvent = {
  type: 'julia_authority_cycle',
  decisionId: 'w-7',
  worker: 'w',
  decidedAt: '2026-10-06T10:00:00Z',
  state: { health: 12, food: 5, time: 'night', threat: { type: 'zombie', distance: 3 }, equippedWeapon: null, atBase: false, nearby: { wood: true, woodDistance: 2 }, inventory: { stick: 2 } },
  candidates: ['equip_best_weapon', 'escape_danger']
}

test('query is invariant to every post-decision field (label leakage regression)', () => {
  const variants = [
    { choice: 'escape_danger', juliaChoice: 'escape_danger', rulesChoice: 'equip_best_weapon', deterministicChoice: 'equip_best_weapon', result: { ok: true, code: null, intent: 'escape_danger' }, nextState: { health: 20, food: 20, threat: null, atBase: true }, settledAt: '2026-10-06T10:00:05Z', validation: 'ok', source: 'julia' },
    { choice: 'equip_best_weapon', juliaChoice: 'equip_best_weapon', rulesChoice: 'escape_danger', deterministicChoice: 'escape_danger', result: { ok: false, code: 'SAFETY_PRECEDENCE', intent: 'equip_best_weapon', error: 'died' }, nextState: { health: 0, food: 0, threat: { type: 'creeper' }, atBase: false }, settledAt: '2026-10-06T10:09:00Z', validation: 'fallback', source: 'fallback' }
  ]
  const [a, b] = variants.map((v) => cycleToEpisode({ ...baseEvent, ...v }))
  for (const v of QUERY_VARIANTS) assert.equal(a.variants[v].query, b.variants[v].query, `variant ${v} leaks post-decision data`)
  assert.equal(a.query, b.query)
  assert.deepEqual(a.features, b.features)
  assert.equal(a.category, b.category)
  assert.notEqual(a.document, b.document)
  for (const ep of [a, b]) {
    for (const v of QUERY_VARIANTS) {
      const q = ep.variants[v].query
      assert.doesNotMatch(q, /chosen_action|outcome|next_state|ok=|code=|SAFETY_PRECEDENCE|creeper|died|julia|rules/i)
    }
  }
  // the list of post-decision fields we guard is complete for the fields the builder reads
  for (const f of ['choice', 'juliaChoice', 'rulesChoice', 'deterministicChoice', 'result', 'nextState', 'realIntent']) {
    assert.ok(POST_DECISION_FIELDS.includes(f), f)
  }
})

test('every query in the real versioned corpus excludes chosen action outside the candidate list', () => {
  const dir = path.join(__dirname, '..', 'docs', 'evidence', 'julia-authority-sustainability-1201', 'runs', 'equip-threat')
  const events = parseJsonl(fs.readFileSync(path.join(dir, 'julia-authority.jsonl'), 'utf8'))
  const episodes = buildEpisodes(events)
  assert.ok(episodes.length > 0)
  for (const e of episodes) {
    const stripped = Object.fromEntries(Object.entries(events.find((x) => x.type === 'julia_authority_cycle' && x.decisionId === e.id && x.decidedAt === e.decidedAt) || {})
      .filter(([k]) => !POST_DECISION_FIELDS.includes(k)))
    assert.equal(stateToQuery(stripped.state, stripped.candidates), e.query)
    assert.doesNotMatch(e.query, /chosen_action|outcome:/)
  }
})

test('shadow timeline evidence is unwrapped and labelled with the executed intent, not Julia\'s', () => {
  const e = cycleToEpisode({
    type: 'julia_shadow_decision',
    data: { decisionId: 1, decidedAt: '2026-10-01T09:16:38Z', state: { health: 20 }, candidates: ['prepare_combat', 'continue_objective'], juliaChoice: 'prepare_combat', realIntent: 'continue_objective', result: { ok: false, code: 'DISCONNECTED' } }
  }, 0, 'run-a')
  assert.equal(e.id, 'run-a:1')
  assert.equal(e.action, 'continue_objective')
  assert.equal(e.flags.cancelled, true)
})

test('parser ignores partial lines and buildEpisodes accepts authority and shadow evidence', () => {
  const lines = [
    JSON.stringify({ type: 'julia_authority_cycle', decisionId: 'b', time: '2026-10-06T10:01:00Z', state: { nearby: {} }, candidates: ['x'], choice: 'x', result: { ok: true } }),
    '{bad',
    JSON.stringify({ type: 'julia_shadow_decision', decisionId: 'a', time: '2026-10-06T10:00:00Z', state: { nearby: {} }, candidateIds: ['y', 'z'], realIntent: 'y', result: { ok: false } })
  ].join('\n')
  const episodes = buildEpisodes(parseJsonl(lines))
  assert.equal(episodes.length, 2)
  assert.equal(episodes[0].id, 'a')
  assert.deepEqual(episodes[0].candidates, ['y', 'z'])
  assert.equal(episodes[1].id, 'b')
})

test('merging runs namespaces colliding decision ids and drops duplicated log lines', () => {
  const ev = { ...baseEvent, choice: 'escape_danger', result: { ok: true }, settledAt: '2026-10-06T10:00:02Z' }
  const other = { ...ev, decidedAt: '2026-10-05T10:00:00Z', settledAt: '2026-10-05T10:00:02Z' }
  const episodes = buildEpisodes([{ event: ev, source: 'run1' }, { event: ev, source: 'run1-copy' }, { event: other, source: 'run2' }])
  assert.equal(episodes.length, 2)
  assert.deepEqual(episodes.map((e) => e.id), ['run2:w-7', 'run1:w-7'])
})

test('priorEpisodeIndices never exposes the episode itself, the future, or still-unsettled episodes', () => {
  const ep = (id, decidedAt, settledAt) => ({ id, decidedAt, settledAt })
  const episodes = [
    ep('a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z'),
    ep('b', '2026-01-01T00:00:05Z', '2026-01-01T00:01:00Z'), // long action, settles late
    ep('c', '2026-01-01T00:00:20Z', '2026-01-01T00:00:30Z'),
    ep('d', '2026-01-01T00:00:40Z', '2026-01-01T00:00:50Z')
  ].sort((x, y) => x.settledAt.localeCompare(y.settledAt))
  const idx = (id) => episodes.findIndex((e) => e.id === id)
  const names = (id) => priorEpisodeIndices(episodes, idx(id)).map((j) => episodes[j].id)
  assert.deepEqual(names('a'), [])
  assert.deepEqual(names('b'), [])
  assert.deepEqual(names('c'), ['a']) // b decided earlier but had not settled yet
  assert.deepEqual(names('d'), ['a', 'c'])
  for (let i = 0; i < episodes.length; i++) {
    for (const j of priorEpisodeIndices(episodes, i)) assert.ok(episodes[j].settledAt < episodes[i].decidedAt)
  }
})

test('corpusStats separates forced from contested decisions', () => {
  const mk = (cands, ok) => cycleToEpisode({ ...baseEvent, candidates: cands, choice: cands[0], result: { ok } })
  const s = corpusStats([mk(['a'], true), mk(['a', 'b'], false), mk(['a', 'b'], true)])
  assert.equal(s.episodes_total, 3)
  assert.equal(s.contested_decisions, 2)
  assert.equal(s.forced_decisions, 1)
  assert.equal(s.contested_failed, 1)
})

test('situationCategory uses only pre-decision information', () => {
  assert.equal(situationCategory({ threat: { type: 'zombie' } }, ['continue_objective']), 'THREAT')
  assert.equal(situationCategory({}, ['find_food', 'return_base']), 'FOOD')
  assert.equal(situationCategory({ food: 3 }, ['prepare_combat', 'sleep_or_shelter']), 'PREPARATION')
  assert.equal(situationCategory({ food: 3 }, ['continue_objective']), 'FOOD')
  assert.equal(situationCategory({}, ['continue_objective']), 'EXPLORATION')
})
