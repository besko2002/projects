# Production Deployment Runbook & Strategy

This runbook covers the production architecture, secrets management, deployment procedures, zero-downtime update policy, disaster recovery, and operational maintenance for the HR Management System.

---

## 1. System Architecture

The production environment runs via `docker-compose.prod.yml` with strict network segmentation and cgroup resource limits:

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

All production secrets reside in `/opt/hr-management-system/.env.production` with restrictive POSIX permissions (`chmod 0600` owned by `root`).

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

## 4. Zero-Downtime Rolling Update Strategy

### Flyway Database Migration Policy
1. **Additive Changes First**: Schema migrations must always be backward compatible with the running application version. Never drop columns, rename columns, or add non-null constraints without default values in a single step.
2. **Multi-Phase Transitions**:
   - Phase 1 (Deploy N): Add new nullable column / new table.
   - Phase 2 (Deploy N+1): Update application code to read/write new column.
   - Phase 3 (Deploy N+2): Deprecate and remove old column.

### Rolling Image Update Execution
```bash
# 1. Pull latest images in the background without affecting live traffic
docker compose -f docker-compose.prod.yml --env-file .env.production pull

# 2. Recreate backend container (Flyway migrations run automatically on boot)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps app

# 3. Wait for app healthcheck to pass (Caddy handles retries / buffering)
docker compose -f docker-compose.prod.yml --env-file .env.production exec app curl -fsS http://localhost:8091/actuator/health

# 4. Recreate frontend container
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps frontend

# 5. Clean up stale untagged images
docker image prune -f
```

---

## 5. Rollback Procedures

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

## 6. Backup, Retention & Disaster Recovery

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

## 7. Pre-Flight Deployment Checklist

Before granting production deployment approval:
- [ ] All unit, integration, and architecture tests passed (`./mvnw test` -> 607 passed).
- [ ] Frontend linting clean (`npm run lint` -> 0 errors).
- [ ] Frontend unit tests passed (`npm test` -> 200 passed).
- [ ] Dependency audits clean (`npm audit` -> 0 vulnerabilities).
- [ ] End-to-end tests passed (`npm run e2e` -> 5 passed).
- [ ] Production Compose file syntax verified (`docker compose -f docker-compose.prod.yml config --quiet`).
- [ ] Strong random secrets generated and stored in `.env.production` (mode `0600`).
- [ ] DNS A/AAAA records verified with global propagation.
- [ ] Backup script verified with test backup and test restore.
- [ ] Bounded load testing verified with zero errors and < 384 MB heap.
