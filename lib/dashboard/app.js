// Painel do mbot: consulta o StatusServer local a cada 2 s, sem recarregar a página.
// Todo texto vindo do bot entra por textContent (nunca innerHTML).
'use strict'

const POLL_MS = 2000
const $ = (id) => document.getElementById(id)

const state = {
  snapshot: null,
  scenarios: null,
  selectedBot: null, // null = bot principal
  selectedRun: null,
  invTab: 'list',
  lastOk: null,
  viewerPort: null,
  inventoryPort: null,
  starting: false
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child == null) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function fmtPos(p) {
  return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : '—'
}
function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : '—'
}
function fmtDuration(ms) {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}
function badge(node, status) {
  node.textContent = status || '—'
  node.dataset.s = status || ''
}

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function poll() {
  try {
    const [snapshot, scenarios] = await Promise.all([getJson('/api/snapshot'), getJson('/api/scenarios')])
    state.snapshot = snapshot
    state.scenarios = scenarios
    state.lastOk = Date.now()
    render()
  } catch (err) {
    renderOffline(err)
  } finally {
    setTimeout(poll, POLL_MS)
  }
}

function renderOffline(err) {
  const conn = $('conn')
  conn.dataset.state = 'offline'
  $('conn-text').textContent = 'painel offline'
  $('updated').textContent = state.lastOk
    ? `sem resposta desde ${new Date(state.lastOk).toLocaleTimeString()} (${err.message})`
    : `sem resposta (${err.message})`
  for (const button of document.querySelectorAll('#scenarios button')) button.disabled = true
}

function render() {
  const snap = state.snapshot
  const main = snap.main || {}
  const conn = $('conn')
  conn.dataset.state = main.connected ? 'ok' : 'bot-off'
  $('conn-text').textContent = main.connected ? `${main.name} conectado` : 'bot desconectado'
  $('updated').textContent = `atualizado ${new Date(snap.timestamp).toLocaleTimeString()} · uptime ${snap.uptime}s`
  $('profile').textContent = snap.profile ? `${snap.profile.version} · ${snap.profile.id} · ${snap.profile.server}` : ''

  renderViews(snap.views)
  renderBot(main)
  renderWorkers(snap.workers || [])
  renderInventory()
  renderProject(snap.project)
  renderScenarios()
  renderHistory()
  renderLogs()
}

function viewUrl(port) {
  return `http://${location.hostname}:${port}/`
}

function renderViews(views) {
  const viewer = views?.viewer
  const slot = $('viewer-slot')
  const status = $('viewer-status')
  if (viewer?.status === 'ativo') {
    status.textContent = `127.0.0.1:${viewer.port}`
    if (state.viewerPort !== viewer.port) {
      state.viewerPort = viewer.port
      slot.replaceChildren(el('iframe', { src: viewUrl(viewer.port), title: 'Visualizador 3D do bot principal' }))
    }
  } else {
    state.viewerPort = null
    status.textContent = viewer ? viewer.status : 'desligado'
    const reason = !viewer || viewer.status === 'desligado'
      ? 'Visualizador desligado. Rode o bot com MBOT_VIEWER_PORT=3007.'
      : `Visualizador ${viewer.status}${viewer.error ? `: ${viewer.error}` : ''}.`
    slot.replaceChildren(el('p', { class: 'placeholder', text: views ? reason : 'Aguardando o bot entrar no mundo…' }))
  }

  const inventory = views?.inventory
  const tab = $('tab-web')
  tab.disabled = inventory?.status !== 'ativo'
  tab.title = tab.disabled ? 'Rode o bot com MBOT_INVENTORY_PORT=3008' : `127.0.0.1:${inventory.port}`
  if (inventory?.status === 'ativo' && state.inventoryPort !== inventory.port) {
    state.inventoryPort = inventory.port
    $('inv-web').replaceChildren(el('iframe', { src: viewUrl(inventory.port), title: 'Inventário web do bot principal' }))
  }
  if (tab.disabled && state.invTab === 'web') setInvTab('list')
}

