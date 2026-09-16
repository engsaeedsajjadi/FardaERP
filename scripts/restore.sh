#!/bin/bash
# FardaERP restore (§25) — bench-native DB restore into an EXISTING target site
# (create the site first; it must never be a running production site), plus
# optional files tarball extraction.
#
# Usage:
#   scripts/restore.sh <target-site> <database.sql.gz|*.enc> [files.tar|*.enc ...]
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

export PATH="$VENV/bin:$PATH"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"   # optional (PostgreSQL sandbox toolchain)
export LD_LIBRARY_PATH="$PGLIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# frappe's restore shells out to `file` to detect gzip/encryption (binutils is
# absent in this environment) — provide a minimal magic-based shim. It NEVER
# reports AES: .enc decryption is handled by decrypt() above.
make_file_shim() {
	SHIM=$(mktemp -d)
	cat > "$SHIM/file" <<'SHIMEOF'
#!/bin/bash
p="$1"
[ -n "$p" ] && [ -f "$p" ] || { echo "file: cannot open $p"; exit 1; }
magic=$(head -c2 "$p" | od -An -tx1 | tr -d ' \n')
if [ "$magic" = "1f8b" ]; then
	echo "$p: gzip compressed data"
else
	echo "$p: ASCII text"
fi
exit 0
SHIMEOF
	chmod +x "$SHIM/file"
	export PATH="$SHIM:$PATH"
}
# inject the shim only when the real file(1) is absent (Docker image installs it)
command -v file >/dev/null 2>&1 || make_file_shim


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

cd "$BENCH/sites"   # bench_helper reads ./apps.txt relative to CWD
RESTORE_ARGS=(--site "$SITE" restore "$DB_PLAIN")
# DB root credentials come from env only (never hard-coded)
if [ -n "${FARDA_DB_ROOT_USER:-}" ]; then
	RESTORE_ARGS+=(--db-root-username "$FARDA_DB_ROOT_USER")
fi
if [ -n "${FARDA_DB_ROOT_PASS:-}" ]; then
	RESTORE_ARGS+=(--db-root-password "$FARDA_DB_ROOT_PASS")
fi
PYTHONIOENCODING=utf-8 "$VENV/bin/python" -m frappe.utils.bench_helper frappe \
	"${RESTORE_ARGS[@]}" > /tmp/farda_restore_last.log 2>&1 \
	|| { echo "RESTORE-FAILED: bench restore"; tail -5 /tmp/farda_restore_last.log; exit 1; }
echo "RESTORE-DB-OK site=$SITE"

for FILES in "${@:3}"; do
  FILES_PLAIN=$(decrypt "$FILES" "$TMP")
  # bench tars embed ./<source-site>/ as top-level dir; cwd is $BENCH/sites
  tar -xf "$FILES_PLAIN" -C "$SITE" --strip-components 1
done
if [ "$#" -ge 3 ]; then
  echo "RESTORE-FILES-OK site=$SITE"
fi
echo "RESTORE-OK site=$SITE"
