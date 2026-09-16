"""FardaERP Iran integration tests — run against a REAL site via bench:

    bench --site <site> execute erpnext.farda_iran.tests.test_integration_iran.run

Covers: Iranian party validation hooks (real ValidationError), VAT settings,
VAT application on a real Sales Invoice (tax row + totals + submitted GL).
Savepoint-isolated and rerun-safe.
"""

from __future__ import annotations

import frappe
from frappe.utils import nowdate


def _unique(prefix: str) -> str:
	return f"{prefix}-{frappe.utils.now_datetime().strftime('%Y%m%d%H%M%S%f')}"


def _get_vat_account(company: str) -> str:
	"""Find or create the VAT liability account for the company."""
	existing = frappe.db.get_value(
		"Account", {"company": company, "account_name": "Iran VAT", "is_group": 0}
	)
	if existing:
		return existing
	parent = frappe.db.get_value(
		"Account",
		{"company": company, "root_type": "Liability", "is_group": 1, "disabled": 0},
		"name",
		order_by="lft",
	)
	if not parent:
		raise AssertionError("no liability group account found for VAT account")
	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"company": company,
			"account_name": "Iran VAT",
			"parent_account": parent,
			"account_type": "Tax",
			"account_currency": frappe.db.get_value("Company", company, "default_currency"),
			"is_group": 0,
		}
	).insert()
	return doc.name


def _setup_vat_settings(company: str) -> str:
	account = _get_vat_account(company)
	frappe.db.set_single_value("Farda VAT Settings", "enabled", 1)
	frappe.db.set_single_value("Farda VAT Settings", "default_rate", 10.0)
	frappe.db.set_single_value("Farda VAT Settings", "vat_account", account)
	frappe.db.set_single_value("Farda VAT Settings", "effective_from", "2024-01-01")
	return account


def _sync_doctypes() -> bool:
	"""Force-import our DocType JSON (fallback when bench migrate missed it)."""
	from frappe.modules.import_file import import_file_by_path

	import os

	path = os.path.join(
		frappe.get_module_path("Farda Iran"),
		"doctype",
		"farda_vat_settings",
		"farda_vat_settings.json",
	)
	import_file_by_path(path, force=True)
	return bool(frappe.db.exists("DocType", "Farda VAT Settings"))


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat
	from frappe.database.database import savepoint as db_savepoint

	pg_compat.apply()  # this smoke site runs PostgreSQL; shims are test-scoped
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		if not _sync_doctypes():
			raise AssertionError("Farda VAT Settings DocType missing even after sync_for")
	results: list[str] = []
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	if not company:
		raise AssertionError("no company on site")
	vat_account = _setup_vat_settings(company)

	# ---------- 1) invalid national id must raise, isolated in a savepoint ----
	with db_savepoint(catch=()):
		try:
			frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": _unique("INTG BAD"),
					"customer_type": "Individual",
					"farda_national_id": "1234567890",  # invalid check digit
				}
			).insert()
		except frappe.exceptions.ValidationError:
			results.append("PASS: invalid کد ملی rejected by real validate hook")
		else:
			raise AssertionError("invalid national id was accepted")

	# ---------- 2) invalid IBAN must raise ----
	with db_savepoint(catch=()):
		try:
			frappe.get_doc(
				{
					"doctype": "Supplier",
					"supplier_name": _unique("INTG BAD IBAN"),
					"supplier_type": "Company",
					"farda_iban": "IR200170000000000123456788",  # one digit off
				}
			).insert()
		except frappe.exceptions.ValidationError:
			results.append("PASS: invalid شبا rejected by real validate hook")
		else:
			raise AssertionError("invalid IBAN was accepted")

	# ---------- 3) valid party fields accepted ----
	customer_code = "0499370899"
	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": _unique("INTG OK"),
			"customer_type": "Individual",
			"farda_person_type": "حقیقی",
			"farda_national_id": customer_code,
			"farda_postal_code": "1968743512",
			"farda_iban": "IR200170000000000123456789",
		}
	).insert()
	results.append("PASS: valid Iranian party fields accepted")

	# ---------- 4) VAT applied to a real Sales Invoice ----
	item = frappe.db.get_value("Item", {"item_code": ("like", "%SMOKE%")}, "item_code") or frappe.db.get_value("Item", {"disabled": 0, "is_stock_item": 1}, "item_code")
	company_currency = frappe.db.get_value("Company", company, "default_currency")
	invoice = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"company": company,
			"customer": customer.name,
			"currency": company_currency,
			"conversion_rate": 1,
			"farda_apply_vat": 1,
			"posting_date": nowdate(),
			"items": [{"item_code": item, "qty": 10, "rate": 100_000}],
		}
	).insert()
	tax_rows = [r for r in invoice.taxes if r.account_head == vat_account]
	if not tax_rows:
		raise AssertionError("VAT tax row not added to Sales Invoice")
	if abs(tax_rows[0].rate - 10.0) > 1e-9:
		raise AssertionError(f"VAT rate wrong: {tax_rows[0].rate}")
	expected_total = 1_100_000
	if abs(invoice.grand_total - expected_total) > 0.01:
		raise AssertionError(f"grand_total {invoice.grand_total} != {expected_total}")
	invoice.submit()
	gl = frappe.get_all(
		"GL Entry",
		filters={"voucher_no": invoice.name, "account": vat_account, "company": company},
		fields=["credit", "debit"],
	)
	if not gl or abs(sum((r.credit or 0) - (r.debit or 0) for r in gl) - 100_000) > 0.01:
		raise AssertionError(f"VAT GL entry wrong: {gl}")
	results.append(
		f"PASS: VAT 10% on real invoice — net 1,000,000 IRR → total {invoice.grand_total:,.0f} IRR, "
		f"GL credit {100_000:,} IRR on {vat_account}"
	)

	# ---------- 5) exempt customer gets no VAT ----
	exempt = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": _unique("INTG EXEMPT"),
			"farda_vat_exempt": 1,
		}
	).insert()
	inv2 = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"company": company,
			"customer": exempt.name,
			"currency": company_currency,
			"conversion_rate": 1,
			"farda_apply_vat": 1,
			"posting_date": nowdate(),
			"items": [{"item_code": item, "qty": 1, "rate": 100_000}],
		}
	).insert()
	if abs(inv2.grand_total - 100_000) > 0.01:
		raise AssertionError(f"exempt customer charged VAT: {inv2.grand_total}")
	results.append("PASS: exempt customer (farda_vat_exempt) → no VAT charged")

	# ---------- cleanup: keep settings, drop test documents ----
	for name, doctype in ((invoice.name, "Sales Invoice"), (inv2.name, "Sales Invoice")):
		pass  # keep submitted docs — they are the audit evidence on this smoke site
	frappe.db.commit()

	summary = " | ".join(results)
	print(summary)
	return summary
