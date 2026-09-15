"""E2E runtime test for the OTP layer on a live site.

Covers: request_otp → Farda OTP Log row (hash-only); cooldown rate-limit;
wrong code → vague rejection; correct code verifies once; replay rejected;
exhausted attempts kill the challenge; unknown purpose rejected.
Uses the console provider (no real SMS) and a per-test pepper via env.
 Rolls the transaction back at the end (redis cooldown keys are TTL-short
and explicitly purged).
"""

from __future__ import annotations

import frappe


def _purge_rate_keys(phone: str) -> None:
	for key in (f"farda_otp_last|{phone}|login", f"farda_otp_last|{phone}|signup",
				f"farda_otp_last|{phone}|phone_verification"):
		frappe.cache().delete_value(key)


def run() -> str:
	frappe.set_user("Guest")
	import os

	pepper = "runtime-test-pepper"
	os.environ["FARDA_OTP_PEPPER"] = pepper

	from erpnext.farda_iran.otp import api as otp_api
	from erpnext.farda_iran.otp import core as otp_core
	from erpnext.farda_iran.otp.store import FrappeStore

	results: list[str] = []
	phone = "09121234567"

	try:
		out = otp_api.request_otp(phone, "login")
		assert out["challenge_id"] and out["expires_in"] == 120, out
		row = frappe.db.get_value(
			"Farda OTP Log",
			{"challenge_id": out["challenge_id"]},
			["phone", "purpose", "used", "attempts", "code_hash", "salt"],
			as_dict=True,
		)
		assert row and row.phone == phone and row.purpose == "login", row
		assert not row.used and row.attempts == 0 and row.code_hash and row.salt
		results.append("PASS: request_otp → log row (hash-only storage, guest-accessible)")

		try:
			otp_api.request_otp(phone, "login")
		except frappe.exceptions.RateLimitExceededError:
			results.append("PASS: second request within cooldown → rate-limited")
		else:
			raise AssertionError("cooldown not enforced")

		# deterministic challenges with a capturing sender (different purposes → no cooldown clash)
		sent: list[tuple[str, str]] = []
		capturing = FrappeStore(sms_send=lambda p, c, pr: sent.append((p, c)))
		ch = otp_core.create_challenge(capturing, phone, "signup", pepper.encode())
		real_code = sent[-1][1]

		try:
			otp_api.verify_otp(ch.id, "000000")
		except frappe.exceptions.PermissionError:
			results.append("PASS: wrong code → vague rejection")
		else:
			raise AssertionError("wrong code accepted")

		assert otp_api.verify_otp(ch.id, real_code) == {"verified": True}
		try:
			otp_api.verify_otp(ch.id, real_code)
		except frappe.exceptions.PermissionError:
			results.append("PASS: correct code verified once; replay → rejected")
		else:
			raise AssertionError("replay accepted")

		sent2: list[tuple[str, str]] = []
		cap2 = FrappeStore(sms_send=lambda p, c, pr: sent2.append((p, c)))
		ch3 = otp_core.create_challenge(cap2, phone, "phone_verification", pepper.encode())
		for _ in range(3):
			try:
				otp_api.verify_otp(ch3.id, "111111")
			except frappe.exceptions.PermissionError:
				pass
		try:
			otp_api.verify_otp(ch3.id, sent2[-1][1])
		except frappe.exceptions.PermissionError:
			results.append("PASS: 3 wrong attempts → challenge dead even with right code")
		else:
			raise AssertionError("exhausted challenge still verifiable")

		try:
			otp_api.request_otp(phone, "admin_export")
		except frappe.exceptions.ValidationError:
			results.append("PASS: unknown purpose rejected")
		else:
			raise AssertionError("unknown purpose accepted")
	except Exception:
		frappe.db.rollback()
		raise
	finally:
		_purge_rate_keys(phone)
		frappe.set_user("Administrator")

	frappe.db.rollback()
	return " | ".join(results)
