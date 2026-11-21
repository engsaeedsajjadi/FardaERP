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
		for d in frappe.get_all("Item", filters={"name": ["in", codes]}, fields=["name", "farda_vat_exempt"]):
			exempt_map[d.name] = d.farda_vat_exempt
	return [bool(exempt_map.get(r.item_code)) for r in items]


def vat_account_for(company: str | None, configured: str | None = None) -> str | None:
	"""CORE-031: the VAT account to use for one company.

	Farda VAT Settings holds a single account, which belongs to one company. For
	any other company use its equivalent: same account number, same account
	name, the Iranian chart's VAT account (210301), or its only Tax account with
	the VAT rate. Returns None when the company has no VAT account.
	"""
	configured = configured if configured is not None else get_settings().vat_account
	if not company:
		return configured
	if configured and frappe.db.get_value("Account", configured, "company") == company:
		return configured
	cands = []
	src = (
		frappe.db.get_value("Account", configured, ["account_number", "account_name"], as_dict=True) or {}
		if configured
		else {}
	)
	if src.get("account_number"):
		cands.append({"account_number": src.account_number})
	cands.append({"account_number": "210301"})  # Iranian chart's VAT account wins over a name match
	if src.get("account_name"):
		cands.append({"account_name": src.account_name})
	for f in cands:
		name = frappe.db.get_value("Account", dict(f, company=company, is_group=0), "name")
		if name:
			return name
	taxes = frappe.get_all(
		"Account",
		filters={"company": company, "is_group": 0, "account_type": "Tax", "tax_rate": get_settings().default_rate or 10},
		pluck="name",
	)
	return taxes[0] if len(taxes) == 1 else None


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
	pattern = _moadian_pattern(doc)
	_remove_levy_rows(doc)
	if not doc.get("farda_apply_vat"):
		_remove_vat_rows(doc, vat_account_for(doc.get("company")))
		doc.calculate_taxes_and_totals()
		return
	rate = get_applicable_vat_rate(doc)
	if pattern in (7, 11, 14):  # export, commodity exchange, chain sale: VAT rate is 0 (S1 §7-41)
		rate = 0
	if not rate:
		_remove_vat_rows(doc, vat_account_for(doc.get("company")))
		doc.calculate_taxes_and_totals()
		return
	s = get_settings()
	if not s.vat_account:
		frappe.throw(
			frappe._("حساب مالیات بر ارزش افزوده در «تنظیمات مالیات بر ارزش افزوده» تعیین نشده است")
		)
	account = vat_account_for(doc.company, s.vat_account)
	if not account:
		frappe.throw(
			frappe._(
				"برای شرکت {0} حساب مالیات بر ارزش افزوده پیدا نشد. یک حساب از نوع «مالیات» با نرخ {1}٪ بسازید یا حساب را در تنظیمات ارزش افزوده تعیین کنید."
			).format(doc.company, rate)
		)

	from erpnext.farda_iran.tax import planner

	flags = _get_exempt_flags(items)
	if pattern == 3:  # gold: VAT on making fee + profit + commission (S1 §7-42)
		_remove_vat_rows(doc, account)
		for item_row, row_tax in zip(items, _gold_row_vat(items, flags, rate)):
			if row_tax:
				doc.append(
					"taxes",
					{
						"charge_type": "Actual",
						"category": "Total",
						"add_deduct_tax": "Add",
						"account_head": account,
						"rate": rate,
						"tax_amount": row_tax,
						"base_tax_amount": row_tax,
						"description": f"{VAT_DESCRIPTION} — {item_row.item_code or ''}",
					},
				)
		_apply_levies(doc, pattern, rate)
		doc.calculate_taxes_and_totals()
		return
	plan = planner.plan_vat(list(zip(flags, [frappe.utils.flt(r.amount) for r in items])), rate)

	if plan.mode == "single":
		_remove_vat_rows(doc, account)
		doc.append(
			"taxes",
			{
				"charge_type": "On Net Total",
				"category": "Total",
				"add_deduct_tax": "Add",
				"account_head": account,
				"rate": rate,
				"description": VAT_DESCRIPTION,
			},
		)
		_apply_levies(doc, pattern, rate)
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
						"category": "Total",
						"add_deduct_tax": "Add",
						"account_head": account,
						"rate": rate,
						"tax_amount": planner.to_number(row_tax),
						"base_tax_amount": planner.to_number(row_tax),
						"description": f"{VAT_DESCRIPTION} — {item_row.item_code or ''}",
					},
				)
	_apply_levies(doc, pattern, rate)
	doc.calculate_taxes_and_totals()


