#!/bin/sh
# Monta o servidor de TESTE vanilla 1.20.1 (ver deploy/teste-1201/README.md).
# Uso: deploy/teste-1201/setup.sh [destino]   (padrão: ~/minecraft-server-1201)
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/minecraft-server-1201}"
JAR_URL=https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar
JAR_SHA1=84194a2f286ef7c14ed7ce0090dba59902951553
OWNER="${MINECRAFT_OWNER:-eduardo}"

mkdir -p "$DEST"
cp "$SRC/start.sh" "$DEST/start.sh"
chmod +x "$DEST/start.sh"

if [ ! -f "$DEST/server.jar" ]; then
  curl -fL -o "$DEST/server.jar" "$JAR_URL"
fi
echo "$JAR_SHA1  $DEST/server.jar" | sha1sum -c -

# Aceite da EULA: https://aka.ms/MinecraftEULA
echo "eula=true" > "$DEST/eula.txt"

# Só as chaves que diferem do padrão; o servidor completa o resto na 1ª subida.
if [ ! -f "$DEST/server.properties" ]; then
  cat > "$DEST/server.properties" <<'PROPS'
server-port=25566
online-mode=false
enforce-secure-profile=false
white-list=true
spawn-protection=0
level-seed=mbot-teste
motd=Teste 1.20.1 (bot)
difficulty=normal
view-distance=8
simulation-distance=6
PROPS
fi

# Whitelist com UUID offline: dono, orquestrador e os papéis da colônia _01.._12.
# Ops: dono e orquestrador.
OWNER="$OWNER" DEST="$DEST" node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
function offlineUuid(name) {
  const h = crypto.createHash("md5").update("OfflinePlayer:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-");
}
const owner = process.env.OWNER;
const roles = ["minerador", "lenhador", "fazendeiro", "construtor", "explorador", "guarda", "ajudante", "artesao"];
const names = [owner, "eduardo_bot"];
for (const role of roles) {
  for (let i = 1; i <= 12; i++) names.push(`${role}_${String(i).padStart(2, "0")}`);
}
const entry = (name) => ({ uuid: offlineUuid(name), name });
const write = (file, data) => fs.writeFileSync(path.join(process.env.DEST, file), JSON.stringify(data, null, 2) + "\n");
write("whitelist.json", names.map(entry));
write("ops.json", [owner, "eduardo_bot"].map((name) => ({ ...entry(name), level: 4, bypassesPlayerLimit: false })));
'

echo "Servidor de teste pronto em $DEST (porta 25566)."
