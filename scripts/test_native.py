"""Unit tests for process/data safety in the native launcher (no live services changed)."""
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import native


class NativeLauncherTest(unittest.TestCase):
    def test_stale_pid_is_not_treated_as_managed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'run').mkdir()
            (home / 'run/hr-api.json').write_text(json.dumps({'pid': 42, 'identity': 'old process'}))
            with patch.object(native, 'HOME', home), patch.object(native, 'identity', return_value='other process'):
                self.assertIsNone(native.managed('hr-api'))

    def test_matching_process_identity_is_managed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'run').mkdir()
            (home / 'run/hr-api.json').write_text(json.dumps({'pid': 42, 'identity': 'same process'}))
            with patch.object(native, 'HOME', home), patch.object(native, 'identity', return_value='same process'):
                self.assertEqual(native.managed('hr-api')['pid'], 42)

    def test_stop_does_not_signal_reused_pid(self):
        with patch.object(native, 'managed', return_value=None), patch.object(native.os, 'killpg') as kill:
            native.stop_process('hr-api')
            kill.assert_not_called()

    def test_refuses_occupied_port(self):
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            with self.assertRaisesRegex(RuntimeError, 'already in use'):
                native.free_port(server.getsockname()[1])

    def test_missing_config_does_not_start_service(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(native, 'HOME', Path(directory)):
                with self.assertRaisesRegex(RuntimeError, 'Missing private native configuration'):
                    native.app_env('hr')

    def test_postgres_is_never_initialized_by_runtime_launcher(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(native, 'PG_DATA', Path(directory)), patch.object(native, 'pg_running', return_value=False):
                with self.assertRaisesRegex(RuntimeError, 'not initialized'):
                    native.start_pg()


if __name__ == '__main__':
    unittest.main()
