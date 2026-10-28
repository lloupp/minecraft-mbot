// FML3 (Forge 1.20.1) login handshake.
//
// O minecraft-protocol-forge 1.2.0 tenta decodificar integralmente cada snapshot
// de registro enviado pelo servidor (discriminador 3 = ServerRegistry). Em
// servidores com mods, o schema embutido não cobre todos os registros e o parse
// lança PartialReadError. O cliente então deixa de responder, e o servidor
// derruba a conexão com "multiplayer.disconnect.slow_login" após ~30s.
//
// Para concluir o login basta ler o discriminador e responder com
// Acknowledgement; o conteúdo dos snapshots não é necessário. Somente o
// ModList (discriminador 1) precisa ser interpretado para montar o ModListReply.

const ProtoDef = require('protodef').ProtoDef

const WRAPPER_CHANNEL = 'fml:loginwrapper'
const HANDSHAKE_CHANNEL = 'fml:handshake'

const DISCRIMINATORS = {
  MOD_LIST: 1,
  SERVER_REGISTRY: 3,
  CONFIGURATION_DATA: 4,
  MOD_DATA: 5,
  CHANNEL_MISMATCH_DATA: 6,
  ACKNOWLEDGEMENT: 99
}

let proto = null
function getProto () {
  if (proto) return proto
  proto = new ProtoDef(false)
  proto.addType('string', ['pstring', { countType: 'varint' }])
  proto.addTypes({
    restBuffer: [
      (buffer, offset) => ({ value: buffer.slice(offset), size: buffer.length - offset }),
      (value, buffer, offset) => {
        value.copy(buffer, offset)
        return offset + value.length
      },
      (value) => value.length
    ]
  })
  proto.addProtocol(require('minecraft-protocol-forge/src/client/data/fml3.json'), ['fml3'])
  return proto
}

function readVarInt (buffer, offset = 0) {
  let value = 0
  let shift = 0
  for (let i = offset; i < buffer.length; i++) {
    const byte = buffer[i]
    value += (byte & 0x7f) * Math.pow(2, shift)
    if ((byte & 0x80) === 0) return { value, size: i - offset + 1 }
    shift += 7
    if (shift > 35) break
  }
  throw new Error('varint incompleto')
}

function acknowledgement () {
  const p = getProto()
  return p.createPacketBuffer('fml_loginwrapper', {
    channel: HANDSHAKE_CHANNEL,
    data: p.createPacketBuffer('fml_handshake', {
      discriminator: 'Acknowledgement',
      data: {}
    })
  })
}

function modListReply (handshake, options) {
  const p = getProto()
  const list = handshake.data
  const modNames = options.forgeMods
  const reply = { modNames: modNames || list.modNames, channels: [], registries: [] }

  const channels = options.channels
  if (!channels) {
    for (const { name, marker } of list.channels) {
      if (marker !== 'FML3') reply.channels.push({ name, marker })
    }
  } else {
    for (const name of Object.keys(channels)) reply.channels.push({ name, marker: channels[name] })
  }

  const registries = options.registries
  if (!registries) {
    for (const { name } of list.registries) reply.registries.push({ name, marker: '1.0' })
  } else {
    for (const name of Object.keys(registries)) reply.registries.push({ name, marker: registries[name] })
  }

  return p.createPacketBuffer('fml_loginwrapper', {
    channel: HANDSHAKE_CHANNEL,
    data: p.createPacketBuffer('fml_handshake', { discriminator: 'ModListReply', data: reply })
  })
}

/**
 * Instala o handshake FML3 tolerante a snapshots de registro desconhecidos.
 * @param {import('minecraft-protocol').Client} client
 * @param {{ forgeMods?: string[], channels?: object, registries?: object, log?: Function }} options
 */
function installForgeHandshake3 (client, options = {}) {
  const p = getProto()
  const log = options.log || ((msg) => console.log(`[forge] ${msg}`))

  client.tagHost = '\0FML3\0'
  client.registerChannel(WRAPPER_CHANNEL, p.types.fml_loginwrapper, false)

  // Sem isso o handler padrão responde vazio e o servidor desconecta.
  const defaultListener = client.listeners('login_plugin_request').find((fn) => fn.name === 'onLoginPluginRequest')
  if (defaultListener) client.removeListener('login_plugin_request', defaultListener)

  client.on('login_plugin_request', (data) => {
    const respond = (payload) => client.write('login_plugin_response', { messageId: data.messageId, data: payload })

    if (data.channel !== WRAPPER_CHANNEL) {
      log(`canal de login ignorado: ${data.channel}`)
      respond(acknowledgement())
      return
    }

    let wrapper
    try {
      wrapper = p.parsePacketBuffer('fml_loginwrapper', data.data).data
    } catch (err) {
      log(`wrapper ilegível (${err.message}); enviando ack`)
      respond(acknowledgement())
      return
    }

    if (wrapper.channel !== HANDSHAKE_CHANNEL) {
      // Ex.: tacz:handshake — o servidor espera apenas reconhecimento.
      respond(acknowledgement())
      return
    }

    let discriminator
    try {
      discriminator = readVarInt(wrapper.data).value
    } catch (err) {
      log(`handshake ilegível (${err.message}); enviando ack`)
      respond(acknowledgement())
      return
    }

    if (discriminator === DISCRIMINATORS.MOD_LIST) {
      let handshake
      try {
        handshake = p.parsePacketBuffer('fml_handshake', wrapper.data).data
      } catch (err) {
        log(`ModList ilegível (${err.message}); enviando ack`)
        respond(acknowledgement())
        return
      }
      respond(modListReply(handshake, options))
      return
    }

    // ServerRegistry (3), ConfigurationData (4), ModData (5), ChannelMismatch (6):
    // não é preciso decodificar o conteúdo, apenas confirmar.
    if (discriminator === DISCRIMINATORS.SERVER_REGISTRY) {
      log('registros do servidor recebidos; confirmando sem decodificar')
    }
    respond(acknowledgement())
  })
}

module.exports = { installForgeHandshake3, readVarInt }
