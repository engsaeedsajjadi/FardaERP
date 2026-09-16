"""FardaERP Iran — idempotent site setup (custom fields + VAT defaults).

Runs on `before_migrate` (hooks.py) and is safe to run manually:
    bench --site <site> execute erpnext.farda_iran.setup.install.execute
All changes are additive custom fields — no upstream schema is modified.
"""

from __future__ import annotations

import os

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

PARTY_FIELDS = [
	dict(
		fieldname="farda_person_type",
		label="نوع شخصیت",
		fieldtype="Select",
		options="\nحقیقی\nحقوقی",
		insert_after="tax_id",
	),
	dict(fieldname="farda_national_id", label="کد ملی", fieldtype="Data", insert_after="farda_person_type"),
	dict(fieldname="farda_legal_id", label="شناسه ملی", fieldtype="Data", insert_after="farda_national_id"),
	dict(fieldname="farda_economic_code", label="کد اقتصادی", fieldtype="Data", insert_after="farda_legal_id"),
	dict(fieldname="farda_postal_code", label="کد پستی", fieldtype="Data", insert_after="farda_economic_code"),
	dict(fieldname="farda_iban", label="شماره شبا", fieldtype="Data", insert_after="farda_postal_code"),
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_iban",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
	dict(
		fieldname="farda_vat_exempt",
		label="معاف از مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="farda_iban",
	),
]

COMPANY_FIELDS = [
	dict(
		fieldname="farda_person_type",
		label="نوع شخصیت",
		fieldtype="Select",
		options="\nحقیقی\nحقوقی",
		insert_after="tax_id",
	),
	dict(fieldname="farda_legal_id", label="شناسه ملی", fieldtype="Data", insert_after="farda_person_type"),
	dict(fieldname="farda_economic_code", label="کد اقتصادی", fieldtype="Data", insert_after="farda_legal_id"),
	dict(
		fieldname="farda_registration_number",
		label="شماره ثبت",
		fieldtype="Data",
		insert_after="farda_economic_code",
	),
	dict(fieldname="farda_postal_code", label="کد پستی", fieldtype="Data", insert_after="tax_id"),
]

PAYMENT_ENTRY_FIELDS = [
	dict(
		fieldname="farda_cheque",
		label="چک مرتبط",
		fieldtype="Link",
		options="Cheque",
		insert_after="reference_date",
	),
	dict(
		fieldname="farda_payment_authority",
		label="شناسه تراکنش درگاه",
		fieldtype="Data",
		insert_after="reference_date",
	),
]

BANK_ACCOUNT_FIELDS = [
	dict(
		fieldname="farda_card_number",
		label="شماره کارت",
		fieldtype="Data",
		insert_after="bank_account_no",
	),
]

INVOICE_FIELDS = [
	dict(
		fieldname="farda_apply_vat",
		label="اعمال مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="taxes_and_charges",
		default="0",
		print_hide=0,
	),
]

ITEM_FIELDS = [
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_iban",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
	dict(
		fieldname="farda_vat_exempt",
		label="معاف از مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="item_group",
		default="0",
		print_hide=0,
	),
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_vat_exempt",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
]


def ensure_custom_fields() -> None:
	custom_fields = {
		"Customer": PARTY_FIELDS,
		"Supplier": PARTY_FIELDS,
		"Company": COMPANY_FIELDS,
		"Item": ITEM_FIELDS,
		"Bank Account": BANK_ACCOUNT_FIELDS,
		"Sales Invoice": INVOICE_FIELDS,
		"Purchase Invoice": INVOICE_FIELDS,
		"Payment Entry": PAYMENT_ENTRY_FIELDS,
	}
	create_custom_fields(custom_fields, ignore_validate=True, update=True)


def ensure_search_keys() -> int:
	"""§10 fold-at-rest backfill: farda_search_key for rows created before the
	field existed. Idempotent; only touches rows with an empty key."""
	from erpnext.farda_iran.utilities.normalization import fold_for_search

	total = 0
	for doctype, name_field in (
		("Customer", "customer_name"),
		("Supplier", "supplier_name"),
		("Item", "item_name"),
	):
		if not frappe.db.exists("DocType", doctype):
			continue
		rows = frappe.get_all(
			doctype,
			filters={"farda_search_key": ["in", ("", None)]},
			fields=["name", name_field],
			limit=10000,
		)
		for r in rows:
			if r.get(name_field):
				frappe.db.set_value(
					doctype, r.name, "farda_search_key", fold_for_search(r[name_field]),
					update_modified=False,
				)
				total += 1
	return total


def ensure_vat_item_tax_templates() -> None:
	"""Standard Item Tax Templates owned by Farda (§8: tax templates).

	Created per company for the configured VAT account; rate kept in sync with
	Farda VAT Settings on every migrate. "Farda Exempt 0%" stays at rate 0.
	"""
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		return
	rate = frappe.db.get_single_value("Farda VAT Settings", "default_rate")
	account = frappe.db.get_single_value("Farda VAT Settings", "vat_account")
	if not account:
		return
	for company in frappe.get_all("Company", pluck="name"):
		if frappe.db.get_value("Account", account, "company") != company:
			continue
		for title, template_rate in (("Farda VAT", rate or 0), ("Farda Exempt 0%", 0)):
			name = frappe.db.exists("Item Tax Template", {"title": title, "company": company})
			if not name:
				frappe.get_doc({
					"doctype": "Item Tax Template",
					"title": title,
					"company": company,
					"taxes": [{"tax_type": account, "tax_rate": template_rate}],
				}).insert(ignore_permissions=True)
			else:
				tpl = frappe.get_doc("Item Tax Template", name)
				changed = False
				for d in tpl.taxes:
					if d.tax_type == account and d.tax_rate != template_rate:
						d.tax_rate = template_rate
						changed = True
				if not tpl.taxes:
					tpl.append("taxes", {"tax_type": account, "tax_rate": template_rate})
					changed = True
				if changed:
					tpl.save(ignore_permissions=True)




