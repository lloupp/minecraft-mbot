// @ts-check
// core/worker/exploration.js
// Exploração, memória do mundo e fatos de cama/comida/ovelha para o player loop.
// Métodos do WorkerController (aplicados ao prototype em core/WorkerController.js).

const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const food = require('../../lib/food')
const stateMachineExplore = require('../../lib/stateMachineExplore')
const night = require('../../lib/night')
const bedLib = require('../../lib/bed')
const worldObserver = require('../../lib/world-observer')
const { STATUS: MEMORY_STATUS } = require('../../lib/world-memory')
const { preparationRadius } = require('../../lib/forced-preparation')
const { BASE_BED_TRAVEL, FAILED_HUNT_MS, DEATH_DROPS_MS, DEATH_DROPS_RANGE, DIG_ESCAPE_MS, UNREACHED_MOVE, travelTimeoutMs } = require('./shared')

class ExplorationBehavior {
  // Superfície caminhável em (x, z) perto de nearY a partir dos chunks já carregados. Água/lava na superfície
  // (oceano, lago) ou nenhum chão => inválido; copas de árvore são atravessadas até o chão. unknown: chunk
  // não carregado (mantém o alvo original).
  /** @this {import('./shared').Worker} */
  surfaceAt(x, z, nearY) {
    const top = Math.floor(nearY) + 24
    for (let y = top; y >= Math.floor(nearY) - 32; y--) {
      const block = this.bot.blockAt?.(new Vec3(x, y, z))
      if (!block) return { unknown: true }
      if (block.name === 'water' || block.name === 'lava' || block.name === 'bubble_column') return { ok: false, reason: block.name }
      if (block.boundingBox === 'block' && !block.name.endsWith('_leaves')) return { ok: true, y: y + 1 }
    }
    return { ok: false, reason: 'no_ground' }
  }

  // ---------- memória espacial (conhecimento; nada aqui autoriza ação) ----------
  /** @this {import('./shared').Worker} */
  memoryGuideOn() {
    return Boolean(this.worldMemory) && process.env.MBOT_WORLD_MEMORY_GUIDE === '1'
  }

  /** @this {import('./shared').Worker} */
  observeWorld() {
    if (!this.worldMemory) return null
    try {
      return worldObserver.observeSurroundings(this.bot, this.worldMemory, { by: this.name })
    } catch (err) {
      this.logger.log?.(`[world-memory] ${this.name}: observação falhou: ${err.message}`)
      return null
    }
  }

  // Vai até uma lembrança e CONFERE no mundo real. Só devolve present=true se o mundo confirmou.
  /** @this {import('./shared').Worker} */
  async approachRemembered(place, isCancelled, { radius = 3 } = {}) {
    const memory = this.worldMemory
    const from = this.bot.entity?.position
    if (!memory || !from) return { ok: false, present: false, code: 'NO_MEMORY' }
    try {
      await this.goTo(new goals.GoalNear(place.x, place.y, place.z, radius), travelTimeoutMs(from, place))
    } catch {
      if (isCancelled()) return { ok: false, present: false, cancelled: true }
      memory.noteApproachFailure(place.key)
      return { ok: false, present: false, code: 'PATH_FAILED' }
    }
    if (isCancelled()) return { ok: false, present: false, cancelled: true }
    const conclusive = worldObserver.verifyPlace(this.bot, memory, place, { by: this.name })
    this.observeWorld()
    if (!conclusive) { memory.noteApproachFailure(place.key); return { ok: true, present: false, code: 'UNVERIFIED' } }
    return { ok: true, present: place.status === MEMORY_STATUS.CONFIRMED }
  }

