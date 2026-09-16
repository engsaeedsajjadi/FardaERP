"""E2E runtime test: Farda Sales Register (Persian/Jalali/Toman report) + RTL CSS.

- syncs the report if the site doesn't have it yet
- creates + submits an invoice with VAT, executes the report
- asserts Jalali dates, Persian-digit Toman amounts, VAT column, total row
- asserts the RTL stylesheet asset is installed and scoped to html[lang=fa]
Rolls the transaction back at the end.
"""

from __future__ import annotations

import frappe

REPORT = "Farda Sales Register"


def _ensure_report() -> None:
	if frappe.db.exists("Report", REPORT):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(
		frappe.get_module_path("Farda Iran"), "report", "farda_sales_register", "farda_sales_register.json"
	)
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Report", REPORT):
		raise AssertionError("Farda Sales Register failed to sync")


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	_ensure_report()
	fn = frappe.get_attr("erpnext.farda_iran.report.farda_sales_register.farda_sales_register.execute")

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "REPORT TEST CUSTOMER",
		"customer_type": "Individual",
	}).insert()
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "REPORT TEST ITEM",
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert()
	si = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer.name,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"items": [{"item_code": item.name, "qty": 1, "rate": 2_000_000}],
	}).insert()
	si.submit()

	columns, data = execute_safe(fn, {})
	row = next((r for r in data if r.get("name") == si.name), None)
	if row is None:
		raise AssertionError("submitted invoice missing from report output")
	if "۱۴۰۵" not in (row["farda_date"] or ""):
		raise AssertionError(f"report date not Jalali: {row['farda_date']}")
	results.append(f"PASS: Jalali date in report ({row['farda_date']})")
	if not any(ch in (row["farda_grand"] or "") for ch in "۰۱۲۳۴۵۶۷۸۹"):
		raise AssertionError(f"amount not Persian digits: {row['farda_grand']}")
	if "٬" not in row["farda_grand"]:
		raise AssertionError(f"amount missing Persian thousands separator: {row['farda_grand']}")
	# 2,200,000 IRR grand = 220,000 Toman
	if row["farda_grand"] != "۲۲۰٬۰۰۰":
		raise AssertionError(f"grand total wrong: {row['farda_grand']} != ۲۲۰٬۰۰۰")
	results.append(f"PASS: Toman amounts, Persian digits+separator ({row['farda_grand']} تومان)")

	total_row = data[-1]
	if "فاکتور" not in (total_row["customer_name"] or ""):
		raise AssertionError(f"total row wrong: {total_row}")

	# self-consistency: total row must equal the sum of the data rows above it
	def persian_to_int(s):
		return int(s.replace("٬", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")))

	sum_grand = sum(persian_to_int(r["farda_grand"]) for r in data[:-1])
	if persian_to_int(total_row["farda_grand"]) != sum_grand:
		raise AssertionError(f"total {total_row['farda_grand']} != sum of rows {sum_grand}")
	results.append("PASS: total row (جمع) equals sum of rows in Toman")

	# date filter narrows rows
	_, filtered = execute_safe(fn, {"from_date": "2100-01-01", "to_date": "2100-12-31"})
	data_rows = [r for r in filtered if r.get("name") not in (None, "جمع")]
	if data_rows:
		raise AssertionError("date filter not applied")
	results.append("PASS: from/to date filters")

	# ---------- RTL stylesheet ----------
	asset = frappe.local.sites_path + "/assets/erpnext/farda_iran/css/farda_rtl.css"
	import os

	if not os.path.exists(asset):
		raise AssertionError(f"RTL stylesheet not installed at {asset}")
	css = open(asset, encoding="utf-8").read()
	if 'html[lang="fa"]' not in css or "direction: rtl" not in css:
		raise AssertionError("RTL stylesheet not scoped to fa locale")
	results.append("PASS: RTL stylesheet installed + fa-scoped")

	frappe.db.rollback()
	return " | ".join(results)


def execute_safe(fn, filters):
	"""Report execute may be wrapped by frappe's report framework; call directly."""
	return fn(filters)
