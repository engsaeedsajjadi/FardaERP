"""Unit tests for the OTP engine (pure logic + memory store) — no frappe."""

import os
import sys
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_ADDED_PATH = _ROOT not in sys.path
if _ADDED_PATH:
	sys.path.insert(0, _ROOT)

from farda_iran import otp as otp_pkg  # noqa: F401 — loads farda_iran.otp into sys.modules while _ROOT is on sys.path (needed by the from-imports below)

if _ADDED_PATH:
	sys.path.remove(_ROOT)

from farda_iran.otp import core
from farda_iran.otp.store import MemoryStore

PEPPER = b"test-pepper-for-unit-tests-only"


class TestOtpCore(unittest.TestCase):
	def setUp(self):
		self.store = MemoryStore()

	def test_code_shape_and_uniqueness(self):
		codes = {core.generate_code() for _ in range(200)}
		self.assertTrue(all(len(c) == 6 and c.isdigit() for c in codes))
		self.assertGreater(len(codes), 190)  # random 6-digit space

	def test_create_and_verify_roundtrip(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		code = self.store.sms_outbox[-1][1]
		self.assertTrue(core.verify(self.store, ch.id, code, PEPPER, now=1050.0))

	def test_wrong_code_rejected(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		with self.assertRaises(core.InvalidOrExpired):
			core.verify(self.store, ch.id, "000000" if self.store.sms_outbox[-1][1] != "000000" else "111111", PEPPER, now=1050.0)

	def test_expiry(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		code = self.store.sms_outbox[-1][1]
		with self.assertRaises(core.InvalidOrExpired):
			core.verify(self.store, ch.id, code, PEPPER, now=1000.0 + core.DEFAULT_TTL_SECONDS + 1)

	def test_one_time_use_replay_blocked(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		code = self.store.sms_outbox[-1][1]
		self.assertTrue(core.verify(self.store, ch.id, code, PEPPER, now=1050.0))
		with self.assertRaises(core.InvalidOrExpired):  # replay
			core.verify(self.store, ch.id, code, PEPPER, now=1051.0)

	def test_max_attempts_kills_challenge(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0, max_attempts=2)
		wrong = "000000" if self.store.sms_outbox[-1][1] != "000000" else "111111"
		with self.assertRaises(core.InvalidOrExpired):
			core.verify(self.store, ch.id, wrong, PEPPER, now=1010.0)
		with self.assertRaises(core.InvalidOrExpired):
			core.verify(self.store, ch.id, wrong, PEPPER, now=1011.0)
		right = self.store.sms_outbox[-1][1]
		with self.assertRaises(core.InvalidOrExpired):  # dead after max attempts
			core.verify(self.store, ch.id, right, PEPPER, now=1012.0)

	def test_unknown_challenge_is_vague(self):
		with self.assertRaises(core.InvalidOrExpired):
			core.verify(self.store, "no-such-id", "123456", PEPPER, now=1000.0)

	def test_cooldown_blocks_immediate_resend(self):
		core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		with self.assertRaises(core.RateLimited):
			core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1010.0)
		# after cooldown it works
		core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0 + core.DEFAULT_COOLDOWN_SECONDS + 1)

	def test_hourly_cap(self):
		now = 1000.0
		for i in range(core.DEFAULT_HOURLY_LIMIT):
			core.create_challenge(
				self.store, "09300000001", "login", PEPPER,
				now=now + i * (core.DEFAULT_COOLDOWN_SECONDS + 1),
			)
		with self.assertRaises(core.RateLimited):
			core.create_challenge(
				self.store, "09300000001", "login", PEPPER,
				now=now + core.DEFAULT_HOURLY_LIMIT * (core.DEFAULT_COOLDOWN_SECONDS + 1),
			)

	def test_hashing_never_stores_plaintext(self):
		ch = core.create_challenge(self.store, "09121234567", "login", PEPPER, now=1000.0)
		stored = self.store.challenges[ch.id]
		code = self.store.sms_outbox[-1][1]
		self.assertNotIn(code, stored.code_hash)
		self.assertNotEqual(stored.code_hash, code)
		# salt + pepper matter
		self.assertNotEqual(core.hash_code(code, stored.salt, PEPPER), core.hash_code(code, stored.salt, b"other"))

	def test_pepper_required(self):
		with self.assertRaises(core.OtpError):
			core.load_or_create_pepper(lambda name: None)


if __name__ == "__main__":
	unittest.main()
