#!/usr/bin/env bash
#
# Seed the community audit cache with real AI audits run through GitHub Models
# (provider "github"), so the search "audited" badges, package pages, and
# leaderboard have real data for the demo.
#
# Prerequisite: set the server-side token once:
#   cd apps/api && npx wrangler secret put GITHUB_MODELS_TOKEN
#   (paste a GitHub PAT that has the `models: read` permission)
#
# Usage:
#   scripts/seed-demo-audits.sh [API_BASE_URL]
#   scripts/seed-demo-audits.sh https://api.betternpm.org
#
# Notes:
# - GitHub Models free tier caps 8k input / 4k output tokens per request and a
#   low requests/day budget, so this list is small, tiny packages. For bigger
#   packages, opt into paid GitHub Models (same token, billing enabled).
set -euo pipefail

API="${1:-https://api.betternpm.org}"
API="${API%/}"

# Small, popular, low-risk packages — reliable within the free-tier token cap.
PACKAGES=(
  "left-pad"
  "is-odd"
  "is-even"
  "is-number"
  "ms"
  "picocolors"
  "has-flag"
  "ansi-styles"
)

field() { # field <json> <key> -> first string value for "key":"..."
  printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

poll() {
  local id="$1"
  local deadline=$(( $(date +%s) + 200 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 4
    local body status
    body="$(curl -s "$API/v1/audit-requests/$id")"
    status="$(field "$body" status)"
    case "$status" in
      completed)
        echo "  done: risk=$(field "$body" level) score=$(field "$body" score)"
        echo "  summary: $(field "$body" summary)"
        return 0 ;;
      failed)
        echo "  FAILED: $(field "$body" error)"
        return 1 ;;
    esac
  done
  echo "  timed out (still processing — check the package page later)"
  return 1
}

echo "Seeding audits via $API (provider: github)"
for pkg in "${PACKAGES[@]}"; do
  echo "=== $pkg ==="
  resp="$(curl -s -X POST "$API/v1/audit-requests" \
    -H "content-type: application/json" \
    -d "{\"provider\":\"github\",\"target\":\"npm-install\",\"packageName\":\"$pkg\",\"version\":\"latest\"}")"

  if printf '%s' "$resp" | grep -q '"cached":true'; then
    echo "  already audited (cache hit)"
    continue
  fi

  if printf '%s' "$resp" | grep -q '"error"'; then
    echo "  error: $(field "$resp" error)"
    continue
  fi

  id="$(field "$resp" id)"
  if [ -z "$id" ]; then
    echo "  no request id in response: $resp"
    continue
  fi

  echo "  queued: $id"
  poll "$id" || true
done
echo "Done."
