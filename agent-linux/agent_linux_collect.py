def clamav_enabled() -> bool:
    try:
        # Vérifie si clamd ou clamav-daemon tourne
        output = run_cmd(["ps", "aux"])
        if "clamd" in output or "clamav-daemon" in output:
            return True
        # Vérifie si clamscan est installé
        if run_cmd(["which", "clamscan"]):
            return True
    except Exception:
        pass
    return False
#!/usr/bin/env python3
"""Linux dedicated IT Monitoring agent.

Collects inventory, basic security posture, resource metrics, and network telemetry,
then sends data to IT Monitoring backend endpoints.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request

DEFAULT_BACKEND_URL = os.getenv("ASSET_BACKEND_URL", "http://192.168.196.134:8000/assets/scan")
AGENT_SOURCE = "linux_py"
AGENT_VERSION = "1.0.0"


def run_cmd(cmd: List[str]) -> str:
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        return out.strip()
    except Exception:
        return ""


def read_first_existing(paths: List[Path]) -> str:
    for path in paths:
        try:
            if path.exists():
                return path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            continue
    return ""


def get_primary_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("1.1.1.1", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return ""


def get_mac_address() -> str:
    mac = read_first_existing([Path("/sys/class/net/eth0/address")])
    if mac:
        return mac.lower()

    for net_dir in Path("/sys/class/net").glob("*"):
        if net_dir.name == "lo":
            continue
        addr = read_first_existing([net_dir / "address"])
        if addr:
            return addr.lower()
    return ""


def get_serial_model() -> Tuple[str, str]:
    serial = read_first_existing([
        Path("/sys/class/dmi/id/product_serial"),
        Path("/sys/devices/virtual/dmi/id/product_serial"),
    ])
    model = read_first_existing([
        Path("/sys/class/dmi/id/product_name"),
        Path("/sys/devices/virtual/dmi/id/product_name"),
    ])

    if not serial:
        serial = run_cmd(["hostnamectl", "--json=short"]) or ""
        if serial:
            try:
                serial = json.loads(serial).get("MachineID", "")
            except Exception:
                serial = ""

    return serial or socket.gethostname(), model or platform.machine()


def parse_dpkg_software() -> List[Dict[str, str]]:
    output = run_cmd(["dpkg-query", "-W", "-f=${Package}\t${Version}\n"])
    if not output:
        return []

    items: List[Dict[str, str]] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        name = parts[0].strip()
        version = parts[1].strip() if len(parts) > 1 else ""
        if name:
            items.append({"name": name, "version": version})
    return items


def parse_rpm_software() -> List[Dict[str, str]]:
    output = run_cmd(["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\n"])
    if not output:
        return []

    items: List[Dict[str, str]] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 1)
        name = parts[0].strip()
        version = parts[1].strip() if len(parts) > 1 else ""
        if name:
            items.append({"name": name, "version": version})
    return items


def get_installed_software(limit: int = 500) -> List[Dict[str, str]]:
    software = parse_dpkg_software()
    if not software:
        software = parse_rpm_software()
    return software[:limit]


def get_cpu_percent(sample_seconds: float = 0.3) -> Optional[float]:
    def read_cpu() -> Tuple[int, int]:
        with open("/proc/stat", "r", encoding="utf-8") as f:
            first = f.readline().strip().split()
        values = list(map(int, first[1:]))
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
        return idle, total

    try:
        idle1, total1 = read_cpu()
        time.sleep(sample_seconds)
        idle2, total2 = read_cpu()
        total_delta = total2 - total1
        idle_delta = idle2 - idle1
        if total_delta <= 0:
            return None
        return round((1.0 - idle_delta / total_delta) * 100.0, 2)
    except Exception:
        return None


def get_memory_gb() -> Tuple[Optional[float], Optional[float]]:
    mem_total_kb = None
    mem_avail_kb = None
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total_kb = float(line.split()[1])
                elif line.startswith("MemAvailable:"):
                    mem_avail_kb = float(line.split()[1])
        if mem_total_kb is None or mem_avail_kb is None:
            return None, None
        used_kb = mem_total_kb - mem_avail_kb
        return round(mem_total_kb / 1024 / 1024, 2), round(used_kb / 1024 / 1024, 2)
    except Exception:
        return None, None


def get_disk_gb() -> Tuple[Optional[float], Optional[float]]:
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        used = total - avail
        return round(total / 1024 / 1024 / 1024, 2), round(used / 1024 / 1024 / 1024, 2)
    except Exception:
        return None, None


def firewall_enabled() -> bool:
    ufw = run_cmd(["bash", "-lc", "command -v ufw >/dev/null 2>&1 && ufw status | head -n 1"])
    if "Status: active" in ufw:
        return True

    firewalld = run_cmd(["bash", "-lc", "command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state"])
    if firewalld.strip() == "running":
        return True

    nft = run_cmd(["bash", "-lc", "command -v nft >/dev/null 2>&1 && nft list ruleset"])
    return bool(nft)


def pending_reboot() -> bool:
    return Path("/var/run/reboot-required").exists()


def get_open_ports(limit: int = 50) -> List[int]:
    output = run_cmd(["ss", "-tuln"])
    ports: List[int] = []
    for line in output.splitlines():
        if ":" not in line or line.startswith("Netid"):
            continue
        right = line.split()[-2] if len(line.split()) >= 5 else ""
        if not right:
            continue
        part = right.rsplit(":", 1)
        if len(part) != 2:
            continue
        try:
            port = int(part[1])
            if port not in ports:
                ports.append(port)
        except ValueError:
            continue
    return ports[:limit]


def get_network_logs(limit: int = 20) -> List[str]:
    logs: List[str] = []

    journal = run_cmd(["bash", "-lc", f"command -v journalctl >/dev/null 2>&1 && journalctl -n {limit} --no-pager -q"])
    if journal:
        logs.extend([line for line in journal.splitlines() if line.strip()][:limit])

    if not logs:
        auth_log = Path("/var/log/auth.log")
        if auth_log.exists():
            try:
                lines = auth_log.read_text(encoding="utf-8", errors="ignore").splitlines()
                logs.extend(lines[-limit:])
            except Exception:
                pass

    return logs[:limit]


def post_json(url: str, payload: Dict[str, Any], timeout: int = 15) -> Tuple[bool, str]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            return 200 <= resp.status < 300, body
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        return False, f"HTTP {exc.code}: {body}"
    except Exception as exc:
        return False, str(exc)


def build_payloads(backend_url: str) -> Dict[str, Dict[str, Any]]:
    hostname = socket.gethostname()
    serial, model = get_serial_model()
    ip_addr = get_primary_ip()
    mac = get_mac_address()
    os_name = platform.system()
    os_version = f"{platform.release()} ({platform.version()})"

    cpu = get_cpu_percent()
    ram_total, ram_used = get_memory_gb()
    disk_total, disk_used = get_disk_gb()

    source = "linux_agent"
    software = get_installed_software()

    base = backend_url.rsplit("/assets/scan", 1)[0]

    assets_payload = {
        "hostname": hostname,
        "os": os_name,
        "os_version": os_version,
        "ip": ip_addr,
        "serial_number": serial,
        "model": model,
        "mac": mac,
        "software": software,
    }

    security_payload = {
        "hostname": hostname,
        "serial_number": serial,
        "ip_address": ip_addr,
        "source": source,
        "agent_source": AGENT_SOURCE,
        "agent_version": AGENT_VERSION,
        "agent_id": hostname,
        "os": f"{os_name} {platform.release()}",
        "firewall_enabled": firewall_enabled(),
        "defender_enabled": False,
        "realtime_protection_enabled": False,
        "bitlocker_enabled": False,
        "pending_reboot": pending_reboot(),
        "clamav_enabled": clamav_enabled(),
    }

    metrics_payload = {
        "serial_number": serial,
        "hostname": hostname,
        "source": source,
        "agent_source": AGENT_SOURCE,
        "agent_version": AGENT_VERSION,
        "agent_id": hostname,
        "cpu_percent": cpu,
        "ram_total_gb": ram_total,
        "ram_used_gb": ram_used,
        "disk_total_gb": disk_total,
        "disk_used_gb": disk_used,
    }

    network_payload = {
        "hosts": [
            {
                "serial_number": serial,
                "hostname": hostname,
                "ip_address": ip_addr,
                "source": source,
                "agent_source": AGENT_SOURCE,
                "agent_version": AGENT_VERSION,
                "agent_id": hostname,
                "open_ports": get_open_ports(),
                "logs": get_network_logs(),
            }
        ]
    }

    return {
        "assets": {"url": backend_url, "payload": assets_payload},
        "security": {"url": f"{base}/security/posture", "payload": security_payload},
        "metrics": {"url": f"{base}/metrics/resources", "payload": metrics_payload},
        "network": {"url": f"{base}/network/telemetry", "payload": network_payload},
    }


def run_cycle(backend_url: str, verbose: bool = False) -> bool:
    all_ok = True
    payloads = build_payloads(backend_url)

    for name, item in payloads.items():
        ok, response = post_json(item["url"], item["payload"])
        if verbose:
            print(f"[{name}] {'OK' if ok else 'ERROR'} -> {item['url']}")
            if not ok:
                print(response)
        all_ok = all_ok and ok
    return all_ok


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dedicated Linux IT Monitoring Agent")
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND_URL, help="Backend asset scan URL")
    parser.add_argument("--interval", type=int, default=300, help="Interval in seconds for loop mode")
    parser.add_argument("--loop", action="store_true", help="Run forever at fixed interval")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.loop:
        return 0 if run_cycle(args.backend_url, args.verbose) else 1

    while True:
        run_cycle(args.backend_url, args.verbose)
        time.sleep(max(30, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
