# Production Deployment Reference & Operational Runbook

> [!NOTE]
> **Reference Documentation**: This document outlines deployment procedures, configuration templates, and operational runbooks for architecture reference. Live public deployment is strictly outside project scope. Production templates (`docker-compose.prod.yml`, `Caddyfile`, `deploy.yml`) are non-blocking reference designs unverified in a live production cluster.

---

## 1. System Architecture

The reference production architecture is configured via `docker-compose.prod.yml` with network segmentation and cgroup resource limits:

```
                            [ Internet ]
                                 │
                            ports 80/443
                                 ▼
                     ┌───────────────────────┐
                     │   Caddy Reverse Proxy │ (Auto TLS, Security Headers, Gzip)
                     │       [128 MB max]    │
                     └───────────┬───────────┘
                                 │
             ┌───────────────────┴───────────────────┐
             │ frontend-net                          │ backend-net
             ▼                                       ▼
    ┌─────────────────┐                     ┌─────────────────┐
    │ Frontend (Nginx)│                     │  Backend (App)  │
    │   [64 MB max]   │                     │  [768 MB max]   │
    └─────────────────┘                     └────────┬────────┘
                                                     │ db-net (isolated)
                                         ┌───────────┴───────────┐
                                         ▼                       ▼
                                ┌─────────────────┐     ┌─────────────────┐
                                │   PostgreSQL    │     │   Redis Store   │
                                │   [512 MB max]  │     │   [256 MB max]  │
                                └─────────────────┘     └─────────────────┘
```

### Network Isolation Policy
- **`frontend-net`**: Connects Caddy to the frontend web server. Cannot communicate with databases.
- **`backend-net`**: Connects Caddy to the Spring Boot backend (`app:8091`).
- **`db-net`** (`internal: true`): Completely isolated internal network. Only `app`, `postgres`, and `redis` participate. No host ports are published; external access is strictly impossible.

### Cgroup Resource Ceilings
| Service | Memory Limit | JVM / Service Tuning | Healthcheck |
| :--- | :--- | :--- | :--- |
| **Caddy** | 128 MB | Low-footprint Go runtime | `caddy version` (10s) |
| **Frontend** | 64 MB | Nginx Alpine static server | `wget http://127.0.0.1:80/` (10s) |
| **App** | 768 MB | `-XX:MaxRAMPercentage=50` (~384MB heap), Metaspace 128MB | `curl /actuator/health` (10s) |
| **PostgreSQL**| 512 MB | Shared buffers ~128MB | `pg_isready` (5s) |
| **Redis** | 256 MB | `--maxmemory 192mb --maxmemory-policy noeviction` | `redis-cli ping` (5s) |

---

## 2. Secrets Management & Environment Configuration

All reference secrets reside in `/opt/hr-management-system/.env.production` with restrictive POSIX permissions (`chmod 0600` owned by `root`).

### Required Production Variables
```bash
# Domain & TLS
DOMAIN=hr.company.com
ACME_EMAIL=security-alerts@company.com

# Database Credentials
DB_NAME=hr
DB_USERNAME=hr
DB_PASSWORD=<Generate: openssl rand -base64 32>
DB_POOL_SIZE=10

# Security & Tokens
# Minimum 32 bytes (256-bit) high-entropy string
JWT_SECRET=<Generate: openssl rand -base64 48>
JWT_EXPIRATION=PT8H

# Bootstrap Administrator (single-use seed credential)
HR_ADMIN_EMAIL=admin@company.com
HR_ADMIN_PASSWORD=<Generate: openssl rand -base64 24>

# Application Configuration
LOG_LEVEL_APP=INFO
```

### Pre-Deployment Environment Validation
Always validate the syntax and interpolation of the compose file before executing any startup command:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet
```

---

## 3. Initial Provisioning & First Boot

1. **Host Setup**:
   - Ubuntu 22.04 / Debian 12 / RHEL 9 with Docker Engine 26+ and Docker Compose v2.
   - Configure DNS `A` and `AAAA` records pointing `hr.company.com` to the server IP.
   - Ensure firewall allows inbound traffic on TCP 80 and 443 only.
2. **Directory Structure**:
   ```bash
   mkdir -p /opt/hr-management-system/infra/{caddy,backup}
   mkdir -p /var/backups/hr-management
   ```
3. **Deploy Configuration**:
   - Copy `docker-compose.prod.yml`, `infra/caddy/Caddyfile`, `infra/backup/backup.sh`, and `infra/backup/restore.sh`.
   - Create `.env.production` with mode `0600`.
4. **First Startup**:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```
5. **Initial Admin Password Rotation**:
   - Log in immediately via the web UI at `https://hr.company.com`.
   - The UI automatically redirects to `/change-password` because `mustChangePassword=true`.
   - Change the password to a permanent administrative credential.

---

## 4. Rolling Image Update Procedure (Single-Node Notice)

> [!WARNING]
> **Single-Node Service Interruption**: On a single Docker host, `docker compose up -d --no-deps app` recreates the container in-place. During the 5–15 seconds while Spring Boot initializes and runs Flyway migrations, reverse proxies will return HTTP 502 to clients. True zero-downtime deployment requires multi-instance load balancing with blue/green deployment or orchestration.

