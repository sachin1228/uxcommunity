#!/usr/bin/env bash
# Restores the transcoder container to PRODUCTION config after a test run:
# stops the mock completion server, closes the test firewall hole, restarts
# the container with the real APP_URL. Run as `ubuntu`:
#   ssh -i <key> ubuntu@<IP> 'bash -s' < scripts/oracle-vm-restore-prod.sh
set -euo pipefail

echo "[restore] stopping mock completion server (if any)"
pkill -f mock-complete.py 2>/dev/null || true
rm -f "$HOME/transcoder/mock-complete.py"

echo "[restore] closing the test firewall hole (docker0 → :8899)"
sudo iptables -D INPUT -i docker0 -p tcp --dport 8899 -j ACCEPT 2>/dev/null || echo "  (already closed)"

echo "[restore] restarting container with the real APP_URL"
docker rm -f transcoder > /dev/null 2>&1 || true
docker run -d --name transcoder \
  --restart unless-stopped \
  --env-file "$HOME/transcoder/.env.production" \
  -p 127.0.0.1:9090:9090 \
  -v transcoder-tmp:/tmp/transcoder \
  transcoder:latest > /dev/null

sleep 6
echo "[restore] health:"
curl -fsS http://127.0.0.1:9090/health | python3 -c "import json,sys; h=json.load(sys.stdin); print('  overall:', h['status']); [print(f\"  {k}: {v['status']}\") for k,v in h['checks'].items()]"
echo "[restore] DONE"
