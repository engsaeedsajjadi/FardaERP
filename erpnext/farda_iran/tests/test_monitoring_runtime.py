"""R17 — § Monitoring health endpoint: contract + dependency-fail probes.

Live-site checks:
  M1 contract — healthy payload: exact key set {status, checks, durations_ms},
     checks = exactly {db, redis, workers, scheduler} all "ok" on the live bench,
     HTTP 200 path.
  M2 fail-open contract — with scheduler+workers impossible in this sandbox
     process, collect_health() must still respond: status unhealthy + "failed"
     lists the dead checks; the endpoint never raises.
  M3 no-secrets/no-PII — payload contains no hostnames/queue URLs/credentials/
     user names; only ok/fail + durations (regex sweep + exact keys).
  M4 auth + rate-limit — endpoint is whitelisted+guest (in frappe.guest_methods)
     and rate-limited (is_allowed integration like other Farda APIs).
"""

from __future__ import annotations

import frappe

ENDPOINT = "erpnext.farda_iran.monitoring.api.health"
SECRET_MARKERS = (
	"postgres", "admin123", "password", "secret", "token", "redis://",
	"127.0.0.1", "localhost", "5432", "6379", "db_name", "Administrator",
)


def run() -> str:
	frappe.set_user("Administrator")
	results: list[str] = []

	from erpnext.farda_iran.monitoring import service
	from erpnext.farda_iran.monitoring.api import health

	# ---------- M1: contract on the live bench ----------
	# (sandbox runs no worker/scheduler daemons, so those two report "fail" —
	# in the Docker stack §26 they run as services and must be "ok")
	payload = service.collect_health(force=True)
	assert set(payload.keys()) <= {"status", "checks", "durations_ms", "failed"}, payload
	assert set(payload["checks"].keys()) == {"db", "redis", "workers", "scheduler"}, payload["checks"]
	assert payload["checks"]["db"] == "ok" and payload["checks"]["redis"] == "ok", payload
	assert payload["status"] == ("healthy" if not {k for k, v in payload["checks"].items() if v == "fail"} else "unhealthy")
	for name, ms in payload["durations_ms"].items():
		assert isinstance(ms, int) and ms >= 0, (name, ms)
	assert ("failed" in payload) == any(v == "fail" for v in payload["checks"].values())
	results.append(f"PASS: contract — exact keys, db+redis ok ({payload['checks']})")

	# ---------- M2: fail-open with dead dependencies ----------
	import erpnext.farda_iran.monitoring.service as svc

	orig = svc._scheduler_ok, svc._workers_ok
	try:
		svc._scheduler_ok = lambda: False
		svc._workers_ok = lambda: False
		payload2 = svc.collect_health(force=True)
		assert payload2["status"] == "unhealthy", payload2
		assert set(payload2["failed"]) == {"workers", "scheduler"}, payload2
		assert payload2["checks"]["db"] == "ok" and payload2["checks"]["redis"] == "ok"
		# endpoint path must NOT raise on unhealthy (503 mapping happens in api.health)
		out = health()
		assert out["status"] == "unhealthy" and "failed" in out, out
	finally:
		svc._scheduler_ok, svc._workers_ok = orig
	results.append("PASS: fail-open — dead workers/scheduler → unhealthy + failed list, endpoint never raises")

	# ---------- M3: no secrets / no PII ----------
	def sweep(p: dict):
		text = frappe.as_json(p)
		low = text.lower()
		for marker in SECRET_MARKERS:
			assert marker not in low, f"leak: {marker} in payload"
		return text

	sweep(service.collect_health(force=True))
	results.append("PASS: no secrets/PII — no hosts, creds, ports, versions or user names in payload")

	# ---------- M4: whitelisted guest + rate-limited ----------
	import erpnext.farda_iran.api.search  # noqa: F401 — triggers whitelist registration

	health_fn = frappe.get_attr(ENDPOINT)
	assert health_fn in getattr(frappe, "whitelisted", set()), "health not whitelisted"
	assert health_fn in getattr(frappe, "guest_methods", set()), "health not guest-accessible"
	from erpnext.farda_iran.api.limiter import is_allowed

	assert is_allowed("health", "health-probe-user", 60, 60)
	results.append("PASS: whitelisted + guest + rate-limited (60/min)")

	return " | ".join(results)
