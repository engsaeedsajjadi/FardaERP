# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class FardaAuditLog(Document):
	"""Append-only audit record (§24).

	Rows are created exclusively by erpnext.farda_iran.audit.service (which sets
	the internal flag). Nobody — including Administrator through the ORM — may
	edit or delete a row; API create is already denied because the DocType has
	no `create` permission for any role.
	"""

	def validate(self):
		if self.is_new():
			if not self.flags.get("farda_audit_internal"):
				frappe.throw(
					frappe._("ثبت مستقیم در Farda Audit Log مجاز نیست (فقط سرویس ممیزی)"),
					frappe.PermissionError,
				)
			return
		frappe.throw(
			frappe._("رکوردهای Farda Audit Log قابل ویرایش نیستند (فقط‌افزودنی)"),
			frappe.ValidationError,
		)

	def on_trash(self):
		if not self.flags.get("farda_audit_internal"):
			frappe.throw(
				frappe._("حذف رکوردهای Farda Audit Log مجاز نیست (فقط‌افزودنی)"),
				frappe.PermissionError,
			)
