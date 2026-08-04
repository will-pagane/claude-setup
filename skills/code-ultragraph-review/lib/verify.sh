#!/usr/bin/env bash
# Run the target project's verification suite in WORKTREE_DIR and emit JSON.
# Exit 0 always; the JSON carries pass/fail. A missing tool => "skip".
set -uo pipefail

WT="${1:?worktree dir}"
EDGE_FILE="${2:-}"
cd "$WT"

# detect runner from lockfile (default npm)
if [ -f bun.lock ] || [ -f bun.lockb ]; then RUN="bun run"; PM="bun"
elif [ -f pnpm-lock.yaml ]; then RUN="pnpm"; PM="pnpm"
elif [ -f yarn.lock ]; then RUN="yarn"; PM="yarn"
else RUN="npm run"; PM="npm"; fi

has_script() { node -e "process.exit((require('./package.json').scripts||{})['$1']?0:1)" 2>/dev/null; }

run_script() { # run_script <script-name>
  local name="$1"
  command -v "$PM" >/dev/null 2>&1 || { echo "skip"; return; }
  { [ -f package.json ] && has_script "$name"; } || { echo "skip"; return; }
  if $RUN "$name" >/tmp/verify-"$name".log 2>&1; then echo "pass"; else echo "fail"; fi
}

LINT=$(run_script lint)
TEST=$(run_script test)
BUILD=$(run_script build)
if command -v tsc >/dev/null 2>&1 || [ -x node_modules/.bin/tsc ]; then
  TSC=$(run tsc npx tsc --noEmit)
else TSC="skip"; fi
if [ -n "$EDGE_FILE" ] && [ -s "$EDGE_FILE" ] && command -v deno >/dev/null 2>&1; then
  DENO=$(run deno bash -c 'xargs -a "'"$EDGE_FILE"'" deno check')
else DENO="skip"; fi

PASSED=true
for r in "$LINT" "$TEST" "$BUILD" "$TSC" "$DENO"; do [ "$r" = "fail" ] && PASSED=false; done

printf '{"passed":%s,"checks":{"lint":"%s","test":"%s","build":"%s","tsc":"%s","deno":"%s"}}\n' \
  "$PASSED" "$LINT" "$TEST" "$BUILD" "$TSC" "$DENO"
