"""Jinja helper for the Persian payslip print format (CORE-038)."""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt


def payslip_context(doc) -> dict:
	from erpnext.farda_iran.jalali.service import date_to_jalali

	from .reports import MONTHS

	jy, jm, _d = date_to_jalali(doc.end_date)
	emp = frappe.get_cached_doc("Employee", doc.employee)
	company = frappe.get_cached_doc("Company", doc.company)

	def items(rows):
		return [
			{"name": d.salary_component, "amount": int(flt(d.amount))}
			for d in rows or []
			if flt(d.amount) and not cint(d.get("do_not_include_in_total"))
		]

	return {
		"month": MONTHS[jm - 1],
		"year": jy,
		"company": company.company_name,
		"workshop_code": company.get("farda_sso_workshop_code") or "",
		"employee": {
			"code": emp.name,
			"name": doc.employee_name,
			"national_id": emp.get("farda_national_id") or "",
			"insurance_number": emp.get("farda_insurance_number") or "",
			"designation": doc.get("designation") or emp.get("designation") or "",
			"department": doc.get("department") or "",
			"iban": emp.get("iban") or "",
		},
		"days": flt(doc.payment_days),
		"overtime_hours": flt(doc.get("farda_overtime_hours")),
		"earnings": items(doc.earnings),
		"deductions": items(doc.deductions),
		"gross": int(flt(doc.gross_pay)),
		"total_deduction": int(flt(doc.total_deduction)),
		"net": int(flt(doc.net_pay)),
		"insurance_base": int(flt(doc.get("farda_insurance_base"))),
		"employer_insurance": int(flt(doc.get("farda_employer_insurance"))),
		"unemployment": int(flt(doc.get("farda_unemployment_insurance"))),
		"tax_base": int(flt(doc.get("farda_tax_base"))),
	}


def rial(amount) -> str:
	from erpnext.farda_iran.invoice.persian import fa

	return fa(f"{int(flt(amount)):,}").replace(",", "٬")
