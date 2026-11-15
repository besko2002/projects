"""Unit tests for scripts/setup-private-config.py: it must never print any part of a password.

Run from the repository root: python3 -m unittest discover -s scripts -p 'test_*.py'
Every test works on a temporary CV_NATIVE_HOME; the real private config is never read or written.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / 'setup-private-config.py'
_spec = importlib.util.spec_from_file_location('setup_private_config', SCRIPT)
helper = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(helper)

SECRET = 'S3cr3tPw'

LEAKY_URLS = [
    f'jdbc:postgresql://127.0.0.1:55432/movie_reservation?user=movie&password={SECRET}',
    f'jdbc:postgresql://127.0.0.1:55432/movie_reservation?password={SECRET}&user=movie',
    f'jdbc:postgresql://127.0.0.1/db?user=u&password=ab@{SECRET}',
    f'jdbc:postgresql://127.0.0.1/db?user=u&PASSWORD={SECRET}',
    f'jdbc:postgresql://127.0.0.1/db?user=u&sslpassword={SECRET}',
    f'jdbc:postgresql://127.0.0.1/db?user=u&password%3D={SECRET}',
    f'jdbc:postgresql://127.0.0.1/db;password={SECRET}',
    f'jdbc:postgresql://127.0.0.1/db#password={SECRET}',
    f'jdbc:postgresql://[::1]:5432/db?password={SECRET}',
    f'postgresql://movie:{SECRET}@127.0.0.1:5432/db',
    f'postgresql://movie:p@{SECRET}@127.0.0.1:5432/db',
    f'postgresql://movie:{SECRET}:x@127.0.0.1/db',
    f'postgresql://movie:pa/{SECRET}@127.0.0.1/db',
    f'postgresql://:{SECRET}@host/db',
    f'postgresql://{SECRET}@host/db',
    f'jdbc:postgresql://movie:{SECRET}@127.0.0.1/db',
    f'jdbc:postgresql://127.0.0.1/db?user=u&password={SECRET[:4]}%26{SECRET[4:]}',
    f'{SECRET}',
]


def leaks(text):
    return any(part in text for part in (SECRET, SECRET[:4], SECRET[4:]))


class MaskDbUrlTest(unittest.TestCase):
    def test_no_form_of_database_password_is_printed(self):
        for url in LEAKY_URLS:
            with self.subTest(url=url):
                self.assertFalse(leaks(helper.mask_db_url(url)), helper.mask_db_url(url))

    def test_plain_location_stays_readable(self):
        self.assertEqual(helper.mask_db_url('jdbc:postgresql://127.0.0.1:55432/movie_reservation'),
                         'jdbc:postgresql://127.0.0.1:55432/movie_reservation')
        self.assertEqual(
            helper.mask_db_url(f'jdbc:postgresql://127.0.0.1:55432/movie_reservation?password={SECRET}'),
            'jdbc:postgresql://127.0.0.1:55432/movie_reservation (parameters hidden)')


class StatusOutputTest(unittest.TestCase):
    def test_status_prints_no_secret_value(self):
        values = {
            'DB_URL': f'jdbc:postgresql://127.0.0.1:55432/movie_reservation?user=movie&sslpassword={SECRET}',
            'DB_PASSWORD': SECRET + 'db',
            'ADMIN_PASSWORD': SECRET + 'admin',
            'JWT_SECRET': SECRET + 'jwt' * 10,
            'STRIPE_SECRET_KEY': 'sk_test_' + SECRET,
            'STRIPE_WEBHOOK_SECRET': 'whsec_' + SECRET,
            'RESEND_API_KEY': 're_' + SECRET,
            'MAIL_FROM': 'CineBook <onboarding@resend.dev>',
        }
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config'
            config.mkdir()
            (config / 'movies.json').write_text(json.dumps(values))
            env = dict(os.environ, CV_NATIVE_HOME=directory)
            result = subprocess.run([sys.executable, '-I', str(SCRIPT), '--status'], env=env,
                                    capture_output=True, text=True, check=True)
        output = result.stdout + result.stderr
        self.assertIn('127.0.0.1:55432/movie_reservation', output)
        self.assertFalse(leaks(output), output)


if __name__ == '__main__':
    unittest.main()
