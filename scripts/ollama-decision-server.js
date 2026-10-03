'use strict'

const http = require('node:http')
const { performance } = require('node:perf_hooks')

const HOST = process.env.ANDY_HOST || '127.0.0.1'
const PORT = Number(process.env.ANDY_PORT || 8767)
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const MODEL = process.env.ANDY_MODEL || 'sweaterdog/andy-4:micro-q8_0'
const NUM_CTX = Number(process.env.ANDY_NUM_CTX || 4096)
const MAX_BODY = 1_000_000
const MAX_CANDIDATES = 20

function normalizeCandidates(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_CANDIDATES) {
    throw new Error('candidates must be a non-empty list (max 20)')
  }
  const seen = new Set()
  return values.map(value => {
    if (!value || typeof value !== 'object') throw new Error('candidate must be an object')
    const id = String(value.id || '')
    const description = String(value.description || '').trim()
    if (!/^[a-z0-9_:-]{1,80}$/.test(id) || seen.has(id)) throw new Error('invalid or duplicate candidate id')
    if (!description || description.length > 1000) throw new Error('invalid candidate description')
    seen.add(id)
    return { id, description }
  })
}

function parseChoice(raw, candidates) {
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('model did not return JSON') }
  const choice = String(value?.choice || '')
  if (!candidates.some(candidate => candidate.id === choice)) {
    throw new Error('model returned an action outside supplied candidates')
  }
  return choice
}

async function choose(payload) {
  const candidates = normalizeCandidates(payload.candidates)
  if (candidates.length === 1) {
    return { choice: candidates[0].id, model_calls: 0, latency_ms: 0, source: 'forced_single_candidate' }
  }
  if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
    throw new Error('state must be an object')
  }

  const system = [
    'You are a Minecraft survival decision selector.',
    'Choose exactly one candidate supplied by the caller.',
    'Never invent an action and never add tool arguments.',
    'Prefer survival, then useful progress toward the current objective.',
    'Return only JSON matching {"choice":"candidate_id"}.'
  ].join(' ')

  const prompt = JSON.stringify({ state: payload.state, candidates })
  const started = performance.now()
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      options: { temperature: 0, num_ctx: NUM_CTX, num_predict: 32 }
    })
  })
  if (!response.ok) throw new Error(`ollama_http_${response.status}`)
  const result = await response.json()
  const choice = parseChoice(String(result?.message?.content || ''), candidates)
  return {
    choice,
    model_calls: 1,
    latency_ms: performance.now() - started,
    source: 'andy_ollama',
    model: MODEL,
    ollama_total_duration_ns: result.total_duration ?? null,
    ollama_prompt_eval_count: result.prompt_eval_count ?? null,
    ollama_eval_count: result.eval_count ?? null,
    rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100
  }
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': data.length })
  res.end(data)
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return json(res, 200, { ok: true, engine: 'andy', model: MODEL, ollama_url: OLLAMA_URL })
  }
  if (req.method !== 'POST' || req.url !== '/choose') return json(res, 404, { error: 'not_found' })

  let size = 0
  const chunks = []
  req.on('data', chunk => {
    size += chunk.length
    if (size > MAX_BODY) req.destroy(new Error('request too large'))
    else chunks.push(chunk)
  })
  req.on('end', async () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      return json(res, 200, await choose(payload))
    } catch (error) {
      const detail = String(error?.message || error)
      const invalid = detail.includes('outside supplied candidates') || detail.includes('did not return JSON')
      return json(res, invalid ? 422 : 503, {
        error: invalid ? 'invalid_choice' : 'inference_failed',
        detail: detail.slice(0, 300)
      })
    }
  })
})

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Andy/Ollama selector ready at http://${HOST}:${PORT}/choose model=${MODEL}`)
  })
}

module.exports = { normalizeCandidates, parseChoice, choose }
