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
		self._validate_sayad()
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

	def _validate_sayad(self):
		"""چک صیادی (CORE-037): 16-digit ID; since 1400 a cheque must be registered
		in سامانه صیاد by the drawer and confirmed by the receiver to be payable."""
		if self.get("sayad_id"):
			sid = validators.normalize_national_id(self.sayad_id)
			if not (sid.isdigit() and len(sid) == 16):
				frappe.throw(frappe._("شناسه صیادی باید دقیقاً ۱۶ رقم باشد"))
			self.sayad_id = sid
		if self.get("sayad_receiver_id"):
			rid = validators.normalize_national_id(self.sayad_receiver_id)
			if not (rid.isdigit() and len(rid) in (10, 11)):
				frappe.throw(frappe._("کد ملی (۱۰ رقم) یا شناسه ملی (۱۱ رقم) گیرنده نادرست است"))
			self.sayad_receiver_id = rid
		if self.flags.ignore_sayad_warnings:
			return
		status = self.get("sayad_status") or "ثبت نشده"
		if self.direction == "Received" and self.status in ("Received", "Deposited") and status != "تأیید شده توسط گیرنده":
			frappe.msgprint(
				frappe._("این چک در سامانه صیاد «تأیید شده توسط گیرنده» نیست؛ چک ثبت‌نشده یا تأییدنشده قابل وصول نیست. پیش از تحویل گرفتن، ثبت و تأیید آن را در اپلیکیشن بانک بررسی کنید."),
				indicator="orange",
				alert=True,
			)
		if self.direction == "Issued" and status == "ثبت نشده":
			frappe.msgprint(
				frappe._("این چک صادره هنوز در سامانه صیاد ثبت نشده است؛ پیش از تحویل به گیرنده آن را در اپلیکیشن بانک ثبت کنید."),
				indicator="orange",
				alert=True,
			)
		if self.get("sayad_color") in ("قهوه‌ای", "قرمز"):
			frappe.msgprint(
				frappe._("وضعیت اعتباری صادرکننده {0} است؛ احتمال برگشت این چک بالاست.").format(self.sayad_color),
				indicator="red",
				alert=True,
			)

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