### Flyway Database Migration Policy
1. **Additive Changes First**: Schema migrations must always be backward compatible with the running application version. Never drop columns, rename columns, or add non-null constraints without default values in a single step.
2. **Multi-Phase Transitions**:
   - Phase 1 (Deploy N): Add new nullable column / new table.
   - Phase 2 (Deploy N+1): Update application code to read/write new column.
   - Phase 3 (Deploy N+2): Deprecate and remove old column.

### Image Update Execution
```bash
# 1. Pull latest images in the background without affecting live traffic
docker compose -f docker-compose.prod.yml --env-file .env.production pull

# 2. Recreate backend container (service restarts; brief 5–15s transition window)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps app

# 3. Wait for app healthcheck to pass
docker compose -f docker-compose.prod.yml --env-file .env.production exec app curl -fsS http://localhost:8091/actuator/health

# 4. Recreate frontend container
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps frontend

# 5. Clean up stale untagged images
docker image prune -f
```

---

## 5. Concurrency, Locking & Scalability Architecture

### Payroll Concurrency & Row-Level Locking
To prevent race conditions between concurrent recalculate, finalize, and delete requests:
- `PayrollRun` entity mutations acquire a database row-level lock via `findByIdForUpdate` (`LockModeType.PESSIMISTIC_WRITE`).
- Run status checks are performed strictly under lock protection before modifying draft payslips or finalizing records.
- Batch generation writes payslips in chunks within a single transaction, ensuring full atomic rollback if a failure occurs during execution.

### Bounded Org-Chart Pagination
- Silent `LIMIT 500` truncation is eliminated. The org-chart API endpoints (`/api/org-chart` and `/api/org-chart/{id}/children`) use bounded pagination (`PageResponse<OrgChartNode>`).
- The frontend supports continuation via "Load more roots" and "Load more reports" buttons, making organizations with arbitrary depth and breadth navigable without unbounded memory payloads.

### Distributed Sliding-Window Throttling
- When `app.login-rate-limit.store=redis`, `RedisLoginThrottle` uses Redis Sorted Sets (ZSET) with millisecond scores and atomic Lua scripts.
- Pruning of expired entries older than `now - window` matches `LoginRateLimiter` sliding-window semantics.
- Outages fail open gracefully with error logging.

### Scale Evidence & Capacity Limits
- **Isolated 5,000 Employee Workload**:
  - Validated in `PayrollFullStackScaleTest` against isolated PostgreSQL container.
  - Database batch seeding: ~0.4s
  - Org-chart roots & children (4,999 reports) queries: < 100ms
  - Paged employee search: ~50ms
  - 5,000 employee payroll run calculation & batch persistence: ~7.3s
  - Streaming SXSSFWorkbook Excel export (5,000 payslips): ~2.2s (362 KB)
  - Point-in-time heap snapshot: ~166 MB (note: heap snapshots are point-in-time readings, not continuous peak measurements).
- **20,000 Capacity Scope**:
  - Full-stack execution on 20,000 employees is explicitly unverified on local test runners due to container resource constraints.

---

## 6. Rollback Procedures

If a deployment fails health checks or introduces regression:

### Fast Image Rollback (No Schema Changes)
```bash
# Pin previous image digest/tag in .env.production
sed -i 's/APP_IMAGE=.*/APP_IMAGE=ghcr.io\/company\/hr-management-app:<PREVIOUS_TAG>/' .env.production

# Recreate app container with previous image
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps app
```

### Full Disaster Rollback (Schema/Data Corruption)
```bash
# 1. Take application offline temporarily to prevent partial writes
docker compose -f docker-compose.prod.yml --env-file .env.production stop app frontend

# 2. Restore database from latest verified backup
/opt/hr-management-system/infra/backup/restore.sh /var/backups/hr-management/hr_db_<TIMESTAMP>.sql.gz --force

# 3. Restart application stack
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

---

## 7. Backup, Retention & Disaster Recovery

### Automated Backup Schedule
Add the following entry to root crontab (`sudo crontab -e`):
```cron
# Run daily database backup at 02:30 UTC
30 2 * * * DB_CONTAINER=hr-prod-postgres BACKUP_DIR=/var/backups/hr-management S3_BUCKET=company-hr-backups /opt/hr-management-system/infra/backup/backup.sh >> /var/log/hr-backup.log 2>&1
```

### Disaster Recovery Metrics
- **RPO (Recovery Point Objective)**: 24 hours (daily snapshot) or point-in-time via WAL archiving if enabled.
- **RTO (Recovery Time Objective)**: < 15 minutes to fully restore database and spin up stack from clean state.

---

## 8. Operational Verification Checklist

Before deploying changes:
- [ ] Targeted backend integration tests passed (`PayrollFullStackScaleTest`, `HierarchyIntegrationTest`, `RedisLoginThrottleIntegrationTest`, `PayrollBatchBoundaryIntegrationTest`, `PayrollRunIntegrationTest`).
- [ ] Frontend linting clean (`npm run lint` -> 0 errors, 0 warnings).
- [ ] Frontend unit tests passed (`npm test -- --run` -> all tests pass).
- [ ] Dependency audits clean (`npm audit` -> 0 vulnerabilities).
- [ ] End-to-end tests passed on isolated test stack.
- [ ] Production Compose file syntax verified (`docker compose -f docker-compose.prod.yml config --quiet`).
- [ ] Strong random secrets generated and stored in `.env.production` (mode `0600`).
