#!/usr/bin/env bash
# Run Leakproof against a fresh copy of the leaky demo shop.
# Usage: bash scripts/demo.sh scan|fix|control|learn
# learn: run `fix` twice on the cookie check alone. Run 2 starts from the leaky code again but keeps
# .leakproof/lessons.json, so it shows what the agent learned from Kane's verdicts in run 1.
set -euo pipefail
MODE=${1:-scan}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEMO=${LEAKPROOF_DEMO_DIR:-${TMPDIR:-/tmp}/leakproof-demo-shop}

# Only ever delete a scratch folder this script made: the default one, or one marked by an earlier run.
if [ -n "${LEAKPROOF_DEMO_DIR:-}" ] && [ -n "$(ls -A "$DEMO" 2>/dev/null)" ] && [ ! -f "$DEMO/.git/leakproof-scratch" ]; then
  echo "Refusing to delete $DEMO: this script did not create it. Point LEAKPROOF_DEMO_DIR at a new or empty folder." >&2
  exit 2
fi

if lsof -ti tcp:3000 -sTCP:LISTEN >/dev/null 2>&1; then
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
if [ "$MODE" = "learn" ]; then
  cat > leakproof.yml <<'YML'
url: http://localhost:3000
start: npm run build && npm run start
env: [SHOP_USER, SHOP_PASS]
flows:
  - name: checkout
    checks: [cookies]
    steps:
      - Open /login and sign in with username {{SHOP_USER}} and password {{SHOP_PASS}}
      - Open /checkout and wait for the order summary to appear
YML
fi
printf '.leakproof/\nnode_modules/\n.next/\n*.tsbuildinfo\n.impeccable/\n' > .gitignore
git init -q -b main
touch .git/leakproof-scratch
git add -A
git -c user.name="Leakproof Demo" -c user.email="demo@leakproof.local" commit -qm "Driftwood Supply"

export SHOP_USER=${SHOP_USER:-demo}
export SHOP_PASS=${SHOP_PASS:-demo123}
case "$MODE" in
  scan|control) node "$ROOT/dist/cli.js" scan ;;
  fix) node "$ROOT/dist/cli.js" fix ;;
  learn)
    node "$ROOT/dist/cli.js" fix --max-attempts 2 2>&1 | tee .leakproof/run1.txt || true
    if ! grep -q '"rejected"' .leakproof/lessons.json 2>/dev/null; then
      echo "Run 1: Kane rejected no edit, so run 2 has nothing to learn. Stopping here." >&2
      exit 0
    fi
    cp -R .leakproof/prompts .leakproof/run1-prompts
    cp .leakproof/lessons.json .leakproof/run1-lessons.json
    cp .leakproof/report.html .leakproof/run1-report.html
    rm -rf .leakproof/prompts
    git checkout -q main # the leaky code again; .leakproof (and its lessons) is gitignored, so it stays
    node "$ROOT/dist/cli.js" fix --max-attempts 2 2>&1 | tee .leakproof/run2.txt || true
    echo "Both runs are in $DEMO/.leakproof (run1.txt, run2.txt, run1-prompts/, prompts/, lessons.json)."
    ;;
  *) echo "Usage: bash scripts/demo.sh scan|fix|control|learn" >&2; exit 2 ;;
esac
