#!/bin/bash
# FardaERP backup (§25) — DB + files + site_config with manifest, retention and
# optional encryption. Uses frappe's own backup machinery (bench backup
# --with-files) so restores stay bench-native, then stages artifacts with
# checksums into $FARDA_BACKUP_DIR/<site>/ and prunes beyond retention.
#
# Usage:   scripts/backup.sh <site>
# Env:
#   FARDA_BENCH_DIR        bench root           (default /opt/fardabench/frappe-bench)
#   FARDA_BACKUP_DIR       staging root         (default $FARDA_BENCH_DIR/backups)
#   FARDA_RETENTION_DAYS   prune age            (default 30)
#   FARDA_BACKUP_PASSPHRASE  if set → AES-256-CBC encrypt staged artifacts
# Exits non-zero on any failure; prints STAGED lines + manifest path on success.
set -euo pipefail

SITE="${1:?usage: backup.sh <site>}"
BENCH="${FARDA_BENCH_DIR:-/opt/fardabench/frappe-bench}"
BACKUP_DIR="${FARDA_BACKUP_DIR:-$BENCH/backups}"
RETENTION="${FARDA_RETENTION_DAYS:-30}"
VENV="${FARDA_VENV:-/opt/tools/venv314}"
PGBIN="${FARDA_PGBIN:-/opt/tools/pgserver-extracted/pgserver/pginstall/bin}"
PGLIBS="${FARDA_PGLIBS:-/opt/tools/pgserver-extracted/pgserver/pgserver.libs}"

export PATH="$VENV/bin:$PGBIN:$PATH"
export LD_LIBRARY_PATH="$PGLIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

DEST="$BACKUP_DIR/$SITE"
mkdir -p "$DEST"

# 1) frappe-native backup (database.sql.gz + files tarball) inside the site
cd "$BENCH/sites"   # bench_helper reads ./apps.txt relative to CWD
BEFORE=$(ls -1 "$SITE/private/backups" 2>/dev/null | sort || true)
PYTHONIOENCODING=utf-8 "$VENV/bin/python" -m frappe.utils.bench_helper frappe \
  --site "$SITE" backup --with-files > /tmp/farda_backup_last.log 2>&1 \
  || { echo "BACKUP-FAILED: bench backup"; tail -5 /tmp/farda_backup_last.log; exit 1; }
AFTER=$(ls -1 "$SITE/private/backups" | sort)
NEW=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") || true)

# 2) stage artifacts (site_config.json included — NOT part of bench backups)
TS=$(date +%Y%m%d-%H%M%S)
STAGE="$DEST/$TS"
mkdir -p "$STAGE"
cp "$SITE/site_config.json" "$STAGE/site_config.json"
for f in $NEW; do
  cp "$SITE/private/backups/$f" "$STAGE/"
done
[ -z "$(ls -A "$STAGE" --ignore=site_config.json)" ] && { echo "BACKUP-FAILED: no new artifacts"; exit 1; }

# 3) optional encryption
if [ -n "${FARDA_BACKUP_PASSPHRASE:-}" ]; then
  for f in "$STAGE"/*; do
    case "$f" in
      *.enc) continue ;;
      site_config.json) continue ;;
    esac
    openssl enc -aes-256-cbc -pbkdf2 -salt \
      -pass "env:FARDA_BACKUP_PASSPHRASE" -in "$f" -out "$f.enc"
    rm -f "$f"
  done
fi

# 4) manifest (sha256 over every staged file)
( cd "$STAGE" && sha256sum * > MANIFEST.sha256 )
echo "$STAGE" > "$DEST/LATEST"
echo "BACKUP-OK site=$SITE dir=$STAGE"
ls -la "$STAGE"

# 5) retention (never touch LATEST pointer target beyond prune window)
find "$BACKUP_DIR/$SITE" -mindepth 1 -maxdepth 1 -type d -name '2*' -mtime "+$RETENTION" -exec rm -rf {} + 2>/dev/null || true
echo "RETENTION-PRUNED older_than=${RETENTION}d"
