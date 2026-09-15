"""Frappe-backed persistence for the payment policy engine.

Maps Farda Payment Log rows to/from the pure ``payments.core`` types.
The authority column is the idempotency key: one row per gateway authority.
"""

from __future__ import annotations

import frappe
from erpnext.farda_iran.payments.core import SettledTransaction

DOCTYPE = "Farda Payment Log"


class PaymentStore:
	"""Interface expected by the runtime layer (swap in tests)."""

	def get_by_authority(self, authority: str) -> dict | None:
		raise NotImplementedError

	def create_initialized(self, authority: str, gateway: str, amount_irr: int,
						   reference_doctype: str | None, reference_name: str | None) -> dict:
		raise NotImplementedError

	def mark_verified(self, authority: str, payment_entry: str | None = None) -> None:
		raise NotImplementedError

	def mark_failed(self, authority: str, reason: str, raw: str | None = None) -> None:
		raise NotImplementedError

	def as_settled(self, authority: str) -> SettledTransaction | None:
		row = self.get_by_authority(authority)
		if row is None:
			return None
		return SettledTransaction(
			authority=authority,
			settled=row["status"] == "Verified",
			amount_irr=int(row["amount_irr"]),
		)


class FrappePaymentStore(PaymentStore):
	def get_by_authority(self, authority: str) -> dict | None:
		name = frappe.db.get_value(DOCTYPE, {"authority": authority}, "name")
		if not name:
			return None
		doc = frappe.get_doc(DOCTYPE, name)
		return {
			"name": doc.name,
			"authority": doc.authority,
			"gateway": doc.gateway,
			"amount_irr": int(doc.amount_irr or 0),
			"status": doc.status,
			"reference_doctype": doc.reference_doctype,
			"reference_name": doc.reference_name,
			"payment_entry": doc.payment_entry,
		}

	def create_initialized(self, authority: str, gateway: str, amount_irr: int,
						   reference_doctype: str | None, reference_name: str | None) -> dict:
		existing = self.get_by_authority(authority)
		if existing:  # idempotent: authority unique
			return existing
		doc = frappe.get_doc({
			"doctype": DOCTYPE,
			"authority": authority,
			"gateway": gateway,
			"amount_irr": int(amount_irr),
			"status": "Initialized",
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
		}).insert(ignore_permissions=False)
		return {
			"name": doc.name,
			"authority": authority,
			"gateway": gateway,
			"amount_irr": int(amount_irr),
			"status": "Initialized",
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"payment_entry": None,
		}

	def mark_verified(self, authority: str, payment_entry: str | None = None) -> None:
		name = frappe.db.get_value(DOCTYPE, {"authority": authority}, "name")
		if not name:
			return
		frappe.db.set_value(DOCTYPE, name, {
			"status": "Verified",
			"verified_at": frappe.utils.now_datetime(),
			"payment_entry": payment_entry,
			"fail_reason": None,
		})

	def mark_failed(self, authority: str, reason: str, raw: str | None = None) -> None:
		name = frappe.db.get_value(DOCTYPE, {"authority": authority}, "name")
		if not name:
			return
		frappe.db.set_value(DOCTYPE, name, {
			"status": "Failed",
			"fail_reason": reason[:140],
			"raw_verify_response": raw,
		})
