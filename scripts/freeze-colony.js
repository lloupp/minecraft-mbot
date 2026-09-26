#!/usr/bin/env node
// scripts/freeze-colony.js
// Creates a snapshot of all source files with SHA256 hashes
// before a colony session, proving code was not modified during execution.
//
// Inspired by minecraft-agent's freeze-run.mjs which captures
// source hashes for provenance verification of runs.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SOURCE_DIRS = ['index.js', 'core', 'lib', 'scripts', 'test']
const EXCLUDE = ['node_modules', '.git', '.data']
const OUTPUT_DIR = '.data/sessions'

function shouldExclude(filePath) {
  const parts = filePath.split(path.sep)
  return EXCLUDE.some(ex => parts.includes(ex))
}

function getSourceFiles() {
  const files = []
  for (const dir of SOURCE_DIRS) {
    const fullDir = path.resolve(dir)
    if (!fs.existsSync(fullDir)) continue
    collectFiles(fullDir, dir, files)
  }
  return files
}

function collectFiles(dir, relativeBase, files) {
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const relativePath = path.join(relativeBase, entry)
    if (shouldExclude(relativePath)) continue
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      collectFiles(fullPath, relativePath, files)
    } else if (stat.isFile() && (entry.endsWith('.js') || entry.endsWith('.json'))) {
      files.push(relativePath)
    }
  }
}

function computeHashes(files) {
  const hashes = {}
  for (const file of files) {
    const fullPath = path.resolve(file)
    try {
      const content = fs.readFileSync(fullPath)
      hashes[file] = crypto.createHash('sha256').update(content).digest('hex')
    } catch (err) {
      hashes[file] = `ERROR: ${err.message}`
    }
  }
  return hashes
}

function main() {
  const sessionName = process.argv[2] || `session-${Date.now()}`
  const sessionDir = path.resolve(OUTPUT_DIR, sessionName)

  // Create session directory
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.mkdirSync(path.join(sessionDir, 'source'), { recursive: true })

  const sourceFiles = getSourceFiles()
  const hashes = computeHashes(sourceFiles)

  // Copy source files
  for (const file of sourceFiles) {
    const fullPath = path.resolve(file)
    const destPath = path.join(sessionDir, 'source', file)
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(fullPath, destPath)
  }

  // Create manifest
  const manifest = {
    sessionId: sessionName,
    createdAt: new Date().toISOString(),
    sourceFiles: sourceFiles.length,
    files: hashes,
    nodeVersion: process.version,
    platform: process.platform
  }

  fs.writeFileSync(
    path.join(sessionDir, 'source-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  )

  // Create run-config.json
  const runConfig = {
    sessionId: sessionName,
    startTime: new Date().toISOString(),
    sourceManifest: 'source-manifest.json',
    eventLog: '.data/colony-events.jsonl',
    proofFile: '.data/colony-proof.json',
    operatorGuidance: 'No external guidance provided',
    sourceSha256: Object.fromEntries(
      Object.entries(hashes).map(([k, v]) => [k, v])
    )
  }

  fs.writeFileSync(
    path.join(sessionDir, 'run-config.json'),
    JSON.stringify(runConfig, null, 2),
    'utf8'
  )

  console.log(JSON.stringify({
    session: sessionName,
    files: sourceFiles.length,
    manifest: path.join(sessionDir, 'source-manifest.json'),
    config: path.join(sessionDir, 'run-config.json'),
    sourceDir: path.join(sessionDir, 'source')
  }, null, 2))
}

function freezeColony(name) {
  process.argv[2] = name
  main()
}

module.exports = { freezeColony }

if (require.main === module) {
  main()
}
