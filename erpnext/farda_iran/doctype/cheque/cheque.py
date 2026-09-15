# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from erpnext.farda_iran.currency import assert_integral_irr
from erpnext.farda_iran.utilities import validators

# Legal lifecycle: دریافت‌شده goes through Deposited; صدور‌شده clears directly.
TRANSITIONS = {
	"Received": {"Deposited", "Cancelled"},
	"Deposited": {"Cleared", "Returned"},
	"Returned": {"Deposited", "Cancelled"},
	"Issued": {"Cleared", "Returned", "Cancelled"},
	"Cleared": set(),
	"Cancelled": set(),
}


class Cheque(Document):
	def validate(self):
		self._validate_identifiers()
		self._validate_amount()
		self._validate_dates()
		self._validate_transition()

	def _validate_identifiers(self):
		if self.get("iban") and not validators.is_valid_iriban(self.iban):
			frappe.throw(frappe._(f"شماره شبا معتبر نیست: {self.iban}"))
		if self.get("account_number"):
			digits = validators.normalize_national_id(self.account_number)
			if not digits.isdigit() or len(digits) > 20:
				frappe.throw(frappe._("شماره حساب باید فقط رقم و حداکثر 20 رقم باشد"))

	def _validate_amount(self):
		try:
			assert_integral_irr(self.amount)
		except ValueError:
			frappe.throw(frappe._("مبلغ چک باید عدد صحیح ریال باشد"))

	def _validate_dates(self):
		if self.issue_date and self.due_date and self.due_date < self.issue_date:
			frappe.throw(frappe._("تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد"))

	def _validate_transition(self):
		if self.is_new():
			return
		old = frappe.db.get_value(self.doctype, self.name, "status")
		if old == self.status:
			return
		if self.status not in TRANSITIONS.get(old, set()):
			frappe.throw(
				frappe._(
					f"گذار وضعیت چک از «{old}» به «{self.status}» مجاز نیست. "
					f"گذارهای مجاز: {', '.join(sorted(TRANSITIONS.get(old, set())) or '—')}"
				)
			)


@frappe.whitelist()
def get_cheques_due_within_days(days: int = 7, company: str | None = None) -> list:
	"""Open cheques (not cleared/cancelled) due within N days — feeds reminders."""
	frappe.only_for(("System Manager", "Accounts Manager", "Accounts User"))
	filters = [
		["status", "in", ["Received", "Issued", "Deposited", "Returned"]],
		["due_date", "<=", frappe.utils.add_days(frappe.utils.nowdate(), int(days))],
	]
	if company:
		filters.append(["company", "=", company])
	return frappe.get_all(
		"Cheque",
		filters=filters,
		fields=["name", "cheque_number", "direction", "status", "party_type", "party", "amount", "due_date"],
		order_by="due_date asc",
	)
