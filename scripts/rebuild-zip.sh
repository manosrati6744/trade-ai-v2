#!/usr/bin/env bash
# Rebuild SMC-Sniper-App.zip from the workspace (no node_modules/.next/data).
set -euo pipefail
cd /home/z/my-project

OUT=/home/z/my-project/download/SMC-Sniper-App.zip
rm -f "$OUT"

zip -r -q "$OUT" \
  package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs \
  DEPS-VERSION \
  components.json .gitignore README-FA.md DEPLOY-GITHUB-FA.md \
  START-WINDOWS.bat START-MAC-LINUX.sh DEPLOY-VERCEL.bat DEPLOY-NEW.bat \
  src public scripts

# demo journal only (clearly labelled in the UI) — never ship the dev brain/feeds
if [ -f data/perf-demo.json ]; then
  mkdir -p /tmp/zipdata/data && cp data/perf-demo.json /tmp/zipdata/data/
  (cd /tmp/zipdata && zip -r -q "$OUT" data)
  rm -rf /tmp/zipdata
fi

echo "--- ZIP contents (count) ---"
unzip -l "$OUT" | tail -1
echo "--- key files present ---"
unzip -l "$OUT" | grep -E "page.tsx|api/dom|TvChart|DomPanel|use-panel-fs|README-FA" || true
