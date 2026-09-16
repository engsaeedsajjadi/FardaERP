"""Whitelisted Iranian banking API (§11): IBAN → bank resolution for UI/API.

Login required, rate-limited, no PII (an IBAN supplied by the caller is only
checked against the public registry — nothing is stored).
"""

from __future__ import annotations

import frappe

from erpnext.farda_iran.api.limiter import is_allowed
from erpnext.farda_iran.utilities.normalization import to_english_digits


@frappe.whitelist(methods=["GET", "POST"])
def resolve_iban(iban: str) -> dict:
	if not is_allowed("banking", frappe.session.user, 120, 60):
		frappe.throw(
			frappe._("تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید."),
			frappe.RateLimitExceededError,
		)
	from erpnext.farda_iran.banking.service import iban_bank_info
	from erpnext.farda_iran.utilities.validators import is_valid_iriban

	iban = to_english_digits(str(iban or "")).replace(" ", "").replace("-", "").upper()
	if not is_valid_iriban(iban):
		return {"valid": False, "iban": iban}
	info = iban_bank_info(iban)
	return {
		"valid": True,
		"iban": iban,
		"bank_code": info.get("bank_code"),
		"bank_name": info.get("bank_name"),
	}
