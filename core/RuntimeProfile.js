function normalizeVersion(value) {
  return String(value || '').trim()
}

function isStandard1201(version) {
  return /^1\.20\.1(?:\b|$)/.test(normalizeVersion(version))
}

function resolveRuntimeProfile({
  serverVersion,
  envVersion = process.env.MINECRAFT_VERSION,
  compat = process.env.MINECRAFT_COMPAT
} = {}) {
  const requested = normalizeVersion(envVersion || serverVersion || '1.20.1')
  const compatMode = normalizeVersion(compat).toLowerCase()

  if (compatMode === 'forge-26.3' || requested === '26.3') {
    return {
      id: 'forge-26.3',
      version: '26.3',
      forge: true,
      protocolPatches: true,
      hideErrors: true
    }
  }

  return {
    id: isStandard1201(requested) ? 'java-1.20.1' : 'java-standard',
    version: requested || '1.20.1',
    forge: false,
    protocolPatches: false,
    hideErrors: false
  }
}

function profileSummary(profile) {
  return [
    profile.id,
    `version=${profile.version}`,
    `forge=${profile.forge ? 'on' : 'off'}`,
    `patches=${profile.protocolPatches ? 'on' : 'off'}`
  ].join(' | ')
}

module.exports = { normalizeVersion, isStandard1201, resolveRuntimeProfile, profileSummary }
