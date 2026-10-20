#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
mkdir -p "$SERVICE_DIR" "$APP_DIR" "$DESKTOP_DIR"

cat > "$SERVICE_DIR/skyforge.service" <<EOF
[Unit]
Description=SkyForge local web portal
After=default.target

[Service]
Type=simple
ExecStart=/usr/bin/env node $PROJECT_DIR/scripts/serve-skyforge.mjs
WorkingDirectory=$PROJECT_DIR
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

cat > "$APP_DIR/skyforge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=SkyForge
Comment=Local drone telemetry and flight log analysis
Exec=xdg-open http://127.0.0.1:4173/
Icon=$PROJECT_DIR/live-viewer/public/icon.svg
Terminal=false
Categories=Science;Utility;
EOF
cp "$APP_DIR/skyforge.desktop" "$DESKTOP_DIR/SkyForge.desktop"
chmod +x "$APP_DIR/skyforge.desktop" "$DESKTOP_DIR/SkyForge.desktop"
systemctl --user daemon-reload
systemctl --user enable --now skyforge.service
echo "SkyForge installed. Open http://127.0.0.1:4173/"
