# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class FardaPaymentLog(Document):
	"""Audit trail for online payment attempts (authority is the idempotency key)."""

	def validate(self):
		if self.amount_irr is None or int(self.amount_irr) <= 0:
			frappe.throw(_("مبلغ باید عددی مثبت باشد"), frappe.ValidationError)