function renderBot(main) {
  $('bot-name').textContent = main.name || 'Bot'
  badge($('bot-status'), main.status)
  const facts = [
    ['Modo', main.task ? `${main.mode} · ${main.task}` : main.mode],
    ['Posição', fmtPos(main.position)],
    ['Dimensão', main.dimension],
    ['Jogo', main.gameMode],
    ['Dono', main.owner]
  ]
  $('bot-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v ?? '—' })]))
  $('hp').value = main.health ?? 0
  $('hp-v').textContent = main.health ?? '—'
  $('food').value = main.food ?? 0
  $('food-v').textContent = main.food ?? '—'
}

function renderWorkers(workers) {
  $('workers-count').textContent = `${workers.length}`
  if (state.selectedBot && !workers.some((w) => w.name === state.selectedBot)) state.selectedBot = null
  const rows = workers.map((w) => el('tr', {
    tabindex: 0,
    'aria-selected': state.selectedBot === w.name ? 'true' : 'false',
    title: 'Ver inventário deste worker',
    onclick: () => selectBot(w.name),
    onkeydown: (e) => { if (e.key === 'Enter') selectBot(w.name) }
  },
  el('td', { text: w.name }),
  el('td', { text: w.role }),
  el('td', { text: w.status }),
  el('td', { text: w.task ? [w.task.type, w.task.resource].filter(Boolean).join(' · ') : '—' }),
  el('td', { class: 'num', text: fmtPos(w.position) }),
  el('td', { class: 'num', text: w.health ?? '—' })))
  $('workers').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: 6, class: 'muted', text: 'Nenhum worker.' }))]))
}

function selectBot(name) {
  state.selectedBot = state.selectedBot === name ? null : name
  if (state.selectedBot) setInvTab('list')
  render()
}

function renderInventory() {
  const snap = state.snapshot
  const target = state.selectedBot
    ? (snap.workers || []).find((w) => w.name === state.selectedBot)
    : snap.main
  $('inv-owner').textContent = target?.name ? `· ${target.name}` : ''
  const items = target?.inventory || []
  $('inv-list').replaceChildren(...(items.length
    ? items.map((item) => el('li', { title: `slot ${item.slot}` }, el('span', { text: item.name }), el('b', { text: `×${item.count}` })))
    : [el('li', {}, el('span', { class: 'muted', text: target?.connected ? 'Inventário vazio' : 'Sem dados' }))]))
  $('tab-web').disabled = $('tab-web').disabled || Boolean(state.selectedBot)
}

function setInvTab(tab) {
  state.invTab = tab
  $('tab-list').setAttribute('aria-selected', String(tab === 'list'))
  $('tab-web').setAttribute('aria-selected', String(tab === 'web'))
  $('inv-list').hidden = tab !== 'list'
  $('inv-web').hidden = tab !== 'web'
}

function renderProject(project) {
  const box = $('project')
  if (!project) {
    box.className = 'muted'
    box.textContent = 'Nenhum projeto ativo.'
    return
  }
  box.className = ''
  const actions = project.actions || []
  const done = actions.filter((a) => a.status === 'concluido').length
  const progress = el('progress', { max: Math.max(1, actions.length), value: done })
  box.replaceChildren(
    el('div', {}, el('strong', { text: project.label || project.type }), ' ', el('span', { class: 'badge', text: project.status })),
    el('div', { class: 'small muted', text: `ações ${done}/${actions.length}` }), progress,
    el('ul', { class: 'small' }, ...actions.map((a) => el('li', { text: `${a.id} (${a.role}): ${a.status}${a.lastError ? ` — ${a.lastError}` : ''}` })))
  )
}

function renderScenarios() {
  const data = state.scenarios || { catalog: [], current: null }
  const running = Boolean(data.current) || state.starting
  const offline = $('conn').dataset.state === 'offline'
  $('scenarios').replaceChildren(...data.catalog.map((s) => {
    const status = el('span', { class: 'badge' })
    badge(status, s.status)
    return el('li', {},
      el('span', { class: 'title', text: s.title }),
      status,
      el('button', { disabled: running || offline, onclick: () => startScenario(s.id), 'aria-label': `Executar ${s.title}` }, 'Executar'),
      el('span', { class: 'desc', text: s.action }))
  }))

  const current = data.current || data.history?.[0] || null
  const box = $('current')
  badge($('current-status'), current?.status)
  if (!current) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Nenhum cenário executado nesta sessão.' }))
    return
  }
  const elapsed = current.status === 'RUNNING' && current.startedAt ? Date.now() - Date.parse(current.startedAt) : current.durationMs
  box.replaceChildren(...[
    el('div', {}, el('strong', { text: current.title }), el('span', { class: 'muted small', text: ` · ${current.bot || ''}` })),
    el('div', { class: 'small muted', text: `${data.current ? 'em execução há' : 'última execução:'} ${fmtDuration(elapsed)} · ${fmtTime(current.startedAt || current.createdAt)}` }),
    current.reasons?.length ? el('ul', { class: 'small nok' }, ...current.reasons.map((r) => el('li', { text: r }))) : null
  ].filter(Boolean))
}

