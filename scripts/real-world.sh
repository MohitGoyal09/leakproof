#!/usr/bin/env bash
# Run Leakproof on a real, unplanted app: cypress-io/cypress-realworld-app at a pinned commit.
# Usage: bash scripts/real-world.sh scan|fix
# Needs Node 22+, git, npx (yarn 1.22.22 is fetched by npx), Kane CLI; `fix` also needs Claude Code.
set -euo pipefail
MODE=${1:-scan}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RWA_REPO=https://github.com/cypress-io/cypress-realworld-app
RWA_COMMIT=0729f68ac220f7cda4ad09c5693dba11d7c532c6   # develop, 7 Oct 2026
APP=${LEAKPROOF_RWA_DIR:-${TMPDIR:-/tmp}/leakproof-rwa}
SHIM=${TMPDIR:-/tmp}/leakproof-rwa-shim

case "$MODE" in scan|fix) ;; *) echo "Usage: bash scripts/real-world.sh scan|fix" >&2; exit 2 ;; esac

# Only ever delete a scratch folder this script made: the default one, or one marked by an earlier run.
if [ -n "${LEAKPROOF_RWA_DIR:-}" ] && [ -n "$(ls -A "$APP" 2>/dev/null)" ] && [ ! -f "$APP/.git/leakproof-scratch" ]; then
  echo "Refusing to delete $APP: this script did not create it. Point LEAKPROOF_RWA_DIR at a new or empty folder." >&2
  exit 2
fi
for port in 3000 3001; do
  if lsof -ti tcp:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is busy. Stop whatever runs there first." >&2
    exit 2
  fi
done

(cd "$ROOT" && npm run build --silent)

# The app's scripts call `yarn` by name: put its pinned yarn on PATH, outside the app's repo.
mkdir -p "$SHIM"
printf '#!/bin/sh\nexec npx -y yarn@1.22.22 "$@"\n' > "$SHIM/yarn"
chmod +x "$SHIM/yarn"
export PATH="$SHIM:$PATH"

rm -rf "$APP"
git clone -q "$RWA_REPO" "$APP"
cd "$APP"
git checkout -q "$RWA_COMMIT"
git switch -q -c leakproof-run
touch .git/leakproof-scratch
CYPRESS_INSTALL_BINARY=0 yarn install --frozen-lockfile --silent
cp "$ROOT/docs/real-world/cypress-rwa/leakproof.yml" leakproof.yml
printf '\n.leakproof/\n.impeccable/\n' >> .gitignore
git add -A
git -c user.name="Leakproof Run" -c user.email="run@leakproof.local" commit -qm "chore: leakproof config"

# The app's own seeded demo account: the first seeded user and the password from its .env.
export RWA_USER=${RWA_USER:-$(node -e 'console.log(require("./data/database-seed.json").users[0].username)')}
export RWA_PASS=${RWA_PASS:-$(sed -n 's/^SEED_DEFAULT_USER_PASSWORD=//p' .env)}
node "$ROOT/dist/cli.js" "$MODE"
