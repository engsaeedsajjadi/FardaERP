# Copyright (c) 2026, FardaERP and contributors

import frappe
from frappe import _
from frappe.model.document import Document


class FardaPayrollYear(Document):
	"""Statutory payroll figures of one Jalali year (حداقل مزد، مزایا، بیمه، مالیات)."""

	def validate(self):
		if not 1390 <= int(self.year or 0) <= 1500:
			frappe.throw(_("سال باید شمسی باشد، مثلاً ۱۴۰۵"))
		rows = self.tax_brackets or []
		limits = [r.upper_limit for r in rows[:-1]]
		if any(not x for x in limits) or limits != sorted(limits):
			frappe.throw(_("سقف پله‌های مالیات باید صعودی باشد و فقط ردیف آخر بدون سقف بماند"))
