"""E2E runtime tests for the Iranian reports pack: Farda Purchase Register,
Farda Cheque Report, Farda Party Balance. Real data, rollback at the end.
"""

from __future__ import annotations

import datetime

import frappe

def _p2i(s) -> int:
	return int(str(s).replace("٬", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")))


def _ensure(report: str, folder: str) -> None:
	if frappe.db.exists("Report", report):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(frappe.get_module_path("Farda Iran"), "report", folder, folder + ".json")
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Report", report):
		raise AssertionError(f"{report} failed to sync")


def _party(doctype, name, **extra):
	return frappe.get_doc({"doctype": doctype, "customer_name" if doctype == "Customer" else "supplier_name": name, **({"customer_type": "Individual"} if doctype == "Customer" else {"supplier_type": "Company"}), **extra}).insert()


def _item(code):
	return frappe.get_doc({
		"doctype": "Item",
		"item_code": code,
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert().name


def _invoice(doctype, party_field, party, item, rate, apply_vat=0):
	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	currency = frappe.db.get_value("Company", company, "default_currency")
	# self-seed: fresh sites may lack a default selling Price List / active Fiscal Year
	if doctype == "Sales Invoice" and not frappe.db.exists("Price List", {"selling": 1}):
		frappe.get_doc({
			"doctype": "Price List",
			"price_list_name": "PACKRT Selling",
			"selling": 1,
			"enabled": 1,
			"currency": currency,
		}).insert()
	_posting = frappe.utils.getdate(frappe.utils.nowdate())
	if not frappe.db.get_value(
		"Fiscal Year",
		{"disabled": 0, "year_start_date": ["<=", _posting], "year_end_date": [">=", _posting]},
		"name",
	):
		frappe.get_doc({
			"doctype": "Fiscal Year",
			"year": f"PACKRT FY{_posting.year}",
			"year_start_date": _posting.replace(month=1, day=1),
			"year_end_date": _posting.replace(month=12, day=31),
			"companies": [{"company": company}],
		}).insert()
	doc = frappe.get_doc({
		"doctype": doctype,
		"company": company,
		party_field: party,
		"currency": currency,
		"conversion_rate": 1,
		"farda_apply_vat": apply_vat,
		"posting_date": frappe.utils.nowdate(),
		**(
			{
				"selling_price_list": frappe.db.get_value("Price List", {"selling": 1}, "name"),
				"price_list_currency": currency,
				"plc_conversion_rate": 1,
			}
			if doctype == "Sales Invoice"
			else {}
		),
		"items": [{"item_code": item, "qty": 1, "rate": rate}],
	}).insert()
	doc.submit()
	return doc


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	for report, folder in (
		("Farda Purchase Register", "farda_purchase_register"),
		("Farda Cheque Report", "farda_cheque_report"),
		("Farda Party Balance", "farda_party_balance"),
	):
		_ensure(report, folder)

	customer = _party("Customer", "PACKRT CUST")
	supplier = _party("Supplier", "PACKRT SUP")
	item = _item("PACKRT ITEM")

	# purchase invoice 800,000 IRR + VAT 10% → grand 880,000
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings
	from erpnext.farda_iran.tax.service import get_settings

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	if not get_settings().vat_account:
		_setup_vat_settings(company)
	pi = _invoice("Purchase Invoice", "supplier", supplier.name, item, 800_000, apply_vat=1)
	assert abs(pi.grand_total - 880_000) < 0.01, pi.grand_total

	# sales invoice fully unpaid 1,000,000 (AR)
	si = _invoice("Sales Invoice", "customer", customer.name, item, 1_000_000)

	# ---- Farda Purchase Register ----
	fn = frappe.get_attr("erpnext.farda_iran.report.farda_purchase_register.farda_purchase_register.execute")
	columns, data = fn({"company": company})
	row = next((r for r in data[:-1] if r["name"] == pi.name), None)
	assert row, data
	assert "۱۴۰۵" in row["farda_date"], row
	assert row["farda_grand"] == "۸۸٬۰۰۰", row["farda_grand"]  # 880,000 IRR = 88,000 Toman
	assert row["farda_tax"] == "۸٬۰۰۰", row["farda_tax"]
	assert _p2i(data[-1]["farda_grand"]) == sum(_p2i(r["farda_grand"]) for r in data[:-1])
	results.append("PASS: Purchase Register — Jalali/Toman/VAT split + جمع self-consistent")

	# ---- Farda Cheque Report ----
	today = frappe.utils.getdate(frappe.utils.today())

	def bank(name: str) -> str:
		n = frappe.db.get_value("Bank", {"bank_name": name}, "name")
		if not n:
			n = frappe.get_doc({"doctype": "Bank", "bank_name": name}).insert(ignore_permissions=True).name
		return n

	# Cheque rows created for report data (names not referenced afterwards)
	frappe.get_doc({
		"doctype": "Cheque",
		"direction": "Received",
		"cheque_number": "PACKRT-1001",
		"bank": bank("بانک ملی ایران"),
		"amount": 1_000_000,
		"issue_date": frappe.utils.today(),
		"due_date": (today + datetime.timedelta(days=10)).isoformat(),
		"company": company,
		"party_type": "Customer",
		"party": customer.name,
	}).insert()
	frappe.get_doc({
		"doctype": "Cheque",
		"direction": "Issued",
		"cheque_number": "PACKRT-1002",
		"bank": bank("بانک ملت"),
		"amount": 500_000,
		"issue_date": (today - datetime.timedelta(days=10)).isoformat(),
		"due_date": (today - datetime.timedelta(days=3)).isoformat(),  # overdue
		"company": company,
		"party_type": "Supplier",
		"party": supplier.name,
	}).insert()

	fn = frappe.get_attr("erpnext.farda_iran.report.farda_cheque_report.farda_cheque_report.execute")
	columns, data = fn({"company": company})
	by_no = {r["cheque_number"]: r for r in data[:-1]}
	assert by_no["PACKRT-1001"]["days_to_due"] == "۱۰", by_no["PACKRT-1001"]
	assert by_no["PACKRT-1001"]["farda_status"] == "دریافتی"
	assert "معوق" in by_no["PACKRT-1002"]["days_to_due"], by_no["PACKRT-1002"]
	assert by_no["PACKRT-1002"]["farda_amount"] == "۵۰٬۰۰۰"  # 500,000 IRR = 50,000 Toman
	assert _p2i(data[-1]["farda_amount"]) == sum(_p2i(r["farda_amount"]) for r in data[:-1])
	# filter: only Received
	_, only_rec = fn({"company": company, "direction": "Received"})
	assert all(r["farda_direction"] == "دریافتی" for r in only_rec[:-1]), only_rec
	results.append("PASS: Cheque Report — days-to-due/معوق، Persian statuses, جمع + direction filter")

	# ---- Farda Party Balance ----
	fn = frappe.get_attr("erpnext.farda_iran.report.farda_party_balance.farda_party_balance.execute")
	columns, data = fn({"company": company})
	ar_rows = [r for r in data[:-3] if r["kind"] == "دریافتنی"]
	ap_rows = [r for r in data[:-3] if r["kind"] == "پرداختنی"]
	ar_row = next((r for r in ar_rows if r["party"] == customer.name), None)
	assert ar_row and ar_row["farda_outstanding"] == "۱۰۰٬۰۰۰", ar_row  # 1,000,000 IRR
	ap_row = next((r for r in ap_rows if r["party"] == supplier.name), None)
	assert ap_row and ap_row["farda_outstanding"] == "۸۸٬۰۰۰", ap_row  # 880,000 IRR
	summary = {r["kind"]: r for r in data[-3:]}
	assert _p2i(summary["جمع دریافتنی"]["farda_outstanding"]) >= 100_000
	assert _p2i(summary["خالص (دریافتنی − پرداختنی)"]["farda_outstanding"]) == (
		_p2i(summary["جمع دریافتنی"]["farda_outstanding"]) - _p2i(summary["جمع پرداختنی"]["farda_outstanding"])
	)
	results.append("PASS: Party Balance — AR/AP outstanding in Toman + خالص row consistent")

	# partial payment reduces AR
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	pe = get_payment_entry("Sales Invoice", si.name)
	pe.paid_amount = 400_000
	for r in pe.get("references"):
		r.allocated_amount = 400_000
	pe.insert()
	pe.submit()
	_, data2 = fn({"company": company})
	ar_row2 = next((r for r in data2[:-3] if r.get("party") == customer.name), None)
	assert ar_row2 and ar_row2["farda_outstanding"] == "۶۰٬۰۰۰", ar_row2  # 600,000 IRR left
	results.append("PASS: AR reflects real payment (۱٬۰۰۰٬۰۰۰ − ۴۰۰٬۰۰۰ = ۶۰۰٬۰۰۰ IRR → ۶۰٬۰۰۰ تومان)")

	frappe.db.rollback()
	return " | ".join(results)
