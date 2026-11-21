# Copyright (c) 2026, FardaERP and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class FardaMoadianLog(Document):
	"""One submission (or prepared draft) of a Sales Invoice to سامانه مودیان.

	Holds only public data: the invoice JSON, taxid, uid and the system's answer.
	No key material is ever stored here.
	"""
