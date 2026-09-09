#!/usr/bin/env bash
# =============================================================================
# CRF 17/18/19 benchmark on representative DESIGNER content.
#
# Synthesizes realistic sources with native ffmpeg (UI screen recordings with
# fine text, fine-detail patterns, animated gradients, 4K and 60fps motion)
# and encodes each with the pipeline's EXACT argv (buildEncodeArgs) at CRF
# 17, 18 and 19, measuring file size, SSIM, PSNR and encode time.
#
# NOTE: this ffmpeg build has no drawtext, so typography stress comes from
# testsrc2 (scrolling fine text + moving elements) and cellauto (crisp
# text-like fine patterns).
#
#   bash scripts/benchmark-crf.sh
#
# Prints one JSON line per (fixture, crf) run. Requires ffmpeg + ffprobe on
# PATH (SSIM/PSNR need matching resolutions/fps — the pipeline preserves
# both). Findings are summarized in docs/crf-benchmark-report.md.
# =============================================================================
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Fixture 1: UI screen recording — fine text, crisp edges, motion ───────
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=6" \
  -vf "noise=alls=4:allf=t" \
  -c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 48000 \
  "$WORK/ui-screen-recording.mp4"

# ── Fixture 2: fine-detail pattern (typography proxy) — crisp edges ───────
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "cellauto=size=1920x1080:rate=30:rule=110:random_seed=42" -t 6 \
  -vf "hue=H=2*PI*t*0.1" \
  -c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p \
  "$WORK/fine-detail-pattern.mp4"

# ── Fixture 3: animated gradients — banding stress test ────────────────────
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "gradients=size=1920x1080:rate=30:duration=6:c0=0x1a2a6c:c1=0xb21f1f:c2=0xfdbb2d:x0=0:y0=0:x1=1920:y1=1080:nb_colors=3:seed=42:speed=0.6" \
  -vf "hue=H=2*PI*t*0.08" \
  -c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p \
  "$WORK/animated-gradients.mp4"

# ── Fixture 4: 4K product animation (medium preset tier) ───────────────────
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=3840x2160:rate=30:duration=5" \
  -c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p \
  "$WORK/4k-product-animation.mp4"

# ── Fixture 5: 60fps UI motion (motion stress) ─────────────────────────────
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=60:duration=5" \
  -c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p \
  "$WORK/60fps-ui-motion.mp4"

echo "── fixtures generated:"
for f in "$WORK"/*.mp4; do
  echo "   $(basename "$f"): $(du -h "$f" | cut -f1)"
done
echo

# ── Run the pipeline argv at CRF 17/18/19 per fixture ──────────────────────
for f in "$WORK"/*.mp4; do
  name="$(basename "$f" .mp4)"
  echo "── $name"
  npx tsx --tsconfig apps/web/tsconfig.json scripts/benchmark-crf.ts \
    "$f" "$WORK/out-$name" --crf 17,18,19
  echo
done