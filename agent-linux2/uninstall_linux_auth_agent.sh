#!/usr/bin/env bash
set -euo pipefail

SERVICE="it-monitoring-linux-auth-agent.service"
SERVICE_FILE="/etc/systemd/system/$SERVICE"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./uninstall_linux_auth_agent.sh"
  exit 1
fi

systemctl disable --now "$SERVICE" || true
rm -f "$SERVICE_FILE"
systemctl daemon-reload

echo "Linux auth-only agent service removed."