'use strict'

const MODEL_ACTIONS = new Set([
  'gather', 'craft', 'smelt', 'eat', 'move', 'deposit',
  'withdraw', 'build', 'fight', 'wait', 'stop'
])

function normalizeCandidates(candidates = []) {
  const seen = new Set()
  return candidates.map(candidate => {
    if (!candidate || typeof candidate !== 'object') throw new Error('candidate inválido')
    const id = String(candidate.id || '')
    if (!MODEL_ACTIONS.has(id)) throw new Error(`candidate id inválido: ${id}`)
    if (seen.has(id)) throw new Error(`candidate duplicado: ${id}`)
    if (!candidate.tool || typeof candidate.tool !== 'string') throw new Error(`tool ausente para ${id}`)
    seen.add(id)
    return {
      id,
      tool: candidate.tool,
      args: { ...(candidate.args || {}) },
      reason: candidate.reason || null
    }
  })
}

class DecisionCoordinator {
  constructor({
    mode = process.env.MBOT_DECISION_ENGINE || 'deterministic',
    conversa = null,
    laya = null,
    juliaShadow = null,
    logger = console
  } = {}) {
    this.mode = mode
    this.conversa = conversa
    this.laya = laya
    this.juliaShadow = juliaShadow
    this.logger = logger
  }

  activeEngine() {
    if (this.mode === 'conversa-llm' && this.conversa) {
      return { engine: this.conversa, source: 'conversa-llm' }
    }
    if (this.mode === 'laya' && this.laya) {
      return { engine: this.laya, source: 'laya' }
    }
    return null
  }

  async choose({ state, candidates, fallbackId }) {
    const options = normalizeCandidates(candidates)
    if (!options.length) throw new Error('nenhum candidate disponível')
    const fallback = options.find(option => option.id === fallbackId) || options[0]
    const maskedState = {
      ...state,
      availableActions: options.map(option => option.id),
      candidateReasons: Object.fromEntries(
        options.map(option => [option.id, option.reason || null])
      )
    }

    let shadow = null
    if (this.juliaShadow) {
      try {
        shadow = await this.juliaShadow(maskedState, options.map(option => option.id))
      } catch (error) {
        shadow = { error: error.message, trusted: false, shadow: true }
      }
    }

    const active = this.activeEngine()
    if (!active) {
      return { selected: fallback, source: 'deterministic', fallback: false, shadow }
    }

    const decision = await active.engine.decide(maskedState, {
      action: fallback.id,
      confidence: 1,
      trusted: true
    })
    const selected = options.find(option => option.id === decision.action)

    if (!selected || decision.source !== active.source || decision.trusted !== true) {
      return {
        selected: fallback,
        source: 'deterministic',
        fallback: true,
        reason: decision.reason || 'model_rejected',
        modelDecision: decision,
        shadow
      }
    }

    return {
      selected,
      source: active.source,
      fallback: false,
      confidence: decision.confidence,
      modelDecision: decision,
      shadow
    }
  }

  async execute({ toolLayer, state, candidates, fallbackId, objective = null }) {
    const chosen = await this.choose({ state, candidates, fallbackId })
    const result = await toolLayer.execute({
      worker: state.worker,
      objective,
      action: chosen.selected.tool,
      args: chosen.selected.args
    })
    const record = {
      worker: state.worker,
      engine: chosen.source,
      candidate: chosen.selected.id,
      tool: chosen.selected.tool,
      confidence: chosen.confidence ?? null,
      fallback: chosen.fallback,
      shadow: chosen.shadow || null,
      execution: result
    }
    this.logger.log?.('[decision] ' + JSON.stringify(record))
    return record
  }
}

module.exports = { DecisionCoordinator, normalizeCandidates, MODEL_ACTIONS }
