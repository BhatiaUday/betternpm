#!/usr/bin/env sh
set -eu

DRY_RUN="${DRY_RUN:-1}"
PUBLISH_SET="${PUBLISH_SET:-all}"

if [ "$DRY_RUN" != "1" ] && [ "$DRY_RUN" != "0" ]; then
  echo "DRY_RUN must be 1 or 0" >&2
  exit 1
fi

if [ "$PUBLISH_SET" != "all" ] && [ "$PUBLISH_SET" != "reserve" ]; then
  echo "PUBLISH_SET must be all or reserve" >&2
  exit 1
fi

if [ "$DRY_RUN" = "0" ] && ! npm whoami >/dev/null 2>&1; then
  echo "npm publish requires an authenticated npm session. Run: npm login" >&2
  exit 1
fi

if [ "$PUBLISH_SET" = "all" ]; then
  npm run build:cli
fi

publish_workspace() {
  workspace="$1"
  version="$(npm pkg get version -w "$workspace" --json | node -e 'const fs = require("fs"); const value = JSON.parse(fs.readFileSync(0, "utf8")); console.log(typeof value === "string" ? value : Object.values(value)[0]);')"

  if npm view "$workspace@$version" version >/dev/null 2>&1; then
    echo "Already published: $workspace@$version"
    return
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run publish: $workspace"
    npm publish -w "$workspace" --access public --dry-run
  else
    echo "Publishing: $workspace"
    npm publish -w "$workspace" --access public
  fi
}

if [ "$PUBLISH_SET" = "all" ]; then
  publish_workspace "betternpm-core"
  publish_workspace "betternpm-cli"
fi

publish_workspace "betternpx"

if [ "$DRY_RUN" = "1" ]; then
  if [ "$PUBLISH_SET" = "reserve" ]; then
    echo "Dry run complete. To reserve names for real: npm run publish:reserve"
  else
    echo "Dry run complete. To publish for real: npm run publish:alpha"
  fi
else
  if [ "$PUBLISH_SET" = "reserve" ]; then
    echo "Published reservation packages. Verify with: npm view betternpx version"
  else
    echo "Published alpha packages. Verify with: npm view betternpm-cli version && npm view betternpx version"
  fi
fi