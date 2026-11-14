#!/usr/bin/env bash
# ==============================================================================
# Database Restore Script for HR Management System
# Safely restores a compressed SQL backup into a PostgreSQL database container.
# ==============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"
FORCE="${2:-}"
CONTAINER_NAME="${DB_CONTAINER:-hr-prod-postgres}"
DB_NAME="${DB_NAME:-hr}"
DB_USER="${DB_USERNAME:-hr}"

if [ -z "${BACKUP_FILE}" ]; then
    echo "Usage: $0 <path-to-backup.sql.gz> [--force]" >&2
    exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file '${BACKUP_FILE}' does not exist." >&2
    exit 1
fi

# Verify gzip integrity before attempting restore
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Verifying backup archive integrity..."
if ! gzip -t "${BACKUP_FILE}"; then
    echo "ERROR: Backup archive '${BACKUP_FILE}' is corrupted or not a valid gzip file." >&2
    exit 2
fi
echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Backup archive integrity verified."

# Safety prompt if --force is not passed
if [ "${FORCE}" != "--force" ]; then
    echo "WARNING: Restoring will overwrite existing data in database '${DB_NAME}' on container '${CONTAINER_NAME}'!"
    read -r -p "Type 'RESTORE' to confirm: " CONFIRMATION
    if [ "${CONFIRMATION}" != "RESTORE" ]; then
        echo "Restore aborted by user."
        exit 0
    fi
fi

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
    echo "ERROR: Target database container '${CONTAINER_NAME}' is not running." >&2
    exit 1
fi

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Restoring database '${DB_NAME}' from '${BACKUP_FILE}'..."

# Stream decompressed backup into psql
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" --single-transaction

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Database restore completed successfully."
