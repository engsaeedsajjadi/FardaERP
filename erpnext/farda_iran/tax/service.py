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


def _get_exempt_flags(items) -> list[bool]:
	"""Batch-read Item.farda_vat_exempt for the invoice rows (missing item → False)."""
	codes = sorted({r.item_code for r in items if r.item_code})
	exempt_map = {}
	if codes:
		exempt_map = frappe.db.get_values("Item", {"name": ["in", codes]}, "farda_vat_exempt") or {}
	return [bool(exempt_map.get(r.item_code)) for r in items]


def _remove_vat_rows(doc, account: str | None) -> None:
	"""Drop ALL Farda-managed VAT rows (exact description for the single row,
	prefixed description for per-row mode). Keeps third-party tax rows intact."""
	if not account:
		return
	keep = []
	for row in doc.get("taxes") or []:
		if row.account_head == account and (
			row.description == VAT_DESCRIPTION
			or str(row.description or "").startswith(VAT_DESCRIPTION + " — ")
		):
			continue
		keep.append(row)
	doc.set("taxes", keep)


def on_invoice_validate(doc, method: str | None = None) -> None:
	"""doc_events validate handler for Sales/Purchase Invoice.

	Rate comes only from settings. Item-level exemption: if any invoice row's
	Item is exempt, the planner switches to per-row "Actual" VAT rows so exempt
	lines never carry VAT while taxable lines keep exact line-level VAT.
	Stale Farda VAT rows are always cleaned before recomputation.
	"""
	items = doc.get("items") or []
	if not doc.get("farda_apply_vat"):
		_remove_vat_rows(doc, get_settings().vat_account)
		return
	rate = get_applicable_vat_rate(doc)
	if not rate:
		_remove_vat_rows(doc, get_settings().vat_account)
		return
	s = get_settings()
	account = s.vat_account
	if not account:
		frappe.throw(
			frappe._("حساب مالیات بر ارزش افزوده در تنظیمات Farda VAT تعیین نشده است")
		)
	if frappe.db.get_value("Account", account, "company") != doc.company:
		frappe.throw(frappe._("حساب VAT به شرکتِ این سند تعلق ندارد"))

	from erpnext.farda_iran.tax import planner

	flags = _get_exempt_flags(items)
	plan = planner.plan_vat(list(zip(flags, [frappe.utils.flt(r.amount) for r in items])), rate)

	if plan.mode == "single":
		_remove_vat_rows(doc, account)
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
		return

	# all_exempt / per_row → exact per-row VAT, exempt lines carry nothing
	_remove_vat_rows(doc, account)
	if plan.total_tax:
		for item_row, row_tax in zip(items, plan.row_taxes):
			if row_tax:
				doc.append(
					"taxes",
					{
						"charge_type": "Actual",
						"account_head": account,
						"rate": rate,
						"tax_amount": planner.to_number(row_tax),
						"base_tax_amount": planner.to_number(row_tax),
						"description": f"{VAT_DESCRIPTION} — {item_row.item_name or item_row.item_code}",
					},
				)
	doc.calculate_taxes_and_totals()


def invoice_totals(doc) -> frappe._dict:
	"""Summary for Persian print formats: net / VAT / grand, all in IRR.

	Frappe-aware (used only inside server-side Jinja rendering).
	"""
	amount = frappe.utils.flt
	s = get_settings()
	vat_amount = 0.0
	for row in doc.get("taxes") or []:
		if s.vat_account and row.get("account_head") == s.vat_account:
			vat_amount += amount(row.get("tax_amount"))
	try:
		rate = get_applicable_vat_rate(doc) if doc.get("farda_apply_vat") else 0.0
	except Exception:
		rate = 0.0
	return frappe._dict(
		net_total=amount(doc.get("net_total")),
		vat_amount=vat_amount,
		vat_rate=rate,
		grand_total=amount(doc.get("grand_total")),
	)