# ---------------------------------------------------------------- CORE-035
LEVY_DESCRIPTION = "سایر مالیات‌ها و عوارض"


def _moadian_pattern(doc) -> int:
	"""Sales Invoice pattern (سامانه مودیان الگو); 1 for anything else."""
	if doc.doctype != "Sales Invoice":
		return 1
	try:
		from erpnext.farda_iran.moadian.service import ensure_pattern

		return ensure_pattern(doc)
	except Exception:
		return 1


def _signed_line(row, pattern: int, rate) -> tuple[dict, int]:
	"""Moadian line for a row; credit-note rows (negative qty) are computed on
	absolute values and the sign is returned separately."""
	from erpnext.farda_iran.moadian import service as md

	sign = -1 if frappe.utils.flt(row.qty) < 0 else 1
	if sign < 0:
		row = frappe._dict(row.as_dict() if hasattr(row, "as_dict") else row)
		for f in ("qty", "base_net_amount", "net_amount", "farda_md_consfee", "farda_md_spro", "farda_md_bros", "total_weight"):
			if row.get(f):
				row[f] = abs(frappe.utils.flt(row[f]))
	return md.line_from_row(row, pattern, rate), sign


def _gold_row_vat(items, exempt_flags, rate) -> list[int]:
	out = []
	for row, exempt in zip(items, exempt_flags):
		line, sign = _signed_line(row, 3, 0 if exempt else rate)
		out.append(sign * int(line.get("vam") or 0))
	return out


def levies_account_for(company: str | None) -> str | None:
	"""Account for other taxes/levies (عوارض): number 210303, else the same name."""
	if not company:
		return None
	for f in ({"account_number": "210303"}, {"account_name": LEVY_DESCRIPTION}):
		name = frappe.db.get_value("Account", dict(f, company=company, is_group=0), "name")
		if name:
			return name
	return None


def _remove_levy_rows(doc) -> None:
	keep = [r for r in doc.get("taxes") or [] if not str(r.description or "").startswith(LEVY_DESCRIPTION)]
	if len(keep) != len(doc.get("taxes") or []):
		doc.set("taxes", keep)


def _apply_levies(doc, pattern: int, rate) -> None:
	"""Rows with «نرخ سایر مالیات/عوارض» get matching Actual tax rows so the ERP
	totals equal what is declared to سامانه مودیان (S1 §7-43)."""
	if doc.doctype != "Sales Invoice":
		return
	items = doc.get("items") or []
	if not any(r.get("farda_md_odr") or r.get("farda_md_olr") for r in items):
		return
	account = None
	for row, exempt in zip(items, _get_exempt_flags(items)):
		if exempt or not (row.get("farda_md_odr") or row.get("farda_md_olr")):
			continue  # levies are 0 when the line's VAT rate is 0 (S1 §7-43)
		line, sign = _signed_line(row, pattern, rate)
		amount = sign * (int(line.get("odam") or 0) + int(line.get("olam") or 0))
		if not amount:
			continue
		account = account or levies_account_for(doc.company)
		if not account:
			frappe.throw(
				frappe._(
					"برای شرکت {0} حساب «سایر مالیات‌ها و عوارض» (شماره ۲۱۰۳۰۳) پیدا نشد. این حساب را از نوع «مالیات» بسازید."
				).format(doc.company)
			)
		doc.append(
			"taxes",
			{
				"charge_type": "Actual",
				"category": "Total",
				"add_deduct_tax": "Add",
				"account_head": account,
				"tax_amount": amount,
				"base_tax_amount": amount,
				"description": f"{LEVY_DESCRIPTION} — {row.item_code or ''}",
			},
		)


def invoice_totals(doc) -> frappe._dict:
	"""Summary for Persian print formats: net / VAT / grand, all in IRR.

	Frappe-aware (used only inside server-side Jinja rendering).
	"""
	amount = frappe.utils.flt
	vat_account = vat_account_for(doc.get("company"))
	vat_amount = 0.0
	for row in doc.get("taxes") or []:
		if vat_account and row.get("account_head") == vat_account:
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
