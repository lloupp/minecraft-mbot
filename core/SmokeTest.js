class SmokeTest {
  constructor({ bot, storage, botManager, homeProvider, projectManager }) {
    this.bot = bot
    this.storage = storage
    this.botManager = botManager
    this.homeProvider = homeProvider
    this.projectManager = projectManager
  }

  async run() {
    const checks = []
    const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })

    add('spawn', Boolean(this.bot.entity), this.bot.entity ? 'bot no mundo' : 'bot sem entity')
    add('pathfinder', Boolean(this.bot.pathfinder), this.bot.pathfinder ? 'carregado' : 'ausente')
    add('registry', Boolean(this.bot.registry?.itemsByName && this.bot.registry?.blocksByName), 'itens/blocos')
    add('base', Boolean(this.homeProvider?.()), this.homeProvider?.() ? 'definida' : 'não definida')
    add('estoque', this.storage?.configured?.(), this.storage?.configured?.() ? 'configurado' : 'não configurado')

    if (this.storage?.configured?.() && this.bot.entity) {
      try {
        const stock = await this.storage.summary(this.bot)
        add('estoque_acesso', true, `${Object.keys(stock).length} tipos`)
      } catch (err) {
        add('estoque_acesso', false, err.message)
      }
    }

    const workers = this.botManager?.list?.() || []
    if (workers.length) {
      const active = workers.filter((worker) => !['erro', 'desconectado'].includes(worker.status))
      add('workers', active.length === workers.length, `${active.length}/${workers.length} disponíveis`)
    } else {
      checks.push({ name: 'workers', ok: null, detail: 'nenhum worker criado' })
    }

    const project = this.projectManager?.status?.()
    checks.push({
      name: 'projeto',
      ok: project ? project.status !== 'cancelado' : null,
      detail: project ? `${project.type}:${project.status}` : 'nenhum projeto'
    })

    const failed = checks.filter((check) => check.ok === false)
    const passed = checks.filter((check) => check.ok === true)
    return {
      ok: failed.length === 0,
      passed: passed.length,
      failed: failed.length,
      checks
    }
  }
}

module.exports = { SmokeTest }
