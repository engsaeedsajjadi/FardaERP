"""Whitelisted OTP endpoints (guest-accessible by design, rate-limited).

- request_otp(phone, purpose): validates the Iranian mobile, applies cooldown +
  hourly caps, hashes the code, sends via the configured SMS provider.
- verify_otp(challenge_id, code): one-shot; vague errors only.

Pepper comes from env FARDA_OTP_PEPPER (required; never stored in repo/db).
Providers are resolved by env FARDA_SMS_PROVIDER; default = console (dev).
"""

from __future__ import annotations

import os

import frappe
from frappe import _

from erpnext.farda_iran.otp import core as otp_core
from erpnext.farda_iran.otp.store import FrappeStore

ALLOWED_PURPOSES = ("login", "signup", "phone_verification", "payment_confirm")


def _pepper() -> bytes:
	return otp_core.load_or_create_pepper(os.environ.get)


def _provider():
	from erpnext.farda_iran.sms.provider import resolve

	return resolve()


@frappe.whitelist(allow_guest=True, methods=["POST"])
def request_otp(phone: str, purpose: str = "login") -> dict:
	if purpose not in ALLOWED_PURPOSES:
		frappe.throw(_("هدف نامعتبر است"), frappe.ValidationError)
	from erpnext.farda_iran.sms.provider import normalize_ir_mobile

	phone = normalize_ir_mobile(phone)
	store = FrappeStore(sms_send=lambda p, code, pr: _provider().send_otp(p, code, pr))
	try:
		challenge = otp_core.create_challenge(store, phone, purpose, _pepper())
	except otp_core.RateLimited as exc:
		frappe.throw(str(exc), frappe.RateLimitExceededError)
	except otp_core.OtpError as exc:
		frappe.throw(str(exc))
	return {
		"challenge_id": challenge.id,
		"expires_in": int(challenge.expires_at - challenge.created_at),
		"message": _("کد تأیید ارسال شد"),
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def verify_otp(challenge_id: str, code: str) -> dict:
	store = FrappeStore()
	try:
		ok = otp_core.verify(store, challenge_id, code, _pepper())
	except otp_core.InvalidOrExpired as exc:
		frappe.throw(str(exc), frappe.PermissionError)
	return {"verified": bool(ok)}

