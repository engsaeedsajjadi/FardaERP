"""E2E runtime tests for the Iranian GL/Trial Balance presentation layer:
Farda General Ledger + Farda Trial Balance. Real SI → GL entries, rollback
at the end. No demo data, no core queries replaced.
"""

from __future__ import annotations

import frappe


def _p2f(s) -> float:
	return float(str(s).replace("٬", "").replace("-", "").translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")) or 0)


def _ensure(report: str, folder: str) -> None:
	if frappe.db.exists("Report", report):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(frappe.get_module_path("Farda Iran"), "report", folder, folder + ".json")
	import_file_by_path(path, force=True)
	if not frappe.db.exists("Report", report):
		raise AssertionError(f"{report} failed to sync")


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	_ensure("Farda General Ledger", "farda_general_ledger")
	_ensure("Farda Trial Balance", "farda_trial_balance")

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	customer = frappe.get_doc({
		"doctype": "Customer",
		"customer_name": "FardaGL CUST",
		"customer_type": "Individual",
	}).insert().name
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "FardaGL ITEM",
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 0,
	}).insert().name

	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings
	from erpnext.farda_iran.tax.service import get_settings

	if not get_settings().vat_account:
		_setup_vat_settings(company)

	# self-seed: fresh sites may lack an active Fiscal Year for the posting date
	_posting = frappe.utils.getdate(frappe.utils.nowdate())
	if not frappe.db.get_value(
		"Fiscal Year",
		{"disabled": 0, "year_start_date": ["<=", _posting], "year_end_date": [">=", _posting]},
		"name",
	):
		frappe.get_doc({
			"doctype": "Fiscal Year",
			"year": f"FardaGL FY{_posting.year}",
			"year_start_date": _posting.replace(month=1, day=1),
			"year_end_date": _posting.replace(month=12, day=31),
			"companies": [{"company": company}],
		}).insert()

	_currency = frappe.db.get_value("Company", company, "default_currency")
	if not frappe.db.exists("Price List", {"selling": 1}):
		frappe.get_doc({
			"doctype": "Price List",
			"price_list_name": "FardaGL Selling",
			"selling": 1,
			"buying": 0,
			"enabled": 1,
			"currency": _currency,
		}).insert()
	si = frappe.get_doc({
		"doctype": "Sales Invoice",
		"company": company,
		"customer": customer,
		"currency": _currency,
		"conversion_rate": 1,
		"farda_apply_vat": 1,
		"posting_date": frappe.utils.nowdate(),
		"selling_price_list": frappe.db.get_value("Price List", {"selling": 1}, "name"),
		"price_list_currency": _currency,
		"plc_conversion_rate": 1,
		"items": [{"item_code": item, "qty": 1, "rate": 1_000_000}],
	}).insert()
	si.submit()
	assert abs(si.grand_total - 1_100_000) < 0.01, si.grand_total  # 1,000,000 + VAT 10%

	to_date = frappe.utils.nowdate()
	from_date = frappe.utils.add_days(to_date, -30)

	# ---- Farda General Ledger ----
	gl = frappe.get_attr("erpnext.farda_iran.report.farda_general_ledger.farda_general_ledger.execute")
	columns, data = gl({
		"company": company,
		"party_type": "Customer",
		"party": customer,
		"from_date": from_date,
		"to_date": to_date,
	})
	rows = data[:-1]
	assert rows, "GL report returned no rows"
	assert any(r["voucher_no"] == si.name for r in rows), rows
	assert all("۱۴" in r["farda_date"] or "۰" in r["farda_date"] for r in rows), rows
	ar_acc = si.debit_to
	ar_row = next(r for r in rows if r["account"] == ar_acc)
	assert _p2f(ar_row["farda_debit"]) == 110_000, ar_row  # 1,100,000 IRR → 110,000 Toman
	assert _p2f(ar_row["farda_credit"]) == 0
	# running balance consistent with rows (filter-scoped)
	run_bal = 0.0
	for r in rows:
		run_bal += _p2f(r["farda_debit"]) - _p2f(r["farda_credit"])
		assert abs(_p2f(r["farda_balance"]) - run_bal) < 0.01, r
	# books balance company-wide: total debit == total credit (no party filter)
	_, all_data = gl({"company": company, "from_date": from_date, "to_date": to_date})
	tot = all_data[-1]
	assert tot["farda_date"] != "" and _p2f(tot["farda_debit"]) == _p2f(tot["farda_credit"]) > 0, tot
	# independent cross-check straight from GL Entry
	direct = frappe.db.sql(
		"select sum(debit) from `tabGL Entry` where company=%(c)s and party=%(p)s and coalesce(is_cancelled,0)=0",
		{"c": company, "p": customer},
	)[0][0]
	assert abs(frappe.utils.flt(direct) - 1_100_000) < 0.01, direct
	results.append("PASS: General Ledger — Jalali date, Toman Dr/Cr, running balance, balanced totals, direct-GL cross-check")

	# ---- Farda Trial Balance ----
	tb = frappe.get_attr("erpnext.farda_iran.report.farda_trial_balance.farda_trial_balance.execute")
	columns, data = tb({"company": company, "from_date": from_date, "to_date": to_date})
	assert data and data[-1]["account"] == "جمع کل", data[-1:]
	tb_ar = next((r for r in data[:-1] if r["account"] == ar_acc), None)
	assert tb_ar, data
	assert tb_ar["account_name"], tb_ar
	# account-wide period debit must match a direct GL sum (contamination-proof)
	direct_acc = frappe.utils.flt(frappe.db.sql(
		"select sum(debit) from `tabGL Entry` where company=%(c)s and account=%(a)s"
		" and posting_date >= %(f)s and posting_date <= %(t)s and coalesce(is_cancelled,0)=0",
		{"c": company, "a": ar_acc, "f": from_date, "t": to_date},
	)[0][0])
	assert abs(_p2f(tb_ar["farda_debit"]) * 10 - direct_acc) < 0.01, (tb_ar, direct_acc)  # Toman → IRR
	# closing = opening + dr - cr (Toman domain)
	assert abs((_p2f(tb_ar["farda_closing"]) + _p2f(tb_ar["farda_opening"]) * 0) - (
		_p2f(tb_ar["farda_opening"]) + _p2f(tb_ar["farda_debit"]) - _p2f(tb_ar["farda_credit"])
	)) < 0.01, tb_ar
	# books balance: total period debit == total credit
	tot = data[-1]
	assert _p2f(tot["farda_debit"]) == _p2f(tot["farda_credit"]) > 0, tot
	# root_type filter narrows rows
	_, asset_rows = tb({"company": company, "root_type": "Asset", "from_date": from_date, "to_date": to_date})
	assert asset_rows and all(
		frappe.db.get_value("Account", r["account"], "root_type") == "Asset"
		for r in asset_rows[:-1] if r.get("account")
	), asset_rows
	results.append("PASS: Trial Balance — per-account opening/period/closing self-consistent, totals balanced, root filter works")

	frappe.db.rollback()
	return " | ".join(results)
