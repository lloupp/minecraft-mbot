const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const dir = process.env.MBOT_SERVER_DEST
const owner = process.env.MINECRAFT_OWNER || 'eduardo'
if (!/^[A-Za-z0-9_]{1,16}$/.test(owner)) throw new Error('Nome do dono inválido')
function entry(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const h = hash.toString('hex')
  return { name, uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` }
}
const names = [owner, 'eduardo_bot']
for (const role of ['minerador', 'lenhador', 'fazendeiro', 'construtor', 'explorador', 'guarda', 'ajudante', 'artesao']) {
  for (let i = 1; i <= 2; i++) names.push(`${role}_0${i}`)
}
for (const [file, data] of [
  ['whitelist.json', names.map(entry)],
  ['ops.json', [{ ...entry(owner), level: 4, bypassesPlayerLimit: false }]]
]) {
  const target = path.join(dir, file)
  // Uma nova instalação fornece OP apenas ao dono; instalações existentes são preservadas.
  if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
}
