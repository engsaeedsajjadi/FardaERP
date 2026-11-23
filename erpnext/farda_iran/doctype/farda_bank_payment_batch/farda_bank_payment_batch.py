# Copyright (c) 2026, FardaERP and contributors
# پرداخت گروهی بانکی — collect payees (salary slips or unpaid purchase
# invoices), check IBAN/amounts, build the bank's group-payment file and keep
# it as a private attachment. Money moves only when a person uploads the file
# in the bank's own internet banking.

import frappe
from frappe import _
from frappe.model.document import Document

FORMAT_KEYS = {"پایا گروهی (اکسل)": "paya_excel", "ملت — واریز گروهی (.PAY)": "mellat_pay"}


class FardaBankPaymentBatch(Document):
	def validate(self):
		from erpnext.farda_iran.banking.batch_formats import clean_iban

		if self.file_format == "ملت — واریز گروهی (.PAY)" and self.bank != "ملت":
			frappe.throw(_("قالب .PAY فقط برای بانک ملت است."))
		for r in self.rows:
			if r.iban:
				r.iban = clean_iban(r.iban)
		self.row_count = len(self.rows)
		self.total_amount = sum(int(round(r.amount or 0)) for r in self.rows)
		self._check_rows()
		if self.status == "فایل ساخته شد" and self.has_value_changed("total_amount"):
			self.status = "پیش‌نویس"  # rows changed after the file was built

	def _check_rows(self):
		from erpnext.farda_iran.banking.batch_formats import validate_rows

		fmt = FORMAT_KEYS.get(self.file_format, "paya_excel")
		for r in self.rows:
			p = validate_rows([r.as_dict()], fmt)
			r.problem = p[0].split(": ", 1)[-1] if p else ""

	@frappe.whitelist()
	def fetch_rows(self):
		self.check_permission("write")
		if self.status == "پرداخت شد":
			frappe.throw(_("این دستهٔ پرداخت بسته شده است."))
		self.set("rows", [])
		if self.source == "حقوق ماهانه":
			self._from_payroll()
		elif self.source == "فاکتورهای خرید پرداخت‌نشده":
			self._from_purchase_invoices()
		self.save()
		return {"count": self.row_count, "total": self.total_amount}

	def _from_payroll(self):
		if not self.payroll_entry:
			frappe.throw(_("«ثبت حقوق و دستمزد» را انتخاب کنید."))
		slips = frappe.get_all(
			"Salary Slip",
			filters={"payroll_entry": self.payroll_entry, "docstatus": 1},
			fields=["name", "employee", "employee_name", "net_pay", "base_net_pay"],
			order_by="employee_name",
		)
		if not slips:
			frappe.throw(_("برای این ثبت حقوق هیچ فیش ثبت‌نهایی‌شده‌ای پیدا نشد."))
		emp = {
			e.name: e
			for e in frappe.get_all(
				"Employee", filters={"name": ["in", [s.employee for s in slips]]}, fields=["name", "iban", "bank_ac_no"]
			)
		}
		for s in slips:
			e = emp.get(s.employee) or frappe._dict()
			self.append("rows", {
				"party_type": "Employee", "party": s.employee, "payee_name": s.employee_name,
				"iban": e.get("iban") or "", "account_no": e.get("bank_ac_no") or "",
				"amount": int(round(s.base_net_pay or s.net_pay or 0)),
				"description": self.description or _("حقوق"), "payment_id": "",
				"reference_doctype": "Salary Slip", "reference_name": s.name,
			})

	def _from_purchase_invoices(self):
		filters = {"company": self.company, "docstatus": 1, "outstanding_amount": [">", 0], "is_return": 0}
		if self.due_until:
			filters["due_date"] = ["<=", self.due_until]
		invs = frappe.get_all(
			"Purchase Invoice", filters=filters,
			fields=["name", "supplier", "supplier_name", "outstanding_amount", "bill_no"], order_by="due_date",
		)
		if not invs:
			frappe.throw(_("فاکتور خرید پرداخت‌نشده‌ای پیدا نشد."))
		ibans = dict(frappe.get_all("Supplier", filters={"name": ["in", list({i.supplier for i in invs})]}, fields=["name", "farda_iban"], as_list=True))
		for i in invs:
			self.append("rows", {
				"party_type": "Supplier", "party": i.supplier, "payee_name": i.supplier_name,
				"iban": ibans.get(i.supplier) or "", "amount": int(round(i.outstanding_amount or 0)),
				"description": self.description or _("بابت فاکتور {0}").format(i.bill_no or i.name),
				"payment_id": "", "reference_doctype": "Purchase Invoice", "reference_name": i.name,
			})

	@frappe.whitelist()
	def make_bank_file(self):
		from erpnext.farda_iran.banking.batch_formats import FORMATS, build_file
		from erpnext.farda_iran.jalali.service import format_jalali

		self.check_permission("write")
		fmt = FORMAT_KEYS.get(self.file_format, "paya_excel")
		rows = [r.as_dict() for r in self.rows]
		try:
			content = build_file(rows, fmt)
		except ValueError as e:
			frappe.throw(str(e).replace("\n", "<br>"), title=_("فایل ساخته نشد؛ این ردیف‌ها را اصلاح کنید"))
		stamp = format_jalali(self.posting_date, "{jy:04d}{jm:02d}{jd:02d}")
		fname = f"{self.name}-{stamp}.{FORMATS[fmt]['ext']}"
		f = frappe.get_doc({
			"doctype": "File", "file_name": fname, "attached_to_doctype": self.doctype,
			"attached_to_name": self.name, "attached_to_field": "bank_file", "is_private": 1, "content": content,
		}).insert(ignore_permissions=True)
		self.db_set({"bank_file": f.file_url, "status": "فایل ساخته شد"})
		return {"file_url": f.file_url, "file_name": fname}

	@frappe.whitelist()
	def mark_paid(self):
		self.check_permission("write")
		if self.status != "فایل ساخته شد":
			frappe.throw(_("اول فایل بانک را بسازید."))
		self.db_set("status", "پرداخت شد")
		self.add_comment("Info", _("پرداخت گروهی در بانک انجام و توسط {0} تأیید شد.").format(frappe.session.user))
