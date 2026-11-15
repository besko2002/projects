#!/usr/bin/env python3
"""Run the Java portfolio projects natively; microservices remain Docker-managed.

Usage: python3 scripts/native.py {start|stop|status|build} {hr|movies|ai|all|postgres}
Tool paths and private configuration default to PROJECT/.native. Override CV_NATIVE_HOME,
JAVA_HOME, PG_BIN, or NATIVE_PG_PORT when using your own native installation.
This launcher never creates/drops databases, installs dependencies, or calls Docker.
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
APPS = {
    'hr': ('hr-management-system', 8091, 5175),
    'movies': ('movie-reservation-system', 8093, 5177),
    'ai': ('ai-document-assistant', 8090, 5174),
}


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, **kwargs)


def app_env(name):
    path = HOME / 'config' / (name + '.json')
    if not path.is_file():
        raise RuntimeError(f'Missing private native configuration: {path}. See NATIVE.md.')
    env = os.environ.copy()
    values = json.loads(path.read_text())
    env.update({k: str(v) for k, v in values.items()})
    env['JAVA_HOME'] = str(JAVA_HOME)
    env['PATH'] = str(JAVA_HOME / 'bin') + os.pathsep + env.get('PATH', '')
    return env


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
    info = json.loads(path.read_text())
    if identity(info['pid']) == info['identity']:
        return info
    return None


def free_port(port):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
        except OSError:
            raise RuntimeError(f'Port {port} is already in use; no process was stopped.')


def spawn(key, command, cwd, env):
    (HOME / 'logs').mkdir(parents=True, exist_ok=True)
    (HOME / 'run').mkdir(parents=True, exist_ok=True)
    logfile = HOME / 'logs' / (key + '.log')
    with logfile.open('ab') as log:
        child = subprocess.Popen([str(x) for x in command], cwd=cwd, env=env,
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    # Wait until ps can identify the process; used to avoid killing a reused PID later.
    for _ in range(20):
        ident = identity(child.pid)
        if ident:
            break
        time.sleep(0.05)
    if not ident:
        raise RuntimeError(f'{key} exited; inspect {logfile}')
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
    raise RuntimeError(f'{key} readiness timed out; inspect its log. Use stop to stop it.')


def build(name):
    directory, _, _ = APPS[name]
    project = ROOT / directory
    env = app_env(name)
    if not (JAVA_HOME / 'bin/java').is_file():
        raise RuntimeError('Java 21 is not installed; set JAVA_HOME. See NATIVE.md.')
    # Build artifacts only: existing Docker-based integration tests remain optional.
    run([project / 'mvnw', '-B', '-q', '-Dmaven.test.skip=true', 'package'], cwd=project, env=env)


TEST_DB_PREFIX = {'movies': 'movie_test_'}


def drop_leftover_test_databases(prefix, owner):
    """Drops test databases a crashed run left behind; only this prefix and owner, never others."""
    if not prefix.endswith('_test_') or not prefix.replace('_', '').isalnum():
        raise ValueError('Unsafe test database prefix')
    psql = [PG_BIN / 'psql', '-X', '-h', HOME / 'socket', '-p', str(PG_PORT), '-U', 'native_admin',
            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', '-c']
    query = ("select d.datname from pg_database d join pg_roles r on r.oid = d.datdba "
             f"where d.datname like '{prefix}%' and r.rolname = '{owner}'")
    names = subprocess.run([str(x) for x in psql] + [query], check=True, capture_output=True,
                           text=True).stdout.split()
    for db in names:
        if db.startswith(prefix) and db[len(prefix):].isalnum():
            run(psql + [f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)'])
    return len(names)


def test(name):
    """Runs a project's full test suite against throwaway native databases (no Docker)."""
    if name not in TEST_DB_PREFIX:
        raise RuntimeError(f'Native (Docker-free) tests are not set up for {name} yet.')
    path = HOME / 'config' / 'tests.json'
    if not path.is_file():
        raise RuntimeError('Missing native test configuration; run python3 scripts/setup-native.py.')
    creds = json.loads(path.read_text())
    if not (JAVA_HOME / 'bin/java').is_file():
        raise RuntimeError('Java 21 is not installed; set JAVA_HOME. See NATIVE.md.')
    start_pg()
    project = ROOT / APPS[name][0]
    # Deliberately NOT the app's private config: tests must never see real Stripe keys.
    env = {k: v for k, v in os.environ.items() if not k.startswith(('STRIPE_', 'DB_', 'JWT_'))}
    env.update(JAVA_HOME=str(JAVA_HOME), PATH=str(JAVA_HOME / 'bin') + os.pathsep + env.get('PATH', ''),
               MAVEN_OPTS='-Xmx384m',
               MOVIE_TEST_DB_URL=f'jdbc:postgresql://127.0.0.1:{PG_PORT}/postgres',
               MOVIE_TEST_DB_USERNAME=creds['username'], MOVIE_TEST_DB_PASSWORD=creds['password'],
               # Each cached test context owns a database and a pool. The shared server also serves
               # the running native apps, so pools open connections on demand and only one test
               # context is cached at a time (peak ~20 connections from tests).
               SPRING_DATASOURCE_HIKARI_MAXIMUMPOOLSIZE='10',
               SPRING_DATASOURCE_HIKARI_MINIMUMIDLE='1',
               SPRING_DATASOURCE_HIKARI_IDLETIMEOUT='10000')
    try:
        # The 'test' phase never repackages the jar, so a running native app is not disturbed.
        run([project / 'mvnw', '-B', '-q', 'test',
             '-DargLine=-Xmx512m -Dspring.test.context.cache.maxSize=1'], cwd=project, env=env)
    finally:
        left = drop_leftover_test_databases(TEST_DB_PREFIX[name], creds['username'])
        if left:
            print(f'Dropped {left} leftover test database(s).')
    print(f'{name}: all tests passed against native PostgreSQL (reports: {project / "target/surefire-reports"})')


