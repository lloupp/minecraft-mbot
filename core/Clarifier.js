// core/Clarifier.js
// Perguntas de esclarecimento: o bot pergunta curto no chat, com opções
// numeradas, e a PRÓXIMA mensagem do dono vira a resposta (número ou nome).
// Só existe uma pergunta pendente por vez; uma nova substitui a anterior.
//
//   const choice = await clarifier.ask('Qual casa?', ['casa (-300,64)', 'casa velha (120,70)'])
//   // -> { index: 0, option: 'casa (-300,64)' } ou null (timeout/cancelado)

const TIMEOUT_MS = 60000
const SIM = new Set(['sim', 's', 'yes', 'y', 'claro', 'isso', 'ok'])
const NAO = new Set(['nao', 'não', 'n', 'no'])
const CANCELAR = new Set(['cancelar', 'cancela', 'nenhum', 'nenhuma', 'deixa', 'esquece', '0'])

const norm = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim()

// Rótulo da opção sem o sufixo de coordenadas/origem, para comparar com o que o jogador digitou.
const optionName = (label) => norm(label).replace(/\s*[([].*$/, '').trim()

class Clarifier {
  constructor({ say = () => {}, timeoutMs = TIMEOUT_MS } = {}) {
    this.say = say
    this.timeoutMs = timeoutMs
    this.pending = null
  }

  isPending() {
    return Boolean(this.pending)
  }

  // options: lista de rótulos (strings). Resolve { index, option } ou null.
  // who: se definido, só aceita resposta desse jogador.
  ask(question, options, { who = null, timeoutMs = this.timeoutMs, kind = 'escolha' } = {}) {
    this.cancel()
    const opts = (options || []).map(String)
    const text = kind === 'confirmar'
      ? question
      : `${question} ${opts.map((o, i) => `${i + 1}) ${o}`).join(' ')}`
    this.say(text.slice(0, 250))

    return new Promise((resolve) => {
      const pending = {
        question, options: opts, who, kind, resolve, hinted: false,
        timer: setTimeout(() => {
          if (this.pending !== pending) return
          this.pending = null
          this.say('Sem resposta; deixei pra lá.')
          resolve(null)
        }, timeoutMs)
      }
      this.pending = pending
    })
  }

  // Pergunta sim/não. Resolve true, false ou null (sem resposta).
  async confirm(question, opts = {}) {
    const choice = await this.ask(question, ['sim', 'não'], { ...opts, kind: 'confirmar' })
    return choice ? choice.index === 0 : null
  }

  cancel() {
    const pending = this.pending
    if (!pending) return false
    this.pending = null
    clearTimeout(pending.timer)
    pending.resolve(null)
    return true
  }

  _finish(value) {
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    pending.resolve(value)
  }

  // Tenta interpretar `message` como resposta. Retorna true se a mensagem
  // foi consumida (não deve seguir para os comandos).
  handleMessage(username, message) {
    const pending = this.pending
    if (!pending) return false
    if (pending.who && username !== pending.who) return false
    const text = norm(message)

    // Um comando novo encerra a pergunta e segue normalmente.
    if (text.startsWith('!')) {
      this.cancel()
      return false
    }

    if (CANCELAR.has(text)) {
      this._finish(null)
      this.say('Ok, deixei pra lá.')
      return true
    }

    if (pending.kind === 'confirmar') {
      const answer = SIM.has(text) ? 0 : NAO.has(text) ? 1 : -1
      if (answer >= 0) {
        this._finish({ index: answer, option: pending.options[answer] })
        return true
      }
    } else {
      const index = this.match(text, pending.options)
      if (index >= 0) {
        this._finish({ index, option: pending.options[index] })
        return true
      }
    }

    // Não entendi: avisa uma vez; depois deixa a conversa seguir.
    if (!pending.hinted) {
      pending.hinted = true
      this.say(pending.kind === 'confirmar'
        ? 'Responda sim ou não.'
        : `Responda com o número (1-${pending.options.length}) ou o nome.`)
      return true
    }
    return false
  }

  // Índice da opção que casa com o texto: número, nome exato ou prefixo único.
  match(text, options) {
    const n = Number.parseInt(text.replace(/[).]$/, ''), 10)
    if (/^\d+[).]?$/.test(text) && n >= 1 && n <= options.length) return n - 1
    const names = options.map(optionName)
    const exact = names.findIndex((name, i) => name === text || norm(options[i]) === text)
    if (exact >= 0) return exact
    const prefix = names.map((name, i) => (name.startsWith(text) ? i : -1)).filter((i) => i >= 0)
    if (prefix.length === 1) return prefix[0]
    return -1
  }
}

module.exports = { Clarifier, TIMEOUT_MS }
