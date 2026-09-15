"""OTP storage backends: in-memory (tests) and frappe ("Farda OTP Log")."""

from __future__ import annotations

import time

from .core import Challenge


class MemoryStore:
	"""Test/dev backend — NOT for production (process-local, volatile)."""

	def __init__(self):
		self.challenges: dict[str, Challenge] = {}
		self.sent: dict[tuple[str, str], list[float]] = {}
		self.last_sent: dict[tuple[str, str], float] = {}
		self.sms_outbox: list[tuple[str, str]] = []  # (phone, code)

	def save(self, challenge: Challenge, code: str):
		self.challenges[challenge.id] = challenge
		self.sms_outbox.append((challenge.phone, code))

	def get(self, challenge_id: str) -> Challenge | None:
		return self.challenges.get(challenge_id)

	def update(self, challenge: Challenge):
		self.challenges[challenge.id] = challenge

	def delete(self, challenge_id: str):
		self.challenges.pop(challenge_id, None)

	def mark_sent(self, phone: str, purpose: str, at: float):
		key = (phone, purpose)
		self.last_sent[key] = at
		self.sent.setdefault(key, []).append(at)

	def last_sent_at(self, phone: str, purpose: str) -> float | None:
		return self.last_sent.get((phone, purpose))

	def sent_count_in_hour(self, phone: str, purpose: str, now: float) -> int:
		hits = [t for t in self.sent.get((phone, purpose), []) if now - t < 3600]
		self.sent[(phone, purpose)] = hits
		return len(hits)


class FrappeStore:
	"""Production backend on the `Farda OTP Log` doctype (module Farda Iran).

	Plaintext code is NEVER stored — it is handed to the SMS layer once.
	"""

	DOCTYPE = "Farda OTP Log"

	def __init__(self, sms_send=None):
		self._sms_send = sms_send  # callable(phone, code, purpose)

	def _send(self, phone: str, code: str, purpose: str):
		if self._sms_send:
			self._sms_send(phone, code, purpose)

	def save(self, challenge: Challenge, code: str):
		import frappe

		self._send(challenge.phone, code, challenge.purpose)
		frappe.get_doc(
			{
				"doctype": self.DOCTYPE,
				"challenge_id": challenge.id,
				"phone": challenge.phone,
				"purpose": challenge.purpose,
				"code_hash": challenge.code_hash,
				"salt": challenge.salt,
				"expires_at": challenge.expires_at,
				"max_attempts": challenge.max_attempts,
				"attempts": 0,
				"used": 0,
			}
		).insert(ignore_permissions=True)

	def _get_doc(self, challenge_id: str):
		import frappe

		name = frappe.db.get_value(self.DOCTYPE, {"challenge_id": challenge_id})
		return frappe.get_doc(self.DOCTYPE, name) if name else None

	def get(self, challenge_id: str) -> Challenge | None:
		import frappe

		doc = self._get_doc(challenge_id)
		if not doc:
			return None
		return Challenge(
			id=doc.challenge_id,
			phone=doc.phone,
			purpose=doc.purpose,
			code_hash=doc.code_hash,
			salt=doc.salt,
			expires_at=float(doc.expires_at),
			max_attempts=int(doc.max_attempts),
			attempts=int(doc.attempts),
			used=bool(doc.used),
			created_at=doc.creationtimestamp() if hasattr(doc, "creationtimestamp") else time.time(),
		)

	def update(self, challenge: Challenge):
		import frappe

		doc = self._get_doc(challenge.id)
		if doc:
			doc.attempts = challenge.attempts
			doc.used = 1 if challenge.used else 0
			doc.save(ignore_permissions=True)

	def delete(self, challenge_id: str):
		import frappe

		name = frappe.db.get_value(self.DOCTYPE, {"challenge_id": challenge_id})
		if name:
			frappe.delete_doc(self.DOCTYPE, name, ignore_permissions=True)

	def mark_sent(self, phone: str, purpose: str, at: float):
		import frappe

		frappe.cache().set_value(
			f"farda_otp_last|{phone}|{purpose}", at
		)
		hour_key = f"farda_otp_hour|{phone}|{purpose}|{int(at // 3600)}"
		count = int(frappe.cache().get_value(hour_key) or 0)
		frappe.cache().set_value(hour_key, count + 1)
		frappe.cache().expire(hour_key, 7200)

	def last_sent_at(self, phone: str, purpose: str) -> float | None:
		import frappe

		value = frappe.cache().get_value(f"farda_otp_last|{phone}|{purpose}")
		return float(value) if value else None

	def sent_count_in_hour(self, phone: str, purpose: str, now: float) -> int:
		import frappe

		return int(frappe.cache().get_value(f"farda_otp_hour|{phone}|{purpose}|{int(now // 3600)}") or 0)
