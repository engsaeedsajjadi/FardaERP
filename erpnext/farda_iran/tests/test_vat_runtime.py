"""E2E runtime test: completed VAT — item-level exemption, rate matrix, VAT report.

Executed on the live site. Covers §8's required cases:
custom rate · 10% · 0% (settings off + future effective date) · exempt item ·
mixed taxable/exempt (per-row Actual rows) · purchase invoice · GL
reconciliation · stale-row removal · Farda VAT Report (Jalali/Toman/Persian,
totals, kind filter). Rolls the transaction back at the end.
"""

from __future__ import annotations

import frappe


def _gl_vat(voucher: str, vat_account: str, company: str) -> float:
	rows = frappe.get_all(
		"GL Entry",
		filters={"voucher_no": voucher, "account": vat_account, "company": company, "is_cancelled": 0},
		fields=["credit", "debit"],
	)
	return sum((r.credit or 0) - (r.debit or 0) for r in rows)


def _item(code: str, exempt: int = 0):
	existing = frappe.db.get_value("Item", {"item_code": code}, "name")
	if existing:
		frappe.db.set_value("Item", existing, "farda_vat_exempt", exempt)
		return existing
	return frappe.get_doc({
		"doctype": "Item",
		"item_code": code,
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
		"farda_vat_exempt": exempt,
	}).insert().name


