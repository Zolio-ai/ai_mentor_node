#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR"
VOICE_DIR="$ROOT_DIR/voice-agent-service"

echo "[start] root: $ROOT_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[start] ERROR: pm2 is not installed. Install with: npm i -g pm2"
  exit 1
fi

# Load root .env only for validation of required vars for API.
if [[ -f "$API_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$API_DIR/.env"
  set +a
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="local-dev-$(date +%s)-$RANDOM"
  echo "[start] JWT_SECRET missing; generating local dev secret."
  printf "\nJWT_SECRET=%s\n" "$JWT_SECRET" >> "$API_DIR/.env"
  export JWT_SECRET
fi

if [[ ! -f "$VOICE_DIR/.env" ]]; then
  echo "[start] ERROR: Missing $VOICE_DIR/.env"
  exit 1
fi

echo "[start] Starting API (index)..."
pm2 delete index >/dev/null 2>&1 || true
pm2 start "$API_DIR/index.js" --name index --cwd "$API_DIR"

echo "[start] Starting Voice Worker (main)..."
pm2 delete main >/dev/null 2>&1 || true
pm2 start "node src/main.js start" --name main --cwd "$VOICE_DIR"

pm2 save

echo "[start] Done. Current PM2 status:"
pm2 status
echo "[start] Logs:"
echo "  pm2 logs index --lines 50"
echo "  pm2 logs main --lines 50"
