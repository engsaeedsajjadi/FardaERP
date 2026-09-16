"""Public health endpoint (§ Monitoring) — whitelisted, guest-readable, rate-limited.

Returns collect_health() (status + per-check ok/fail + durations). Never exposes
secrets, hostnames, queue names, versions or PII (contract test R17 asserts the
exact key set). Rate-limited 60/min per user bucket.
"""

from __future__ import annotations

import frappe

from erpnext.farda_iran.api.limiter import is_allowed
from erpnext.farda_iran.monitoring.service import collect_health

RATE_LIMIT = 60
RATE_WINDOW = 60


@frappe.whitelist(allow_guest=True, methods=["GET"])
def health() -> dict:
	if not is_allowed("health", frappe.session.user, RATE_LIMIT, RATE_WINDOW):
		frappe.throw(
			frappe._("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."),
			frappe.RateLimitExceededError,
		)
	payload = collect_health()
	if payload.get("status") != "healthy":
		frappe.local.response["http_status_code"] = 503
	return payload
