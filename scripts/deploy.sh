#!/usr/bin/env bash
# Deploy to Cloudflare from a developer machine.
#
# CI does not deploy, so the guarantee CI would have given — that whatever is
# in production passed its tests — has to live here instead. This script is
# that gate: it refuses to ship a tree it cannot tie to a commit, and it runs
# the suite before shipping.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "error: $*" >&2
  exit 1
}

[ -f .env ] || fail "no .env — copy .env.example and fill in your token."

# Read only the one variable, rather than `set -a; source .env`, which would
# export everything that file ever grows and run any code inside it.
CLOUDFLARE_API_TOKEN="$(grep -E '^CLOUDFLARE_API_TOKEN=' .env | head -1 | cut -d= -f2-)"
[ -n "$CLOUDFLARE_API_TOKEN" ] || fail "CLOUDFLARE_API_TOKEN is empty in .env"
export CLOUDFLARE_API_TOKEN

account="$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' .env | head -1 | cut -d= -f2- || true)"
[ -n "$account" ] && export CLOUDFLARE_ACCOUNT_ID="$account"

grep -q 'REPLACE_AFTER_CREATING_THE_DATABASE' wrangler.jsonc &&
  fail "wrangler.jsonc still has the placeholder database_id.
       Run: npx wrangler d1 create game-grand
       then paste the printed id into wrangler.jsonc."

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "on branch '$branch', not main. Deploy what you merged."

[ -z "$(git status --porcelain)" ] ||
  fail "working tree is dirty. Commit or stash first — a deploy must be
       reproducible from a commit."

echo "==> Typechecks"
npx tsc --noEmit
npx tsc -p tsconfig.server.json
npx tsc -p worker/tsconfig.json

echo "==> Unit tests"
make test-unit

echo "==> Build"
make build

echo "==> Deploying $(git rev-parse --short HEAD)"
npx wrangler deploy

cat <<'DONE'

==> Deployed. Verify the header the stage depends on, because nothing else
    reports its absence — the stage just silently stays blank:

      curl -sI https://<your-worker>/runtime.html | grep -i access-control-allow-origin

    Expected: Access-Control-Allow-Origin: *
DONE
