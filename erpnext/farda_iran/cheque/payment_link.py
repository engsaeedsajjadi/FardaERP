"""Cheque <-> Payment Entry wiring.

- Payment Entry carries optional `farda_cheque` link (custom field).
- On PE submit: a linked Received cheque is Deposited->Cleared, an Issued one
  cleared; legal transition rules in the Cheque doc are enforced implicitly
  (invalid jumps raise). On PE cancel: cheque returns to Received/Issued.
- `create_payment_entry` builds a DRAFT PE from a cheque (reviewable, auditable).
"""

from __future__ import annotations

import frappe

REVERT_MAP = {"Cleared": None, "Deposited": "Received", "Returned": "Received"}


def _linked_cheque(doc) -> str | None:
	return doc.get("farda_cheque") or None


def on_payment_entry_submit(doc, method: str | None = None) -> None:
	name = _linked_cheque(doc)
	if not name:
		return
	if not frappe.db.exists("Cheque", name):
		frappe.throw(frappe._(f"چک پیوندشده یافت نشد: {name}"))
	cheque = frappe.get_doc("Cheque", name)
	if cheque.status in ("Cleared", "Cancelled"):
		frappe.throw(frappe._(f"چک {name} در وضعیت «{cheque.status}» قابل شارژ نیست"))
	# Advance through LEGAL TRANSITIONS one step per save (§ R19 bug fix):
	# Received/Returned → Deposited → Cleared; Issued → Cleared. A direct
	# Received→Cleared save previously violated Cheque.TRANSITIONS and raised.
	guard = 0
	while cheque.status != "Cleared":
		if cheque.status in ("Received", "Returned"):
			cheque.status = "Deposited"
		else:
			cheque.status = "Cleared"
		cheque.save(ignore_permissions=True)  # audit: one StatusChange row per legal step
		guard += 1
		if guard > 3:
			frappe.throw(frappe._(f"گذار وضعیت چک {name} به «Cleared» ناممکن است"))
	if doc.get("reference_no"):
		cheque.notes = (cheque.notes or "") + f"\nPE {doc.name} ref {doc.reference_no}".strip()
	cheque.payment_entry = doc.name
	cheque.save(ignore_permissions=True)
	frappe.msgprint(frappe._(f"چک {name} به وضعیت «Cleared» رفت"), alert=True)


def on_payment_entry_cancel(doc, method: str | None = None) -> None:
	name = _linked_cheque(doc)
	if not name:
		return
	if not frappe.db.exists("Cheque", name):
		return
	cheque = frappe.get_doc("Cheque", name)
	# revert only if this PE is the one that cleared it; a cancel-revert is a
	# controlled administrative reversal (Cleared has no UI transitions by design),
	# so it is recorded directly with the revert documented in the notes.
	if cheque.payment_entry == doc.name and cheque.status == "Cleared":
		new_status = "Received" if cheque.direction == "Received" else "Issued"
		notes = ((cheque.notes or "") + "\nreverted on PE " + doc.name + " cancel").strip()
		frappe.db.set_value(
			"Cheque",
			cheque.name,
			{"status": new_status, "payment_entry": None, "notes": notes},
			update_modified=True,
		)


@frappe.whitelist()
def create_payment_entry(cheque: str) -> str:
	"""Build a draft Payment Entry for a cheque (Receive for دریافت‌شده, Pay for صادرشده)."""
	frappe.only_for(("System Manager", "Accounts Manager", "Accounts User"))
	c = frappe.get_doc("Cheque", cheque)
	if c.status in ("Cleared", "Cancelled"):
		frappe.throw(frappe._(f"برای چک در وضعیت «{c.status}» سند پرداخت ساخته نمی‌شود"))
	company = c.company or frappe.db.get_value("Company", {"is_group": 0}, "name")
	party_type = c.party_type or ("Customer" if c.direction == "Received" else "Supplier")
	party = c.party or frappe.db.get_value(party_type, {"company": company}, "name") if c.party else None
	if not party:
		party = frappe.db.get_value(party_type, {"disabled": 0}, "name")
	if not party:
		frappe.throw(frappe._("طرف حساب برای سند پرداخت یافت نشد"))
	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Receive" if c.direction == "Received" else "Pay"
	pe.company = company
	pe.posting_date = frappe.utils.nowdate()
	pe.party_type = party_type
	pe.party = party
	pe.paid_from = frappe.db.get_value("Company", company, "default_receivable_account") if pe.payment_type == "Receive" else frappe.db.get_value("Company", company, "default_payable_account")
	pe.paid_to = (
		frappe.db.get_value("Company", company, "default_bank_account")
		or frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
		or frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
	)
	if not pe.paid_to:
		frappe.throw(frappe._("حساب بانک/صندوق برای شرکت یافت نشد"))
	pe.paid_to_account_currency = (
		frappe.db.get_value("Account", pe.paid_to, "account_currency")
		or frappe.db.get_value("Company", company, "default_currency")
	)
	pe.paid_amount = c.amount
	pe.received_amount = c.amount
	# cheque amounts are integral IRR (cheque validate); set unit rates unless a
	# multi-currency account already populated them (PE.validate requires them)
	if not pe.get("source_exchange_rate"):
		pe.source_exchange_rate = 1
	if not pe.get("target_exchange_rate"):
		pe.target_exchange_rate = 1
	pe.reference_no = c.cheque_number
	pe.reference_date = c.due_date
	pe.farda_cheque = c.name
	pe.insert()
	return pe.name
