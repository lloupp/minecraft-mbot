// Compatibilidade temporária com pacotes de movimento do protocolo 26.3.
// Converte estruturas novas para os campos esperados pelo mineflayer atual.
function fixEntityMovement(client) {
  const fixDelta = (packet) => {
    const d = packet.delta
    if (!d || packet.dX !== undefined) return
    let x = 0; let y = 0; let z = 0
    if (d.steps?.length) {
      for (const step of d.steps) { x += step.x; y += step.y; z += step.z }
    } else {
      x = d.dX; y = d.dY; z = d.dZ
    }
    packet.dX = x * 4096
    packet.dY = y * 4096
    packet.dZ = z * 4096
  }

  client.prependListener('rel_entity_move', fixDelta)
  client.prependListener('entity_move_look', fixDelta)
  client.prependListener('sync_entity_position', (packet) => {
    const path = packet.position?.path
    if (!path || packet.x !== undefined) return
    const pos = path.endPosition || path.steps?.at(-1)?.position
    if (!pos) return
    packet.x = pos.x
    packet.y = pos.y
    packet.z = pos.z
    packet.dx = 0
    packet.dy = 0
    packet.dz = 0
  })
}

// Corrige pacotes que o mineflayer envia no formato antigo para o 26.3:
// - Dois pacotes com posição sem tick_end entre eles = expulsão
//   (invalid_player_movement). Acontece ao responder a um teleporte de correção.
// - block_place (colocar bloco / clicar em bloco) agora agrupa o alvo em `hitResult`.
// - block_dig: o 26.3 inseriu CHANGE_DESTROY_DIRECTION na posição 1 do enum de
//   ações, deslocando as demais. Sem remapear, "terminar de cavar" (2) vira
//   "cancelar" e nenhum bloco quebra de verdade no servidor.
const DIG_STATUS_26_3 = [0, 2, 3, 4, 5, 6, 7] // antigo -> novo

function fixOutgoingPackets(client) {
  const write = client.write.bind(client)
  let sentPosition = false
  client.write = (name, params) => {
    if (client.protocolVersion < 777) return write(name, params)
    if (name === 'tick_end') {
      sentPosition = false
    } else if (name === 'position' || name === 'position_look') {
      if (sentPosition) write('tick_end', {})
      sentPosition = true
    } else if (name === 'block_dig') {
      params = { ...params, status: DIG_STATUS_26_3[params.status] ?? params.status }
    } else if (name === 'block_place' && params.location && !params.hitResult) {
      const { hand = 0, sequence = 0, location, direction, cursorX, cursorY, cursorZ } = params
      params = {
        hand,
        sequence,
        hitResult: { location, direction, cursorX, cursorY, cursorZ, insideBlock: false, worldBorderHit: false }
      }
    }
    return write(name, params)
  }
}

module.exports = { fixEntityMovement, fixOutgoingPackets, DIG_STATUS_26_3 }