def ensure_dashboards() -> None:
	"""§18 real-data Number Cards + chart + Dashboard (idempotent, is_public).

	Cards aggregate REAL ERP documents via frappe's own machinery (Sum over
	Sales/Purchase Invoice / Bin). No demo numbers.
	"""
	cards = [
		("فروش کل", "Sales Invoice", "base_grand_total", [["docstatus", "=", 1]]),
		("خرید کل", "Purchase Invoice", "base_grand_total", [["docstatus", "=", 1]]),
		("دریافتنی", "Sales Invoice", "outstanding_amount", [["docstatus", "=", 1], ["outstanding_amount", ">", 0]]),
		("پرداختنی", "Purchase Invoice", "outstanding_amount", [["docstatus", "=", 1], ["outstanding_amount", ">", 0]]),
		("ارزش موجودی", "Bin", "stock_value", []),
	]
	created = []
	for label, doctype, based_on, filters in cards:
		if not frappe.db.exists("Number Card", label):
			frappe.get_doc({
				"doctype": "Number Card",
				"label": label,
				"type": "Document Type",
				"document_type": doctype,
				"function": "Sum",
				"aggregate_function_based_on": based_on,
				"filters_json": frappe.as_json(filters),
				"is_public": 1,
			}).insert(ignore_permissions=True)
			created.append(label)

	chart_name = "فروش ماهانه"
	if not frappe.db.exists("Dashboard Chart", chart_name):
		frappe.get_doc({
			"doctype": "Dashboard Chart",
			"chart_name": chart_name,
			"chart_type": "Sum",
			"document_type": "Sales Invoice",
			"based_on": "posting_date",
			"value_based_on": "base_grand_total",
			"group_by_type": "Sum",
			"time_interval": "Monthly",
			"timeseries": 1,
			"filters_json": frappe.as_json([["docstatus", "=", 1]]),
			"is_public": 1,
		}).insert(ignore_permissions=True)

	dash_name = "فردا — مدیریت"
	if not frappe.db.exists("Dashboard", dash_name):
		frappe.get_doc({
			"doctype": "Dashboard",
			"dashboard_name": dash_name,
			"module": "Farda Iran",
			"charts": [{"chart": chart_name}],
			"cards": [{"card": label} for label, *_ in cards],
		}).insert(ignore_permissions=True)


def get_item_tax_template_names(company: str) -> dict:
	"""Template names for a company (used by tests/reporting)."""
	out = {}
	for title, key in (("Farda VAT", "vat"), ("Farda Exempt 0%", "exempt")):
		out[key] = frappe.db.get_value("Item Tax Template", {"title": title, "company": company}, "name")
	return out


def ensure_vat_settings_defaults() -> None:
	"""Seed the VAT singleton with the default 10% rate (once)."""
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		return
	if not frappe.db.get_single_value("Farda VAT Settings", "default_rate"):
		frappe.db.set_single_value("Farda VAT Settings", "enabled", 1)
		frappe.db.set_single_value("Farda VAT Settings", "default_rate", 10.0)


def ensure_ui_assets() -> None:
	"""Copy client JS into sites/assets (no node build step required)."""
	import shutil

	public = frappe.get_app_path("erpnext", "farda_iran", "public")
	assets = os.path.join(frappe.local.sites_path, "assets", "erpnext", "farda_iran")
	for sub, fname in (("js", "farda_ui.js"), ("css", "farda_rtl.css")):
		os.makedirs(os.path.join(assets, sub), exist_ok=True)
		shutil.copy2(os.path.join(public, sub, fname), os.path.join(assets, sub, fname))


def ensure_audit_index() -> None:
	"""Composite index for audit lookups (subject filters + retention sweeps)."""
	try:
		frappe.db.add_index("Farda Audit Log", ["subject_doctype", "subject_name"])
	except Exception:
		frappe.log_error("farda_iran: audit index ensure failed")  # non-fatal


def ensure_flags() -> None:
	"""7 subsystem Check flags on System Settings (farda_enable_*, default ON)."""
	from erpnext.farda_iran.flags.service import ensure_flags as _ensure

	_ensure()


def before_migrate(**_kwargs) -> None:
	execute()


def execute() -> str:
	ensure_custom_fields()
	ensure_vat_settings_defaults()
	ensure_vat_item_tax_templates()
	ensure_search_keys()
	ensure_audit_index()
	ensure_flags()
	try:
		ensure_dashboards()
	except Exception:
		frappe.log_error("farda_iran: dashboard setup failed")  # non-fatal
	try:
		ensure_ui_assets()
	except Exception:
		frappe.log_error("farda_iran: UI asset copy failed")  # non-fatal outside a site
	frappe.clear_cache()
	return "farda_iran setup applied (custom fields + VAT defaults + UI assets)"
