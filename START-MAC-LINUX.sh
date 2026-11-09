#!/usr/bin/env bash
# SMC SNIPER one-click launcher (macOS / Linux)
cd "$(dirname "$0")"

echo "============================================"
echo "  SMC SNIPER - Gold / Oil / Forex Analyzer"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[X] Node.js not found!"
  echo "    Please install Node.js 20.9 or newer from https://nodejs.org"
  exit 1
fi

# Node must be >= 20.9 for Next.js 16
NODE_V="$(node -v)"            # like v20.11.0
NODE_MAJ="${NODE_V:1:2}"
NODE_MIN="${NODE_V:4:2}"
echo "[OK] $NODE_V detected"
if [ "$NODE_MAJ" -lt 20 ] || { [ "$NODE_MAJ" -eq 20 ] && [ "$NODE_MIN" -lt 9 ]; } 2>/dev/null; then
  echo "[X] Node.js $NODE_V is too old for this app (needs 20.9+)."
  echo "    Install the LTS version from https://nodejs.org and run again."
  exit 1
fi

# warn when port 3000 is busy (old copy still running)
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":3000 "; then
  echo
  echo "[!] Port 3000 is BUSY - an old copy of the app is probably still open."
  echo "    Close that terminal first (Ctrl+C inside it), otherwise the new"
  echo "    version cannot start."
  echo
elif command -v lsof >/dev/null 2>&1 && lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo
  echo "[!] Port 3000 is BUSY - close the old app window (Ctrl+C) first."
  echo
fi

# install deps when missing or when app version changed
DEPSVER=0
[ -f DEPS-VERSION ] && DEPSVER="$(cat DEPS-VERSION)"
if [ ! -f "node_modules/.smc-deps-v$DEPSVER" ]; then
  echo "[1/2] Preparing packages - please wait 1-3 min (needs internet once)..."
  npm install --no-audit --no-fund --prefer-offline || {
    echo "[X] npm install failed - check your internet / VPN."
    echo "    If it still fails: delete the node_modules folder and run again."
    exit 1
  }
  mkdir -p node_modules && touch "node_modules/.smc-deps-v$DEPSVER"
fi

echo "[2/2] Building and starting..."
if ! npm run build; then
  echo
  echo "    Build failed - trying one automatic repair (re-install packages)..."
  echo
  npm install --no-audit --no-fund --prefer-offline || {
    echo "[X] Repair install failed - check internet / VPN and run again."
    echo "    If it still fails: delete the node_modules folder and run again."
    exit 1
  }
  touch "node_modules/.smc-deps-v$DEPSVER"
  if ! npm run build; then
    echo "[X] Build failed again. Screenshot this window and send it for support."
    echo "    Also try: delete node_modules and .next folders, then run again."
    exit 1
  fi
fi

echo
echo "============================================"
echo "  SMC SNIPER is running!"
echo "  Open:  http://localhost:3000"
echo "  Stop:  press Ctrl+C"
echo "============================================"
echo
npm start
