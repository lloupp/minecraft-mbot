const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const files = ['index.js', 'iniciar-bot.js']
for (const dir of ['core', 'lib', 'lib/dashboard', 'scripts']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (file.endsWith('.js')) files.push(`${dir}/${file}`)
  }
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' })
  if (result.status !== 0) { process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`); process.exit(1) }
}
console.log(`Syntax OK: ${files.length} JavaScript files`)
