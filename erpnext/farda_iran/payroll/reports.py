"""Shared data for the payroll reports (لیست حقوق، لیست بیمه، لیست مالیات حقوق)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt

MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]


def period(filters) -> tuple:
	from erpnext.farda_iran.jalali.service import jalali_month_length, jalali_to_date, jalali_today

	jy, jm, _d = jalali_today()
	year = cint(filters.get("year")) or jy
	month = filters.get("month")
	month = MONTHS.index(month) + 1 if month in MONTHS else (cint(month) or jm)
	return jalali_to_date(year, month, 1), jalali_to_date(year, month, jalali_month_length(year, month)), year, month


def slips(filters) -> list[dict]:
	if not frappe.db.exists("DocType", "Salary Slip"):
		frappe.throw(_("ماژول حقوق و دستمزد (HRMS) نصب نیست"))
	start, end, _y, _m = period(filters)
	cond = {"docstatus": 1, "start_date": [">=", start], "end_date": ["<=", end]}
	if filters.get("company"):
		cond["company"] = filters["company"]
	rows = frappe.get_all(
		"Salary Slip",
		filters=cond,
		fields=[
			"name", "employee", "employee_name", "payment_days", "total_working_days", "gross_pay",
			"total_deduction", "net_pay", "farda_insurance_base", "farda_employer_insurance",
			"farda_unemployment_insurance", "farda_tax_base",
		],
		order_by="employee_name asc",
	)
	if not rows:
		return []
	keys = dict(frappe.get_all("Salary Component", fields=["name", "farda_payroll_key"], as_list=True))
	flags = {c.name: c for c in frappe.get_all("Salary Component", fields=["name", "farda_insurable", "farda_taxable"])}
	details = frappe.get_all(
		"Salary Detail",
		filters={"parenttype": "Salary Slip", "parent": ["in", [r.name for r in rows]]},
		fields=["parent", "parentfield", "salary_component", "amount"],
	)
	emp = {
		e.name: e
		for e in frappe.get_all(
			"Employee",
			filters={"name": ["in", list({r.employee for r in rows})]},
			fields=["name", "first_name", "last_name", "farda_national_id", "farda_father_name",
				"farda_insurance_number", "farda_job_code", "date_of_birth", "gender", "date_of_joining", "relieving_date",
				"designation", "farda_id_number", "farda_id_place"],
		)
	}
	by_slip = {r.name: dict(r) for r in rows}
	for r in by_slip.values():
		r.update(_emp=emp.get(r["employee"]) or frappe._dict(), _items={}, other_insurable=0, other_taxable=0)
	for d in details:
		slip = by_slip[d.parent]
		key = keys.get(d.salary_component) or ("other_" + d.parentfield)
		slip["_items"][key] = slip["_items"].get(key, 0) + flt(d.amount)
		if not keys.get(d.salary_component) and d.parentfield == "earnings":
			f = flags.get(d.salary_component) or {}
			if f.get("farda_insurable"):
				slip["other_insurable"] += flt(d.amount)
	return list(by_slip.values())


def filters_js_note() -> str:
	return ""
