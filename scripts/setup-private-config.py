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
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get('CV_NATIVE_HOME', str(ROOT.parent / '.native'))).resolve()
CONFIG_DIR = HOME / 'config'
CONFIG_PATH = CONFIG_DIR / 'movies.json'


def mask(value: str) -> str:
    if not value:
        return "<unset>"
    return "******** (configured, hidden)"


def mask_db_url(url: str) -> str:
    if not url:
        return "<not configured>"
    import re
    s = str(url)
    # Mask authority user:password@ where password may contain @ or special characters
    s = re.sub(r'(://[^:/\s]+:)(.*)(@[^/\s]+)', r'\1****\3', s)
    # Also mask query parameters like ?password=... or &password=... or pwd=
    s = re.sub(r'([?&](?:password|pwd)=)[^&]*', r'\1****', s, flags=re.IGNORECASE)
    return s


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
        addr = new_mail_from
        if '<' in addr and '>' in addr:
            addr = addr.split('<')[1].split('>')[0]
        addr_clean = addr.strip().lower()
        if addr_clean.endswith('.local') or '@cinebook.local' in addr_clean or not ('.' in addr_clean.split('@')[-1] if '@' in addr_clean else False):
            print("   ⚠️  Warning: Resend rejects .local or unverified domains. Use a verified domain (or onboarding@resend.dev for testing).")
        config["MAIL_FROM"] = new_mail_from

    # App Base URL
    current_base_url = config.get("APP_BASE_URL", "")
    print(f"\n4. Application Base URL (APP_BASE_URL) [Current: {current_base_url or 'http://localhost:5177'}]")
    new_base_url = input("   Enter App Base URL: ").strip()
    if new_base_url:
        config["APP_BASE_URL"] = new_base_url

    # Write securely with timestamped backups, prune to keep 5 most recent, and atomic replace with fsync
    if CONFIG_PATH.exists():
        content = CONFIG_PATH.read_text(encoding='utf-8')
        # Maintain default movies.json.bak
        backup_path = CONFIG_PATH.with_suffix('.bak')
        backup_path.write_text(content, encoding='utf-8')
        backup_path.chmod(0o600)

        # Timestamped backup
        ts = int(time.time())
        ts_backup = CONFIG_PATH.parent / f'movies.json.bak.{ts}'
        ts_backup.write_text(content, encoding='utf-8')
        ts_backup.chmod(0o600)

        # Prune older timestamped backups, keeping 5 most recent
        existing_backups = sorted(
            CONFIG_PATH.parent.glob('movies.json.bak.*'),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        for old_bak in existing_backups[5:]:
            try:
                old_bak.unlink()
            except OSError:
                pass

    temp_path = CONFIG_PATH.with_suffix('.tmp')
    with open(temp_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    temp_path.chmod(0o600)
    temp_path.replace(CONFIG_PATH)
    CONFIG_PATH.chmod(0o600)

    print("\n✓ Configuration saved securely to ../.native/config/movies.json (mode 0600).")
    print_status(config)


if __name__ == '__main__':
    main()
