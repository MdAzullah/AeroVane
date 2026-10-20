#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
mkdir -p "$SERVICE_DIR" "$APP_DIR" "$DESKTOP_DIR"

# Stop and disable old aerovane.service if running
if command -v systemctl >/dev/null; then
  systemctl --user stop aerovane.service 2>/dev/null || true
  systemctl --user disable aerovane.service 2>/dev/null || true
fi

NODE_PATH="$(command -v node 2>/dev/null || echo /usr/bin/node)"
if [ -x "$NODE_PATH" ] && "$NODE_PATH" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null; then
  EXEC_START="$NODE_PATH $PROJECT_DIR/scripts/serve-aerovane.mjs"
else
  EXEC_START="/usr/bin/python3 $PROJECT_DIR/scripts/serve-aerovane.py --directory $PROJECT_DIR/aerovane-dist --port 4173"
fi

cat > "$SERVICE_DIR/aerovane.service" <<EOF
[Unit]
Description=AeroVane local web portal
After=default.target

[Service]
Type=simple
ExecStart=$EXEC_START
WorkingDirectory=$PROJECT_DIR
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

# Maintain aerovane.service as alias for backward compatibility
cp "$SERVICE_DIR/aerovane.service" "$SERVICE_DIR/aerovane.service"

cat > "$APP_DIR/aerovane.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AeroVane
Comment=Local drone telemetry and flight log analysis
Exec=xdg-open http://127.0.0.1:4173/
Icon=$PROJECT_DIR/live-viewer/public/icon.svg
Terminal=false
Categories=Science;Utility;
EOF

# Clean up old aerovane desktop entry and place AeroVane
rm -f "$APP_DIR/aerovane.desktop" "$DESKTOP_DIR/AeroVane.desktop"
cp "$APP_DIR/aerovane.desktop" "$DESKTOP_DIR/AeroVane.desktop"
chmod +x "$APP_DIR/aerovane.desktop" "$DESKTOP_DIR/AeroVane.desktop"

# Refresh desktop application database
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$APP_DIR" 2>/dev/null || true
fi

if command -v systemctl >/dev/null; then
  systemctl --user daemon-reload
  systemctl --user enable --now aerovane.service
fi

echo "AeroVane installed. Open http://127.0.0.1:4173/"
