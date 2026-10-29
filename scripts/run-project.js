// npm prepends node_modules/.bin, which can contain an unrelated Node shim.
// Use the runtime that launched npm, not that shim, for project commands.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const root = path.resolve(__dirname, '..')
const commands = {
  check: ['scripts/check-syntax.js'],
  test: ['--test', '--test-concurrency=4', '--test-timeout=60000', ...fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.js')).map(name => `test/${name}`)],
  probe: ['scripts/plugin-probe.js'],
  start: ['index.js']
}
const args = commands[process.argv[2]]
if (!args) throw new Error('Unsupported project command')
const runtime = process.env.npm_node_execpath || process.execPath
const result = spawnSync(runtime, [...args, ...process.argv.slice(3)], { cwd: root, stdio: 'inherit' })
if (result.error) { console.error(result.error.message); process.exit(1) }
process.exit(result.status == null ? 1 : result.status)
