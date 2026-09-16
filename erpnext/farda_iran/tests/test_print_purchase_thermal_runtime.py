"""R15 — Persian print formats: Purchase Invoice (A4 RTL) + Thermal Receipt 80mm.

Live-site E2E mirroring the H7 sales-invoice print test:
  Purchase A4  — renders via the format's Jinja; asserts RTL, «صورتحساب خرید»,
                 supplier IDs (شناسه ملی/کد اقتصادی) in Persian digits, VAT row,
                 Jalali date, Toman amounts, amount-in-words match.
  Thermal 80mm — asserts 72mm content width (80mm paper), compact رسید title,
                 item/qty/price columns, totals + به حروف, discount row only
                 when a discount exists (structural negative too).
Rendering uses the format HTML through frappe.get_jenv (same as H7 —
frappe.get_print needs the Desk bundle this env does not build).
"""

from __future__ import annotations

import frappe

PF_PURCHASE = "Farda Persian Purchase Invoice"
PF_THERMAL = "Farda Thermal Receipt 80mm"

LEGAL_ID = "24005678907"  # valid vector (official algorithm)
ECONOMIC = "411366512345"  # valid vector


def _ensure_print_format(name: str, slug: str) -> None:
	if frappe.db.exists("Print Format", name):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(
		frappe.get_module_path("Farda Iran"), "print_format", slug, f"{slug}.json"
	)
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Print Format", name):
		raise AssertionError(f"{name} print format failed to sync")


def _render(pf_name: str, doc) -> str:
	pf_html = frappe.db.get_value("Print Format", pf_name, "html")
	jenv = frappe.get_jenv()
	return jenv.from_string(pf_html).render({
		"doc": doc,
		"print_settings": frappe.get_doc("Print Settings").as_dict(),
		"letter_head": None,
		"no_letterhead": 1,
	})


def _item(code):
	if frappe.db.exists("Item", code):
		return code
	return frappe.get_doc({
		"doctype": "Item",
		"item_code": code,
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert().name


def _run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()

	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	results: list[str] = []
	global _CLEANUP
	_CLEANUP = []

	_ensure_print_format(PF_PURCHASE, "farda_persian_purchase_invoice")
	_ensure_print_format(PF_THERMAL, "farda_thermal_receipt_80mm")
	results.append("PASS: both print formats synced as standard (module Farda Iran)")

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	_setup_vat_settings(company)
	item = _item("PRINT PURCHASE ITEM")

	# ---------- Purchase Invoice (A4) ----------
	supplier = frappe.get_doc({
		"doctype": "Supplier",
		"supplier_name": "PRINT PURCHASE SUP",
		"supplier_type": "Company",
		"farda_legal_id": LEGAL_ID,
		"farda_economic_code": ECONOMIC,
	}).insert()
	_CLEANUP.append(("Supplier", supplier.name))

	pi = frappe.get_doc({
		"doctype": "Purchase Invoice",
		"company": company,
		"supplier": supplier.name,
		"bill_no": "SUP-1404-88",
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [{"item_code": item, "qty": 3, "rate": 400_000}],
	}).insert()
	pi.submit()
	_CLEANUP.append(("Purchase Invoice", pi.name))
	# net 1,200,000 + VAT 120,000 = 1,320,000 IRR
	assert abs(pi.grand_total - 1_320_000) < 0.01, pi.grand_total

	html = _render(PF_PURCHASE, pi)
	assert 'dir="rtl"' in html, "purchase print format is not RTL"
	assert "صورتحساب خرید کالا و خدمات" in html, "purchase title missing"
	assert "۲۴۰۰۵۶۷۸۹۰۷" in html, "supplier legal ID not rendered in Persian digits"
	assert "۴۱۱۳۶۶۵۱۲۳۴۵" in html, "supplier economic code not rendered"
	assert "شماره فاکتور فروشنده" in html, "bill_no row missing"
	assert "۱۴۰۵" in html, "Jalali date missing on purchase invoice"
	assert "مالیات بر ارزش افزوده" in html and "۱۲٬۰۰۰" in html, "VAT row (12,000 Toman = 120,000 IRR) missing"
	from erpnext.farda_iran.invoice.persian import money_words_toman

	words = money_words_toman(pi.grand_total)
	assert words in html and "به حروف" in html, f"words mismatch: «{words}»"
	results.append("PASS: Purchase A4 — RTL + خرید title + supplier IDs + VAT ۱۲۰٬۰۰۰ + Jalali + به حروف")

	# ---------- Thermal 80mm (Sales Invoice) ----------
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "PRINT THERMAL CUST",
		"customer_type": "Individual",
	}).insert()
	_CLEANUP.append(("Customer", customer.name))

	si = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer.name,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [
			{"item_code": item, "qty": 2, "rate": 500_000},
			{"item_code": item, "qty": 1, "rate": 250_000},
		],
	}).insert()
	si.submit()
	_CLEANUP.append(("Sales Invoice", si.name))
	# net 1,250,000 + VAT 125,000 = 1,375,000 IRR
	assert abs(si.grand_total - 1_375_000) < 0.01, si.grand_total

	thermal = _render(PF_THERMAL, si)
	assert 'dir="rtl"' in thermal and "width: 72mm" in thermal, "thermal 80mm layout missing (72mm content)"
	assert "صورتحساب فروش (رسید)" in thermal, "thermal receipt title missing"
	assert "کد اقتصادی" in thermal, "store economic code missing on receipt"
	assert thermal.count("<tr") >= 7 + len(si.items), "receipt rows not compact-rendered"
	assert "قابل پرداخت" in thermal and "۱۳۷٬۵۰۰" in thermal, "grand total (137,500 Toman = 1,375,000 IRR) missing"
	assert money_words_toman(si.grand_total) in thermal, "receipt words missing"
	assert "تخفیف" not in thermal, "discount row rendered although no discount was applied"
	results.append("PASS: Thermal 80mm — 72mm layout + رسید title + compact rows + totals/words + no empty discount row")

	# discount row appears only with a real discount (fresh validated doc)
	si2 = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer.name,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [{"item_code": item, "qty": 1, "rate": 500_000}],
		"discount_amount": 50_000,
	}).insert()
	_CLEANUP.append(("Sales Invoice", si2.name))
	thermal2 = _render(PF_THERMAL, si2)
	assert "تخفیف" in thermal2 and "۵٬۰۰۰" in thermal2, "discount row missing/mistyped on receipt"
	results.append("PASS: discount row rendered exactly when a discount exists (۵٬۰۰۰ تومان)")

	return " | ".join(results)


def run() -> str:
	try:
		return _run()
	finally:
		_teardown()


def _teardown():
	frappe.set_user("Administrator")
	for doctype, name in _CLEANUP:
		try:
			if not frappe.db.exists(doctype, name):
				continue
			if frappe.db.get_value(doctype, name, "docstatus") == 1:
				frappe.get_doc(doctype, name).cancel()
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
		except Exception:
			frappe.log_error(title="R15 teardown", message=f"{doctype} {name}\n{frappe.get_traceback()}")
