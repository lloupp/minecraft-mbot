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

module.exports = { fixEntityMovement }
