#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${1:-http://192.168.196.134:8000/assets/scan}"
INSTALL_DIR="/opt/it-monitoring-agent-linux"
SERVICE_FILE="/etc/systemd/system/it-monitoring-linux-agent.service"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./install_linux_agent.sh [backend_url]"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
cp "$(dirname "$0")/../python/agent-linux/agent_linux_collect.py" "$INSTALL_DIR/agent_linux_collect.py"
chmod 755 "$INSTALL_DIR/agent_linux_collect.py"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=IT Monitoring Linux Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent_linux_collect.py --loop --interval 300 --backend-url $BACKEND_URL
Restart=always
RestartSec=8
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now it-monitoring-linux-agent.service
systemctl status it-monitoring-linux-agent.service --no-pager -l || true

echo "Linux agent installed with backend: $BACKEND_URL"
