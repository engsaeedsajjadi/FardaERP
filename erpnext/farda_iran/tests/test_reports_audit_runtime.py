"""E2E runtime audit for ALL thirteen Iranian reports (§17 evidence pack):
every allowlisted report is executed twice on real seeded data — once for a
populated result and once with an impossible filter (empty-state shape) —
plus a guest-permission probe on the farda.reports.run API (reports must be
blocked for guests). Rollback at the end. No demo data beyond what the
gate-5 smoke self-seeds.
"""

from __future__ import annotations

import frappe

REPORTS = (
	("farda_sales_register", "Sales Register"),
	("farda_purchase_register", "Purchase Register"),
	("farda_cheque_report", "Cheque Report"),
	("farda_party_balance", "Party Balance"),
	("farda_vat_report", "VAT Report"),
	("farda_general_ledger", "General Ledger"),
	("farda_trial_balance", "Trial Balance"),
	("farda_stock_balance", "Stock Balance"),
	("farda_stock_movement", "Stock Movement"),
	("farda_bank_report", "Bank Report"),
	("farda_cash_flow", "Cash Flow"),
	("farda_profit_and_loss", "Profit and Loss"),
	("farda_balance_sheet", "Balance Sheet"),
)


def _ensure(report: str) -> None:
	if frappe.db.exists("Report", report):
		return
	from frappe.modules.import_file import import_file_by_path
	import os

	path = os.path.join(frappe.get_module_path("Farda Iran"), "report", report, report + ".json")
	import_file_by_path(path, force=True)
	assert frappe.db.exists("Report", report), f"{report} failed to sync"


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	# seed the baseline + a full sales chain so reports have real data
	from erpnext.farda_iran.tests import gate5_smoke

	gate5_smoke.ensure_currency(gate5_smoke.Smoke())
	gate5_smoke.ensure_company(gate5_smoke.Smoke())
	gate5_smoke.ensure_fiscal_year(gate5_smoke.Smoke())
	s = gate5_smoke.Smoke()
	gate5_smoke.ensure_customer(s)
	gate5_smoke.ensure_item_and_price(s)
	gate5_smoke.sales_chain(s)  # SO -> DN -> SI -> PE
	company = gate5_smoke.COMPANY
	today = frappe.utils.nowdate()

	# the gate-5 chain ships without VAT — seed one VAT-carrying invoice so
	# the VAT report has real rows too (idempotent settings, rolled back)
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	_setup_vat_settings(company)
	vat_customer = frappe.get_doc({
		"doctype": "Customer", "customer_name": "Farda Audit VAT CUST",
		"customer_type": "Individual", "company": company,
	}).insert().name
	vat_item = frappe.get_doc({
		"doctype": "Item", "item_code": "FARDA-AUDIT ITEM",
		"item_group": frappe.db.get_value("Item Group", {}, "name"),
		"stock_uom": frappe.db.get_value("UOM", {}, "name"), "is_stock_item": 0,
	}).insert().name
	frappe.get_doc({
		"doctype": "Sales Invoice", "company": company, "customer": vat_customer,
		"currency": frappe.db.get_value("Company", company, "default_currency"),
		"conversion_rate": 1, "farda_apply_vat": 1,
		"posting_date": today, "set_posting_time": 1,
		"items": [{"item_code": vat_item, "qty": 1, "rate": 1_000_000}],
	}).insert().submit()

	for slug, label in REPORTS:
		_ensure(f"Farda {label}")  # Report doc names are Title Case
		mod = frappe.get_attr(
			f"erpnext.farda_iran.report.{slug}.{slug}.execute"
		)
		# populated run — must return (columns, rows) with rows; the cardex
		# requires an item filter by design (use the gate-5 stock item moved
		# by the chain's delivery note)
		populated = {"company": company, "from_date": today, "to_date": today}
		if slug == "farda_stock_movement":
			populated["item_code"] = "FARDA-SMOKE ITEM-001"
		columns, data = mod(populated)
		assert isinstance(columns, list) and columns, slug
		assert isinstance(data, list) and data, f"{slug}: no rows on seeded data"
		# empty-state run — impossible account/date combo must not raise
		filters = {"company": company, "from_date": "1990-01-01", "to_date": "1990-01-02"}
		if slug == "farda_stock_movement":
			filters = {"company": company, "item_code": "FARDA-NOPE", "from_date": today, "to_date": today}
		elif slug in ("farda_party_balance", "farda_vat_report", "farda_trial_balance",
					  "farda_stock_balance", "farda_general_ledger"):
			filters = {"company": company, "as_on": "1990-01-01"} if slug in ("farda_party_balance", "farda_stock_balance", "farda_balance_sheet") else filters
		_, empty = mod(filters)
		assert isinstance(empty, list), slug
		results.append(f"PASS: {label} — populated rows + empty-state OK")

	# guest must be blocked from the reports API (namespaced dispatcher)
	frappe.set_user("Guest")
	try:
		api = frappe.get_attr("erpnext.farda_iran.api.namespaces.reports")
		resp = api(action="run", report="farda_general_ledger", filters={"company": company})
		assert resp.get("ok") is False and resp["error"]["code"] == "FORBIDDEN", resp
	finally:
		frappe.set_user("Administrator")
	results.append("PASS: Reports API — guest blocked (authz enforced)")

	frappe.db.rollback()
	return " | ".join(results)
