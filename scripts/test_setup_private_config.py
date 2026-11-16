"""Unit tests for scripts/setup-private-config.py: it must never print any part of a password.

Run from the repository root: python3 -m unittest discover -s scripts -p 'test_*.py'
Every test works on a temporary CV_NATIVE_HOME; the real private config is never read or written.
"""
import builtins
import contextlib
import getpass
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

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


class InteractiveSaveTest(unittest.TestCase):
    """Runs main() in-process against a temporary config directory (never the real one)."""

    def setUp(self):
        self.real_config = helper.CONFIG_PATH
        self.real_mtime = self.real_config.stat().st_mtime_ns if self.real_config.exists() else None
        self.tmp = tempfile.TemporaryDirectory()
        self.config_dir = Path(self.tmp.name) / 'config'
        self.config_dir.mkdir()
        self.config_path = self.config_dir / 'movies.json'
        self.saved_umask = os.umask(0o022)
        self.patches = [
            unittest.mock.patch.object(helper, 'CONFIG_DIR', self.config_dir),
            unittest.mock.patch.object(helper, 'CONFIG_PATH', self.config_path),
            unittest.mock.patch.object(getpass, 'getpass', lambda prompt='': ''),
            unittest.mock.patch.object(sys, 'argv', ['setup-private-config.py']),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        os.umask(self.saved_umask)
        self.tmp.cleanup()
        after = self.real_config.stat().st_mtime_ns if self.real_config.exists() else None
        self.assertEqual(self.real_mtime, after, 'the real private config must never be written by tests')

    def run_main(self, answers):
        replies = iter(answers)
        out = io.StringIO()
        with unittest.mock.patch.object(builtins, 'input', lambda prompt='': next(replies)), \
                contextlib.redirect_stdout(out):
            helper.main()
        return out.getvalue()

    def test_config_and_backups_are_private_from_creation(self):
        # CB-37: files used to be written first and chmod-ed afterwards. A backup or temp file that
        # already existed with mode 0644 then held the secrets while still world-readable. With every
        # chmod disabled, only files created private from the start end up 0600.
        self.config_path.write_text(json.dumps({'RESEND_API_KEY': 're_' + SECRET}))
        for leftover in ('movies.bak', 'movies.tmp'):
            (self.config_dir / leftover).write_text('{}')
            os.chmod(self.config_dir / leftover, 0o644)
        with unittest.mock.patch.object(os, 'chmod', lambda *a, **k: None), \
                unittest.mock.patch.object(Path, 'chmod', lambda *a, **k: None):
            output = self.run_main(['', '', ''])
        self.assertFalse(leaks(output), output)
        written = [self.config_path, self.config_dir / 'movies.bak',
                   *self.config_dir.glob('movies.json.bak.*')]
        self.assertGreaterEqual(len(written), 3)
        for path in written:
            with self.subTest(path=path.name):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.config_path.read_text())['RESEND_API_KEY'], 're_' + SECRET)

    def test_malformed_mail_from_is_not_saved(self):
        # CB-36: "Name <address" (no closing bracket) was saved; the app then treats email as unset.
        self.config_path.write_text(json.dumps({'MAIL_FROM': 'CineBook <onboarding@resend.dev>'}))
        output = self.run_main(['', 'CineBook <boxoffice@cinebook.com', ''])
        self.assertIn('Not saved', output)
        self.assertEqual(json.loads(self.config_path.read_text())['MAIL_FROM'], 'CineBook <onboarding@resend.dev>')

    def test_well_formed_mail_from_is_saved(self):
        self.config_path.write_text('{}')
        self.run_main(['', 'CineBook <boxoffice@cinebook.com>', ''])
        self.assertEqual(json.loads(self.config_path.read_text())['MAIL_FROM'], 'CineBook <boxoffice@cinebook.com>')


if __name__ == '__main__':
    unittest.main()
