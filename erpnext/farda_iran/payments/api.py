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


def _validate_amount_against_reference(doctype: str, name: str, amount_irr: int) -> None:
	"""SEC-1: the charged amount may not exceed what is still owed on the document."""
	doc = frappe.db.get_value(
		doctype,
		name,
		["docstatus", "currency", "grand_total", "rounded_total"]
		+ (["advance_paid"] if doctype == "Sales Order" else ["outstanding_amount"]),
		as_dict=True,
	)
	if doc.docstatus != 1:
		frappe.throw(_("فقط برای سند ثبت‌نهایی‌شده می‌توان پرداخت آنلاین ایجاد کرد"), frappe.ValidationError)
	if (doc.currency or "IRR") != "IRR":
		frappe.throw(_("پرداخت آنلاین فقط برای اسناد ریالی پشتیبانی می‌شود"), frappe.ValidationError)
	if doctype == "Sales Order":
		owed = (doc.rounded_total or doc.grand_total or 0) - (doc.advance_paid or 0)
	else:
		owed = doc.outstanding_amount or 0
	if amount_irr > int(round(owed)):
		frappe.throw(
			_("مبلغ پرداخت ({0} ریال) از مانده سند ({1} ریال) بیشتر است").format(amount_irr, int(round(owed))),
			frappe.ValidationError,
		)


def _safe_callback_url(callback_url: str | None, gateway: str) -> str:
	"""SEC-1: the gateway may only redirect back to this site (no open redirect)."""
	from urllib.parse import quote, urlparse

	default = frappe.utils.get_url(f"/farda_payment_callback?gateway={quote(gateway)}")
	if not callback_url:
		return default
	site_host = urlparse(frappe.utils.get_url()).netloc
	parsed = urlparse(callback_url)
	if parsed.scheme not in ("http", "https") or parsed.netloc != site_host:
		frappe.throw(_("آدرس بازگشت باید روی همین سایت باشد"), frappe.ValidationError)
	return callback_url


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
		# SEC-1: the caller must be allowed to see the document it pays for
		if not frappe.has_permission(reference_doctype, "read", reference_name):
			frappe.throw(_("دسترسی به سند مرجع مجاز نیست"), frappe.PermissionError)
		_validate_amount_against_reference(reference_doctype, reference_name, amount_irr)
	elif not frappe.has_permission("Payment Entry", "create"):
		# SEC-1: free-amount payments (no reference) are for back-office users only
		frappe.throw(_("پرداخت بدون سند مرجع مجاز نیست"), frappe.PermissionError)
	gw = _gateway(gateway)
	callback = _safe_callback_url(callback_url, gw.name)
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
	# SEC-3: the gateway callback usually arrives as Guest; the draft is created on the
	# strength of the verified, amount-checked gateway result, not the caller's rights.
	pe.insert(ignore_permissions=True)
	return pe.name
