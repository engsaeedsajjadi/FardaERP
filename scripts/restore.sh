#!/bin/bash
# FardaERP restore (§25) — bench-native DB restore into an EXISTING target site
# (create the site first; it must never be a running production site), plus
# optional files tarball extraction.
#
# Usage:
#   scripts/restore.sh <target-site> <database.sql.gz|*.enc> [files.tar.gz|*.enc]
# Env: same FARDA_* knobs as backup.sh; FARDA_BACKUP_PASSPHRASE decrypts .enc inputs.
# The DB restore replaces ALL data of the target database (destructive by design).
set -euo pipefail

SITE="${1:?usage: restore.sh <target-site> <db.sql.gz> [files.tar.gz]}"
DBFILE="${2:?missing database backup file}"
FILES="${3:-}"

BENCH="${FARDA_BENCH_DIR:-/opt/fardabench/frappe-bench}"
VENV="${FARDA_VENV:-/opt/tools/venv314}"
PGBIN="${FARDA_PGBIN:-/opt/tools/pgserver-extracted/pgserver/pginstall/bin}"
PGLIBS="${FARDA_PGLIBS:-/opt/tools/pgserver-extracted/pgserver/pgserver.libs}"

export PATH="$VENV/bin:$PGBIN:$PATH"
export LD_LIBRARY_PATH="$PGLIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

decrypt() { # decrypt <file> <outdir> -> prints plaintext path
  local f="$1" out="$2"
  case "$f" in
    *.enc)
      [ -n "${FARDA_BACKUP_PASSPHRASE:-}" ] || { echo "RESTORE-FAILED: encrypted input but FARDA_BACKUP_PASSPHRASE unset"; exit 1; }
      openssl enc -d -aes-256-cbc -pbkdf2 -pass "env:FARDA_BACKUP_PASSPHRASE" -in "$f" -out "$out/$(basename "${f%.enc}")"
      echo "$out/$(basename "${f%.enc}")"
      ;;
    *) echo "$f" ;;
  esac
}

DB_PLAIN=$(decrypt "$DBFILE" "$TMP")
[ -f "$DB_PLAIN" ] || { echo "RESTORE-FAILED: $DB_PLAIN missing"; exit 1; }

cd "$BENCH"
PYTHONIOENCODING=utf-8 "$VENV/bin/python" -m frappe.utils.bench_helper frappe \
  --site "$SITE" restore "$DB_PLAIN" > /tmp/farda_restore_last.log 2>&1 \
  || { echo "RESTORE-FAILED: bench restore"; tail -5 /tmp/farda_restore_last.log; exit 1; }
echo "RESTORE-DB-OK site=$SITE"

if [ -n "$FILES" ]; then
  FILES_PLAIN=$(decrypt "$FILES" "$TMP")
  tar -xzf "$FILES_PLAIN" -C "sites/$SITE"
  echo "RESTORE-FILES-OK site=$SITE"
fi
echo "RESTORE-OK site=$SITE"
