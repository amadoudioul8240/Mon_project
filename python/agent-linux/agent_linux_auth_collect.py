#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request


DEFAULT_BACKEND_URL = os.getenv("ASSET_BACKEND_URL", "http://192.168.196.134:8000/assets/scan")
DEFAULT_AUTH_URL = os.getenv(
    "AUTH_EVENTS_URL",
    DEFAULT_BACKEND_URL.replace("/assets/scan", "/siem/auth-events"),
)
DEFAULT_STATE_DIR = Path(os.getenv("AUTH_AGENT_STATE_DIR", "/var/lib/it-monitoring-auth-agent"))
AGENT_SOURCE = "linux_auth_agent"
AUTH_UNITS = ["sshd", "ssh", "sudo", "su", "gdm", "lightdm"]


def run_cmd(cmd: List[str]) -> str:
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        return out.strip()
    except Exception:
        return ""


def ensure_state_dir(path: Path) -> Path:
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except Exception:
        fallback = Path.cwd() / ".auth-agent-state"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def load_json(path: Path) -> Dict[str, Any]:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def save_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def get_primary_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("1.1.1.1", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return ""


def get_serial_number() -> str:
    for candidate in [
        Path("/sys/class/dmi/id/product_serial"),
        Path("/sys/devices/virtual/dmi/id/product_serial"),
    ]:
        try:
            if candidate.exists():
                serial = candidate.read_text(encoding="utf-8", errors="ignore").strip()
                if serial:
                    return serial
        except Exception:
            continue
    return socket.gethostname()


def extract_user(message: str) -> str:
    patterns = [
        r"for user[= ](\S+)",
        r"Accepted \S+ for (\S+)",
        r"Failed \S+ for (?:invalid user )?(\S+)",
        r"Invalid user (\S+)",
        r"user=(\S+)",
        r"for (\S+) from",
    ]
    for pattern in patterns:
        match = re.search(pattern, message, re.IGNORECASE)
        if match:
            return match.group(1).strip(";:,")
    return ""


def extract_source_ip(message: str) -> str:
    match = re.search(r"from ([\d.]{7,15}|[0-9a-f:]{3,39})", message, re.IGNORECASE)
    if match:
        return match.group(1)
    return ""


def normalize_message(message: str) -> str:
    compact = re.sub(r"\s+", " ", message).strip()
    return compact[:300]


def parse_event(message: str, timestamp: Optional[str], record_id: Optional[int]) -> Optional[Dict[str, Any]]:
    event_id: Optional[int] = None
    outcome: Optional[str] = None

    if re.search(r"session opened for user", message, re.IGNORECASE):
        event_id = 4624
        outcome = "success"
    elif re.search(r"Accepted (password|publickey|keyboard-interactive)", message, re.IGNORECASE):
        event_id = 4624
        outcome = "success"
    elif re.search(r"authentication failure|Failed password|Invalid user|FAILED LOGIN", message, re.IGNORECASE):
        event_id = 4625
        outcome = "failure"
    elif re.search(r"account locked|user locked|maximum authentication attempts", message, re.IGNORECASE):
        event_id = 4740
        outcome = "lockout"

    if event_id is None:
        return None

    return {
        "record_id": record_id,
        "event_id": event_id,
        "timestamp": timestamp,
        "user_name": extract_user(message),
        "domain": "",
        "source_ip": extract_source_ip(message),
        "logon_type": "interactive" if event_id == 4624 else "unknown",
        "outcome": outcome,
        "message": normalize_message(message),
    }


def micros_to_iso8601(value: str) -> Optional[str]:
    try:
        dt = datetime.fromtimestamp(int(value) / 1_000_000, tz=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def parse_syslog_timestamp(prefix: str) -> Optional[str]:
    try:
        now = datetime.now()
        parsed = datetime.strptime(f"{now.year} {prefix}", "%Y %b %d %H:%M:%S")
        if parsed > now + timedelta(days=1):
            parsed = parsed.replace(year=parsed.year - 1)
        return parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def collect_from_journal(state_dir: Path, limit: int) -> Tuple[List[Dict[str, Any]], bool]:
    cursor_path = state_dir / "journal_cursor.json"
    state = load_json(cursor_path)
    cursor = (state.get("cursor") or "").strip()

    cmd = ["journalctl", "--no-pager", "-q", "-o", "json"]
    for unit in AUTH_UNITS:
        cmd.extend(["-u", unit])
    if cursor:
        cmd.extend([f"--after-cursor={cursor}"])
    else:
        cmd.extend(["-n", str(max(1, limit))])

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return [], False

    if proc.returncode not in (0, 1):
        return [], False

    events: List[Dict[str, Any]] = []
    last_cursor = cursor
    for raw_line in proc.stdout.splitlines():
        if not raw_line.strip():
            continue
        try:
            entry = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        message = str(entry.get("MESSAGE") or "").strip()
        if not message:
            continue

        parsed = parse_event(
            message,
            micros_to_iso8601(str(entry.get("__REALTIME_TIMESTAMP") or "")),
            int(entry.get("__REALTIME_TIMESTAMP")) if entry.get("__REALTIME_TIMESTAMP") else None,
        )
        if parsed:
            events.append(parsed)

        if entry.get("__CURSOR"):
            last_cursor = str(entry["__CURSOR"])

    if last_cursor and last_cursor != cursor:
        save_json(cursor_path, {"cursor": last_cursor, "updated_at": datetime.utcnow().isoformat()})

    return events, True


def collect_from_auth_log(state_dir: Path, limit: int) -> List[Dict[str, Any]]:
    auth_log_path = None
    for candidate in [Path("/var/log/auth.log"), Path("/var/log/secure")]:
        if candidate.exists():
            auth_log_path = candidate
            break

    if auth_log_path is None:
        return []

    state_path = state_dir / "auth_log_state.json"
    state = load_json(state_path)

    stat = auth_log_path.stat()
    previous_inode = state.get("inode")
    previous_offset = int(state.get("offset", 0)) if state.get("offset") is not None else 0
    if previous_inode != stat.st_ino or previous_offset > stat.st_size:
        previous_offset = 0

    events: List[Dict[str, Any]] = []
    with auth_log_path.open("r", encoding="utf-8", errors="ignore") as handle:
        handle.seek(previous_offset)
        new_lines = handle.readlines()
        new_offset = handle.tell()

    for line in new_lines[-max(1, limit):]:
        prefix_match = re.match(r"^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})", line)
        timestamp = parse_syslog_timestamp(prefix_match.group(1)) if prefix_match else None
        parsed = parse_event(line, timestamp, None)
        if parsed:
            events.append(parsed)

    save_json(
        state_path,
        {"inode": stat.st_ino, "offset": new_offset, "updated_at": datetime.utcnow().isoformat()},
    )
    return events


def collect_auth_events(state_dir: Path, limit: int) -> List[Dict[str, Any]]:
    journal_events, journal_available = collect_from_journal(state_dir, limit)
    if journal_available:
        return journal_events
    return collect_from_auth_log(state_dir, limit)


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


def build_payload(events: List[Dict[str, Any]], host_serial: str, host_name: str, host_ip: str) -> Dict[str, Any]:
    return {
        "host_serial": host_serial,
        "host_name": host_name,
        "host_ip": host_ip,
        "source": AGENT_SOURCE,
        "events": events,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dedicated Linux authentication-only agent")
    parser.add_argument("--auth-url", default=DEFAULT_AUTH_URL, help="Backend auth events URL")
    parser.add_argument("--interval", type=int, default=60, help="Interval in seconds for loop mode")
    parser.add_argument("--limit", type=int, default=200, help="Max auth log entries per collection cycle")
    parser.add_argument("--loop", action="store_true", help="Run forever at fixed interval")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--state-dir", default=str(DEFAULT_STATE_DIR), help="State directory for cursors")
    return parser.parse_args()


def run_cycle(args: argparse.Namespace) -> bool:
    state_dir = ensure_state_dir(Path(args.state_dir))
    host_name = socket.gethostname()
    host_serial = get_serial_number()
    host_ip = get_primary_ip()
    events = collect_auth_events(state_dir, max(1, args.limit))

    if args.verbose:
        print(f"[auth-only] collected {len(events)} event(s)")

    if not events:
        return True

    payload = build_payload(events, host_serial, host_name, host_ip)
    ok, response = post_json(args.auth_url, payload)
    if args.verbose:
        status = "OK" if ok else f"ERROR: {response}"
        print(f"[auth-only] send status: {status}")
    return ok


def main() -> int:
    args = parse_args()
    if not args.loop:
        return 0 if run_cycle(args) else 1

    while True:
        run_cycle(args)
        time.sleep(max(30, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())