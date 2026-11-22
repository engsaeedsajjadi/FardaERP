# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class FardaAssistantSettings(Document):
	def validate(self):
		if self.use_ai:
			url = (self.api_base_url or "").strip()
			if not url.startswith(("http://", "https://")):
				frappe.throw(_("آدرس سرویس باید با http:// یا https:// شروع شود."))
			self.api_base_url = url.rstrip("/")
			self.model = (self.model or "").strip()
		if self.timeout and not (5 <= self.timeout <= 120):
			frappe.throw(_("زمان انتظار باید بین ۵ تا ۱۲۰ ثانیه باشد."))
