#!/usr/bin/env bash
# Installs a user systemd service on Linux Mint/Ubuntu; never starts the Minecraft server.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then echo "Node.js 22 required" >&2; exit 1; fi
command -v systemctl >/dev/null || { echo "systemd required" >&2; exit 1; }
[[ -d "$ROOT/node_modules" ]] || { echo "Run npm ci in $ROOT first" >&2; exit 1; }
CONF_DIR="$HOME/.config/minecraft-mbot"
UNIT_DIR="$HOME/.config/systemd/user"
CONF_FILE="$CONF_DIR/autonomous.env"
UNIT_FILE="$UNIT_DIR/minecraft-mbot.service"
mkdir -p "$CONF_DIR" "$UNIT_DIR"
if [[ ! -f "$CONF_FILE" ]]; then
  cp "$ROOT/examples/minecraft-mbot-autonomous.env" "$CONF_FILE"
  chmod 600 "$CONF_FILE"
  echo "Review host/port in $CONF_FILE before enabling."
fi
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Minecraft MBot continuous autonomous worker runtime
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=%h/.config/minecraft-mbot/autonomous.env
ExecStart=$NODE_BIN $ROOT/index.js
Restart=always
RestartSec=30
TimeoutStopSec=20
KillSignal=SIGTERM

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
echo "Installed $UNIT_FILE"
echo "Configuration: $CONF_FILE"
echo "NOTE: A Minecraft server must already be running. This does not start one."
echo "NOTE: Colony autostart requires base, stock, and worker roster in the saved state."
echo "Start: systemctl --user enable --now minecraft-mbot.service"
echo "Status: systemctl --user status minecraft-mbot.service"
echo "Logs: journalctl --user -u minecraft-mbot.service -f"
echo "Stop: systemctl --user disable --now minecraft-mbot.service"
echo "User services may stop when you log out unless administrator enables loginctl enable-linger."
