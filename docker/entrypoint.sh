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
# common_site_config.json lives on the shared "sites" volume and backend,
# workers, scheduler and websocket all start at the same time. Several
# concurrent `bench set-config` calls could read a half-written file
# ("Expecting value: line 1 column 1") and crash the container, so the keys
# are upserted once, under a file lock, with an atomic replace.
DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" REDIS_CACHE_URL="$REDIS_CACHE_URL" REDIS_QUEUE_URL="$REDIS_QUEUE_URL" \
python - <<'PY'
import fcntl, json, os, time

path = "sites/common_site_config.json"
want = {
    "db_host": os.environ["DB_HOST"],
    "db_port": int(os.environ["DB_PORT"]),
    "redis_cache": os.environ["REDIS_CACHE_URL"],
    "redis_queue": os.environ["REDIS_QUEUE_URL"],
    "redis_socketio": os.environ["REDIS_QUEUE_URL"],
    "socketio_port": 9000,
}
with open("sites/.common_site_config.lock", "w") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    conf = {}
    for _ in range(10):
        try:
            with open(path) as fh:
                text = fh.read().strip()
            conf = json.loads(text) if text else {}
            break
        except FileNotFoundError:
            break
        except ValueError:
            time.sleep(0.5)  # a writer outside the lock may be mid-write
    if any(conf.get(k) != v for k, v in want.items()):
        conf.update(want)
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w") as fh:
            json.dump(conf, fh, indent=1, sort_keys=True)
        os.replace(tmp, path)
    fcntl.flock(lock, fcntl.LOCK_UN)
PY
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
