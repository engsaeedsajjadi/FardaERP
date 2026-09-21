#!/usr/bin/env bash
# Sandbox runtime bootstrap (dev/CI helper — NOT used by the Docker image).
# Rebuilds the full PG runtime used to execute farda_iran runtime suites after
# a sandbox reset: cpython 3.14 (with openssl built from source, sqlite/libffi
# headers hand-crafted against system libs), PostgreSQL via the pgserver wheel,
# redis via the redislite binary, frappe+hrms+erpnext from tags, and a fresh
# smoke.farda.local site with all PG shims and seeds applied.
#
# Usage: scripts/ci/bootstrap_sandbox_runtime.sh [--keep-src]
#   Env: FARDA_RT_ROOT (default /tmp/fardart)
# Idempotent-ish: skips cpython build if the prefix already exists.
set -euo pipefail

RT=${FARDA_RT_ROOT:-/tmp/fardart}
BENCH_DIR=$RT/frappe-bench
PGBIN=$RT/venv/lib/python3.11/site-packages/pgserver/pginstall/bin
REPO=$(cd "$(dirname "$0")/../.." && pwd)
KEEP=${1:-}

log() { echo "[bootstrap] $*"; }

mkdir -p "$RT/prefix/include" "$RT/prefix/lib"
cd "$RT"

# ── 0) sources ────────────────────────────────────────────────────────────────
fetch() { # url out
	[ -s "$2" ] && return 0
	curl -sL "$1" -o "$2"
}
fetch https://codeload.github.com/frappe/frappe/tar.gz/refs/tags/v16.33.1 frappe.tgz
fetch https://codeload.github.com/frappe/hrms/tar.gz/refs/tags/v16.18.1 hrms.tgz
fetch https://codeload.github.com/frappe/bench/tar.gz/refs/tags/v5.31.0 bench.tgz
fetch https://codeload.github.com/openssl/openssl/tar.gz/refs/tags/openssl-3.3.2 openssl.tgz
fetch https://codeload.github.com/madler/zlib/tar.gz/refs/tags/v1.3.1 zlib.tgz
fetch https://codeload.github.com/libffi/libffi/tar.gz/refs/tags/v3.4.6 libffi.tgz
fetch https://codeload.github.com/sqlite/sqlite/tar.gz/refs/tags/version-3.45.1 sqlite.tgz
fetch https://codeload.github.com/python/cpython/tar.gz/refs/tags/v3.14.0 cpython.tgz
[ -d frappe ] || { tar xzf frappe.tgz && mv frappe-16.33.1 frappe; }
[ -d hrms ]   || { tar xzf hrms.tgz && mv hrms-16.18.1 hrms; }
[ -d bench ]  || { tar xzf bench.tgz && mv bench-5.31.0 bench; }

# ── 1) wheel-based services (py3.11 system) ──────────────────────────────────
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q redislite pgserver 2>/dev/null || ./venv/bin/pip install -q redislite pgserver --break-system-packages

# ── 2) openssl + zlib into prefix (needed by cpython _ssl) ───────────────────
if [ ! -f prefix/lib64/libssl.so.3 ] && [ ! -f prefix/lib/libssl.so.3 ]; then
	[ -d zlib-1.3.1 ] || tar xzf zlib.tgz
	(cd zlib-1.3.1 && ./configure --prefix="$RT/prefix" >/dev/null && make -j2 -s >/dev/null && make install >/dev/null)
	[ -d openssl-openssl-3.3.2 ] || tar xzf openssl.tgz
	(cd openssl-openssl-3.3.2 && ./Configure linux-x86_64 --prefix="$RT/prefix" \
		--openssldir="$RT/prefix/ssl" no-tests >/dev/null && make -j2 -s >/dev/null 2>&1 && make install_sw >/dev/null 2>&1)
	log "openssl+zlib built"
fi

