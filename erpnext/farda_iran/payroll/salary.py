"""HRMS glue: compute Iranian salary items on every Salary Slip (CORE-036).

Hooked through HRMS' `regional_overrides` for country «Iran» on
`SalarySlip.apply_regional_deductions`, which HRMS calls after the structure
components are evaluated and before net pay is finalised — so the slip, the
payroll entry preview and the accounting all see the same numbers.

Conventions (shown in the UI help texts):
- Salary Structure Assignment «Base» = مزد روزانه (daily wage, rial)
- Salary Components carry `farda_payroll_key` (base, housing, …, insurance, tax);
  components without a key are «other» items with their own insurable/taxable flags
"""

from __future__ import annotations

import frappe
from frappe.utils import cint, flt, getdate

from . import engine

KEY_EARNINGS = ("base", "seniority", "housing", "grocery", "marriage", "child", "overtime", "night", "holiday")
KEY_DEDUCTIONS = ("insurance", "tax")


def rates_for(end_date) -> engine.Rates | None:
	from erpnext.farda_iran.jalali.service import date_to_jalali

	year = date_to_jalali(getdate(end_date))[0]
	name = frappe.db.get_value("Farda Payroll Year", {"year": ["<=", year]}, "name", order_by="year desc")
	if not name:
		return None
	y = frappe.get_cached_doc("Farda Payroll Year", name)
	brackets = [(int(b.upper_limit) or None, flt(b.rate)) for b in y.tax_brackets]
	if brackets and brackets[-1][0] is not None:
		brackets.append((None, brackets[-1][1]))
	return engine.Rates(
		year=cint(y.year),
		min_daily_wage=int(y.min_daily_wage or 0),
		seniority_daily=int(y.seniority_daily or 0),
		grocery=int(y.grocery or 0),
		housing=int(y.housing or 0),
		marriage=int(y.marriage or 0),
		child_days=flt(y.child_days),
		insurance_employee=flt(y.insurance_employee),
		insurance_employer=flt(y.insurance_employer),
		unemployment=flt(y.unemployment),
		insurance_cap_multiple=flt(y.insurance_cap_multiple),
		hours_per_day=flt(y.hours_per_day) or 7.33,
		overtime_factor=flt(y.overtime_factor),
		night_extra=flt(y.night_extra),
		holiday_factor=flt(y.holiday_factor),
		tax_insurance_exempt=flt(y.tax_insurance_exempt),
		tax_brackets=brackets,
		eid_days=flt(y.eid_days),
		eid_cap_min_days=flt(y.eid_cap_min_days),
	)


def _component_keys() -> dict:
	rows = frappe.get_all(
		"Salary Component",
		fields=["name", "salary_component_abbr", "farda_payroll_key", "farda_insurable", "farda_taxable", "type"],
	)
	return {r.name: r for r in rows}


def _row(slip, parentfield: str, component: str, comps: dict):
	for d in slip.get(parentfield) or []:
		if d.salary_component == component:
			return d
	c = comps[component]
	return slip.append(
		parentfield,
		{"salary_component": component, "abbr": c.salary_component_abbr, "depends_on_payment_days": 0},
	)


def apply_regional_deductions(slip) -> None:
	"""Called by HRMS for companies whose country is Iran."""
	if not frappe.db.exists("DocType", "Farda Payroll Year") or not slip.salary_structure:
		return
	r = rates_for(slip.end_date)
	if not r:
		frappe.msgprint(
			frappe._("نرخ‌های حقوق برای سال این فیش در «سال‌های حقوق و دستمزد» ثبت نشده است؛ محاسبات ایرانی انجام نشد."),
			indicator="orange",
			alert=True,
		)
		return
	comps = _component_keys()
	by_key = {c.farda_payroll_key: name for name, c in comps.items() if c.farda_payroll_key}
	ssa = getattr(slip, "_salary_structure_assignment", None) or {}
	emp = frappe.get_cached_doc("Employee", slip.employee)

	other = []
	for d in slip.get("earnings") or []:
		c = comps.get(d.salary_component)
		if c and not c.farda_payroll_key and not d.do_not_include_in_total:
			amount = slip.get_amount_based_on_payment_days(d)[0]
			other.append((d.salary_component, flt(amount), cint(c.farda_insurable), cint(c.farda_taxable)))
	other_deductions = sum(
		flt(d.amount)
		for d in slip.get("deductions") or []
		if not (comps.get(d.salary_component) or {}).get("farda_payroll_key")
	)

	res = engine.compute(
		engine.Employee(
			daily_wage=int(flt(ssa.get("base"))),
			days=flt(slip.payment_days),
			month_days=cint(slip.total_working_days) or 30,
			seniority_daily=int(flt(emp.get("farda_seniority_daily"))),
			married=(emp.get("marital_status") == "Married"),
			children=cint(emp.get("farda_children_count")),
			overtime_hours=flt(slip.get("farda_overtime_hours")),
			night_hours=flt(slip.get("farda_night_hours")),
			holiday_hours=flt(slip.get("farda_holiday_hours")),
			other=other,
			other_deductions=int(other_deductions),
			insured=bool(cint(emp.get("farda_insured", 1))),
			housing=bool(cint(emp.get("farda_housing_allowance", 1))),
			grocery=bool(cint(emp.get("farda_grocery_allowance", 1))),
		),
		r,
	)
	amounts = {x["key"]: x["amount"] for x in res["lines"]}
	amounts["insurance"] = res["insurance_employee"]
	amounts["tax"] = res["tax"]

	missing = []
	for key in KEY_EARNINGS + KEY_DEDUCTIONS:
		component = by_key.get(key)
		value = amounts.get(key, 0)
		if not component:
			if value:
				missing.append(key)
			continue
		parentfield = "deductions" if key in KEY_DEDUCTIONS else "earnings"
		existing = next((d for d in slip.get(parentfield) or [] if d.salary_component == component), None)
		if not value and not existing:
			continue
		row = existing or _row(slip, parentfield, component, comps)
		row.amount = value
		row.default_amount = value
		row.depends_on_payment_days = 0
	if missing:
		frappe.msgprint(
			frappe._("اجزای حقوق ایرانی ساخته نشده‌اند؛ از «سال حقوق و دستمزد ← راه‌اندازی برای شرکت» استفاده کنید."),
			indicator="orange",
			alert=True,
		)

	slip.gross_pay = slip.get_component_totals("earnings", depends_on_payment_days=1)
	slip.base_gross_pay = flt(slip.gross_pay) * flt(slip.exchange_rate or 1)
	for field, value in (
		("farda_insurance_base", res["insurance_base"]),
		("farda_employer_insurance", res["insurance_employer"]),
		("farda_unemployment_insurance", res["unemployment"]),
		("farda_tax_base", res["taxable"]),
		("farda_payroll_year", r.year),
	):
		if slip.meta.has_field(field):
			slip.set(field, value)
