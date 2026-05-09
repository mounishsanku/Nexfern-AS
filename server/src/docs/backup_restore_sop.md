# Backup and Restore SOP

**Product:** Nexfern FinanceOS  
**Audience:** System Administrators, DevOps Engineers  
**Last Updated:** Phase 16

---

## Overview

Nexfern FinanceOS uses MongoDB as its database. Backups are managed at two levels:

1. **Automated backups** — scheduled via the built-in `disasterRecoveryService`
2. **Manual backups** — using `mongodump` / `mongoexport` for specific collections

> [!IMPORTANT]
> Always test restore procedures in a staging environment before executing on production.

---

## Automated Backup System

The built-in backup subsystem is in `src/services/disasterRecoveryService.js`.

### Schedule
Backups run as part of the background job scheduler (`src/jobs/backgroundJobs.js`).
The interval is controlled by the `BACKUP_INTERVAL_MS` environment variable.

### Verify Backup Health

```http
GET /health/ready
```

Check `checks.reportCache` and `checks.monitoring` in the response. A degraded
status may indicate the backup system requires attention.

### Backup Storage
Backups are stored encrypted. The encryption key is derived from `BACKUP_SECRET`
in your `.env` file. **Rotate this key periodically and store it in a secrets manager.**

---

## Manual Backup Procedure

### Pre-requisites
- `mongodump` (from MongoDB Database Tools)
- Access to the production MongoDB connection string

### Step 1 — Full Database Dump

```bash
mongodump \
  --uri="mongodb+srv://<user>:<pass>@<host>/<dbname>" \
  --out="./backups/$(date +%Y%m%d_%H%M%S)" \
  --gzip
```

### Step 2 — Verify Dump Integrity

```bash
# Check that critical collections are present
ls ./backups/<timestamp>/nexfern/
# Expected: invoices.bson vouchers.bson entities.bson financialyears.bson ...
```

### Step 3 — Encrypt the Archive

```bash
tar czf backup_$(date +%Y%m%d).tar.gz ./backups/<timestamp>
openssl enc -aes-256-cbc -salt -in backup_$(date +%Y%m%d).tar.gz \
  -out backup_$(date +%Y%m%d).tar.gz.enc \
  -k "${BACKUP_SECRET}"
```

### Step 4 — Store Off-Site

Upload to secure object storage (S3, GCS, Azure Blob) with server-side encryption
and versioning enabled. Retain for a minimum of 90 days.

---

## Restore Procedure

> [!CAUTION]
> Restoring overwrites existing data. Always confirm the target environment before proceeding.

### Step 1 — Decrypt the Backup

```bash
openssl enc -d -aes-256-cbc -in backup_<date>.tar.gz.enc \
  -out backup_<date>.tar.gz \
  -k "${BACKUP_SECRET}"
tar xzf backup_<date>.tar.gz
```

### Step 2 — Stop the Application

```bash
# PM2:
pm2 stop nexfern-server

# Docker:
docker stop nexfern-server
```

The server will respond to in-flight requests for up to 10 seconds (graceful shutdown)
then terminate cleanly.

### Step 3 — Restore the Database

```bash
mongorestore \
  --uri="mongodb+srv://<user>:<pass>@<host>/<dbname>" \
  --drop \
  --gzip \
  ./backups/<timestamp>/
```

`--drop` drops each collection before restoring. **This is irreversible.**

### Step 4 — Restart the Application

```bash
pm2 start nexfern-server
```

Monitor the startup logs for accounting diagnostic results:
```bash
pm2 logs nexfern-server | grep "startup diagnostic"
```

### Step 5 — Verify Restore

```http
POST /api/system/diagnostics/full
```

Check that `systemStatus = "healthy"` and `issuesFound = 0` (or all auto-healed).

---

## Post-Restore Validation Checklist

- [ ] `/health/ready` returns `status: "ready"`
- [ ] `/api/health` returns `{ status: "ok" }`
- [ ] Full diagnostics show 0 unresolved issues
- [ ] Trial balance debit = credit
- [ ] Spot-check 3 invoices and their vouchers are intact
- [ ] Audit log is accessible and shows pre-backup entries

---

## Point-in-Time Recovery (PITR)

For MongoDB Atlas, enable **Continuous Cloud Backup** with point-in-time restore.
This allows recovery to any second within the retention window (typically 7–35 days).

Configure in Atlas → Project → Backup → Enable Continuous Cloud Backup.

---

## RTO / RPO Targets (Reference)

| Tier | Recovery Time Objective | Recovery Point Objective |
|---|---|---|
| Standard | < 2 hours | < 24 hours |
| Enterprise | < 30 minutes | < 1 hour |
| Atlas PITR | < 10 minutes | < 1 second |