# ── 3) sqlite3.h / ffi.h hand-crafted vs system libs ─────────────────────────
if [ ! -f prefix/include/sqlite3.h ]; then
	[ -d sqlite-version-3.45.1 ] || tar xzf sqlite.tgz
	sed -e 's/--VERS--/3.45.1/g' -e 's/--VERSION-NUMBER--/3045001/g' \
		-e 's/--SOURCE-ID--/2024-01-15 17:01:33 farda-embed/g' \
		sqlite-version-3.45.1/src/sqlite.h.in > prefix/include/sqlite3.h
	ln -sf /usr/lib/x86_64-linux-gnu/libsqlite3.so.0 prefix/lib/libsqlite3.so
fi
if [ ! -f prefix/include/ffi.h ]; then
	[ -d libffi-3.4.6 ] || tar xzf libffi.tgz
	sed -e 's/@VERSION@/3.4.6/g' -e 's/@TARGET@/X86_64/g' -e 's/@HAVE_LONG_DOUBLE@/1/g' \
		-e 's/@FFI_EXEC_TRAMPOLINE_TABLE@/0/g' \
		libffi-3.4.6/include/ffi.h.in > prefix/include/ffi.h
	cp libffi-3.4.6/src/x86/ffitarget.h prefix/include/ffitarget.h
	ln -sf /usr/lib/x86_64-linux-gnu/libffi.so.8 prefix/lib64/libffi.so
fi

# ── 4) cpython 3.14 ───────────────────────────────────────────────────────────
if [ ! -x py314/bin/python3 ]; then
	[ -d cpython-3.14.0 ] || tar xzf cpython.tgz
	(cd cpython-3.14.0 && ./configure --prefix="$RT/py314" --with-ensurepip=install \
		--with-openssl="$RT/prefix" \
		CPPFLAGS="-I$RT/prefix/include" \
		LDFLAGS="-L$RT/prefix/lib -L$RT/prefix/lib64 -Wl,-rpath,$RT/prefix/lib64 -Wl,-rpath,$RT/prefix/lib" \
		>configure.log 2>&1 && make -j2 >make.log 2>&1 && make install >install.log 2>&1)
	log "cpython 3.14 built"
fi
[ -d venv14 ] || ./py314/bin/python3 -m venv venv14

# ── 5) frappe stack (no-deps for apps; filtered deps; click pinned 8.4.1) ────
./venv14/bin/pip install -q --no-deps ./frappe ./hrms ./bench
./venv14/bin/pip install -q -e "$REPO" --no-deps
./venv14/bin/python - "$REPO" <<'PYEOF'
import sys, tomllib
repo = sys.argv[1]
deps = []
for p in ['frappe/pyproject.toml', 'hrms/pyproject.toml', repo + '/pyproject.toml', 'bench/pyproject.toml']:
    with open(p, 'rb') as f:
        deps += tomllib.load(f).get('project', {}).get('dependencies', [])
deps = [x for x in deps if 'mysqlclient' not in x.lower() and 'click' not in x.lower()]
open('deps.txt', 'w').write('\n'.join(deps))
PYEOF
./venv14/bin/pip install -q -r deps.txt "click==8.4.1" || true
ln -sfn "$RT/venv14" "$BENCH_DIR/env" 2>/dev/null || true

# ── 6) services up ────────────────────────────────────────────────────────────
"$RT/venv/lib/python3.11/site-packages/redislite/bin/redis-server" --daemonize yes --port 6379 \
	--save '' --appendonly no --dir "$RT" 2>/dev/null || true
if ! "$PGBIN/pg_ctl" -D "$RT/pgdata" status >/dev/null 2>&1; then
	[ -d "$RT/pgdata" ] || "$PGBIN/initdb" -D "$RT/pgdata" -U postgres --auth=trust \
		--encoding=UTF8 --locale=C.UTF-8 >/dev/null
	"$PGBIN/pg_ctl" -D "$RT/pgdata" -l "$RT/pg.log" -o "-p 5432 -c listen_addresses=127.0.0.1" start >/dev/null
	sleep 1
