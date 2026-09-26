// core/Memory.js
// Memória tipada do bot, com proveniência: cada item diz de onde veio
// (visto pelo bot, dito por um jogador ou inferido), quando e com que confiança.
//
// Tipos:
//   lugar       { nome, chave, posicao {x,y,z}, dimensao }
//   preferencia { chave, valor }
//   compromisso { descricao, para, prazo, estado: pendente|feito|falhou|cancelado }
//   fato        { descricao, assunto, posicao?, expiraEm? }
//
// Persistida num JSON próprio em .data/ (ignorado pelo git), gravado de forma
// atômica como o StateStore.

const fs = require('fs')
const path = require('path')
const { normalizeWaypointName, waypointPoint } = require('./WaypointManager')

const TIPOS = ['lugar', 'preferencia', 'compromisso', 'fato']
const ORIGENS = ['visto', 'dito', 'inferido']
const CONFIANCA_PADRAO = { visto: 0.9, dito: 1, inferido: 0.6 }
const MAX_ITENS = 500
const MAX_COMPROMISSOS_ENCERRADOS = 50

// Nomes de tipos aceitos no chat (!memoria lugares, !memoria prefs...).
const TIPO_ALIASES = {
  lugar: 'lugar', lugares: 'lugar', local: 'lugar', locais: 'lugar',
  preferencia: 'preferencia', preferencias: 'preferencia', pref: 'preferencia', prefs: 'preferencia',
  compromisso: 'compromisso', compromissos: 'compromisso', promessas: 'compromisso',
  fato: 'fato', fatos: 'fato'
}

function tipoDe(value) {
  const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return TIPO_ALIASES[key] || null
}

