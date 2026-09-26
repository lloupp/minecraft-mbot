const test = require('node:test')
const assert = require('node:assert/strict')
const { freezeColony, validateSessionName } = require('../scripts/freeze-colony')

test('freeze-colony accepts safe session names', () => {
  assert.equal(validateSessionName('freeze-1729'), 'freeze-1729')
  assert.equal(validateSessionName('session_name-1'), 'session_name-1')
})

test('freeze-colony rejects path traversal and invalid names before filesystem work', () => {
  for (const name of ['../escape', 'a/b', '..', '.hidden', 'two words', '']) {
    assert.throws(() => validateSessionName(name), /nome inválido/)
  }
  assert.throws(() => freezeColony('../escape'), /nome inválido/)
  assert.throws(() => validateSessionName('a'.repeat(65)), /nome inválido/)
})
