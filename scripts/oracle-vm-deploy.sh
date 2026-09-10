#!/usr/bin/env bash
# Build + run the transcoder on the Oracle VM. Expects:
#   ~/transcoder/context.tar.gz   — repo subset (uploaded by the deploy flow)
#   ~/transcoder/.env.production  — secrets (chmod 600, never committed)
# Idempotent: stops/replaces the previous container. Run as `ubuntu`:
#   ssh -i <key> ubuntu@<IP> 'bash -s' < scripts/oracle-vm-deploy.sh
set -euo pipefail

WORK="$HOME/transcoder"
sudo mkdir -p "$WORK/src"
sudo tar -xzf "$WORK/context.tar.gz" -C "$WORK/src"

cd "$WORK/src"
echo "[deploy] building image (ARM-native, ~3-5 min first time)…"
sudo docker build -f apps/transcoder/Dockerfile -t transcoder:latest .

echo "[deploy] (re)starting container…"
sudo docker rm -f transcoder 2>/dev/null || true
sudo docker run -d --name transcoder \
  --restart unless-stopped \
  --env-file "$WORK/.env.production" \
  -p 127.0.0.1:9090:9090 \
  -v transcoder-tmp:/tmp/transcoder \
  transcoder:latest

echo "[deploy] waiting for health…"
for i in $(seq 1 20); do
  sleep 3
  if curl -fsS http://127.0.0.1:9090/health > /tmp/health.json 2>/dev/null; then
    echo "[deploy] health after ~$((i * 3))s:"
    cat /tmp/health.json
    exit 0
  fi
done

echo "[deploy] health check did not pass — recent logs:"
sudo docker logs --tail 40 transcoder
exit 1
