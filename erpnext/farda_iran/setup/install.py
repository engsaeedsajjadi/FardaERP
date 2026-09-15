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


def ensure_custom_fields() -> None:
	custom_fields = {
		"Customer": PARTY_FIELDS,
		"Supplier": PARTY_FIELDS,
		"Company": COMPANY_FIELDS,
		"Sales Invoice": INVOICE_FIELDS,
		"Purchase Invoice": INVOICE_FIELDS,
		"Payment Entry": PAYMENT_ENTRY_FIELDS,
	}
	create_custom_fields(custom_fields, ignore_validate=True, update=True)


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

	src = frappe.get_app_path("erpnext", "farda_iran", "public", "js", "farda_ui.js")
	assets = os.path.join(frappe.local.sites_path, "assets", "erpnext", "farda_iran", "js")
	os.makedirs(assets, exist_ok=True)
	shutil.copy2(src, os.path.join(assets, "farda_ui.js"))


def before_migrate(**_kwargs) -> None:
	execute()


def execute() -> str:
	ensure_custom_fields()
	ensure_vat_settings_defaults()
	try:
		ensure_ui_assets()
	except Exception:
		frappe.log_error("farda_iran: UI asset copy failed")  # non-fatal outside a site
	frappe.clear_cache()
	return "farda_iran setup applied (custom fields + VAT defaults + UI assets)"
