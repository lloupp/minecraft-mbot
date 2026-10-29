/* global THREE, fetch */
// Controles de camera do visualizador (carregado depois do bundle do
// prismarine-viewer). O bundle mantem um OrbitControls; usamos a camera dele
// (controls.object) e o metodo update para alternar entre:
//   first  - primeira pessoa, na cabeca do bot
//   follow - terceira pessoa, orbita em volta do bot e acompanha o movimento
//   free   - camera livre: fica onde voce deixar
//   top    - visao de cima, acompanhando o bot
// Sem reconstruir o bundle: apenas embrulhamos render() e update().
(function () {
  const MODES = { FIRST: 'first', FOLLOW: 'follow', FREE: 'free', TOP: 'top' }
  const LABELS = {
    first: '1\u00aa pessoa',
    follow: '3\u00aa pessoa',
    free: 'Livre',
    top: 'Topo'
  }

  let mode = localStorage.getItem('mbotCameraMode') || MODES.FOLLOW
  if (!Object.values(MODES).includes(mode)) mode = MODES.FOLLOW

  const state = {
    username: 'bot',
    position: null,
    yaw: 0,
    pitch: 0,
    timeOfDay: null,
    isDay: null
  }
  let camera = null
  let controls = null
  let scene = null
  let placed = false
  let lastTarget = null
  const pressed = new Set()
  let movementFrame = 0
  let movementTime = 0

  function hasPosition () {
    return state.position && Number.isFinite(state.position.x)
  }

  function target () {
    return new THREE.Vector3(state.position.x, state.position.y + 1.2, state.position.z)
  }

  // O bundle do prismarine-viewer usa um céu fixo (azul-claro) e não desenha
  // sol/lua. Ajustamos a cor de fundo pela hora do servidor para o visualizador
  // não parecer "dia" enquanto o bot está à noite.
  let dayColor = null
  let nightColor = null
  function applySky () {
    if (!scene || !window.THREE || !Number.isFinite(state.timeOfDay)) return
    const T = window.THREE
    if (!dayColor) {
      dayColor = new T.Color(0x87ceeb)
      nightColor = new T.Color(0x0b1026)
    }
    const t = state.timeOfDay
    let color
    if (t >= 13000 && t < 22500) color = nightColor
    else if (t >= 11500 && t < 13000) color = dayColor.clone().lerp(nightColor, (t - 11500) / 1500)
    else if (t >= 22500 && t < 23500) color = nightColor.clone().lerp(dayColor, (t - 22500) / 1000)
    else color = dayColor
    if (scene.background && scene.background.isColor) scene.background.copy(color)
    else scene.background = color
  }

  function clockText (t) {
    if (!Number.isFinite(t)) return ''
    let hours = ((t / 1000) + 6) % 24
    if (hours < 0) hours += 24
    const h = Math.floor(hours)
    const m = Math.floor((hours - h) * 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  function applyFirstPerson () {
    if (!camera || !hasPosition()) return
    camera.position.set(state.position.x, state.position.y + 1.62, state.position.z)
    camera.rotation.set(state.pitch || 0, state.yaw || 0, 0, 'ZYX')
  }

  function place (kind) {
    if (!camera || !hasPosition()) return
    const t = target()
    if (kind === MODES.FOLLOW) {
      camera.position.set(t.x, t.y + 6, t.z + 10)
    } else if (kind === MODES.FREE) {
      camera.position.set(t.x + 12, t.y + 10, t.z + 12)
    } else if (kind === MODES.TOP) {
      camera.position.set(t.x + 0.01, t.y + 26, t.z + 0.01)
    }
    if (controls) {
      controls.target.copy(t)
      lastTarget = t.clone()
      controls.update()
    }
  }

  function setMode (next) {
    const key = String(next || '').toLowerCase()
    if (!Object.values(MODES).includes(key)) return
    mode = key
    localStorage.setItem('mbotCameraMode', mode)
    placed = false
    lastTarget = null
    if (controls) {
      controls.enabled = mode !== MODES.FIRST
    }
    if (mode === MODES.FIRST) {
      applyFirstPerson()
    } else {
      place(mode)
      placed = true
    }
    updateButtons()
  }

  function updateButtons () {
    for (const button of document.querySelectorAll('[data-camera-mode]')) {
      const active = button.getAttribute('data-camera-mode') === mode
      button.style.background = active ? '#3d8b40' : 'rgba(20,20,20,.82)'
      button.style.borderColor = active ? '#7ee081' : '#666'
      button.setAttribute('aria-pressed', String(active))
    }
    const status = document.getElementById('camera-status')
    if (status) {
      const pos = hasPosition()
        ? `${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}`
        : 'entrando...'
      const time = clockText(state.timeOfDay)
      const phase = state.timeOfDay == null ? '' : (state.isDay ? '' : ' noite')
      status.textContent = `${state.username} \u00b7 ${LABELS[mode]} \u00b7 ${time}${phase} \u00b7 ${pos}`
    }
  }

  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'])

  function startKeyboardMotion () {
    if (movementFrame || !controls || !camera) return
    movementTime = performance.now()
    const step = (now) => {
      movementFrame = 0
      if (![...pressed].some((key) => MOVE_KEYS.has(key)) || !controls || !camera) return
      const elapsed = Math.min((now - movementTime) / 1000, 0.05)
      movementTime = now
      const speed = (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 24 : 8) * elapsed
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0
      if (forward.lengthSq()) forward.normalize()
      const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
      const movement = new THREE.Vector3()
      if (pressed.has('KeyW')) movement.add(forward)
      if (pressed.has('KeyS')) movement.sub(forward)
      if (pressed.has('KeyD')) movement.add(right)
      if (pressed.has('KeyA')) movement.sub(right)
      if (pressed.has('KeyE')) movement.y += 1
      if (pressed.has('KeyQ')) movement.y -= 1
      if (movement.lengthSq()) {
        if (mode !== MODES.FREE) setMode(MODES.FREE)
        movement.normalize().multiplyScalar(speed)
        camera.position.add(movement)
        controls.target.add(movement)
        lastTarget = controls.target.clone()
        controls.update()
      }
      movementFrame = requestAnimationFrame(step)
    }
    movementFrame = requestAnimationFrame(step)
  }

  function rotateWithArrows (code) {
    if (!controls || !camera) return
    if (mode !== MODES.FREE) setMode(MODES.FREE)
    const offset = camera.position.clone().sub(controls.target)
    const radius = offset.length()
    if (!radius) return
    const theta = Math.atan2(offset.x, offset.z)
    let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)))
    const turn = 0.08
    const nextTheta = theta + (code === 'ArrowLeft' ? turn : code === 'ArrowRight' ? -turn : 0)
    phi += code === 'ArrowUp' ? -turn : code === 'ArrowDown' ? turn : 0
    phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi))
    offset.set(
      radius * Math.sin(phi) * Math.sin(nextTheta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(nextTheta)
    )
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  function initUI () {
    const css = document.createElement('style')
    css.textContent = `
      #camera-ui { position: fixed; top: 10px; left: 10px; z-index: 10; font: 13px/1.4 system-ui, sans-serif; color: #eee; }
      #camera-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
      #camera-buttons button { cursor: pointer; color: #fff; background: rgba(20,20,20,.82); border: 1px solid #666; border-radius: 5px; padding: 6px 10px; font: inherit; }
      #camera-buttons button:hover { border-color: #aaa; }
      #camera-status { margin-top: 6px; padding: 4px 7px; background: rgba(0,0,0,.55); border-radius: 4px; }
      #camera-help { position: fixed; left: 10px; bottom: 10px; z-index: 10; color: #eee; background: rgba(0,0,0,.55); border-radius: 4px; padding: 4px 7px; font: 12px/1.4 system-ui, sans-serif; }
      #camera-help b { color: #9fe3a3; }
    `
    document.head.appendChild(css)

    const panel = document.createElement('div')
    panel.id = 'camera-ui'

    const buttons = document.createElement('div')
    buttons.id = 'camera-buttons'
    for (const key of Object.keys(LABELS)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = LABELS[key]
      button.setAttribute('data-camera-mode', key)
      button.setAttribute('aria-pressed', 'false')
      button.addEventListener('click', () => setMode(key))
      buttons.appendChild(button)
    }
    panel.appendChild(buttons)

    const status = document.createElement('div')
    status.id = 'camera-status'
    status.textContent = 'conectando...'
    panel.appendChild(status)
    document.body.appendChild(panel)

    const help = document.createElement('div')
    help.id = 'camera-help'
    help.innerHTML = 'Clique na camera · <b>1–4</b> modos · <b>WASD</b> mover · <b>Q/E</b> descer/subir · <b>setas</b> girar · <b>Shift</b> rapido · mouse: arraste/roda'
    document.body.appendChild(help)

    document.addEventListener('keydown', (event) => {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        pressed.add(event.code)
        return
      }
      const map = { Digit1: MODES.FIRST, Digit2: MODES.FOLLOW, Digit3: MODES.FREE, Digit4: MODES.TOP }
      const next = map[event.code]
      if (next) {
        setMode(next)
        return
      }
      if (MOVE_KEYS.has(event.code)) {
        event.preventDefault()
        pressed.add(event.code)
        if (event.shiftKey) pressed.add('ShiftLeft')
        startKeyboardMotion()
      } else if (event.code.startsWith('Arrow')) {
        event.preventDefault()
        if (!event.repeat) rotateWithArrows(event.code)
      }
    })
    document.addEventListener('keyup', (event) => {
      pressed.delete(event.code)
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        pressed.delete('ShiftLeft')
        pressed.delete('ShiftRight')
      }
    })
    window.addEventListener('blur', () => pressed.clear())

    updateButtons()
  }

  // Nesta versao do three o OrbitControls define update() na propria
  // instancia; embrulhamos a instancia para acompanhar o bot sem perder o
  // angulo/zoom escolhido no mouse.
  function wrapControls (c) {
    if (!c || c.__botWrapped) return
    c.__botWrapped = true
    const originalUpdate = c.update.bind(c)
    c.update = function () {
      controls = c
      if (c.object) camera = c.object
      if (mode === MODES.FIRST) return false
      c.enabled = true
      if (hasPosition() && (mode === MODES.FOLLOW || mode === MODES.TOP)) {
        const t = target()
        if (lastTarget) {
          c.object.position.x += t.x - lastTarget.x
          c.object.position.y += t.y - lastTarget.y
          c.object.position.z += t.z - lastTarget.z
        }
        if (mode === MODES.TOP) c.object.position.y = t.y + 26
        c.target.copy(t)
        lastTarget = t.clone()
      }
      return originalUpdate()
    }
  }

  function installHooks () {
    const found = window.__botControls
    if (!found || !found.object) {
      setTimeout(installHooks, 50)
      return
    }
    const T = window.THREE
    controls = found
    camera = found.object
    wrapControls(controls)

    const originalRender = T.WebGLRenderer.prototype.render
    T.WebGLRenderer.prototype.render = function (sceneObj, cam) {
      scene = sceneObj
      camera = cam
      if (mode === MODES.FIRST) {
        applyFirstPerson()
      } else if (!placed && hasPosition()) {
        place(mode)
        placed = true
      }
      return originalRender.call(this, sceneObj, cam)
    }

    initUI()
    poll()
  }

  async function poll () {
    if (window.__botControls && window.__botControls !== controls) {
      controls = window.__botControls
      camera = controls.object
      wrapControls(controls)
      placed = false
    }
    try {
      const response = await fetch('/state.json', { cache: 'no-store' })
      const data = await response.json()
      state.username = data.username || 'bot'
      state.position = data.position
      state.yaw = data.yaw || 0
      state.pitch = data.pitch || 0
      state.timeOfDay = data.time?.timeOfDay ?? null
      state.isDay = data.time?.isDay ?? null
      applySky()
      if (mode === MODES.FIRST) applyFirstPerson()
      else if (!placed && hasPosition() && camera) {
        place(mode)
        placed = true
      }
      updateButtons()
    } catch (err) {
      // servidor reiniciando; tenta de novo no proximo ciclo
    }
    setTimeout(poll, 100)
  }

  // Exposto para diagnostico e para testes automatizados.
  window.__botViewer = {
    get mode () { return mode },
    get camera () { return camera },
    get controls () { return controls },
    get state () { return state },
    setMode,
    place: () => place(mode),
    applyFirstPerson
  }

  installHooks()
})()
