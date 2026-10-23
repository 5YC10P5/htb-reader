#!/usr/bin/env sh
# Starts the HTB Reader voice server (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it free from https://nodejs.org (LTS version)."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing the voice engine. This takes a minute..."
  npm install --omit=dev || exit 1
fi
exec node server/server.mjs
