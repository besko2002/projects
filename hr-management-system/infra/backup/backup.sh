#!/usr/bin/env bash
# ==============================================================================
# Database Backup Script for HR Management System
# Creates compressed, timestamped pg_dump backups with automated retention pruning.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hr-management}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CONTAINER_NAME="${DB_CONTAINER:-hr-prod-postgres}"
DB_NAME="${DB_NAME:-hr}"
DB_USER="${DB_USERNAME:-hr}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
BACKUP_FILE="${BACKUP_DIR}/hr_db_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting database backup for '${DB_NAME}' from container '${CONTAINER_NAME}'..."

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
    echo "ERROR: Target database container '${CONTAINER_NAME}' is not running." >&2
    exit 1
fi

# Execute pg_dump directly through docker exec, stream to gzip
docker exec -i "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-privileges --clean --if-exists | gzip -9 > "${BACKUP_FILE}"

# Verify backup integrity
if ! gzip -t "${BACKUP_FILE}"; then
    echo "ERROR: Backup integrity verification failed for ${BACKUP_FILE}" >&2
    rm -f "${BACKUP_FILE}"
    exit 2
fi

BACKUP_SIZE=$(ls -lh "${BACKUP_FILE}" | awk '{print $5}')
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Backup successfully created: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Offsite / S3 upload hook if configured
if [ -n "${S3_BUCKET:-}" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Uploading backup to S3: s3://${S3_BUCKET}/backups/"
    if command -v aws >/dev/null 2>&1; then
        aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/backups/$(basename "${BACKUP_FILE}")"
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] S3 upload complete."
    else
        echo "WARN: AWS CLI not installed; skipping S3 upload." >&2
    fi
fi

# Retention pruning: delete local backups older than RETENTION_DAYS
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "hr_db_*.sql.gz" -type f -mtime +"${RETENTION_DAYS}" -exec rm -vf {} \;

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Backup cycle complete."
