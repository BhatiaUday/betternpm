#!/usr/bin/env sh
set -eu

REPO="${BETTERNPM_REPO:-BhatiaUday/betternpm}"
REF="${BETTERNPM_REF:-main}"
ARCHIVE_URL="https://codeload.github.com/${REPO}/tar.gz/${REF}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "betternpm installer: missing required command: $1" >&2
    exit 1
  fi
}

need curl
need node
need npm
need tar

node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 20) { process.exit(1); }' || {
  echo "betternpm installer: Node.js 20 or newer is required." >&2
  exit 1
}

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t betternpm)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "Installing betternpm from ${REPO}@${REF}..."
curl -fsSL "$ARCHIVE_URL" | tar -xz --strip-components=1 -C "$TMP_DIR"

cd "$TMP_DIR"
npm install
npm -w betternpm-core run build
npm -w betternpm-cli run build
npm -w betternpm-cli link

echo "Installed betternpm, bnpm, betternpx, and bnpx. Try: bnpm --help"