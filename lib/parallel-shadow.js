'use strict'

// Isolated helper for a future runtime integration. It has no Mineflayer
// dependency and returns proposals only; callers remain responsible for the
// existing deterministic executor and must ignore proposals for execution.
async function requestProposal(url, state, candidates, timeoutMs = 1500) {
  if (!url) return { available: false, error: 'not_configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, candidates }), signal: controller.signal
    })
    if (!response.ok) return { available: false, error: `http_${response.status}` }
    const value = await response.json()
    const valid = candidates.some(candidate => candidate.id === value.choice)
    return valid
      ? { available: true, choice: value.choice, latency_ms: value.latency_ms ?? null }
      : { available: false, error: 'invalid_candidate' }
  } catch (error) {
    return { available: false, error: error?.name === 'AbortError' ? 'timeout' : 'request_failed' }
  } finally { clearTimeout(timer) }
}

function startParallelShadow({ state, candidates, layaUrl, nanoandyUrl, timeoutMs = 1500, record }) {
  const snapshot = JSON.parse(JSON.stringify({ state, candidates }))
  for (const [engine, url] of [['laya', layaUrl], ['nanoandy', nanoandyUrl]]) {
    void requestProposal(url, snapshot.state, snapshot.candidates, timeoutMs)
      .then(result => record?.({ engine, ...result, executionAuthority: 'none' }))
      .catch(() => record?.({ engine, available: false, error: 'record_failed', executionAuthority: 'none' }))
  }
  return { started: true, executionAuthority: 'existing_system_only' }
}

module.exports = { requestProposal, startParallelShadow }