// Chave de preferência: minúsculas, sem acento, só [a-z0-9._-].
function normalizarChave(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

// Valor digitado no chat: número vira número, sim/não vira booleano.
function parseValor(raw) {
  const text = String(raw ?? '').trim()
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  const lower = text.toLowerCase()
  if (['sim', 'true', 'on'].includes(lower)) return true
  if (['nao', 'não', 'false', 'off'].includes(lower)) return false
  return text
}

// Monta a proveniência de um item. `quem` só faz sentido para 'dito'.
function origem(tipo, { quem = null, confianca = null, em = null } = {}) {
  const t = ORIGENS.includes(tipo) ? tipo : 'inferido'
  const c = confianca == null ? NaN : Number(confianca)
  return {
    tipo: t,
    quem: quem ? String(quem) : null,
    em: em || new Date().toISOString(),
    confianca: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : CONFIANCA_PADRAO[t]
  }
}

const dito = (quem, extra = {}) => origem('dito', { ...extra, quem })
const visto = (extra = {}) => origem('visto', extra)
const inferido = (extra = {}) => origem('inferido', extra)

function fmtPos(p) {
  return p ? `(${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)})` : ''
}

// "há 3min", "há 2h", "há 1d".
function idade(iso, now = Date.now()) {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function fmtOrigem(o, now) {
  if (!o) return '[?]'
  const quem = o.tipo === 'dito' && o.quem ? `dito por ${o.quem}` : o.tipo
  const when = o.tipo === 'dito' ? '' : ` ${idade(o.em, now)}`
  return `[${quem}${when}]`
}

// Linha curta para o chat, ex.: "casa (-300,64,-520) [dito por eduardo]".
function formatar(item, now = Date.now()) {
  const tag = fmtOrigem(item.origem, now)
  switch (item.tipo) {
    case 'lugar':
      return `${item.nome} ${tag}`
    case 'preferencia':
      return `${item.chave}=${item.valor} ${tag}`
    case 'compromisso':
      return `${item.descricao}${item.para ? ` p/ ${item.para}` : ''} (${item.estado}) ${tag}`
    case 'fato':
      return `${item.descricao} ${tag}`
    default:
      return `${item.tipo}? ${tag}`
  }
}

class Memory {
  constructor({
    filePath = process.env.MEMORY_FILE || '.data/memory.json',
    maxItems = MAX_ITENS,
    now = () => Date.now(),
    autoSave = true
  } = {}) {
    this.autoSave = autoSave
    this.filePath = path.resolve(filePath)
    this.maxItems = Math.max(10, maxItems)
    this.now = now
    this.items = []
    this.nextId = 1
    this.lastLoadError = null
    this._write = Promise.resolve()
    this._timer = null
  }

  // ---------- persistência ----------

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8')
      this.restore(JSON.parse(raw))
    } catch (err) {
      if (err.code === 'ENOENT') return this
      if (err instanceof SyntaxError) {
        this.lastLoadError = err
        return this
      }
      throw err
    }
    return this
  }

  restore(data) {
    this.items = []
    const list = Array.isArray(data?.items) ? data.items : []
    for (const raw of list) {
      if (!raw || !TIPOS.includes(raw.tipo)) continue
      const item = { ...raw, origem: raw.origem ? origem(raw.origem.tipo, raw.origem) : inferido() }
      if (item.tipo === 'lugar') {
        // Compatibilidade: ignore posições antigas. Coordenadas pertencem somente ao WaypointManager.
        delete item.posicao
        delete item.dimensao
        item.nome = String(item.nome || item.waypoint || '').trim().slice(0, 32)
        item.waypoint = normalizeWaypointName(item.waypoint || item.nome)
        item.chave = item.waypoint
        if (!item.waypoint || !item.nome) continue
      }
      if (item.tipo === 'preferencia') {
        item.chave = normalizarChave(item.chave)
        if (!item.chave) continue
      }
      if (!Number.isInteger(item.id) || item.id < 1) item.id = 0
      if (!item.atualizadoEm) item.atualizadoEm = item.criadoEm || item.origem.em
      this.items.push(item)
    }
    let maxId = this.items.reduce((m, i) => Math.max(m, i.id), 0)
    for (const item of this.items) if (!item.id) item.id = ++maxId
    this.nextId = Math.max(Number(data?.nextId) || 1, maxId + 1)
    this.prune()
  }

  exportState() {
    return { version: 1, nextId: this.nextId, items: this.items.map((i) => ({ ...i })), updatedAt: new Date(this.now()).toISOString() }
  }

  async save() {
    const data = this.exportState()
    const run = async () => {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp-${process.pid}`
      await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
      await fs.promises.rename(tmp, this.filePath)
      return data
    }
    this._write = this._write.then(run, run)
    return this._write
  }

  // Agrupa várias mudanças seguidas numa gravação só.
  saveSoon(ms = 1000) {
    if (!this.autoSave) return
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => {
      this._timer = null
      this.save().catch((err) => console.log(`[memória] não consegui salvar: ${err.message}`))
    }, ms)
    this._timer.unref?.()
  }

  // ---------- escrita ----------

  _novo(tipo, campos, prov) {
    const ts = new Date(this.now()).toISOString()
    const item = { id: this.nextId++, tipo, ...campos, origem: prov || inferido(), criadoEm: ts, atualizadoEm: ts }
    if (!item.origem.em) item.origem.em = ts
    this.items.push(item)
    this.prune()
    this.saveSoon()
    return item
  }

  _atualizar(item, campos, prov) {
    Object.assign(item, campos, { origem: prov || item.origem, atualizadoEm: new Date(this.now()).toISOString() })
    this.saveSoon()
    return item
  }

  lembrarLugar(nome, prov = inferido(), contexto = null) {
    const waypoint = normalizeWaypointName(nome)
    if (!waypoint) throw new Error('nome de lugar inválido')
    const campos = { nome: String(nome).trim().slice(0, 32), waypoint, chave: waypoint }
    if (contexto) campos.contexto = String(contexto).slice(0, 120)
    const atual = this.items.find((i) => i.tipo === 'lugar' && i.waypoint === waypoint)
    // O que o jogador disse vale mais do que o que o bot viu sozinho.
    if (atual && atual.origem?.tipo === 'dito' && prov.tipo !== 'dito') return atual
    return atual ? this._atualizar(atual, campos, prov) : this._novo('lugar', campos, prov)
  }

  definirPreferencia(chave, valor, prov = inferido()) {
    const k = normalizarChave(chave)
    if (!k) throw new Error('chave inválida')
    const atual = this.items.find((i) => i.tipo === 'preferencia' && i.chave === k)
    return atual ? this._atualizar(atual, { valor }, prov) : this._novo('preferencia', { chave: k, valor }, prov)
  }

  preferencia(chave, padrao = undefined) {
    const k = normalizarChave(chave)
    const item = this.items.find((i) => i.tipo === 'preferencia' && i.chave === k)
    return item ? item.valor : padrao
  }

  // Preferência numérica limitada a [min, max]; fora disso usa o padrão.
  preferenciaNumero(chave, padrao, min = -Infinity, max = Infinity) {
    const n = Number(this.preferencia(chave))
    return Number.isFinite(n) && n >= min && n <= max ? n : padrao
  }

  prometer(descricao, { para = null, prazo = null } = {}, prov = inferido()) {
    return this._novo('compromisso', {
      descricao: String(descricao).slice(0, 80),
      para: para ? String(para) : null,
      prazo: prazo || null,
      estado: 'pendente'
    }, prov)
  }

  encerrarCompromisso(id, estado = 'feito') {
    const item = this.items.find((i) => i.id === id && i.tipo === 'compromisso')
    if (!item) return null
    return this._atualizar(item, { estado }, item.origem)
  }

  // ttlMs: expiração opcional (fatos ficam velhos: o minério é minerado, o item some).
  registrarFato(descricao, { assunto = null, posicao = null, ttlMs = null } = {}, prov = inferido()) {
    const pos = waypointPoint(posicao)
    return this._novo('fato', {
      descricao: String(descricao).slice(0, 100),
      assunto: assunto ? String(assunto) : null,
      posicao: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
      expiraEm: ttlMs ? new Date(this.now() + ttlMs).toISOString() : null
    }, prov)
  }

  esquecerLugar(nome) {
    const waypoint = normalizeWaypointName(nome)
    const antes = this.items.length
    this.items = this.items.filter((item) => item.tipo !== 'lugar' || item.waypoint !== waypoint)
    const removidos = antes - this.items.length
    if (removidos) this.saveSoon()
    return removidos
  }

  // Esquece lugares/preferências/fatos pelo nome (ou assunto). Retorna quantos saíram.
  esquecer(nome) {
    const chaveLugar = normalizeWaypointName(nome)
    const chavePref = normalizarChave(nome)
    const antes = this.items.length
    this.items = this.items.filter((i) => {
      if (i.tipo === 'lugar') return i.chave !== chaveLugar
      if (i.tipo === 'preferencia') return i.chave !== chavePref
      if (i.tipo === 'fato') return i.assunto !== nome && i.assunto !== chavePref
      return true
    })
    const removidos = antes - this.items.length
    if (removidos) this.saveSoon()
    return removidos
  }

  removerId(id) {
    const antes = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
    if (this.items.length !== antes) this.saveSoon()
    return this.items.length !== antes
  }

  // Remove fatos de um assunto perto de uma posição (ex.: minério que foi minerado).
  removerFatosPerto(assunto, posicao, raio = 1) {
    const antes = this.items.length
    this.items = this.items.filter((i) => !(i.tipo === 'fato' && i.assunto === assunto && i.posicao &&
      Math.abs(i.posicao.x - posicao.x) <= raio && Math.abs(i.posicao.y - posicao.y) <= raio &&
      Math.abs(i.posicao.z - posicao.z) <= raio))
    if (this.items.length !== antes) this.saveSoon()
    return antes - this.items.length
  }

  // ---------- leitura ----------

  expirado(item) {
    return Boolean(item.expiraEm) && Date.parse(item.expiraEm) <= this.now()
  }

  // Itens válidos, do mais recente para o mais antigo.
  listar(tipo = null) {
    return this.items
      .filter((i) => (!tipo || i.tipo === tipo) && !this.expirado(i))
      .sort((a, b) => Date.parse(b.atualizadoEm) - Date.parse(a.atualizadoEm) || b.id - a.id)
  }

  lugar(nome) {
    const chave = normalizeWaypointName(nome)
    return this.items.find((i) => i.tipo === 'lugar' && i.waypoint === chave) || null
  }

  lugares() {
    return this.listar('lugar')
  }

  // Fatos com algo em comum com o termo (assunto ou descrição), mais recentes primeiro.
  buscarFatos(termos) {
    const lista = (Array.isArray(termos) ? termos : [termos]).map((t) => String(t).toLowerCase()).filter(Boolean)
    return this.listar('fato').filter((i) => lista.some((t) =>
      String(i.assunto || '').toLowerCase().includes(t) || i.descricao.toLowerCase().includes(t)))
  }

  // Descarta expirados; acima do limite, primeiro os fatos mais antigos,
  // depois compromissos encerrados, e só por fim o restante.
  prune() {
    this.items = this.items.filter((i) => !this.expirado(i))
    const encerrados = this.items.filter((i) => i.tipo === 'compromisso' && i.estado !== 'pendente')
    if (encerrados.length > MAX_COMPROMISSOS_ENCERRADOS) {
      const remover = new Set(encerrados.sort(byOldest).slice(0, encerrados.length - MAX_COMPROMISSOS_ENCERRADOS))
      this.items = this.items.filter((i) => !remover.has(i))
    }
    if (this.items.length <= this.maxItems) return
    const ordem = [
      (i) => i.tipo === 'fato',
      (i) => i.tipo === 'compromisso' && i.estado !== 'pendente',
      () => true
    ]
    for (const grupo of ordem) {
      const excesso = this.items.length - this.maxItems
      if (excesso <= 0) return
      const remover = new Set(this.items.filter(grupo).sort(byOldest).slice(0, excesso))
      this.items = this.items.filter((i) => !remover.has(i))
    }
  }

  formatar(item) {
    return formatar(item, this.now())
  }
}

function byOldest(a, b) {
  return Date.parse(a.atualizadoEm) - Date.parse(b.atualizadoEm) || a.id - b.id
}

module.exports = {
  Memory,
  TIPOS,
  ORIGENS,
  MAX_ITENS,
  tipoDe,
  normalizarChave,
  parseValor,
  origem,
  dito,
  visto,
  inferido,
  formatar,
  idade,
  fmtPos,
  fmtOrigem
}
