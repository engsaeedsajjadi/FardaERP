"""Whitelisted payment endpoints.

Flow (all amounts in IRR internally; UI converts Toman via the central service):
  start_payment  → gateway request → Farda Payment Log(Initialized) + redirect URL
  verify_payment → gateway verify  → policy evaluate vs. logged state →
                   ACCEPT: PE draft linked + log(Verified) | duplicates: idempotent echo
  payment_status → read-only lookup

Security: guest access only for verify (gateway redirects users back unauthenticated);
every other endpoint requires a logged-in session. The authority is unguessable and
acts as the idempotency key; the policy engine rejects replay/amount-mismatch.
"""

from __future__ import annotations

import frappe
from frappe import _

from erpnext.farda_iran.payments import core as pay_core
from erpnext.farda_iran.payments.core import Decision
from erpnext.farda_iran.payments.gateways import PaymentGateway, resolve_class
from erpnext.farda_iran.payments.persistence import FrappePaymentStore

ALLOWED_REFERENCES = ("Sales Invoice", "POS Invoice", "Sales Order")


def _store() -> FrappePaymentStore:
	return FrappePaymentStore()


def _gateway(name: str, transport=None) -> PaymentGateway:
	try:
		cls = resolve_class(name)
	except ValueError:
		frappe.throw(_("درگاه پرداخت ناشناخته است"), frappe.ValidationError)
	if transport is not None:
		return cls(http=transport)
	return cls()


@frappe.whitelist(methods=["POST"])
def start_payment(
	gateway: str,
	amount_irr: int,
	reference_doctype: str | None = None,
	reference_name: str | None = None,
	callback_url: str | None = None,
	mobile: str | None = None,
) -> dict:
	"""Request a payment from the gateway; returns the redirect URL + authority."""
	amount_irr = int(amount_irr)
	if amount_irr <= 0:
		frappe.throw(_("مبلغ باید عددی مثبت باشد"), frappe.ValidationError)
	if reference_doctype or reference_name:
		if reference_doctype not in ALLOWED_REFERENCES or not reference_name:
			frappe.throw(_("سند مرجع نامعتبر است"), frappe.ValidationError)
		if not frappe.db.exists(reference_doctype, reference_name):
			frappe.throw(_("سند مرجع یافت نشد"), frappe.DoesNotExistError)
	gw = _gateway(gateway)
	callback = callback_url or frappe.utils.get_url("/farda_payment_callback")
	result = gw.create_payment(amount_irr, callback, description=reference_name or "FardaERP payment")
	if not result.ok or not result.authority:
		frappe.throw(_("درگاه پرداخت درخواست را نپذیرفت: {0}").format(result.error or "?"))
	store = _store()
	row = store.create_initialized(
		result.authority, gateway, amount_irr, reference_doctype, reference_name
	)
	return {
		"authority": result.authority,
		"redirect_url": result.redirect_url,
		"log": row["name"],
		"already_existed": row["status"] != "Initialized" or row.get("payment_entry"),
	}


@frappe.whitelist(allow_guest=True, methods=["POST", "GET"])
def verify_payment(gateway: str, authority: str, amount_irr: int | None = None,
				   status_param: str | None = None) -> dict:
	"""Gateway-callback verification; idempotent, policy-guarded."""
	report = None
	gw = _gateway(gateway)
	try:
		report = gw.verify_payment(authority, int(amount_irr or 0))
	except Exception:
		store = _store()
		if store.get_by_authority(authority):
			store.mark_failed(authority, "verify-transport-error")
		frappe.throw(_("بررسی پرداخت ناموفق بود"))

	store = _store()
	logged = store.as_settled(authority)
	if not amount_irr and logged is not None:
		amount_irr = logged.amount_irr  # gateway verify requires the requested amount
	# the engine authoritative-checks report.amount_irr against logged.amount_irr,
	# so the caller-expected value here is our own record, never the gateway echo
	decision = pay_core.evaluate(logged, amount_irr if logged else report.amount_irr, report)

	if decision.decision == Decision.ACCEPT:
		pe_name = _build_payment_entry(store.get_by_authority(authority), authority)
		store.mark_verified(authority, pe_name)
	elif decision.decision == Decision.FAIL_STATUS:
		store.mark_failed(authority, "; ".join(decision.reasons))
	elif decision.decision == Decision.FAIL_AMOUNT:
		store.mark_failed(authority, "; ".join(decision.reasons))
	# ALREADY_SETTLED: leave the settled row untouched (idempotent echo)

	row = store.get_by_authority(authority)
	return {
		"decision": decision.decision.value,
		"already": bool(decision.already),
		"reason": decision.reasons,
		"payment_entry": row.get("payment_entry") if row else None,
	}


@frappe.whitelist(methods=["GET"])
def payment_status(authority: str) -> dict:
	row = _store().get_by_authority(authority)
	if not row:
		frappe.throw(_("تراکنش یافت نشد"), frappe.DoesNotExistError)
	return {k: row[k] for k in ("authority", "gateway", "amount_irr", "status", "payment_entry")}


def _build_payment_entry(row: dict, authority: str) -> str | None:
	"""Create a draft Receive Payment Entry for the settled payment (idempotent)."""
	if not row or not row.get("reference_name") or row.get("payment_entry"):
		return row.get("payment_entry") if row else None
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	pe = get_payment_entry(
		row["reference_doctype"], row["reference_name"], bank_amount=int(row["amount_irr"])
	)
	pe.reference_no = authority[:140]
	pe.reference_date = frappe.utils.today()
	pe.farda_payment_authority = authority  # custom field created by farda setup
	pe.insert()
	return pe.name
