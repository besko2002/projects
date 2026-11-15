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

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get('CV_NATIVE_HOME', str(ROOT.parent / '.native'))).resolve()
CONFIG_DIR = HOME / 'config'
CONFIG_PATH = CONFIG_DIR / 'movies.json'


def mask(value: str) -> str:
    if not value:
        return "<unset>"
    if len(value) <= 8:
        return "****"
    return value[:4] + "...." + value[-4:]


def print_status(config: dict):
    print("CineBook Private Configuration Status:")
    print(f"  Configuration file: {CONFIG_PATH}")
    if not CONFIG_PATH.exists():
        print("  Status: Not found")
        return

    keys_to_report = [
        ("DB_URL", False),
        ("SERVER_PORT", False),
        ("APP_BASE_URL", False),
        ("ADMIN_EMAIL", False),
        ("ADMIN_PASSWORD", True),
        ("JWT_SECRET", True),
        ("STRIPE_SECRET_KEY", True),
        ("STRIPE_WEBHOOK_SECRET", True),
        ("GOOGLE_CLIENT_ID", False),
        ("RESEND_API_KEY", True),
        ("MAIL_FROM", False),
    ]

    for key, is_secret in keys_to_report:
        val = config.get(key)
        if not val:
            display = "<not configured>"
        elif is_secret:
            display = mask(str(val))
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
            config = json.loads(CONFIG_PATH.read_text())
        except Exception as e:
            print(f"Warning: Could not read existing config at {CONFIG_PATH}: {e}", file=sys.stderr)

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
        config["MAIL_FROM"] = new_mail_from

    # App Base URL
    current_base_url = config.get("APP_BASE_URL", "")
    print(f"\n4. Application Base URL (APP_BASE_URL) [Current: {current_base_url or 'http://localhost:5177'}]")
    new_base_url = input("   Enter App Base URL: ").strip()
    if new_base_url:
        config["APP_BASE_URL"] = new_base_url

    # Write securely
    temp_path = CONFIG_PATH.with_suffix('.tmp')
    with open(temp_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)
    temp_path.chmod(0o600)
    temp_path.replace(CONFIG_PATH)
    CONFIG_PATH.chmod(0o600)

    print("\n✓ Configuration saved securely to ../.native/config/movies.json (mode 0600).")
    print_status(config)


if __name__ == '__main__':
    main()