  // Lembrança de mesa+madeira+pedra: navega até a mesa conhecida; depois o fluxo normal (snapshot real,
  // preflight físico, executor) decide tudo. Uma única viagem por tarefa.
  /** @this {import('./shared').Worker} */
  async tryRememberedPreparationSite(isCancelled) {
    if (!this.memoryGuideOn() || !this.bot.entity?.position) return false
    const dim = worldObserver.dimensionOf(this.bot)
    const site = this.worldMemory.suggestPreparationSite(dim, this.bot.entity.position, { radius: preparationRadius() + 4 })
    if (!site) return false
    const result = await this.approachRemembered(site.table, isCancelled, { radius: 2 })
    this.logger.log?.(`[world-memory] ${this.name} preparation_site table=(${site.table.x},${site.table.y},${site.table.z}) present=${result.present} code=${result.code || 'ok'}`)
    if (!result.present) return false
    // A memória guarda pontos simples {x,y,z}; blockAt do mineflayer exige Vec3 (sem isso: 'pos.floored is not a function').
    const live = this.bot.blockAt?.(new Vec3(site.table.x, site.table.y, site.table.z))
    if (live?.name === 'crafting_table') this.production?.rememberCraftingTable?.(this.bot, live)
    return true
  }

  // Recurso não está à vista: usa a memória só para decidir ONDE olhar; a coleta segue pelo mesmo
  // caminho real (findBlocks + cavar + confirmação de inventário). Até 2 hipóteses por tarefa.
  /** @this {import('./shared').Worker} */
  async rememberedResourceDetour(kind, isCancelled) {
    const memory = this.worldMemory
    const dim = worldObserver.dimensionOf(this.bot)
    const tried = new Set()
    for (let i = 0; i < 2 && !isCancelled(); i++) {
      const [pick] = memory.suggest(kind, dim, this.bot.entity.position, { limit: 1, exclude: tried })
      if (!pick) return false
      tried.add(pick.place.key)
      const result = await this.approachRemembered(pick.place, isCancelled, { radius: 4 })
      this.logger.log?.(`[world-memory] ${this.name} resource_detour ${kind} (${pick.place.x},${pick.place.y},${pick.place.z}) ${pick.status} present=${result.present} code=${result.code || 'ok'}`)
      if (result.cancelled) return false
      if (result.present) return true
    }
    return false
  }

  // Destino de exploração: com a flag, a memória escolhe entre os pontos do anel clássico o menos visitado.
  // Memória vazia (ou flag desligada) mantém exatamente o padrão geométrico.
  /** @this {import('./shared').Worker} */
  exploreCandidates(home, radius, y) {
    const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
    const out = []
    const seen = new Set()
    const rings = Math.min(8, Math.ceil(radius / 16))
    for (let ring = 1; ring <= rings; ring++) {
      const distance = Math.min(radius, 16 * ring)
      directions.forEach((d, i) => {
        const x = Math.floor(home.x + d[0] * distance)
        const z = Math.floor(home.z + d[1] * distance)
        const key = `${x},${z}`
        if (seen.has(key)) return
        seen.add(key)
        out.push({ x, z, y, distance, order: (ring - 1) * 8 + i })
      })
    }
    return out
  }

