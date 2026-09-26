class CommandRouter {
  constructor(prefix = '!') {
    this.prefix = prefix
    this.commands = new Map()
  }

  register(names, handler) {
    const aliases = Array.isArray(names) ? names : [names]
    for (const name of aliases) this.commands.set(name.toLowerCase(), handler)
    return this
  }

  parse(message) {
    const text = String(message || '').trim()
    if (!text.startsWith(this.prefix)) return null
    const parts = text.slice(this.prefix.length).trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return null
    return { command: parts[0].toLowerCase(), args: parts.slice(1) }
  }

  async dispatch(context, message) {
    const parsed = this.parse(message)
    if (!parsed) return false
    const handler = this.commands.get(parsed.command)
    if (!handler) return false
    await handler(context, parsed.args)
    return true
  }
}

module.exports = { CommandRouter }
