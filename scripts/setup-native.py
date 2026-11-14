#!/usr/bin/env python3
"""Initialize native PostgreSQL and private Java-project configuration (no Docker).

Install Java/PostgreSQL binaries first as described in NATIVE.md, then run this once.
Existing databases, configs, and roles are preserved. No app/database data is deleted.
"""
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native


def load_env(project):
    values = {}
    for name in ('.env', '.env.local'):
        path = native.ROOT / project / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:]
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            tokens = shlex.split(value, comments=True)
            values[key.strip()] = ' '.join(tokens) if tokens else ''
    return values


def sql(statement, database='postgres'):
    result = subprocess.run([str(native.PG_BIN / 'psql'), '-X', '-h', str(native.HOME / 'socket'),
                             '-p', str(native.PG_PORT), '-U', 'native_admin', '-d', database,
                             '-v', 'ON_ERROR_STOP=1', '-Atq'],
                            input=statement, capture_output=True, text=True)
    if result.returncode:
        # Password-bearing SQL is deliberately never included in a displayed error.
        raise RuntimeError('Database setup failed. No existing data was deleted; inspect PostgreSQL log.')
    return result.stdout.strip()


def quoted(text):
    return "'" + text.replace("'", "''") + "'"


def main():
    os.umask(0o077)
    for name in ('config', 'logs', 'run', 'socket', 'backups'):
        directory = native.HOME / name
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)
    native.HOME.chmod(0o700)
    if not (native.PG_BIN / 'initdb').is_file():
        raise RuntimeError('Install PostgreSQL 16 first. See NATIVE.md.')
    if not (native.PG_DATA / 'PG_VERSION').exists():
        if native.PG_DATA.exists() and any(native.PG_DATA.iterdir()):
            raise RuntimeError('PostgreSQL data directory is nonempty; refusing to initialize over it.')
        native.run([native.PG_BIN / 'initdb', '-D', native.PG_DATA, '-U', 'native_admin',
                    '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale', '-E', 'UTF8'])
        # This is only appended to a newly initialized, private cluster.
        with (native.PG_DATA / 'postgresql.conf').open('a') as file:
            file.write("\nlisten_addresses = '127.0.0.1'\n")
            file.write(f"port = {native.PG_PORT}\n")
            file.write(f"unix_socket_directories = '{native.HOME / 'socket'}'\n")
            file.write("shared_buffers = '64MB'\nmax_connections = 60\n")
    native.start_pg()
    settings = {
        'hr': ('hr-management-system', 'hr', 'hr', 8091),
        'movies': ('movie-reservation-system', 'movie_reservation', 'movie', 8093),
        'ai': ('ai-document-assistant', 'docassistant', 'doc', 8090),
    }
    for name, (project, database, role, port) in settings.items():
        config_path = native.HOME / 'config' / (name + '.json')
        if config_path.exists():
            env = json.loads(config_path.read_text())
        else:
            env = load_env(project)
            env.setdefault('DB_PASSWORD', secrets.token_urlsafe(32))
            if not env['DB_PASSWORD']:
                env['DB_PASSWORD'] = secrets.token_urlsafe(32)
            if not env.get('JWT_SECRET'):
                env['JWT_SECRET'] = secrets.token_urlsafe(48)
            env.update(DB_URL=f'jdbc:postgresql://127.0.0.1:{native.PG_PORT}/{database}',
                       DB_USERNAME=role, SERVER_PORT=str(port), SERVER_ADDRESS='127.0.0.1')
            if name == 'hr':
                env.update(LOGIN_RATE_LIMIT_STORE='memory', REDIS_HEALTH_ENABLED='false')
            if name == 'movies':
                env.setdefault('ADMIN_EMAIL', 'admin@cinema.local')
                env.setdefault('ADMIN_PASSWORD', secrets.token_urlsafe(24))
                env['APP_BASE_URL'] = f'http://localhost:{port}'
            with config_path.open('x') as file:
                json.dump(env, file, indent=2)
                file.write('\n')
            config_path.chmod(0o600)
        if not sql(f'select 1 from pg_roles where rolname={quoted(role)};'):
            sql(f'CREATE ROLE "{role}" LOGIN PASSWORD {quoted(env["DB_PASSWORD"])};')
        if not sql(f'select 1 from pg_database where datname={quoted(database)};'):
            sql(f'CREATE DATABASE "{database}" OWNER "{role}";')
        if name == 'ai':
            sql('CREATE EXTENSION IF NOT EXISTS vector;', database)
        print(f'Prepared native {name}: database={database}, API port={port}; secrets not printed.')
    print('Setup complete. Existing roles/configurations/databases were not overwritten.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
