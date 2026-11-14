# Native local development (macOS Apple Silicon)

The HR, movie-reservation, and AI-document applications run directly on macOS with a
shared native PostgreSQL 16 server. **Only order-processing microservices need Docker
for their normal local runtime.** Docker remains an optional tool for the existing
Testcontainers integration tests; the launchers do not call Docker.

Image colorization already uses native Python/SQLite; see its own README and launcher.

## Installed tooling and private state

By default, `scripts/native.py` uses the sibling directory `../.native/`, outside this
Git repository. It contains downloaded native tools, PostgreSQL data, private JSON
configuration, PID records, logs, and database backups. Do not commit/share this directory.
It is not a Docker image or a virtual machine.

- Java: Eclipse Temurin 21.0.13, Apple Silicon (`tools/jdk-21.0.13+9/Contents/Home`).
- PostgreSQL: Postgres.app 2.9.7 / PostgreSQL 16 (`tools/Postgres.app/Contents/Versions/16/bin`).
  This distribution includes the `vector` extension for the AI document database.
- Database: `127.0.0.1:55432`, listening only on loopback, with separate database roles.
- Each Java API uses a maximum 384 MB heap. Running fewer apps saves more memory than
  starting every project simultaneously.

Official downloads: [Temurin](https://adoptium.net/temurin/releases/?version=21) and
[Postgres.app](https://github.com/PostgresApp/PostgresApp/releases/tag/v2.9.7).
For another machine, install Java 21 and PostgreSQL 16 plus pgvector, then set `JAVA_HOME`
and `PG_BIN` to their native locations. `CV_NATIVE_HOME` optionally changes private
state storage. `NATIVE_PG_PORT` must be chosen before initial setup and kept consistent.
No administrator access or system-wide PATH change is needed with the bundled paths.
Node.js and Python 3 must be available on PATH.

## First setup on another machine

```bash
# Run from cv-projects, after installing the native tools described above.
python3 scripts/setup-native.py
# Install JS dependencies only where they are not already installed:
(cd hr-management-system/frontend && npm ci)
(cd movie-reservation-system/frontend && npm ci)
(cd ai-document-assistant/frontend && npm ci)
python3 scripts/native.py build hr
python3 scripts/native.py build movies
python3 scripts/native.py build ai
```

Setup initializes a **new** private database cluster only when none exists. It preserves
existing configuration, roles, and databases. It never restores or deletes existing data.
It imports trusted local `.env` / `.env.local` settings into private configuration once;
subsequent changes belong in `../.native/config/{hr,movies,ai}.json`, not in committed files.
Passwords and API keys are not printed. The native JSON config is data, not a shell script.

Build commands package current application code without running the integration suites.
Run tests separately when needed; this does not mean the tests have passed.

## Start only the project you need

```bash
python3 scripts/native.py start hr
python3 scripts/native.py start movies
python3 scripts/native.py start ai
python3 scripts/native.py status all
```

| Project | UI / explorer | API | Database |
|---|---|---|---|
| HR | http://localhost:5175 | http://localhost:8091 | `hr` |
| Movies | http://localhost:5177 (CineBook) · http://localhost:8093/swagger-ui.html | http://localhost:8093 | `movie_reservation` |
| AI documents | http://localhost:5174 | http://localhost:8090 | `docassistant` |

The movie API uses **8093** rather than its default 8080, because the Docker microservices
API gateway uses 8080. Vite runs the HR, CineBook (port 5177), and AI frontends natively and proxies `/api` to
the corresponding native API. All native services bind to loopback.

The launcher refuses to take over occupied ports and only stops processes it started,
checking their PID/start identity first. Inspect `../.native/logs/` if startup fails.
If source files change, stop, rebuild, and restart the affected API. Vite reloads UI changes.

```bash
python3 scripts/native.py stop hr
python3 scripts/native.py stop movies
python3 scripts/native.py stop ai
# Stop the shared database only after all native APIs are stopped:
python3 scripts/native.py stop postgres
```

Stopping services does not delete database data. Avoid using `start all` unless all three
projects are configured and you actually need them running.

## Existing HR data and rollback

The existing Docker PostgreSQL volume is retained. A restricted-permission custom-format
`pg_dump` backup is stored in `../.native/backups/` before switching. Restore is performed
into the separate native `hr` database, never by copying Docker's raw PostgreSQL files.
The native schema may apply newer forward migrations when its API first starts.

**Do not run the Docker and native HR stacks on the same ports.** Before choosing Docker
again, stop native HR, then use the original Docker Compose instructions. Its preserved
volume is a pre-cutover snapshot; later native writes are not automatically mirrored.
Do not restart the old stack expecting it to contain new native changes. Back up the native
database before any reverse migration or upgrade.

Example native backup (adjust paths for custom installations):

```bash
umask 077
../.native/tools/Postgres.app/Contents/Versions/16/bin/pg_dump \
  -h ../.native/socket -p 55432 -U native_admin -d hr -Fc \
  -f ../.native/backups/hr-native-manual.dump
```

Use a new filename for each backup. Never commit database dumps or private configuration.

## External-feature requirements

- Movie Stripe Checkout/refunds require your own Stripe **test-mode** keys and webhook
  forwarding. Without keys, provider-dependent endpoints intentionally return 503; local
  startup and browsing do not establish a successful payment integration.
- AI document upload/questions require a valid Gemini API key in the native AI config.
  Starting without one does not make embeddings or answers work; no fake provider is used.
- Image colorization needs its actual model checkpoint and compatible Python ML dependencies.
  A missing checkpoint must not be described as working colorization.

No public deployment, production readiness, or complete external-provider test is implied
by the native runtime switch.
