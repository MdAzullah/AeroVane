#!/usr/bin/env bash
set -euo pipefail
if command -v systemctl >/dev/null && systemctl --user cat aerovane.service >/dev/null 2>&1; then
  systemctl --user start aerovane.service
else
  PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$PROJECT_DIR"
  nohup node "$PROJECT_DIR/scripts/serve-aerovane.mjs" >/tmp/aerovane-server.log 2>&1 &
fi
echo "AeroVane is available at http://127.0.0.1:4173/"
