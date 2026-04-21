#!/usr/bin/env bash
set -euo pipefail

AUTH_URL="${1:-http://192.168.196.134:8000/siem/auth-events}"
INSTALL_DIR="/opt/it-monitoring-auth-agent"
SERVICE_FILE="/etc/systemd/system/it-monitoring-linux-auth-agent.service"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo ./install_linux_auth_agent.sh [auth_events_url]"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
cp "$(dirname "$0")/../python/agent-linux/agent_linux_auth_collect.py" "$INSTALL_DIR/agent_linux_auth_collect.py"
chmod 755 "$INSTALL_DIR/agent_linux_auth_collect.py"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=IT Monitoring Linux Auth Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent_linux_auth_collect.py --loop --interval 60 --auth-url $AUTH_URL
Restart=always
RestartSec=8
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now it-monitoring-linux-auth-agent.service
systemctl status it-monitoring-linux-auth-agent.service --no-pager -l || true

echo "Linux auth-only agent installed with backend: $AUTH_URL"