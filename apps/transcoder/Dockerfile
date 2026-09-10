# Server-side transcoder for the video pipeline.
#
# Build from the REPO ROOT (npm workspaces — the lockfile references every
# workspace manifest, and the transcoder depends on @uxcommunity/shared):
#
#   docker build -f apps/transcoder/Dockerfile -t transcoder .
#
# Run with the env vars from apps/transcoder/.env.example. Needs network
# access to Supabase, R2 and the web app's /api/internal/video/complete.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first for layer caching; every workspace manifest must be
# present for `npm ci` to validate against package-lock.json.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY apps/transcoder/package.json apps/transcoder/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --workspace=apps/transcoder --include-workspace-root=false

COPY packages/shared packages/shared
COPY apps/transcoder apps/transcoder

ENV NODE_ENV=production
CMD ["npm", "run", "start", "--workspace=apps/transcoder"]