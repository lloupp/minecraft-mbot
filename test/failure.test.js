const test = require('node:test')
const assert = require('node:assert/strict')
const { CODES, classify, retryable, actionFor } = require('../lib/failure')

test('mapeia códigos de coleta já existentes', () => {
  assert.equal(classify({ code: 'PATH_FAILED' }).code, CODES.PATH_NO_PATH)
  assert.equal(classify({ code: 'DIG_FAILED' }).code, CODES.PATH_DIG_ERROR)
  assert.equal(classify({ code: 'ITEM_NOT_CONFIRMED' }).code, CODES.VERIFICATION_FAILED)
  assert.equal(classify({ code: 'CANCELLED' }).code, CODES.CANCELLED)
})

test('mapeia telemetria de navegação', () => {
  assert.equal(classify({ nav: { code: 'PATH_TIMEOUT', reason: 'timeout' } }).code, CODES.PATH_TIMEOUT)
  assert.equal(classify({ nav: { code: 'PATH_PLACE_ERROR', reason: 'place_error' } }).code, CODES.PATH_PLACE_ERROR)
})

test('classifica mensagens conhecidas', () => {
  assert.equal(classify({ error: new Error('caminho demorou demais') }).code, CODES.PATH_TIMEOUT)
  assert.equal(classify({ error: new Error('Event blockUpdate did not fire within timeout') }).code, CODES.PROTECTED_AREA)
  assert.equal(classify({ error: new Error('destination full') }).code, CODES.CONTAINER_FULL)
  assert.equal(classify({ error: new Error('bloco fora do alcance físico') }).code, CODES.RESOURCE_UNREACHABLE)
  assert.equal(classify({ error: new Error('chunk não carregado') }).code, CODES.CHUNK_UNLOADED)
})

test('erro desconhecido é UNKNOWN e não retentável', () => {
  const failure = classify({ error: new Error('algo inesperado') })
  assert.equal(failure.code, CODES.UNKNOWN)
  assert.equal(failure.retryable, false)
  assert.equal(failure.action, 'abort')
})

test('retryable e ação por código', () => {
  assert.equal(retryable(CODES.PATH_TIMEOUT), true)
  assert.equal(retryable(CODES.PROTECTED_AREA), false)
  assert.equal(actionFor(CODES.PATH_NO_PATH), 'alternate_target')
  assert.equal(actionFor(CODES.TOOL_MISSING), 'withdraw_tool')
  assert.equal(actionFor('INEZISTENTE'), 'abort')
})

test('detalhe preserva a mensagem original', () => {
  const failure = classify({ error: new Error('sem picareta de ferro') })
  assert.equal(failure.code, CODES.TOOL_MISSING)
  assert.match(failure.detail, /sem picareta/)
})
