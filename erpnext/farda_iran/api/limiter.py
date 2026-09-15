"""Small sliding-window rate limiter on top of frappe.cache (per user+bucket).

The windowing math is pure (testable without frappe); storage is the shared
Redis cache so limits hold across workers.
"""

from __future__ import annotations

import time


def _now() -> float:
	return time.time()


def is_allowed(bucket: str, key: str, limit: int, window_seconds: int, cache=None, now=None) -> bool:
	"""Return True and record the hit when under `limit` hits per window."""
	if limit <= 0 or window_seconds <= 0:
		return True
	cache = cache if cache is not None else _default_cache()
	now = now if now is not None else _now()
	name = f"farda_ratelimit|{bucket}|{key}|{int(now // window_seconds)}"
	count = int(cache.get_value(name) or 0)
	if count >= limit:
		return False
	cache.set_value(name, count + 1)
	return True


def _default_cache():
	import frappe

	return frappe.cache
