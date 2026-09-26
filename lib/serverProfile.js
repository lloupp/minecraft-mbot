const { autoVersionForge } = require('minecraft-protocol-forge')
const { fixEntityMovement, fixOutgoingPackets } = require('./protocol')

const PROFILE_IDS = {
  AUTO: 'auto',
  VANILLA_1201: 'vanilla1201',
  FORGE_263: 'forge263'
}

function normalizeVersion(value) {
  const raw = String(value || '').trim()
  const semver = raw.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)
  return semver ? semver[1] : raw
}

function detectProfile(version, forced = process.env.MINECRAFT_PROFILE || PROFILE_IDS.AUTO) {
  const requested = String(forced || PROFILE_IDS.AUTO).trim().toLowerCase()
  const normalized = normalizeVersion(version)

  if (requested === PROFILE_IDS.VANILLA_1201) {
    return {
      id: PROFILE_IDS.VANILLA_1201,
      version: '1.20.1',
      useForge: false,
      useProtocolPatches: false,
      source: 'forced'
    }
  }

  if (requested === PROFILE_IDS.FORGE_263) {
    return {
      id: PROFILE_IDS.FORGE_263,
      version: normalized || '26.3',
      useForge: true,
      useProtocolPatches: true,
      source: 'forced'
    }
  }

  if (normalized === '1.20.1') {
    return {
      id: PROFILE_IDS.VANILLA_1201,
      version: normalized,
      useForge: false,
      useProtocolPatches: false,
      source: 'detected'
    }
  }

  if (normalized === '26.3' || /forge/i.test(String(version || ''))) {
    return {
      id: PROFILE_IDS.FORGE_263,
      version: normalized || String(version || ''),
      useForge: true,
      useProtocolPatches: normalized === '26.3',
      source: 'detected'
    }
  }

  return {
    id: PROFILE_IDS.AUTO,
    version: normalized || String(version || ''),
    useForge: false,
    useProtocolPatches: false,
    source: 'fallback'
  }
}

function configureClient(bot, profile) {
  if (profile.useForge) autoVersionForge(bot._client)
  if (profile.useProtocolPatches) {
    fixEntityMovement(bot._client)
    fixOutgoingPackets(bot._client)
  }
  return profile
}

function describeProfile(profile) {
  const parts = [profile.id]
  if (profile.version) parts.push(`versão ${profile.version}`)
  parts.push(profile.useForge ? 'Forge' : 'vanilla/protocolo padrão')
  parts.push(profile.useProtocolPatches ? 'patches 26.3 ON' : 'patches 26.3 OFF')
  return parts.join(' | ')
}

module.exports = {
  PROFILE_IDS,
  normalizeVersion,
  detectProfile,
  configureClient,
  describeProfile
}
