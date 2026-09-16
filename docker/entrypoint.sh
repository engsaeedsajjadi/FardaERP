#!/bin/bash
# FardaERP production entrypoint (§26).
# Idempotent: prepares sites/ + common_site_config.json, waits for
# MariaDB/Redis, optionally migrates (RUN_MIGRATIONS=1), then exec CMD.
set -euo pipefail

BENCH=/home/frappe/frappe-bench
cd "$BENCH"

DB_HOST="${DB_HOST:-mariadb}"
DB_PORT="${DB_PORT:-3306}"
REDIS_CACHE_URL="${REDIS_CACHE_URL:-redis://redis-cache:6379}"
REDIS_QUEUE_URL="${REDIS_QUEUE_URL:-redis://redis-queue:6379}"
SITE_NAME="${SITE_NAME:-}"

mkdir -p sites/logs config/pids logs   # bench's is_bench_directory() checks all of these
[ -f sites/apps.txt ] || printf 'frappe\nerpnext\nhrms\n' > sites/apps.txt
[ -f sites/common_site_config.json ] || echo '{}' > sites/common_site_config.json
# (update_site_config edits in place — it does NOT create the file)

# common_site_config: bench set-config -g writes to ./common_site_config.json
# RELATIVE TO CWD, so these must run from sites/ (idempotent upserts).
# NOTE: -p (ast.literal_eval) is ONLY for numeric values; URLs are plain strings.
cd "$BENCH/sites"
bench set-config -g db_host "$DB_HOST"
bench set-config -gp db_port "$DB_PORT"
bench set-config -g redis_cache "$REDIS_CACHE_URL"
bench set-config -g redis_queue "$REDIS_QUEUE_URL"
bench set-config -g redis_socketio "$REDIS_QUEUE_URL"
bench set-config -gp socketio_port 9000
cd "$BENCH"

# --- wait for dependencies ---------------------------------------------
wait_tcp() { # host port label
	local host="$1" port="$2" label="$3" i=0
	until env python -c "import socket,sys; s=socket.create_connection((sys.argv[1],int(sys.argv[2])),3); s.close()" \
			"$host" "$port" >/dev/null 2>&1; do
		i=$((i + 1))
		[ "$i" -ge 90 ] && { echo "TIMEOUT waiting for $label ($host:$port)"; exit 1; }
		sleep 2
	done
	echo "READY: $label ($host:$port)"
}
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" wait_tcp "$DB_HOST" "$DB_PORT" "MariaDB"
rc_hostport="${REDIS_CACHE_URL#redis://}"; rc_host="${rc_hostport%%:*}"; rc_port="${rc_hostport##*:}"
[ "$rc_port" = "$rc_host" ] && rc_port=6379
wait_tcp "$rc_host" "$rc_port" "redis-cache"
rq_hostport="${REDIS_QUEUE_URL#redis://}"; rq_host="${rq_hostport%%:*}"; rq_port="${rq_hostport##*:}"
[ "$rq_port" = "$rq_host" ] && rq_port=6379
wait_tcp "$rq_host" "$rq_port" "redis-queue"

# --- optional migration phase ------------------------------------------
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
	[ -n "$SITE_NAME" ] || { echo "RUN_MIGRATIONS=1 needs SITE_NAME"; exit 1; }
	echo "RUNNING: bench --site $SITE_NAME migrate"
	bench --site "$SITE_NAME" migrate
	bench --site "$SITE_NAME" clear-cache
	bench --site "$SITE_NAME" clear-website-cache || true
fi

exec "$@"
