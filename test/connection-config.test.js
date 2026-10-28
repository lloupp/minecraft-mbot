'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { connectionSettings } = require('../lib/connection-config')

test('explicit invalid ports fail instead of connecting to a different server', () => {
  for (const port of ['', '0', '65536', '-1', '25567oops', '1.5', '1e3', ' ']) {
    assert.throws(() => connectionSettings({ MINECRAFT_PORT: port }), /MINECRAFT_PORT/)
  }
  assert.equal(connectionSettings({}).port, null)
  assert.equal(connectionSettings({ MINECRAFT_PORT: '25567' }).port, 25567)
})

test('remote dedicated server retains its explicit address and port', () => {
  const config = connectionSettings({ MINECRAFT_HOST: '192.168.0.74', MINECRAFT_PORT: '25567', MINECRAFT_OWNER: 'owner' })
  assert.equal(config.host, '192.168.0.74')
  assert.equal(config.port, 25567)
  assert.equal(config.local, false)
  assert.equal(config.owner, 'owner')
  assert.equal(connectionSettings({ MINECRAFT_HOST: '::1' }).local, true)
  assert.throws(() => connectionSettings({ MINECRAFT_HOST: '  ' }), /MINECRAFT_HOST/)
})

test('local .env is loaded before configuration and shell values win', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbot-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, '.env'), 'MINECRAFT_HOST=192.168.0.74\nMINECRAFT_PORT=25567\n')
  const modulePath = require.resolve('../lib/connection-config')
  const code = `const c=require(${JSON.stringify(modulePath)});c.loadLocalEnv();console.log(JSON.stringify(c.connectionSettings()));`
  const env = { ...process.env }
  delete env.MINECRAFT_HOST
  delete env.MINECRAFT_PORT
  const run = extra => spawnSync(process.execPath, ['-e', code], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' })
  let result = run({})
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).port, 25567)
  result = run({ MINECRAFT_PORT: '25568' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).port, 25568)
  fs.unlinkSync(path.join(dir, '.env'))
  result = run({})
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).port, null)
  fs.mkdirSync(path.join(dir, '.env'))
  result = run({})
  assert.notEqual(result.status, 0, 'an unreadable .env must not be silently ignored')
})
