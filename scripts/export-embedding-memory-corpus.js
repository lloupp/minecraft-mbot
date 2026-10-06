#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { parseJsonl, buildEpisodes, corpusStats } = require('../lib/embedding-memory-corpus')

function findJsonl(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findJsonl(p))
    else if (entry.name.endsWith('.jsonl')) out.push(p)
  }
  return out.sort()
}

const args = process.argv.slice(2)
const statsOnly = args.includes('--stats')
let paths = args.filter((a) => !a.startsWith('--'))
if (args.includes('--all-evidence')) paths = paths.concat(findJsonl(path.join(__dirname, '..', 'docs', 'evidence')))
if (!paths.length) {
  console.error('usage: node scripts/export-embedding-memory-corpus.js [--all-evidence] [--stats] [julia-log.jsonl ...]')
  process.exit(2)
}

const events = []
for (const file of paths) {
  const source = path.relative(path.join(__dirname, '..'), path.dirname(file)).replace(/^docs\/evidence\//, '')
  for (const event of parseJsonl(fs.readFileSync(file, 'utf8'))) events.push({ event, source })
}

const episodes = buildEpisodes(events)
const stats = corpusStats(episodes)
const sourceFiles = paths.map((p) => path.relative(path.join(__dirname, '..'), p))
process.stdout.write(JSON.stringify(statsOnly
  ? { version: 2, sourceFiles, stats }
  : { version: 2, generatedAt: new Date().toISOString(), sourceFiles, stats, episodes }, null, 2) + '\n')