def start(name):
    directory, api_port, ui_port = APPS[name]
    project = ROOT / directory
    env = app_env(name)
    api_port = int(env.get('SERVER_PORT', api_port))
    # Fail before spawning anything if the host sandbox blocks process inspection.
    identity(os.getpid())
    if not managed(name + '-api'):
        jars = [p for p in (project / 'target').glob('*.jar') if not p.name.startswith('original-')]
        if len(jars) != 1:
            raise RuntimeError(f'Build {name} first: python3 scripts/native.py build {name}')
        free_port(api_port)
        start_pg()
        spawn(name + '-api', [JAVA_HOME / 'bin/java', '-Xms64m', '-Xmx384m',
                              '-XX:MaxMetaspaceSize=192m', '-jar', jars[0]], project, env)
    wait_http(name + '-api', f'http://127.0.0.1:{api_port}/actuator/health')
    print(f'{name} API: http://127.0.0.1:{api_port}')
    if ui_port:
        if not managed(name + '-ui'):
            vite = project / 'frontend/node_modules/vite/bin/vite.js'
            if not vite.is_file():
                raise RuntimeError(f'Install frontend dependencies in {project / "frontend"} first.')
            free_port(ui_port)
            spawn(name + '-ui', ['node', vite, '--host', '127.0.0.1', '--port', str(ui_port),
                                 '--strictPort'], project / 'frontend', env)
        wait_http(name + '-ui', f'http://127.0.0.1:{ui_port}/')
        print(f'{name} frontend: http://127.0.0.1:{ui_port}')
    if name == 'movies':
        print(f'Movie Swagger: http://127.0.0.1:{api_port}/swagger-ui.html')


def stop_process(key):
    info = managed(key)
    if not info:
        return
    os.killpg(info['pid'], signal.SIGTERM)
    deadline = time.monotonic() + 30
    while managed(key) and time.monotonic() < deadline:
        time.sleep(0.2)
    if managed(key):
        raise RuntimeError(f'{key} did not stop cleanly; no force-kill was sent.')
    print('Stopped:', key)


def stop(name):
    for suffix in ('-ui', '-api'):
        stop_process(name + suffix)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'build', 'test'])
    parser.add_argument('project', choices=list(APPS) + ['all', 'postgres'])
    args = parser.parse_args()
    if args.project == 'postgres':
        if args.action == 'start':
            start_pg()
        elif args.action == 'stop':
            if any(managed(n + '-api') for n in APPS):
                raise RuntimeError('Stop native APIs before stopping their shared PostgreSQL.')
            if pg_running():
                run([PG_BIN / 'pg_ctl', '-D', PG_DATA, '-w', '-m', 'fast', 'stop'])
        elif args.action == 'status':
            print('PostgreSQL:', 'running' if pg_running() else 'stopped', f'port={PG_PORT}')
        else:
            raise RuntimeError('PostgreSQL is installed separately, not built by this launcher.')
        return
    names = list(APPS) if args.project == 'all' else [args.project]
    if args.action == 'test' and args.project == 'all':
        names = list(TEST_DB_PREFIX)
    for name in names:
        if args.action == 'status':
            print(name, 'api=' + ('running' if managed(name + '-api') else 'stopped'),
                  'ui=' + ('running' if managed(name + '-ui') else 'stopped'))
        else:
            {'start': start, 'stop': stop, 'build': build, 'test': test}[args.action](name)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