  /** @this {import('./shared').Worker} */
  async explore(radius, isCancelled, center = null, { groundAware = false } = {}) {
    const home = center || this.homeProvider?.()
    if (!home) throw new Error('base/centro de exploração ainda não definido')

    const directions = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1]
    ]
    const pick = () => {
      const direction = directions[this.exploreStep % directions.length]
      const ring = 1 + Math.floor(this.exploreStep / directions.length)
      this.exploreStep++
      const distance = Math.min(radius, 16 * ring)
      return {
        distance,
        x: Math.floor(home.x + direction[0] * distance),
        z: Math.floor(home.z + direction[1] * distance),
        y: Number.isFinite(Number(home.y)) ? Math.floor(Number(home.y)) : Math.floor(this.bot.entity.position.y)
      }
    }
    const memory = this.worldMemory
    const dim = worldObserver.dimensionOf(this.bot)
    const homeY = Number.isFinite(Number(home.y)) ? Math.floor(Number(home.y)) : Math.floor(this.bot.entity.position.y)
    let candidates = null
    let guided = false
    // Escolha guiada pela memória; sem flag ou com memória vazia mantém o padrão geométrico clássico.
    const choose = () => {
      if (memory && this.memoryGuideOn()) {
        candidates ||= this.exploreCandidates(home, radius, homeY)
        const best = candidates.length ? memory.chooseExploreTarget(dim, candidates, this.bot.entity.position) : null
        if (best) {
          candidates = candidates.filter((c) => c !== best.candidate)
          this.exploreStep++
          guided = true
          return best.candidate
        }
      }
      guided = false
      return pick()
    }
    let chosen = choose()
    if (groundAware) {
      // Alvos em anel com y fixo caem no ar sobre o oceano ou dentro de rocha em terreno natural; cada tentativa
      // custava ~30 s de pathfinder. Procura a superfície real e passa à próxima direção (sem se mover).
      // Chão desconhecido (chunk ainda não carregado) não ganha de cara: visto no Minecraft, esses alvos mantinham o y da
      // base e caíam no oceano — perna nadando até o timeout (12 de 12 pernas falhas com chão água/sem chão) e
      // afogamentos. Procura uma direção com chão conhecido; sem nenhuma, usa a primeira desconhecida (como antes).
      let firstUnknown = null
      let found = false
      for (let tries = 0; tries < 8; tries++) {
        const ground = this.surfaceAt(chosen.x, chosen.z, chosen.y)
        if (ground.ok) { chosen.y = ground.y; found = true; break }
        if (ground.unknown) firstUnknown ||= chosen
        else if (memory && (ground.reason === 'water' || ground.reason === 'lava' || ground.reason === 'bubble_column')) {
          memory.markHazard(ground.reason === 'lava' ? 'lava' : 'water', dim, { x: chosen.x, y: chosen.y, z: chosen.z }, { by: this.name })
        }
        chosen = choose()
      }
      if (!found && firstUnknown) chosen = firstUnknown
    }
    const { distance, x, y, z } = chosen
    memory?.recordExploreDestination(dim, { x, z }, { guided })

    // Cobertura enquanto caminha (em memória; só persiste quando um chunk novo aparece).
    const walkSampler = memory
      ? setInterval(() => { if (this.bot.entity?.position) memory.visit(dim, this.bot.entity.position) }, 2500)
      : null
    walkSampler?.unref?.()
    try {
      return await this.exploreTo({ x, y, z, distance }, isCancelled, { memory, dim, digEscape: groundAware })
    } finally {
      if (walkSampler) clearInterval(walkSampler)
    }
  }

  /** @this {import('./shared').Worker} */
  async exploreTo({ x, y, z, distance }, isCancelled, { memory = null, dim = 'overworld', digEscape = false } = {}) {

    const target = { x, y, z, radius: distance }
    if (process.env.MBOT_STATEMACHINE === '1') {
      const result = await stateMachineExplore.runExploreStateMachine({
        target,
        move: (point) => this.goTo(new goals.GoalNear(point.x, point.y, point.z, 3), 30000),
        isCancelled,
        logger: this.logger
      })
      if (!result.fallback) {
        if (!isCancelled() && result.ok !== false) memory?.visit(dim, { x, z })
        if (!isCancelled()) this.observeWorld()
        return { ...result, x, y, z, radius: distance }
      }
      this.logger.log?.('[statemachine] plugin indisponível; usando exploração clássica')
    }

    try {
      const goal = new goals.GoalNear(x, y, z, 3)
      try {
        await this.goTo(goal, 30000)
        // Sucesso falso do pathfinder (caminho parcial vazio): o player loop confere a chegada.
        if (digEscape && !isCancelled() && !this.arrivedAt(goal)) throw new Error('No path to the goal! (pathfinder parou sem chegar)')
      } catch (err) {
        // Explorador do player loop num buraco natural (sem cavar e sem blocos para subir): toda perna dá
        // "No path" e ele só sai morrendo. Uma única nova tentativa da mesma perna podendo cavar (curral protegido).
        if (!digEscape || isCancelled() || !UNREACHED_MOVE.test(err?.message || '')) throw err
        await this.goToWithDigging(goal, DIG_ESCAPE_MS)
        if (!isCancelled() && !this.arrivedAt(goal)) throw new Error('No path to the goal! (nem cavando)', { cause: err })
      }
    } catch (err) {
      // Rota que falha repetidamente vira evidência local (afasta destinos futuros), nunca ordem.
      // Player loop: troca de dono no meio da perna (defesa/nova ordem) é cancelamento, não falha de navegação.
      if (digEscape && isCancelled()) return { ok: false, cancelled: true }
      if (memory && !isCancelled()) memory.markHazard('route_failed', dim, { x, y, z }, { by: this.name })
      if (!isCancelled()) {
        const from = this.bot.entity?.position
        const ground = this.surfaceAt(x, z, y)
        this.logger.log?.(`[colônia] ${this.name} perna falhou alvo=(${x},${y},${z}) dist=${from ? Math.round(from.distanceTo(new Vec3(x, y, z))) : '?'} chao=${ground.unknown ? 'desconhecido' : ground.ok ? ground.y : ground.reason} erro=${err?.message}`)
      }
      throw err
    }
    if (isCancelled()) return { ok: false, cancelled: true }
    // GoalNear(raio 3) para antes do alvo (pode ficar no chunk vizinho): chegar conta o chunk do alvo como visitado.
    memory?.visit(dim, { x, z })
    this.observeWorld()
    return { ok: true, x, y, z, radius: distance, stateMachine: false }
  }

  // Percepção da cama da base (só fatos do mundo): existe? há material? ovelha alcançável à vista? À noite, a cama da
  // base a até BASE_BED_TRAVEL conta como abrigo executável.
  /** @this {import('./shared').Worker} */
  bedFacts(state) {
    const home = this.homeProvider?.()
    if (!state || !home || !this.bot.entity?.position) return
    const drops = this._deathDrops
    if (drops && Date.now() - drops.at < DEATH_DROPS_MS && this.bot.entity.position.distanceTo(drops.position) <= DEATH_DROPS_RANGE) {
      state.deathDrops = { distance: Math.round(this.bot.entity.position.distanceTo(drops.position)), ageS: Math.round((Date.now() - drops.at) / 1000) }
    }
    // Fatos de executabilidade: base inalcançável há pouco (NOT_ARRIVED) e preparação recusada sob ameaça (guardrail).
    if (this._baseUnreachableUntil > Date.now()) state.baseUnreachable = true
    state.preparationBlockedByThreat = true
    let bed = null
    try { bed = bedLib.findBedNear(this.bot, home) } catch { bed = null }
    if (bed) this._baseBed = bed.position.clone()
    else if (this._baseBed && this.bot.blockAt?.(this._baseBed)) this._baseBed = null // chunk carregado e a cama sumiu
    state.baseHasBed = Boolean(this._baseBed)
    // Sem baú configurado a base não guarda comida; com baú, não se sabe sem olhar (fica sem afirmar nada).
    state.baseHasFood = this.production?.storage?.configured?.() ? null : false
    try { state.bedMaterials = bedLib.hasBedMaterials(this.bot) } catch { state.bedMaterials = false }
    try { state.woolProgress = Math.min(bedLib.BED_WOOL, bedLib.woolEquivalent(this.bot)) } catch { state.woolProgress = 0 }
    state.canCook = this.canCook()
    const sheep = this.nearestSheep()
    state.nearby = state.nearby || {}
    state.nearby.sheep = Boolean(sheep)
    state.nearby.sheepDistance = sheep ? Math.round(sheep.position.distanceTo(this.bot.entity.position)) : null
    // Sem ovelha útil à vista: um rebanho lembrado da cor certa (até 160) também é caminho para a cama. Medido no mundo
    // novo: as 3 ovelhas brancas mais próximas ficam entre 48 e 128 blocos da base, fora da vista.
    if (!sheep && !state.baseHasBed && !state.bedMaterials) {
      const remembered = this.rememberedSheep()
      if (remembered) {
        state.nearby.sheep = true
        state.nearby.sheepDistance = Math.round(remembered.distance)
        state.nearby.sheepRemembered = remembered.place
      }
    }
    if (state.time === 'night' && state.baseHasBed && state.shelterKind !== 'bed' && Number(state.baseDistance) <= BASE_BED_TRAVEL) {
      state.shelterKind = 'base_bed'
      state.shelterNearby = true
    }
    if (this._shelterBlockedUntil > Date.now() && typeof state.shelterNearby === 'boolean') {
      state.shelterNearby = false
      state.shelterKind = null
    }
  }

  /** @this {import('./shared').Worker} */
  nearestSheep() {
    const position = this.bot.entity?.position
    if (!position || typeof this.bot.nearestEntity !== 'function') return null
    // Só ovelha que ajuda a fechar 3 lãs da mesma cor (tosquiada não dá lã). Visto no Minecraft: 61 caças de lã no soak e
    // nenhuma cama, com lãs de cores misturadas (2 brancas + 1 cinza).
    // Sem lã nenhuma: branca primeiro (a cor mais comum; a linha também vira lã branca). Visto no Minecraft: começou pela
    // cinza-clara mais próxima, e há só 2 dessa cor por perto.
    const wanted = bedLib.wantedWool(this.bot)
    const usable = (color) => (e) => {
      if (e?.name !== 'sheep' || this.huntFailed(e) || !(e.position?.distanceTo(position) <= 48)) return false
      const wool = bedLib.sheepWool(e)
      return wool !== null && (!color || wool === 'unknown' || wool === color)
    }
    return this.bot.nearestEntity(usable(wanted || 'white_wool')) || (wanted ? null : this.bot.nearestEntity(usable(null))) || null
  }

  /** @this {import('./shared').Worker} */
  rememberedSheep() {
    if (!this.worldMemory || !this.memoryGuideOn() || !this.bot.entity?.position) return null
    const wanted = bedLib.wantedWool(this.bot)
    const dim = worldObserver.dimensionOf(this.bot)
    const nearest = (kinds) => {
      let best = null
      for (const kind of kinds) {
        const [pick] = this.worldMemory.suggest(kind, dim, this.bot.entity.position, { limit: 1, maxDistance: 160 })
        if (pick && (!best || pick.distance < best.distance)) best = { distance: pick.distance, place: { ...pick.place, kind } }
      }
      return best
    }
    if (wanted) return nearest([`sheep:${wanted}`])
    return nearest(['sheep:white_wool']) || nearest(bedLib.WOOL_COLORS.map((c) => `sheep:${c}_wool`))
  }

  /** @this {import('./shared').Worker} */
  async makeBaseBed(isCancelled, remembered = null) {
    if (!bedLib.hasBedMaterials(this.bot)) {
      let sheep = this.nearestSheep()
      if (!sheep && remembered) {
        // Vai ao rebanho lembrado; lá, só confia no que vê. Sem ovelha útil, a lembrança é invalidada.
        const goal = new goals.GoalNear(remembered.x, remembered.y, remembered.z, 6)
        await this.goTo(goal, travelTimeoutMs(this.bot.entity?.position, remembered)).catch(() => {})
        if (isCancelled()) return { ok: false, step: 'cancelled' }
        sheep = this.nearestSheep()
        if (!sheep) {
          this.worldMemory?.invalidate(remembered.key, 'no_sheep')
          return { ok: false, step: 'remembered_empty' }
        }
      }
      if (!sheep) return { ok: false, step: 'no_sheep' }
      // Numa ida só: segue caçando as ovelhas úteis à vista até fechar a lã. Visto no Minecraft: a lã chegou a 2 da mesma
      // cor 3 vezes e se perdeu na morte seguinte (uma ovelha por ciclo, com noites e combates no meio).
      for (let hunts = 0; sheep && hunts < 4 && !bedLib.hasBedMaterials(this.bot); hunts++) {
        const before = bedLib.woolEquivalent(this.bot)
        await food.hunt(this.bot, sheep, isCancelled).catch(() => false)
        if (isCancelled()) return { ok: false, step: 'cancelled' }
        // Ovelha anda: a mesma pode ficar alcançável depois (visto no Minecraft: uma falha a excluía para sempre).
        if (bedLib.woolEquivalent(this.bot) <= before) { this._failedHunts.set(sheep.id, Date.now() + FAILED_HUNT_MS); break }
        if (night.nightFalling(this.bot) || this.hostileNear()) break
        sheep = this.nearestSheep()
      }
      if (!bedLib.hasBedMaterials(this.bot)) return { ok: bedLib.woolEquivalent(this.bot) > 0, step: 'wool' }
      if (night.nightFalling(this.bot) || this.hostileNear()) return { ok: true, step: 'wool_complete' }
    }
    // Fabrica já na base: a mesa precisa de chão livre e seco. Visto no Minecraft: tentou colocar a mesa perto da água
    // ('não achei lugar para colocar crafting_table') 4 vezes e afogou.
    const returned = await this.returnHome(isCancelled, { verify: true })
    if (isCancelled()) return { ok: false, step: 'cancelled' }
    if (!returned.ok) return { ok: false, step: 'return', error: returned.code || null }
    const item = await bedLib.craftBed(this.bot, isCancelled)
    if (isCancelled()) return { ok: false, step: 'cancelled' }
    if (!item) return { ok: false, step: 'craft' }
    const bed = await bedLib.placeBed(this.bot, isCancelled)
    if (!bed) return { ok: false, step: 'place' }
    this._baseBed = bed.position.clone()
    this.logger.log?.(`[colônia] ${this.name} cama colocada na base em ${bed.position}`)
    const used = await bedLib.useBed(this.bot, bed, isCancelled)
    return { ok: true, step: `placed:${used}` }
  }

  // Com fome, sem comida e sem nada caçável a 48 blocos: um rebanho lembrado (WorldMemory, até 160) conta como comida
  // alcançável. Só percepção; a ida e a caça são confirmadas no mundo e a lembrança é invalidada se não houver animal.
  /** @this {import('./shared').Worker} */
  rememberedFoodHint(state) {
    if (!this.memoryGuideOn() || state?.nearby?.food || Number(state?.food) > 8 || !this.bot.entity?.position) return null
    if (Object.keys(state.inventory || {}).some((name) => this.bot.registry?.foodsByName?.[name])) return null
    const dim = worldObserver.dimensionOf(this.bot)
    const [pick] = this.worldMemory.suggest('food', dim, this.bot.entity.position, { limit: 1, maxDistance: 160 })
    if (!pick) return null
    const { x, y, z, key } = pick.place
    state.nearby.food = true
    state.nearby.foodDistance = Math.round(pick.distance)
    state.nearby.foodRemembered = { x, y, z, key }
    return state.nearby.foodRemembered
  }

  /** @this {import('./shared').Worker} */
  async huntRememberedFood(place, hunt, isCancelled) {
    const goal = new goals.GoalNear(place.x, place.y, place.z, 6)
    try {
      await this.goTo(goal, travelTimeoutMs(this.bot.entity?.position, place))
    } catch (err) {
      if (isCancelled() || !UNREACHED_MOVE.test(err?.message || '')) return null
      await this.goToWithDigging(goal, DIG_ESCAPE_MS).catch(() => {})
    }
    if (isCancelled()) return null
    const gathered = await hunt()
    // Só conta animal que o executor caçaria (poupa os últimos de cada espécie). Visto no Minecraft: rebanho lembrado com
    // 2 galinhas poupadas nunca era invalidado ('caça=nada animais=true') e o explorador voltava lá 57 vezes.
    /** @type {boolean} */
    let animalsHere = false
    try {
      const here = this.bot.entity.position
      animalsHere = Boolean(food.findHuntableAnimal(this.bot, { spare: (e) => !(e.position?.distanceTo(here) <= 24) }))
    } catch { animalsHere = false }
    if (!gathered && !animalsHere) this.worldMemory?.invalidate(place.key, 'no_food_animals')
    this.logger.log?.(`[world-memory] ${this.name} food (${place.x},${place.y},${place.z}) caça=${gathered ? 'ok' : 'nada'} animais=${animalsHere}`)
    return gathered
  }
}

module.exports = { ExplorationBehavior }
