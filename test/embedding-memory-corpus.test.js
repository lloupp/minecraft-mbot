const test = require('node:test')
const assert = require('node:assert/strict')
const { stateToQuery, cycleToEpisode, parseJsonl, buildEpisodes } = require('../lib/embedding-memory-corpus')

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
