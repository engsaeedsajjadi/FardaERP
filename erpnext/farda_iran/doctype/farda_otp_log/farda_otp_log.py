# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class FardaOTPLog(Document):
	def as_dict(self, *args, **kwargs):
		"""Never expose the code hash/salt to callers without write permission."""
		out = super().as_dict(*args, **kwargs)
		try:
			allowed = frappe.utils.has_permission(self.doctype, "write")
		except Exception:
			allowed = False
		if not allowed:
			for field in ("code_hash", "salt"):
				out.pop(field, None)
		return out
