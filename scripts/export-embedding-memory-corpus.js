#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const { parseJsonl, buildEpisodes } = require('../lib/embedding-memory-corpus')

const paths = process.argv.slice(2)
if (!paths.length) {
  console.error('usage: node scripts/export-embedding-memory-corpus.js <julia-log.jsonl> [more.jsonl ...]')
  process.exit(2)
}

const events = []
for (const file of paths) {
  const text = fs.readFileSync(file, 'utf8')
  events.push(...parseJsonl(text))
}

const episodes = buildEpisodes(events)
process.stdout.write(JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceFiles: paths,
  episodes
}, null, 2) + '\n')