def _invoice(doctype: str, party_field: str, party: str, rows: list[dict], apply_vat: int = 1):
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	doc = frappe.get_doc({
		"doctype": doctype,
		"company": company,
		party_field: party,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": apply_vat,
		"posting_date": frappe.utils.nowdate(),
		"items": rows,
	}).insert()
	return doc, company


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	# setup: VAT settings FIRST (account), then templates (they need the account)
	import erpnext.farda_iran.setup.install as farda_setup
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	vat_account = _setup_vat_settings(company)
	farda_setup.execute()
	names = farda_setup.get_item_tax_template_names(company)
	if not names["vat"] or not names["exempt"]:
		raise AssertionError(f"Item Tax Templates missing: {names}")
	results.append("PASS: Item Tax Templates ensured (Farda VAT + Farda Exempt 0%, rate-synced)")

	customer = frappe.get_doc({"doctype": "Customer", "customer_name": "VATRT CUST", "customer_type": "Individual"}).insert()
	supplier = frappe.get_doc({"doctype": "Supplier", "supplier_name": "VATRT SUP", "supplier_type": "Company"}).insert()
	item_a = _item("VATRT TAXABLE", 0)
	item_b = _item("VATRT EXEMPT", 1)

	def set_settings(**kv):
		for k, v in kv.items():
			frappe.db.set_single_value("Farda VAT Settings", k, v)
		frappe.clear_document_cache("Farda VAT Settings", "Farda VAT Settings")

	try:
		# ---- 1) custom rate 15% ----
		set_settings(enabled=1, default_rate=15, effective_from="2024-01-01")
		si, _ = _invoice("Sales Invoice", "customer", customer.name,
						 [{"item_code": item_a, "qty": 1, "rate": 1_000_000}])
		vat_rows = [t for t in si.taxes if t.account_head == vat_account]
		assert len(vat_rows) == 1 and abs(vat_rows[0].tax_amount - 150_000) < 0.01, si.taxes
		results.append("PASS: custom rate 15% → ۱۵۰٬۰۰۰ IRR on 1,000,000 IRR net")

		# ---- 2) settings off = 0% + stale-row removal ----
		set_settings(enabled=0)
		si.reload() if hasattr(si, "reload") else None
		si = frappe.get_doc("Sales Invoice", si.name)
		si.farda_apply_vat = 0
		si.save()
		assert not [t for t in si.taxes if t.account_head == vat_account], si.taxes
		results.append("PASS: settings off → VAT rows removed (0% + stale cleanup)")

		# ---- 3) exempt item only → no VAT ----
		set_settings(enabled=1, default_rate=10)
		si2, _ = _invoice("Sales Invoice", "customer", customer.name,
						  [{"item_code": item_b, "qty": 2, "rate": 400_000}])
		assert not [t for t in si2.taxes if t.account_head == vat_account], si2.taxes
		assert abs(si2.grand_total - 800_000) < 0.01, si2.grand_total
		results.append("PASS: exempt item invoice → zero VAT rows, grand == net")

		# ---- 4) mixed → per-row Actual VAT only on taxable lines ----
		si3, _ = _invoice("Sales Invoice", "customer", customer.name,
						  [
						   {"item_code": item_a, "qty": 1, "rate": 1_000_000},
						   {"item_code": item_b, "qty": 1, "rate": 500_000},
						   {"item_code": item_a, "qty": 1, "rate": 250_000},
						  ])
		vat_rows3 = [t for t in si3.taxes if t.account_head == vat_account]
		assert len(vat_rows3) == 2, si3.taxes  # two taxable lines → two Actual rows
		total_vat = sum(t.tax_amount for t in vat_rows3)
		assert abs(total_vat - 125_000) < 0.01, (total_vat, si3.taxes)
		assert abs(si3.grand_total - 1_875_000) < 0.01, si3.grand_total  # 1,750,000 net + 125,000 VAT
		si3.submit()
		gl = _gl_vat(si3.name, vat_account, company)
		assert abs(gl - 125_000) < 0.01, gl
		results.append("PASS: mixed invoice → exempt line carries 0; VAT ۱۲۵٬۰۰۰ IRR; GL reconciles")

		# ---- 5) purchase invoice VAT (debit side) ----
		pi, _ = _invoice("Purchase Invoice", "supplier", supplier.name,
						 [{"item_code": item_a, "qty": 1, "rate": 800_000}])
		pi_vat = [t for t in pi.taxes if t.account_head == vat_account]
		assert len(pi_vat) == 1 and abs(pi_vat[0].tax_amount - 80_000) < 0.01, pi.taxes
		pi.submit()
		gl_pi = _gl_vat(pi.name, vat_account, company)
		assert abs(gl_pi + 80_000) < 0.01, gl_pi  # debit → negative credit-debit delta
		results.append("PASS: purchase invoice → VAT ۸۰٬۰۰۰ IRR debited, GL reconciles")

		# ---- 6) future effective date → 0 ----
		set_settings(effective_from="2100-01-01")
		si4, _ = _invoice("Sales Invoice", "customer", customer.name,
						  [{"item_code": item_a, "qty": 1, "rate": 1_000_000}])
		assert not [t for t in si4.taxes if t.account_head == vat_account], si4.taxes
		set_settings(effective_from="2024-01-01")
		results.append("PASS: future effective_from → VAT not applied")

		# ---- 7) Farda VAT Report ----
		_ensure_report()
		fn = frappe.get_attr("erpnext.farda_iran.report.farda_vat_report.farda_vat_report.execute")
		columns, data = fn({"company": company, "kind": ""})
		# report is per tax ROW; aggregate per voucher for assertions

		def p2i(s):
			return int(s.replace("٬", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")))

		agg: dict = {}
		for r in data[:-1]:
			a = agg.setdefault(r["voucher"], {"kind": r["kind"], "farda_date": r["farda_date"], "vat": 0})
			a["vat"] += p2i(r["vat"])
		r3 = agg.get(si3.name)
		assert r3 and r3["vat"] == 12_500 and r3["kind"] == "فروش", (r3,)  # 125,000 IRR = 12,500 Toman
		r_pi = agg.get(pi.name)
		assert r_pi and r_pi["vat"] == 8_000 and r_pi["kind"] == "خرید", r_pi
		assert "۱۴۰۵" in r3["farda_date"], r3
		# totals row = sum of rows
		assert p2i(data[-1]["vat"]) == sum(p2i(r["vat"]) for r in data[:-1]), data[-1]
		_, only_purchase = fn({"company": company, "kind": "Purchase"})
		assert all(r["kind"] == "خرید" for r in only_purchase[:-1]), only_purchase
		results.append(f"PASS: Farda VAT Report — {len(data) - 1} rows, Jalali/Toman/Persian, totals+kind filter")
	finally:
		set_settings(enabled=1, default_rate=10, effective_from="2024-01-01")

	frappe.db.rollback()
	return " | ".join(results)


def _ensure_report() -> None:
	if frappe.db.exists("Report", "Farda VAT Report"):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(
		frappe.get_module_path("Farda Iran"), "report", "farda_vat_report", "farda_vat_report.json"
	)
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Report", "Farda VAT Report"):
		raise AssertionError("Farda VAT Report failed to sync")
