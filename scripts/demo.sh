#!/usr/bin/env bash
# Run Leakproof against a fresh copy of the leaky demo shop.
# Usage: bash scripts/demo.sh scan|fix|control
set -euo pipefail
MODE=${1:-scan}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEMO=${LEAKPROOF_DEMO_DIR:-${TMPDIR:-/tmp}/leakproof-demo-shop}

if lsof -ti tcp:3000 >/dev/null 2>&1; then
  echo "Port 3000 is busy. Stop whatever runs there first." >&2
  exit 2
fi

(cd "$ROOT" && npm run build --silent)

rm -rf "$DEMO"
mkdir -p "$DEMO"
rsync -a --exclude .next --exclude .leakproof --exclude PRODUCT.md --exclude DESIGN.md "$ROOT/examples/shop/" "$DEMO/"
cd "$DEMO"
if [ "$MODE" = "control" ]; then
  patch -p3 --silent < "$ROOT/examples/shop.fixed.patch"
fi
printf '.leakproof/\nnode_modules/\n.next/\n' > .gitignore
git init -q -b main
git add -A
git -c user.name="Leakproof Demo" -c user.email="demo@leakproof.local" commit -qm "Driftwood Supply"

export SHOP_USER=${SHOP_USER:-demo}
export SHOP_PASS=${SHOP_PASS:-demo123}
case "$MODE" in
  scan|control) node "$ROOT/dist/cli.js" scan ;;
  fix) node "$ROOT/dist/cli.js" fix ;;
  *) echo "Usage: bash scripts/demo.sh scan|fix|control" >&2; exit 2 ;;
esac
