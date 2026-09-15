"""Unit tests for the API rate limiter windowing logic (pure, fake cache)."""

import os
import sys
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ADDED_PATH = _ROOT not in sys.path
if _ADDED_PATH:
	sys.path.insert(0, _ROOT)

if _ADDED_PATH:
	sys.path.remove(_ROOT)

from erpnext.farda_iran.api.limiter import is_allowed


class FakeCache:
	def __init__(self):
		self.store = {}

	def get_value(self, key):
		return self.store.get(key)

	def set_value(self, key, value):
		self.store[key] = value


class TestRateLimiter(unittest.TestCase):
	def test_allows_under_limit(self):
		cache = FakeCache()
		for _ in range(5):
			self.assertTrue(is_allowed("b", "u", 5, 60, cache=cache, now=1000.0))
		self.assertFalse(is_allowed("b", "u", 5, 60, cache=cache, now=1000.0))

	def test_window_rollover_resets(self):
		cache = FakeCache()
		for _ in range(3):
			self.assertTrue(is_allowed("b", "u", 3, 60, cache=cache, now=1000.0))
		# past the window boundary -> new bucket
		self.assertTrue(is_allowed("b", "u", 3, 60, cache=cache, now=1061.0))

	def test_keys_are_isolated(self):
		cache = FakeCache()
		self.assertTrue(is_allowed("b", "user1", 1, 60, cache=cache, now=1000.0))
		self.assertTrue(is_allowed("b", "user2", 1, 60, cache=cache, now=1000.0))
		self.assertFalse(is_allowed("b", "user1", 1, 60, cache=cache, now=1000.0))

	def test_disabled_limiter(self):
		self.assertTrue(is_allowed("b", "u", 0, 60, cache=FakeCache(), now=1000.0))
		self.assertTrue(is_allowed("b", "u", 5, 0, cache=FakeCache(), now=1000.0))


if __name__ == "__main__":
	unittest.main()