async function startScenario(id) {
  const errorBox = $('scenario-error')
  errorBox.hidden = true
  state.starting = true
  renderScenarios()
  try {
    const response = await fetch(`/api/scenarios/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mbot-Dashboard': '1' },
      body: '{}'
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
    state.selectedRun = body.runId
  } catch (err) {
    errorBox.textContent = `Não iniciou: ${err.message}`
    errorBox.hidden = false
  } finally {
    state.starting = false
  }
  try {
    state.scenarios = await getJson('/api/scenarios')
    renderScenarios()
    renderHistory()
  } catch {}
}

function renderHistory() {
  const history = state.scenarios?.history || []
  $('history').replaceChildren(...(history.length
    ? history.map((run) => {
      const status = el('span', { class: 'badge' })
      badge(status, run.status)
      return el('li', {
        tabindex: 0,
        'aria-selected': state.selectedRun === run.runId ? 'true' : 'false',
        onclick: () => { state.selectedRun = run.runId; renderHistory() },
        onkeydown: (e) => { if (e.key === 'Enter') { state.selectedRun = run.runId; renderHistory() } }
      }, status, el('span', { text: run.title }), el('span', { class: 'muted small', text: fmtTime(run.createdAt) }))
    })
    : [el('li', { class: 'muted' }, 'Nada executado ainda.')]))

  const detail = $('run-detail')
  const run = history.find((r) => r.runId === state.selectedRun)
  if (!run) {
    detail.hidden = true
    return
  }
  detail.hidden = false
  const status = el('span', { class: 'badge' })
  badge(status, run.status)
  detail.replaceChildren(...[
    el('div', {}, el('strong', { text: run.title }), ' ', status),
    el('div', { class: 'small muted', text: `${run.runId} · bot ${run.bot || '—'} · início ${fmtTime(run.startedAt || run.createdAt)} · fim ${fmtTime(run.finishedAt)} · ${fmtDuration(run.durationMs)}` }),
    el('div', { class: 'small', text: `Ação: ${run.action}` }),
    el('h3', { text: 'Pré-condições' }),
    el('ul', { class: 'small' }, ...(run.preconditions || []).map((c) => el('li', { class: c.ok ? 'ok' : 'nok', text: `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}` }))),
    run.reasons?.length ? el('h3', { text: 'Motivos' }) : null,
    run.reasons?.length ? el('ul', { class: 'small nok' }, ...run.reasons.map((r) => el('li', { text: r }))) : null,
    el('h3', { text: 'Evidência' }),
    el('pre', { text: run.evidence ? JSON.stringify(run.evidence, null, 2) : '(sem evidência)' })
  ].filter(Boolean))
}

function renderLogs() {
  const snap = state.snapshot
  const source = $('log-source').value
  const level = $('log-level').value
  const text = $('log-text').value.trim().toLowerCase()
  const lines = []
  if (source !== 'events') {
    for (const line of snap.logs || []) lines.push({ time: line.time, level: line.level, label: line.level, text: line.text })
  }
  if (source !== 'console') {
    for (const ev of snap.events?.recent || []) {
      const { time, type, worker, ...data } = ev
      const failed = type === 'scenario_status' && ['FAIL', 'BLOCKED'].includes(data.status)
      lines.push({ time, level: failed || /error|death|fail/i.test(type) ? 'error' : 'event', label: 'evento', text: `${type}${worker ? ` [${worker}]` : ''} ${JSON.stringify(data)}` })
    }
  }
  lines.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const filtered = lines.filter((line) => {
    if (level === 'error' && line.level !== 'error') return false
    if (level === 'warn' && !['warn', 'error'].includes(line.level)) return false
    return !text || line.text.toLowerCase().includes(text)
  }).slice(-300)

  const list = $('logs')
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
  list.replaceChildren(...filtered.map((line) => el('li', { class: `lv-${line.level}` },
    el('span', { class: 'muted', text: fmtTime(line.time) }),
    el('span', { text: line.label }),
    el('span', { text: line.text }))))
  if (atBottom) list.scrollTop = list.scrollHeight
}

$('tab-list').addEventListener('click', () => setInvTab('list'))
$('tab-web').addEventListener('click', () => { if (!$('tab-web').disabled) setInvTab('web') })
for (const id of ['log-source', 'log-level', 'log-text']) $(id).addEventListener('input', () => state.snapshot && renderLogs())
poll()
