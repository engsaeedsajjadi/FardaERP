"""Farda health service (§ Monitoring) — safe for public exposure.

Checks (fast, read-only):
  db        — SELECT 1 via a fresh connection
  redis     — PING against redis_queue + redis_cache (from site config)
  workers   — ≥1 active RQ worker heartbeating (frappe's worker registry)
  scheduler — scheduler heartbeat enabled + seen recently (frappe's scheduler
              last-activity record), consistent with the stack healthchecks.

Response contract (no secrets, no PII, no queue names/hosts):
  200 {"status": "healthy",        "checks": {...ok/green...}}
  503 {"status": "unhealthy",      "checks": {...}, "failed": [...]}
Every check value is one of "ok"/"fail" plus a duration in ms. Nothing else.
"""

from __future__ import annotations

import time

import frappe

_CACHE_TTL = 5  # seconds — flatten burst traffic on the heavy checks
last_health: dict | None = None  # {ts, healthy, payload}


def _db_check() -> bool:
	frappe.db.sql("select 1")
	return True


def _redis_check(conn) -> bool:
	return bool(conn.ping())


def _get_redis(url: str):
	import redis

	return redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)


def _workers_ok() -> bool:
	try:
		import frappe.utils.background_jobs as bg

		workers = bg.get_workers(queue=None) or []
		return len(workers) > 0
	except Exception:
		return False


def _scheduler_ok() -> bool:
	try:
		# frappe records the scheduler's last heartbeat in Redis (Scheduler
		# last-activity). Enabled + fresh (< 2×DUE_INTERVAL) = scheduling alive.
		from frappe.utils.scheduler import is_scheduler_inactive

		return not is_scheduler_inactive()
	except Exception:
		return False


def collect_health(force: bool = False) -> dict:
	global last_health
	now = time.time()
	if (
		not force
		and last_health
		and now - last_health["ts"] < _CACHE_TTL
	):
		return last_health["payload"]

	checks: dict[str, str] = {}
	durations: dict[str, int] = {}

	def timed(name, fn):
		t0 = time.time()
		try:
			ok = bool(fn())
		except Exception:
			ok = False
		checks[name] = "ok" if ok else "fail"
		durations[name] = int((time.time() - t0) * 1000)

	timed("db", _db_check)
	timed("redis", lambda: all(
		_redis_check(_get_redis(frappe.get_conf().get(k)))
		for k in ("redis_queue", "redis_cache")
	))
	timed("workers", _workers_ok)
	timed("scheduler", _scheduler_ok)

	failed = sorted(k for k, v in checks.items() if v == "fail")
	payload = {
		"status": "healthy" if not failed else "unhealthy",
		"checks": checks,
		"durations_ms": durations,
	}
	if failed:
		payload["failed"] = failed
	last_health = {"ts": now, "healthy": not failed, "payload": payload}
	return payload
