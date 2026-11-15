#!/usr/bin/env python3
"""Run CineBook in isolated portfolio demo mode without Docker.

Usage: python3 scripts/demo.py {start|stop|status|build}
Runs CineBook with app.demo.enabled=true on an isolated database (cinebook_demo).
Never modifies, resets, or migrates the owner's saved database (movie_reservation).
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get('CV_NATIVE_HOME', str(ROOT.parent / '.native'))).resolve()
JAVA_HOME = Path(os.environ.get('JAVA_HOME', str(HOME / 'tools/jdk-21.0.13+9/Contents/Home')))
PG_BIN = Path(os.environ.get('PG_BIN', str(HOME / 'tools/Postgres.app/Contents/Versions/16/bin')))
PG_DATA = HOME / 'postgres16'
PG_PORT = int(os.environ.get('NATIVE_PG_PORT', '55432'))
PROJECT_DIR = ROOT / 'movie-reservation-system'

DEMO_KEY = 'movies-demo'
DEMO_PORT = int(os.environ.get('DEMO_PORT', '8094'))
DEMO_DB_NAME = os.environ.get('DEMO_DB_NAME', 'cinebook_demo')


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, **kwargs)


def pg_running():
    if not (PG_BIN / 'pg_ctl').is_file() or not PG_DATA.is_dir():
        return False
    return subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(PG_DATA), 'status'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def start_pg():
    if pg_running():
        return
    if not (PG_DATA / 'PG_VERSION').is_file():
        raise RuntimeError('Native PostgreSQL cluster is not initialized. See NATIVE.md.')
    run([PG_BIN / 'pg_ctl', '-D', PG_DATA, '-l', HOME / 'logs/postgres.log', '-w', 'start'])


def ensure_demo_database(db_owner='movie'):
    """Ensures the isolated demo database exists; never modifies any other database."""
    psql = [PG_BIN / 'psql', '-X', '-h', HOME / 'socket', '-p', str(PG_PORT), '-U', 'native_admin',
            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c']
    check_cmd = subprocess.run([str(x) for x in psql] + [f"select 1 from pg_database where datname = '{DEMO_DB_NAME}'"],
                               capture_output=True, text=True)
    if check_cmd.returncode == 0 and '1' in check_cmd.stdout:
        return
    print(f'Creating isolated demo database: {DEMO_DB_NAME} (owner={db_owner})')
    run(psql + [f'CREATE DATABASE "{DEMO_DB_NAME}" WITH OWNER "{db_owner}"'])


def identity(pid):
    p = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                       capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ''


def record_path(key):
    return HOME / 'run' / (key + '.json')


def managed(key):
    path = record_path(key)
    if not path.exists():
        return None
    try:
        info = json.loads(path.read_text())
        if identity(info['pid']) == info['identity']:
            return info
    except Exception:
        pass
    return None


def free_port(port):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
        except OSError:
            raise RuntimeError(f'Port {port} is already in use; stop the existing process first.')


def spawn(key, command, cwd, env):
    (HOME / 'logs').mkdir(parents=True, exist_ok=True)
    (HOME / 'run').mkdir(parents=True, exist_ok=True)
    logfile = HOME / 'logs' / (key + '.log')
    with logfile.open('ab') as log:
        child = subprocess.Popen([str(x) for x in command], cwd=cwd, env=env,
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    for _ in range(20):
        ident = identity(child.pid)
        if ident:
            break
        time.sleep(0.05)
    if not ident:
        raise RuntimeError(f'{key} exited immediately; inspect {logfile}')
    record_path(key).write_text(json.dumps({'pid': child.pid, 'identity': ident}))
    return logfile


def wait_http(key, url, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not managed(key):
            raise RuntimeError(f'{key} exited; inspect {HOME / "logs" / (key + ".log")}')
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f'{key} readiness timed out ({url}); inspect its log.')


def demo_env():
    env = os.environ.copy()
    config_path = HOME / 'config/movies.json'
    if config_path.is_file():
        values = json.loads(config_path.read_text())
        env.update({k: str(v) for k, v in values.items()})

    # Isolated database and ports for demo mode
    env['DB_URL'] = f'jdbc:postgresql://127.0.0.1:{PG_PORT}/{DEMO_DB_NAME}'
    env['SERVER_PORT'] = str(DEMO_PORT)
    env['APP_BASE_URL'] = f'http://127.0.0.1:{DEMO_PORT}'
    env['DEMO_MODE_ENABLED'] = 'true'
    env['JAVA_HOME'] = str(JAVA_HOME)
    env['PATH'] = str(JAVA_HOME / 'bin') + os.pathsep + env.get('PATH', '')

    # Allow explicit environment overrides
    if 'STRIPE_WEBHOOK_SECRET' in os.environ:
        env['STRIPE_WEBHOOK_SECRET'] = os.environ['STRIPE_WEBHOOK_SECRET']
    if 'STRIPE_SECRET_KEY' in os.environ:
        env['STRIPE_SECRET_KEY'] = os.environ['STRIPE_SECRET_KEY']
    return env


def build():
    print('Building frontend...')
    frontend_dir = PROJECT_DIR / 'frontend'
    run(['npm', 'run', 'build'], cwd=frontend_dir)

    print('Copying frontend bundle to static resources...')
    static_dir = PROJECT_DIR / 'src/main/resources/static'
    static_dir.mkdir(parents=True, exist_ok=True)
    run(['cp', '-r', str(frontend_dir / 'dist') + '/.', str(static_dir)])

    print('Packaging self-contained Spring Boot JAR...')
    env = demo_env()
    run([PROJECT_DIR / 'mvnw', '-B', '-q', '-Dmaven.test.skip=true', 'package'],
        cwd=PROJECT_DIR, env=env)
    print('Build complete.')


def start():
    if not (JAVA_HOME / 'bin/java').is_file():
        raise RuntimeError('Java 21 is not installed; set JAVA_HOME. See NATIVE.md.')

    jars = [p for p in (PROJECT_DIR / 'target').glob('*.jar') if not p.name.startswith('original-')]
    if len(jars) != 1:
        build()
        jars = [p for p in (PROJECT_DIR / 'target').glob('*.jar') if not p.name.startswith('original-')]

    if not managed(DEMO_KEY):
        free_port(DEMO_PORT)
        start_pg()
        ensure_demo_database()
        env = demo_env()
        print(f'Starting CineBook Portfolio Demo on port {DEMO_PORT} (DB={DEMO_DB_NAME})...')
        spawn(DEMO_KEY, [JAVA_HOME / 'bin/java', '-Xms64m', '-Xmx384m',
                         '-XX:MaxMetaspaceSize=192m', '-jar', jars[0]],
              PROJECT_DIR, env)

    wait_http(DEMO_KEY, f'http://127.0.0.1:{DEMO_PORT}/actuator/health')
    print('================================================================')
    print(f'  🎬 CineBook Portfolio Demo is RUNNING')
    print(f'  URL: http://127.0.0.1:{DEMO_PORT}')
    print(f'  API Health: http://127.0.0.1:{DEMO_PORT}/actuator/health')
    print(f'  Demo Status: http://127.0.0.1:{DEMO_PORT}/api/demo/status')
    print(f'  Isolated Database: {DEMO_DB_NAME}')
    print('================================================================')


def stop():
    info = managed(DEMO_KEY)
    if not info:
        print('CineBook demo is not running.')
        return
    try:
        os.killpg(info['pid'], signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + 30
    while managed(DEMO_KEY) and time.monotonic() < deadline:
        time.sleep(0.2)
    record = record_path(DEMO_KEY)
    if record.exists():
        record.unlink(missing_ok=True)
    print('Stopped CineBook demo.')


def status():
    info = managed(DEMO_KEY)
    if info:
        print(f'CineBook demo is RUNNING (pid={info["pid"]}, port={DEMO_PORT}, db={DEMO_DB_NAME})')
    else:
        print('CineBook demo is STOPPED.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'build'])
    args = parser.parse_args()

    actions = {
        'start': start,
        'stop': stop,
        'status': status,
        'build': build,
    }
    actions[args.action]()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as err:
        print('ERROR:', err, file=sys.stderr)
        sys.exit(1)
