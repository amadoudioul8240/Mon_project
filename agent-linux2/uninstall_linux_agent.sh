#!/usr/bin/env bash
set -euo pipefail

SERVICE="it-monitoring-linux-agent.service"
SERVICE_FILE="/etc/systemd/system/$SERVICE"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./uninstall_linux_agent.sh"
  exit 1
fi

systemctl disable --now "$SERVICE" || true
rm -f "$SERVICE_FILE"
systemctl daemon-reload

echo "Linux agent service removed."
