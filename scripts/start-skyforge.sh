#!/usr/bin/env bash
set -euo pipefail
if command -v systemctl >/dev/null && systemctl --user cat skyforge.service >/dev/null 2>&1; then
  systemctl --user start skyforge.service
else
  PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  nohup node "$PROJECT_DIR/scripts/serve-skyforge.mjs" >/tmp/skyforge-server.log 2>&1 &
fi
echo "SkyForge is available at http://127.0.0.1:4173/"
