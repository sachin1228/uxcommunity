#!/usr/bin/env bash
# One-time setup for the Oracle Always-Free ARM VM (apps/transcoder host).
# Idempotent — safe to re-run. Run as the default `ubuntu` user:
#   ssh -i <key> ubuntu@<IP> 'bash -s' < scripts/oracle-vm-setup.sh
set -euo pipefail

echo "[setup] apt: docker.io + ffmpeg + stress-ng + curl + cron (Minimal image lacks cron)"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io ffmpeg stress-ng curl cron
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu || true

echo "[setup] anti-idle: CPU burst 3 min every 15 min (Oracle reclaims idle free VMs)"
(sudo crontab -l 2>/dev/null | grep -v stress-ng; echo '*/15 * * * * /usr/bin/stress-ng --cpu 1 --timeout 3m') | sudo crontab -

echo "[setup] anti-idle: hold ~3 GB RAM so memory util stays above the idle threshold"
sudo tee /etc/systemd/system/mem-keepalive.service > /dev/null <<'UNIT'
[Unit]
Description=free-tier memory keep-alive
[Service]
ExecStart=/usr/bin/python3 -c "x=bytearray(3000000000); import time; time.sleep(2147483647)"
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now mem-keepalive

echo "[setup] DONE"
ffmpeg -version | head -1
docker --version
