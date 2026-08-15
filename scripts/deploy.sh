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
deploy_log="$(mktemp)"
trap 'rm -f "$deploy_log"' EXIT
npx wrangler deploy 2>&1 | tee "$deploy_log"

url="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$deploy_log" | head -1 || true)"

# Nothing else reports a missing Access-Control-Allow-Origin: the stage just
# silently stays blank, because the sandboxed iframe cannot fetch its own
# module bundle and no error surfaces anywhere. So check it here rather than
# telling the developer to remember to.
echo
echo "==> Verifying the header the stage depends on"

if [ -z "$url" ]; then
  echo "    ? Could not read the deployed URL from wrangler's output."
  echo "      Check by hand: curl -sI <url>/runtime.html | grep -i access-control-allow-origin"
  exit 0
fi

# A brand-new workers.dev subdomain takes a minute to get its certificate, so
# being unreachable at first is normal rather than a failure.
headers=""
for attempt in 1 2 3 4 5; do
  if headers="$(curl -sI --max-time 15 "$url/runtime.html" 2>/dev/null)" && [ -n "$headers" ]; then
    break
  fi
  [ "$attempt" -lt 5 ] && sleep 15
done

# Unreachable is not the same as wrong, and must not be reported as wrong: a
# proxy, a DNS blip or a cert still being issued all land here.
if [ -z "$headers" ]; then
  echo "    ? Could not reach $url to verify — that is not the same as a failure."
  echo "      Check once it resolves:"
  echo "        curl -sI $url/runtime.html | grep -i access-control-allow-origin"
  exit 0
fi

http_status="$(printf '%s' "$headers" | grep -oiE '^HTTP/[0-9.]+ [0-9]+' | tail -1 | awk '{print $2}' || true)"
acao="$(printf '%s' "$headers" | grep -i '^access-control-allow-origin:' | tr -d '\r' | awk '{print $2}' || true)"

ok=yes
[ "$http_status" = "200" ] || { echo "    ✗ runtime.html returned $http_status, expected 200"; ok=no; }
[ "$acao" = "*" ] || { echo "    ✗ Access-Control-Allow-Origin is ${acao:-absent}, expected *"; ok=no; }

if [ "$ok" = yes ]; then
  echo "    ✓ runtime.html: 200 with Access-Control-Allow-Origin: *"
  echo
  echo "==> Live at $url"
  exit 0
fi

cat <<EOF

The stage will render blank for every visitor.

The likeliest cause is html_handling in wrangler.jsonc no longer being
"none": Cloudflare's default redirects /runtime.html to /runtime, where the
_headers rules no longer match and both headers vanish.
EOF
exit 1
