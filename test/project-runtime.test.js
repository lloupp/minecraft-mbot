const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const entry = path.resolve(__dirname, '../scripts/run-project.js')

function inspect(command, npmRuntime) {
  const source = `const cp=require('node:child_process'); cp.spawnSync=(runtime,args,opts)=>{console.log(JSON.stringify({runtime,args,cwd:opts.cwd,shell:opts.shell}));return {status:0}}; process.argv=['node',${JSON.stringify(entry)},${JSON.stringify(command)}]; require(${JSON.stringify(entry)})`
  const env = { ...process.env }
  if (npmRuntime) env.npm_node_execpath = npmRuntime
  else delete env.npm_node_execpath
  return spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', env })
}

test('npm runtime overrides an unrelated local Node shim without invoking a shell', () => {
  const result = inspect('probe', 'C:/supported-runtime/node.exe')
  assert.equal(result.status, 0, result.stderr)
  const call = JSON.parse(result.stdout)
  assert.equal(call.runtime, 'C:/supported-runtime/node.exe')
  assert.deepEqual(call.args, ['scripts/plugin-probe.js'])
  assert.equal(call.shell, undefined)
})

test('direct project runner uses the current runtime and enumerates test files without shell globbing', () => {
  const result = inspect('test')
  assert.equal(result.status, 0, result.stderr)
  const call = JSON.parse(result.stdout)
  assert.equal(call.runtime, process.execPath)
  assert.equal(call.args.includes('--test-timeout=60000'), true)
  assert.equal(call.args.some(arg => arg.includes('*')), false)
  assert.equal(call.args.some(arg => arg.endsWith('project-runtime.test.js')), true)
})

test('project runner rejects arbitrary commands', () => {
  const result = inspect('not-a-project-command')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unsupported project command/)
})
