"""E2E runtime tests for the Iranian Stock Balance report (Farda Stock
Balance): receipt → transfer → issue across two warehouses, Jalali last-move
label, Toman valuation, historical as-on date, filters, direct-SLE
cross-checks. Real data, rollback at the end.
"""

from __future__ import annotations

import datetime

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


def _stock_entry(purpose: str, rows: list[dict], company: str) -> str:
	return frappe.get_doc({
		"doctype": "Stock Entry",
		"stock_entry_type": purpose,
		"company": company,
		"items": rows,
	}).insert().submit().name


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	# self-seed the site baseline exactly like the gate-5 smoke does (fresh
	# PG sites have no company/currency/FY until provisioned)
	from erpnext.farda_iran.tests import gate5_smoke

	gate5_smoke.ensure_currency(gate5_smoke.Smoke())
	gate5_smoke.ensure_company(gate5_smoke.Smoke())
	gate5_smoke.ensure_fiscal_year(gate5_smoke.Smoke())
	company = gate5_smoke.COMPANY

	_ensure("Farda Stock Balance", "farda_stock_balance")

	wh_a = frappe.get_doc({
		"doctype": "Warehouse", "warehouse_name": "FardaST WH A", "company": company, "is_group": 0,
	}).insert().name
	wh_b = frappe.get_doc({
		"doctype": "Warehouse", "warehouse_name": "FardaST WH B", "company": company, "is_group": 0,
	}).insert().name
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "FardaST ITEM",
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_stock_item": 1,
	}).insert().name

	# ---- 1) Material Receipt: 10 units @ 1,000 IRR into WH A ----
	_stock_entry("Material Receipt", [
		{"item_code": item, "qty": 10, "basic_rate": 1000, "t_warehouse": wh_a},
	], company)

	sb = frappe.get_attr("erpnext.farda_iran.report.farda_stock_balance.farda_stock_balance.execute")
	columns, data = sb({"company": company, "warehouse": wh_a})
	assert [c["fieldname"] for c in columns] == [
		"item_code", "item_name", "warehouse", "item_group", "stock_uom",
		"farda_qty", "farda_value", "farda_last_move",
	], columns
	assert data and data[-1]["item_code"] == "جمع کل", data[-1:]
	row = next((r for r in data[:-1] if r["warehouse"] == wh_a), None)
	assert row, data
	assert abs(_p2f(row["farda_qty"]) - 10) < 1e-9, row
	# 10,000 IRR valuation → 1,000 Toman display
	assert abs(_p2f(row["farda_value"]) * 10 - 10_000) < 0.01, row
	assert row["farda_last_move"] and row["farda_last_move"] != row["farda_qty"], row  # jalali label present
	# scoped totals: fresh warehouse → totals are mine alone
	assert abs(_p2f(data[-1]["farda_qty"]) - 10) < 1e-9, data[-1]
	results.append("PASS: Stock Balance — receipt qty+valuation (Toman), Jalali last-move, scoped totals")

	# ---- 2) Material Transfer: 4 units A → B ----
	_stock_entry("Material Transfer", [
		{"item_code": item, "qty": 4, "basic_rate": 1000, "s_warehouse": wh_a, "t_warehouse": wh_b},
	], company)
	_, data = sb({"company": company, "warehouse": wh_b})
	row_b = next((r for r in data[:-1] if r["warehouse"] == wh_b), None)
	assert row_b and abs(_p2f(row_b["farda_qty"]) - 4) < 1e-9, (row_b, data)
	_, data_a = sb({"company": company, "warehouse": wh_a})
	row_a = next((r for r in data_a[:-1] if r["warehouse"] == wh_a), None)
	assert row_a and abs(_p2f(row_a["farda_qty"]) - 6) < 1e-9, (row_a, data_a)
	results.append("PASS: Stock Balance — transfer splits 6/4 across warehouses")

	# ---- 3) Material Issue: remaining 6 units out of WH A ----
	_stock_entry("Material Issue", [
		{"item_code": item, "qty": 6, "basic_rate": 1000, "s_warehouse": wh_a},
	], company)
	_, data_a = sb({"company": company, "warehouse": wh_a})
	assert not [r for r in data_a[:-1] if r["warehouse"] == wh_a], data_a  # zero row excluded
	results.append("PASS: Stock Balance — issued-out warehouse drops to zero (row excluded)")

	# ---- 4) direct SLE cross-check for WH B + valuation consistency ----
	direct = frappe.db.sql(
		"select sum(actual_qty), sum(stock_value_difference) from `tabStock Ledger Entry`"
		" where company=%(c)s and item_code=%(i)s and warehouse=%(w)s and coalesce(is_cancelled,0)=0",
		{"c": company, "i": item, "w": wh_b},
	)[0]
	assert abs(frappe.utils.flt(direct[0]) - 4) < 1e-9, direct
	assert abs(_p2f(row_b["farda_value"]) * 10 - frappe.utils.flt(direct[1])) < 0.01, (row_b, direct)
	results.append("PASS: Stock Balance — direct SLE cross-check (qty + stock value) for WH B")

	# ---- 5) historical as-on date excludes today's movements ----
	yesterday = (frappe.utils.getdate(frappe.utils.nowdate()) - datetime.timedelta(days=1)).isoformat()
	_, data_hist = sb({"company": company, "item_code": item, "as_on": yesterday})
	assert len(data_hist) == 1 and data_hist[0]["item_code"] == "جمع کل", data_hist
	assert _p2f(data_hist[0]["farda_qty"]) == 0, data_hist
	results.append("PASS: Stock Balance — historical as-on date excludes today's ledger entries")

	# ---- 6) item_group filter with a bogus group → no data rows ----
	_, data_g = sb({"company": company, "item_code": item, "item_group": "FardaST NOPE"})
	assert len(data_g) == 1 and data_g[0]["item_code"] == "جمع کل", data_g
	results.append("PASS: Stock Balance — item_group filter narrows correctly")

	# ---- 7) Farda Stock Movement (کاردکس): opening + rows + running balance ----
	_ensure("Farda Stock Movement", "farda_stock_movement")
	sm = frappe.get_attr("erpnext.farda_iran.report.farda_stock_movement.farda_stock_movement.execute")
	today = frappe.utils.nowdate()
	columns, data = sm({"company": company, "item_code": item, "from_date": today, "to_date": today})
	assert [c["fieldname"] for c in columns] == [
		"farda_date", "voucher_no", "voucher_type", "item_code", "warehouse",
		"farda_in", "farda_out", "farda_balance", "farda_rate", "farda_value",
	], columns
	assert data[0]["farda_date"] == "افتتاحیه" and _p2f(data[0]["farda_balance"]) == 0, data[0]
	ledger_rows = data[1:-1]
	assert len(ledger_rows) == 4, f"expected 4 SLE rows (receipt, transfer x2, issue), got {len(ledger_rows)}: {ledger_rows}"
	# running balance column consistent row by row
	run_bal = 0.0
	for r in ledger_rows:
		run_bal += _p2f(r["farda_in"]) - _p2f(r["farda_out"])
		assert abs(_p2f(r["farda_balance"]) - run_bal) < 1e-9, r
		assert r["farda_date"] and r["voucher_no"], r  # Jalali date + voucher link present
	# totals: in 14 (receipt 10 + transfer-in 4), out 10 (transfer-out 4 + issue 6), closing 4
	tot = data[-1]
	assert _p2f(tot["farda_in"]) == 14 and _p2f(tot["farda_out"]) == 10 and _p2f(tot["farda_balance"]) == 4, tot
	# transfer rows carry valuation: receipt value = 10,000 IRR → 1,000 Toman
	receipt_row = ledger_rows[0]
	assert abs(_p2f(receipt_row["farda_value"]) * 10 - 10_000) < 0.01, receipt_row
	# warehouse-scoped run: WH B only → single in-row of 4, closing 4
	_, data_b = sm({"company": company, "item_code": item, "from_date": today, "to_date": today, "warehouse": wh_b})
	assert len(data_b) == 3 and _p2f(data_b[-1]["farda_balance"]) == 4, data_b  # opening + 1 row + total
	results.append("PASS: Stock Movement — کاردکس opening/rows/running-balance, Jalali dates, Toman value, warehouse scope")

	frappe.db.rollback()
	return " | ".join(results)
