#!/usr/bin/env bash
# =============================================================================
# Downloads the pinned @ffmpeg/core build into scripts/ffmpeg-core/ — the
# committed, checksum-verified artifact for the video pipeline's FFmpeg
# worker. The core is served from R2 (media/videos-adjacent bucket) at
# ffmpeg-core/{ffmpeg-core.js,ffmpeg-core.wasm} — NOT from the Worker's
# static assets, which cap files at 25 MiB (the wasm is ~31 MiB). Upload
# with:  bash scripts/upload-ffmpeg-core.mjs
#
# The download is verified against pinned SHA-256 checksums (supply-chain
# guard); the committed files are checked by the CI test suite, so a
# tampered or stale core fails tests.
#
#   bash scripts/fetch-ffmpeg-core.sh
# =============================================================================
set -euo pipefail

VERSION="0.12.10"
BASE="https://cdn.jsdelivr.net/npm/@ffmpeg/core@${VERSION}/dist/umd"
DEST="$(cd "$(dirname "$0")/.." && pwd)/scripts/ffmpeg-core"

# SHA-256 of the @ffmpeg/core@0.12.10 dist/umd artifacts (pinned — update
# deliberately when upgrading the core, and regenerate with `shasum -a 256`).
declare -A CHECKSUMS=(
  [ffmpeg-core.js]="b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21"
  [ffmpeg-core.wasm]="9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7"
)

mkdir -p "$DEST"

for FILE in ffmpeg-core.js ffmpeg-core.wasm; do
  TMP="$(mktemp)"
  echo "Fetching ${FILE}..."
  curl -fsSL -o "$TMP" "${BASE}/${FILE}"

  ACTUAL="$(shasum -a 256 "$TMP" | awk '{print $1}')"
  EXPECTED="${CHECKSUMS[$FILE]}"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "✗ SHA-256 mismatch for ${FILE}: expected ${EXPECTED}, got ${ACTUAL}" >&2
    rm -f "$TMP"
    exit 1
  fi

  mv "$TMP" "$DEST/$FILE"
  echo "✓ ${FILE} (${EXPECTED:0:12}…) verified and installed"

done

echo "ffmpeg core ${VERSION} is pinned at scripts/ffmpeg-core/"
echo "Upload to R2 (required for production):  node scripts/upload-ffmpeg-core.mjs"