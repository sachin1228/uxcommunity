#!/usr/bin/env bash
# =============================================================================
# End-to-end validation for the centralized video pipeline's FFmpeg config.
#
# Generates a matrix of synthetic sources (standard MP4, silent, 4K, 60fps,
# portrait, square, screen-recording style, MOV, WebM, 10-bit) and runs the
# EXACT encode args the in-browser FFmpeg worker produces (buildEncodeArgs)
# against each with a real ffmpeg, then verifies the canonical output
# preserves resolution / FPS / duration / aspect ratio / audio and is
# faststart + yuv420p(+10le).
#
# Requires ffmpeg + ffprobe on PATH. Not part of CI by default (the wasm
# worker cannot run in CI), but run locally before shipping encoder changes:
#
#   bash scripts/test-video-pipeline.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
DRIVER="$TSX --tsconfig $ROOT/apps/web/tsconfig.json $ROOT/scripts/video-e2e-driver.ts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v ffmpeg >/dev/null || { echo "ffmpeg not found on PATH"; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found on PATH"; exit 1; }

cd "$ROOT"

# 1. Standard 1080p30 MP4 with AAC audio (12s)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=12" \
  -f lavfi -i "sine=frequency=440:duration=12" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 128k \
  "$WORK/standard.mp4"

# 2. Same, but silent (no audio track)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=8" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an \
  "$WORK/silent.mp4"

# 3. 4K30 (medium preset is expected for >1080p)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=3840x2160:rate=30:duration=5" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an \
  "$WORK/4k.mp4"

# 4. 60fps 1080p
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=6" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an \
  "$WORK/60fps.mp4"

# 5. Portrait 9:16
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=6" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an \
  "$WORK/portrait.mp4"

# 6. Square 1:1
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1080x1080:rate=30:duration=6" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an \
  "$WORK/square.mp4"

# 7. Screen-recording style: 1440p60, very high bitrate (CRF 12), PCM audio —
#    the pipeline transcodes it (copyVideo) and must shrink it.
ffmpeg -y -v error -f lavfi -i "testsrc2=size=2560x1440:rate=60:duration=10" \
  -f lavfi -i "sine=frequency=880:duration=10" \
  -c:v libx264 -preset fast -crf 12 -pix_fmt yuv420p \
  -c:a pcm_s16le \
  "$WORK/screen.mov"

# 8. MOV container with AAC (lossless remux territory, but encodes fine too)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -f lavfi -i "sine=frequency=220:duration=6" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -f mov \
  "$WORK/mov.mov"

# 9. WebM (VP9)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -c:v libvpx-vp9 -b:v 2M -an \
  "$WORK/webm.webm"

# 10. 10-bit HDR-style source (must stay 10-bit in the output)
ffmpeg -y -v error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=6" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p10le -an \
  "$WORK/10bit.mp4"

echo "── standard 1080p30 + AAC ────────────────────────────────"
(cd "$WORK" && $DRIVER standard.mp4 out-standard.mp4 --preset slow --expect-audio)

echo "── silent 1080p30 ───────────────────────────────────────"
(cd "$WORK" && $DRIVER silent.mp4 out-silent.mp4 --preset slow)

echo "── 4K30 (medium preset) ─────────────────────────────────"
(cd "$WORK" && $DRIVER 4k.mp4 out-4k.mp4 --preset medium)

echo "── 60fps 1080p ──────────────────────────────────────────"
(cd "$WORK" && $DRIVER 60fps.mp4 out-60fps.mp4 --preset slow)

echo "── portrait 9:16 ────────────────────────────────────────"
(cd "$WORK" && $DRIVER portrait.mp4 out-portrait.mp4 --preset slow)

echo "── square 1:1 ───────────────────────────────────────────"
(cd "$WORK" && $DRIVER square.mp4 out-square.mp4 --preset slow)

echo "── screen recording 1440p60 PCM (video copied, AAC added) ──"
(cd "$WORK" && $DRIVER screen.mov out-screen.mp4 --preset medium --copy-video --expect-audio)

echo "── MOV container ────────────────────────────────────────"
(cd "$WORK" && $DRIVER mov.mov out-mov.mp4 --preset slow --expect-audio)

echo "── WebM (VP9) ───────────────────────────────────────────"
(cd "$WORK" && $DRIVER webm.webm out-webm.mp4 --preset slow)

echo "── 10-bit source ────────────────────────────────────────"
(cd "$WORK" && $DRIVER 10bit.mp4 out-10bit.mp4 --preset slow --expect-10bit)

echo ""
echo "All video-pipeline E2E checks passed."