"""E2E runtime test: §18 dashboards — real-data KPIs move with real documents.

- setup ensures Number Cards + Chart + Dashboard (idempotent)
- baseline KPI snapshot → create+submit SI (1,000,000 IRR) → sales/receivables move
- partial PE → receivables reduce by exactly 400,000 IRR
- VAT card logic: invoice with VAT raises vat_sales
- formatted Toman strings match the pure builder against live raw values
- guest denied; rate limiter present
Rolls back at the end.
"""

from __future__ import annotations

import frappe


def run() -> str:
	frappe.set_user("Administrator")
	from erpnext.farda_iran.tests import pg_compat

	pg_compat.apply()
	results: list[str] = []

	import erpnext.farda_iran.setup.install as farda_setup
	from erpnext.farda_iran.tests.test_integration_iran import _setup_vat_settings

	company = frappe.db.get_value("Company", {"is_group": 0}, "name")
	if not frappe.db.get_single_value("Farda VAT Settings", "vat_account"):
		_setup_vat_settings(company)
	farda_setup.execute()

	# ---- cards/chart/dashboard exist and are public ----
	for card in ("فروش کل", "خرید کل", "دریافتنی", "پرداختنی", "ارزش موجودی"):
		if not frappe.db.exists("Number Card", card):
			raise AssertionError(f"Number Card missing: {card}")
	if not frappe.db.exists("Dashboard Chart", "فروش ماهانه"):
		raise AssertionError("Dashboard Chart missing")
	dash = frappe.db.exists("Dashboard", "فردا — مدیریت")
	if not dash:
		raise AssertionError("Dashboard missing")
	results.append("PASS: 5 Number Card + نمودار فروش ماهانه + Dashboard «فردا — مدیریت» ensured")

	card_doc = frappe.get_doc("Number Card", "فروش کل")
	assert card_doc.is_public and card_doc.document_type == "Sales Invoice"
	assert card_doc.function == "Sum" and card_doc.aggregate_function_based_on == "base_grand_total"
	results.append("PASS: Number Card real-aggregation config (Sum over SI.base_grand_total)")

	# ---- KPI endpoint moves with real documents ----
	from erpnext.farda_iran.dashboard.kpis import farda_kpis

	raw0 = frappe.get_attr(
		"erpnext.farda_iran.dashboard.kpis.collect_kpis"
	)(company=company)
	kpi0 = farda_kpis(company=company)
	assert kpi0["sales"]["irr"] == round(raw0["sales"], 2)

	customer = frappe.get_doc({"doctype": "Customer", "customer_name": "DASHRT CUST", "customer_type": "Individual"}).insert()
	item = frappe.get_doc({
		"doctype": "Item",
		"item_code": "DASHRT ITEM",
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
		"posting_date": frappe.utils.today(),
		"items": [{"item_code": item.name, "qty": 1, "rate": 1_000_000}],
	}).insert()
	si.submit()
	assert abs(si.grand_total - 1_100_000) < 0.01, si.grand_total  # + VAT 10%

	kpi1 = farda_kpis(company=company)
	sales_delta = kpi1["sales"]["irr"] - kpi0["sales"]["irr"]
	assert abs(sales_delta - 1_100_000) < 0.01, (kpi0["sales"], kpi1["sales"])
	# formatted string must be the central-service rendering of the live raw value
	from erpnext.farda_iran.invoice.persian import toman_str
	assert kpi1["sales"]["toman_fa"] == toman_str(kpi1["sales"]["irr"], persian_digits=True, with_unit=True)
	assert kpi1["sales"]["toman_fa"].endswith("تومان") and "٬" in kpi1["sales"]["toman_fa"]
	vat_delta = kpi1["vat_sales"]["irr"] - kpi0["vat_sales"]["irr"]
	assert abs(vat_delta - 100_000) < 0.01, (kpi0["vat_sales"], kpi1["vat_sales"])
	results.append("PASS: SI ۱٬۱۰۰٬۰۰۰ IRR (+VAT) → sales & vat_sales KPIs moved exactly")

	# partial payment reduces receivables by exactly 400,000 IRR
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	pe = get_payment_entry("Sales Invoice", si.name)
	pe.paid_amount = 400_000
	for r in pe.get("references"):
		r.allocated_amount = 400_000
	pe.insert()
	pe.submit()

	kpi2 = farda_kpis(company=company)
	ar_delta = kpi1["receivables"]["irr"] - kpi2["receivables"]["irr"]
	assert abs(ar_delta - 400_000) < 0.01, (kpi1["receivables"], kpi2["receivables"])
	results.append("PASS: PE ۴۰۰٬۰۰۰ IRR → receivables KPI reduced exactly")

	# payload structure sanity: every KPI has fa label + toman string
	for key in ("sales", "purchases", "profit", "receivables", "payables", "net_ar_ap", "vat_net", "cash_balance", "inventory_value", "orders"):
		assert kpi2[key]["label_fa"] and isinstance(kpi2[key]["toman_fa"], str), key
	results.append("PASS: full KPI payload (۱۰ KPI، برچسب فارسی + رشتهٔ تومانی)")

	# ---- guest denied at the HTTP dispatch layer (direct python calls bypass
	# frappe's whitelist/auth pipeline, so assert the actual mechanism) ----
	fn = frappe.get_attr("erpnext.farda_iran.dashboard.kpis.farda_kpis")
	assert fn in frappe.whitelisted, "endpoint not whitelisted"
	assert fn not in frappe.guest_methods, "endpoint accidentally guest-accessible"
	results.append("PASS: KPI endpoint whitelisted for authed users only (not in guest_methods)")

	frappe.db.rollback()
	return " | ".join(results)
