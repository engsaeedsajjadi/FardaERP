"""§11 Bank Account ↔ Iranian banking integration (validate hooks).

- `iban` (upstream field): normalize (digits/ZWNJ/space) → must be a valid
  Iranian IBAN → bank derived from the published registry:
    · `bank` empty  → get-or-create the Bank record by registry name and link it
    · `bank` filled → must MATCH the registry bank (integrity), else throw
- `farda_card_number` (custom): ISO Luhn + 16 digits (or empty).
All logic lives behind the central banking/validators services.
"""

from __future__ import annotations

import frappe


def _get_or_create_bank(bank_name: str) -> str:
	name = frappe.db.get_value("Bank", {"bank_name": bank_name}, "name")
	if name:
		return name
	return frappe.get_doc({"doctype": "Bank", "bank_name": bank_name}).insert(
		ignore_permissions=True
	).name


def validate_bank_account(doc, method: str | None = None) -> None:
	from erpnext.farda_iran.banking.service import iban_bank_info, is_valid_card_number
	from erpnext.farda_iran.utilities.normalization import to_english_digits
	from erpnext.farda_iran.utilities.validators import is_valid_iriban

	if doc.get("iban"):
		iban = to_english_digits(str(doc.iban)).replace(" ", "").replace("-", "").upper()
		doc.iban = iban
		if not is_valid_iriban(iban):
			frappe.throw(frappe._("شماره شبا واردشده معتبر نیست: {0}").format(iban), frappe.ValidationError)
		info = iban_bank_info(iban)
		registry_name = info.get("bank_name")
		if registry_name:
			if doc.get("bank"):
				bank_title = frappe.db.get_value("Bank", doc.bank, "bank_name") or str(doc.bank)
				if bank_title != registry_name:
					frappe.throw(
						frappe._("بانک انتخابی ({0}) با بانک شبا ({1}) هم‌خوانی ندارد").format(
							bank_title, registry_name
						),
						frappe.ValidationError,
					)
			else:
				doc.bank = _get_or_create_bank(registry_name)

	card = doc.get("farda_card_number")
	if card:
		card = to_english_digits(str(card)).replace(" ", "").replace("-", "")
		doc.farda_card_number = card
		if not is_valid_card_number(card):
			frappe.throw(frappe._("شماره کارت واردشده معتبر نیست."), frappe.ValidationError)
