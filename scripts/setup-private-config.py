#!/usr/bin/env python3
"""Interactive or scripted setup helper for CineBook private configuration.

Allows the owner to safely configure Google Client ID, Resend API Key, Mail From,
and other environment properties in ../.native/config/movies.json without echoing
secrets to the terminal or committing them to source control.

Usage:
    python3 scripts/setup-private-config.py
    python3 scripts/setup-private-config.py --status
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get('CV_NATIVE_HOME', str(ROOT.parent / '.native'))).resolve()
CONFIG_DIR = HOME / 'config'
CONFIG_PATH = CONFIG_DIR / 'movies.json'


def mask(value: str) -> str:
    if not value:
        return "<unset>"
    return "******** (configured, hidden)"


# Only a strictly shaped "scheme://host[:port]/database" prefix is ever shown. User info, query
# parameters and anything else (where passwords live in every URL form: user:pw@, ?password=,
# sslpassword=, ;password=, encoded names...) is never printed, not even partly.
_DB_URL_PREFIX = re.compile(
    r'^((?:jdbc:)?postgres(?:ql)?://)'
    r'([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])'
    r'(:[0-9]{1,5})?'
    r'(/[A-Za-z0-9_-]+)?'
    r'(?=$|[?#;])'
)


def mask_db_url(url: str) -> str:
    if not url:
        return "<not configured>"
    s = str(url)
    match = _DB_URL_PREFIX.match(s)
    if not match:
        return "<configured, hidden (contains credentials or an unrecognised form)>"
    shown = match.group(0)
    if len(s) > len(shown):
        shown += " (parameters hidden)"
    return shown


def print_status(config: dict):
    print("CineBook Private Configuration Status:")
    print(f"  Configuration file: {CONFIG_PATH}")
    if not CONFIG_PATH.exists():
        print("  Status: Not found")
        return

    keys_to_report = [
        ("DB_URL", "db_url"),
        ("SERVER_PORT", "plain"),
        ("APP_BASE_URL", "plain"),
        ("ADMIN_EMAIL", "plain"),
        ("ADMIN_PASSWORD", "secret"),
        ("JWT_SECRET", "secret"),
        ("STRIPE_SECRET_KEY", "secret"),
        ("STRIPE_WEBHOOK_SECRET", "secret"),
        ("GOOGLE_CLIENT_ID", "plain"),
        ("RESEND_API_KEY", "secret"),
        ("MAIL_FROM", "plain"),
    ]

    for key, display_type in keys_to_report:
        val = config.get(key)
        if not val:
            display = "<not configured>"
        elif display_type == "secret":
            display = mask(str(val))
        elif display_type == "db_url":
            display = mask_db_url(str(val))
        else:
            display = str(val)
        print(f"  - {key}: {display}")


_ADDRESS = re.compile(
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}")
_NAMED = re.compile(r'(?:"[^"\\]*"|[^<>",;:@]*)\s*<([^<>]*)>')


def sender_address(value: str):
    """The address of a MAIL_FROM value, lower-cased, or None unless it is exactly one well-formed
    'address' or 'Name <address>' (same rule as the app's ResendEmailSender.senderAddress)."""
    trimmed = (value or '').strip()
    if not trimmed or any(ord(c) < 0x20 or ord(c) == 0x7f for c in trimmed):
        return None
    address = trimmed
    if '<' in trimmed or '>' in trimmed:
        named = _NAMED.fullmatch(trimmed)
        if not named:
            return None
        address = named.group(1).strip()
    if not _ADDRESS.fullmatch(address):
        return None
    return address.lower()


def _write_private(path: Path, text: str):
    """Writes text to path via a new 0600 temp file in the same directory, fsync, atomic rename.
    The data never sits in a file that is (or was) readable by others, whatever the umask or the
    mode of a file already at that path."""
    fd, temp_name = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def _fsync_dir(directory: Path):
    try:
        fd = os.open(str(directory), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def save_config(config_path: Path, config: dict):
    """Keeps movies.json.bak plus the 5 newest timestamped backups, then replaces the config
    atomically. Every file is created 0600 before any data is written (CB-37)."""
    if config_path.exists():
        content = config_path.read_text(encoding='utf-8')
        _write_private(config_path.with_suffix('.bak'), content)
        _write_private(config_path.parent / f'{config_path.name}.bak.{time.time_ns()}', content)
        existing_backups = sorted(config_path.parent.glob(f'{config_path.name}.bak.*'),
                                  key=lambda p: p.stat().st_mtime, reverse=True)
        for old_bak in existing_backups[5:]:
            try:
                old_bak.unlink()
            except OSError:
                pass
    _write_private(config_path, json.dumps(config, indent=2))
    _fsync_dir(config_path.parent)


def main():
    parser = argparse.ArgumentParser(description="Configure private settings for CineBook movie-reservation-system.")
    parser.add_argument("--status", action="store_true", help="Print configuration status without prompting")
    args = parser.parse_args()

    os.umask(0o077)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.chmod(0o700)

    config = {}
    if CONFIG_PATH.exists():
        try:
            raw = CONFIG_PATH.read_text(encoding='utf-8')
            config = json.loads(raw) if raw.strip() else {}
        except Exception as e:
            print(f"Error: Existing config file at {CONFIG_PATH} is corrupted or unparsable: {e}", file=sys.stderr)
            print("Aborting to prevent overwriting or data loss. Restore or fix the file manually.", file=sys.stderr)
            sys.exit(1)

    if args.status:
        print_status(config)
        return

    print("==================================================================")
    print(" CineBook Private Configuration Helper")
    print(" Enter values below. Press Enter without input to preserve current.")
    print(" Secrets will not be displayed or echoed.")
    print("==================================================================")

    # Google Client ID
    current_google_id = config.get("GOOGLE_CLIENT_ID", "")
    print(f"\n1. Google Sign-In Client ID [Current: {current_google_id or '<unset>'}]")
    new_google_id = input("   Enter Google Client ID: ").strip()
    if new_google_id:
        config["GOOGLE_CLIENT_ID"] = new_google_id

    # Resend API Key (secret)
    current_resend = config.get("RESEND_API_KEY", "")
    print(f"\n2. Resend API Key (for password reset emails) [Current: {mask(current_resend)}]")
    new_resend = getpass.getpass("   Enter Resend API Key (hidden): ").strip()
    if new_resend:
        config["RESEND_API_KEY"] = new_resend

    # Mail From
    current_mail_from = config.get("MAIL_FROM", "")
    print(f"\n3. Mail Sender Address (MAIL_FROM) [Current: {current_mail_from or '<unset>'}]")
    new_mail_from = input("   Enter Mail From (e.g. CineBook <boxoffice@yourdomain.com>): ").strip()
    if new_mail_from:
        address = sender_address(new_mail_from)
        if address is None:
            print("   ✗ Not saved: use exactly one address, either 'boxoffice@yourdomain.com' or "
                  "'CineBook <boxoffice@yourdomain.com>'. The previous value is kept.")
        else:
            if address.endswith('.local') or address == 'noreply@cinebook.local':
                print("   ⚠️  Warning: Resend rejects .local or unverified domains. Use a verified domain (or onboarding@resend.dev for testing).")
            config["MAIL_FROM"] = new_mail_from

    # App Base URL
    current_base_url = config.get("APP_BASE_URL", "")
    print(f"\n4. Application Base URL (APP_BASE_URL) [Current: {current_base_url or 'http://localhost:5177'}]")
    new_base_url = input("   Enter App Base URL: ").strip()
    if new_base_url:
        config["APP_BASE_URL"] = new_base_url

    save_config(CONFIG_PATH, config)

    print("\n✓ Configuration saved securely to ../.native/config/movies.json (mode 0600).")
    print_status(config)


if __name__ == '__main__':
    main()
