"""FardaERP VAT (مالیات بر ارزش افزوده) — central configurable service.

Design (never hardcode rates):
- `Farda VAT Settings` (Single DocType, module Farda Iran) owns:
  enabled · default rate (DEFAULT 10%) · effective date · VAT account.
- Per-party exemption: `farda_vat_exempt` custom field on Customer/Supplier.
- Per-invoice opt-in: `farda_apply_vat` custom field on Sales/Purchase Invoice.
  When checked, validate adds/updates the VAT tax row via THIS service and
  recalculates totals — the rate always comes from the settings, never code.
"""

from __future__ import annotations

import frappe

VAT_DESCRIPTION = "مالیات بر ارزش افزوده (VAT)"


def get_settings() -> frappe._dict:
	"""Live VAT settings as a dict (safe defaults when unset)."""
	return frappe._dict(
		enabled=frappe.db.get_single_value("Farda VAT Settings", "enabled"),
		default_rate=frappe.db.get_single_value("Farda VAT Settings", "default_rate"),
		effective_from=frappe.db.get_single_value("Farda VAT Settings", "effective_from"),
		vat_account=frappe.db.get_single_value("Farda VAT Settings", "vat_account"),
	)


def get_applicable_vat_rate(doc) -> float:
	"""Effective VAT percent for this document (0 = not applicable)."""
	s = get_settings()
	if not s.enabled or not s.default_rate:
		return 0.0
	posting_date = doc.get("posting_date") or frappe.utils.nowdate()
	if s.effective_from and frappe.utils.getdate(posting_date) < frappe.utils.getdate(s.effective_from):
		return 0.0
	party_field = "customer" if doc.doctype == "Sales Invoice" else "supplier"
	if party_field == "customer" and doc.get("customer") and frappe.db.get_value(
		"Customer", doc.customer, "farda_vat_exempt"
	):
		return 0.0
	if party_field == "supplier" and doc.get("supplier") and frappe.db.get_value(
		"Supplier", doc.supplier, "farda_vat_exempt"
	):
		return 0.0
	return float(s.default_rate)


def on_invoice_validate(doc, method: str | None = None) -> None:
	"""doc_events validate handler for Sales/Purchase Invoice."""
	if not doc.get("farda_apply_vat"):
		return
	rate = get_applicable_vat_rate(doc)
	if not rate:
		return
	s = get_settings()
	account = s.vat_account
	if not account:
		frappe.throw(
			frappe._("حساب مالیات بر ارزش افزوده در تنظیمات Farda VAT تعیین نشده است")
		)
	if frappe.db.get_value("Account", account, "company") != doc.company:
		frappe.throw(frappe._("حساب VAT به شرکتِ این سند تعلق ندارد"))
	for row in doc.get("taxes") or []:
		if row.account_head == account:
			row.rate = rate
			row.description = VAT_DESCRIPTION
			break
	else:
		doc.append(
			"taxes",
			{
				"charge_type": "On Net Total",
				"account_head": account,
				"rate": rate,
				"description": VAT_DESCRIPTION,
			},
		)
	doc.calculate_taxes_and_totals()
