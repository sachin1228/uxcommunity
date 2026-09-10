#!/usr/bin/env bash
# Anti-idle keep-alives only (Oracle reclaims idle Always-Free VMs).
# Safe to re-run. Run as `ubuntu`:
#   ssh -i <key> ubuntu@<IP> 'bash -s' < scripts/oracle-vm-keepalive.sh
set -euo pipefail

echo "[keepalive] CPU burst: 3 min of 1-core load every 15 min"
(sudo crontab -l 2>/dev/null | grep -v stress-ng || true; echo '*/15 * * * * /usr/bin/stress-ng --cpu 1 --timeout 3m') | sudo crontab -

echo "[keepalive] memory: hold ~3 GB so memory util stays above the idle threshold"
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

echo "[keepalive] DONE"
sudo crontab -l | tail -1
systemctl is-active mem-keepalive
