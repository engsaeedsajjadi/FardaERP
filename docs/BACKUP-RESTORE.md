# FardaERP — Backup & Restore Runbook (§25)

> Verified: 2026-09-16 — a real backup of `smoke.farda.local` was restored into a fresh
> `verify.farda.local` and data/custom-fields/farda-settings/ suites were asserted on the
> restored site (see `erpnext/farda_iran/tests/test_backup_restore_runtime.py`, R13).
> **A backup that has never been restored successfully is NOT considered verified** — this one has.

## 1) What is backed up

| Component | Mechanism | Notes |
|---|---|---|
| Database (full, all apps' tables) | `bench --site X backup` (frappe-native) | includes ERPNext/HRMS/Farda doctypes, GL, custom fields, docs |
| Uploaded files (public+private) | `backup --with-files` | tarball relative to the site dir |
| `site_config.json` | copied by `scripts/backup.sh` | **NOT** included by frappe backups; contains db name + keys — treat as SECRET |
| Integrity | `MANIFEST.sha256` per backup dir | `sha256sum -c MANIFEST.sha256` before any restore |

Redis is **not** backed up (cache/queue are rebuildable by design; `redis_queue` jobs lost on DR are acceptable and documented).

## 2) Frequency (production recommendation)

```cron
# DB+files nightly 02:30, weekly full retained longer (see retention)
30 2 * * * root /opt/farda/FardaERP/scripts/backup.sh production.farda.local >> /var/log/farda-backup.log 2>&1
```

Before **any destructive migration**: run `backup.sh` manually and only proceed on `BACKUP-OK`.

## 3) Retention

* `FARDA_RETENTION_DAYS` (default **30**) — backup dirs older than that are pruned after each run.
* Keep at least one copy **off the DB host** (rsync/restic the `FARDA_BACKUP_DIR` tree off-site).

## 4) Encryption (optional but recommended for off-site copies)

Set `FARDA_BACKUP_PASSPHRASE` → every staged artifact (DB + files tarballs) is encrypted
AES-256-CBC/PBKDF2 (`.enc`); only ciphertext is kept. `site_config.json` stays plaintext in the
staging dir **by design** — store the whole staging dir on an encrypted/restricted volume, or
move it manually. Restore decrypts automatically when the passphrase env is set.

## 5) Restore procedure

```bash
# 1. create the (empty) target site once — NEVER restore over a running prod site
bench --site verify.farda.local new-site ...   # same db engine as source

# 2. restore DB (+ optionally files)
FARDA_BACKUP_PASSPHRASE=... scripts/restore.sh verify.farda.local \
    "$(cat FARDA_BACKUP_DIR/prod/LATEST)/20250916-023000-*.sql.gz.enc" \
    "$(cat FARDA_BACKUP_DIR/prod/LATEST)/20250916-023000-private-files.tar.enc"

# 3. verify BEFORE switching traffic
sha256sum -c MANIFEST.sha256
bench --site verify.farda.local console  # spot checks (see §6)
```

## 6) Restore verification gate (automated)

`erpnext/farda_iran/tests/test_backup_restore_runtime.py::run()` performs the full cycle on the
current environment and asserts on the restored site:

1. marker Customer created pre-backup exists post-restore,
2. `Sales Invoice` count equals the source count,
3. Farda custom fields count equals the source count,
4. `Farda VAT Settings` values equal the source values,
5. the frappe-free unit suite passes **on the restored site**.

## 7) Disaster recovery runbook

1. Provision host (Docker stack — §26) with the SAME db engine as the backup.
2. Restore `site_config.json` (from the staging dir) then `scripts/restore.sh`.
3. `bench --site X migrate` (only when the backup predates a code upgrade).
4. `bench --site X clear-cache` and restart workers/scheduler.
5. Run the §6 verification gate; only then repoint DNS/load balancer.
6. RPO: 24h with nightly cron (≤ the last backup). RTO: ≈ host provisioning + restore time.

## 8) Environment knobs (both scripts)

| Var | Default | Purpose |
|---|---|---|
| `FARDA_BENCH_DIR` | `/opt/fardabench/frappe-bench` | bench root |
| `FARDA_BACKUP_DIR` | `<bench>/backups` | staging root |
| `FARDA_RETENTION_DAYS` | `30` | prune age |
| `FARDA_BACKUP_PASSPHRASE` | unset | enable AES-256 artifact encryption |
| `FARDA_VENV` / `FARDA_PGBIN` / `FARDA_PGLIBS` | toolchain paths | sandbox toolchain (Docker image sets its own) |