fi
"$PGBIN/psql" -U postgres -h 127.0.0.1 -c "alter user postgres password 'postgres123';" >/dev/null

# ── 7) bench skeleton + site ─────────────────────────────────────────────────
mkdir -p "$BENCH_DIR"/{config/pids,logs,sites,apps}
[ -L "$BENCH_DIR/env" ] || ln -sfn "$RT/venv14" "$BENCH_DIR/env"
[ -L "$BENCH_DIR/apps/frappe" ] || ln -sfn "$RT/frappe" "$BENCH_DIR/apps/frappe"
[ -L "$BENCH_DIR/apps/erpnext" ] || ln -sfn "$REPO" "$BENCH_DIR/apps/erpnext"
[ -L "$BENCH_DIR/apps/hrms" ] || ln -sfn "$RT/hrms" "$BENCH_DIR/apps/hrms"
printf 'frappe\nerpnext\nhrms\n' > "$BENCH_DIR/sites/apps.txt"
[ -f "$BENCH_DIR/sites/common_site_config.json" ] || cat > "$BENCH_DIR/sites/common_site_config.json" <<EOF
{
 "db_host": "127.0.0.1", "db_port": 5432, "db_type": "postgres",
 "redis_cache": "redis://127.0.0.1:6379", "redis_queue": "redis://127.0.0.1:6379",
 "redis_socketio": "redis://127.0.0.1:6379", "webserver_port": 8000,
 "pause_scheduler": 1, "root_login": "postgres", "root_password": "postgres123"
}
EOF

export PATH="$RT/venv14/bin:$PGBIN:$PATH"
export PYTHONIOENCODING=utf-8 LANG=C.UTF-8 LC_ALL=C.UTF-8
cd "$BENCH_DIR/sites"
if [ ! -f smoke.farda.local/site_config.json ]; then
	bench --site smoke.farda.local new-site smoke.farda.local --db-type postgres \
		--db-root-username postgres --db-root-password postgres123 --admin-password admin123 >/dev/null
	log "site created"
fi
bench --site smoke.farda.local install-app erpnext >/dev/null
# hrms with the PG-15 shim active (patch uses MariaDB numeric truthiness)
"$RT/venv14/bin/python" - "$BENCH_DIR" <<'PYEOF'
import sys
bench = sys.argv[1]
sys.path.insert(0, bench + "/apps/erpnext")
import frappe
frappe.init("smoke.farda.local", sites_path=bench + "/sites")
frappe.connect()
from erpnext.farda_iran.tests import pg_compat
pg_compat.apply()
from frappe.installer import install_app
install_app("hrms")
frappe.db.commit()
print("[bootstrap] hrms installed (pg_compat applied)")
PYEOF
# fresh-PG seeds + farda custom fields (before_migrate hook is not run by install-app)
"$RT/venv14/bin/python" - "$BENCH_DIR" <<'PYEOF'
import sys
bench = sys.argv[1]
sys.path.insert(0, bench + "/apps/erpnext")
import frappe
frappe.init("smoke.farda.local", sites_path=bench + "/sites")
frappe.connect()
from erpnext.farda_iran.tests import sandbox_seeds
print("[bootstrap]", sandbox_seeds.run())
from erpnext.farda_iran.setup.install import execute
print("[bootstrap]", execute())
# locale workaround: frappe/locale.py get_locale_value UnboundLocalError with no language
if not frappe.db.sql("select 1 from tabLanguage where name='en'"):
	frappe.db.sql("insert into `tabLanguage` (name, language_name, number_format, date_format, time_format, first_day_of_the_week) values ('en', 'English', '#,###.##', 'yyyy-mm-dd', 'HH:mm:ss', 'Sunday')")
frappe.db.set_single_value("System Settings", "language", "en")
frappe.db.commit(); frappe.clear_cache()
print("[bootstrap] language workaround applied")
PYEOF
log "DONE — runtime ready at $BENCH_DIR (suite runner: bench --site smoke.farda.local execute <module>.run)"
