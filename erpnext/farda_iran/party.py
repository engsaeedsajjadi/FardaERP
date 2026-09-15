"""FardaERP Iranian party (Company/Customer/Supplier) validation hooks.

doc_events validate → these handlers. Every check is a no-op when the
corresponding custom field is empty, so vanilla upstream flows are untouched.
Persian, user-friendly error messages (§59: no tracebacks in UI).
"""

from __future__ import annotations

import frappe
from .utilities import validators


def _check(doc, fieldname: str, valid_fn, label_fa: str) -> None:
	value = doc.get(fieldname)
	if value and not valid_fn(value):
		frappe.throw(
			frappe._(f"{label_fa} واردشده معتبر نیست: {value}")
		)


def validate(doc, method: str | None = None) -> None:
	"""Customer / Supplier."""
	_check(doc, "farda_national_id", validators.is_valid_national_id, "کد ملی")
	_check(doc, "farda_legal_id", validators.is_valid_legal_national_id, "شناسه ملی")
	_check(doc, "farda_economic_code", validators.is_valid_economic_code, "کد اقتصادی")
	_check(doc, "farda_postal_code", validators.is_valid_postal_code, "کد پستی")
	_check(doc, "farda_iban", validators.is_valid_iriban, "شماره شبا")


def validate_company(doc, method: str | None = None) -> None:
	"""Company."""
	_check(doc, "farda_legal_id", validators.is_valid_legal_national_id, "شناسه ملی")
	_check(doc, "farda_economic_code", validators.is_valid_economic_code, "کد اقتصادی")
	_check(doc, "farda_postal_code", validators.is_valid_postal_code, "کد پستی")
	_check(doc, "farda_registration_number", validators.is_valid_economic_code, "شماره ثبت")
