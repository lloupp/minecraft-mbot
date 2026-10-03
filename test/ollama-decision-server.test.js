'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCandidates, parseChoice } = require('../scripts/ollama-decision-server')

test('Ollama selector accepts a valid candidate choice', () => {
  const candidates = normalizeCandidates([
    { id: 'gather', description: 'Collect wood.' },
    { id: 'wait', description: 'Wait for a concrete reason.' }
  ])
  assert.equal(parseChoice('{"choice":"gather"}', candidates), 'gather')
})

test('Ollama selector rejects invented actions', () => {
  const candidates = normalizeCandidates([
    { id: 'gather', description: 'Collect wood.' },
    { id: 'wait', description: 'Wait.' }
  ])
  assert.throws(() => parseChoice('{"choice":"teleport"}', candidates), /outside supplied candidates/)
})

test('Ollama selector rejects duplicate and malformed candidates', () => {
  assert.throws(() => normalizeCandidates([
    { id: 'gather', description: 'one' },
    { id: 'gather', description: 'two' }
  ]), /invalid or duplicate/)
  assert.throws(() => normalizeCandidates([
    { id: 'INVALID ACTION', description: 'bad' }
  ]), /invalid or duplicate/)
})
