"""عیدی و پاداش + سنوات پایان خدمت به تفکیک کارمند برای یک سال شمسی (CORE-038).

Days worked = paid days on submitted salary slips in the year; when a year has
no slips yet (e.g. accruing mid-year) the calendar days employed are used and
the row says so. Wage = «Base» (daily wage) of the latest salary structure
assignment up to the year end.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, flt, getdate


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return columns(), rows(filters)


def columns():
	c = lambda f, l, t="Currency", w=140, **k: dict(fieldname=f, label=l, fieldtype=t, width=w, **k)  # noqa: E731
	return [
		c("employee", "کد پرسنلی", "Link", 120, options="Employee"),
		c("employee_name", "نام", "Data", 170),
		c("date_of_joining", "تاریخ شروع", "Date", 110),
		c("relieving_date", "تاریخ ترک کار", "Date", 110),
		c("days", "روزهای کارکرد سال", "Float", 110),
		c("days_source", "مبنای روزها", "Data", 120),
		c("daily_wage", "مزد روزانه"),
		c("eid", "عیدی و پاداش"),
		c("eid_exempt", "معاف از مالیات"),
		c("eid_taxable", "مشمول مالیات"),
		c("severance_year", "سنوات همین سال"),
		c("service_years", "سابقه (سال)", "Float", 90),
		c("severance_total", "سنوات کل تا پایان سال"),
	]


def rows(filters) -> list[dict]:
	from erpnext.farda_iran.jalali.service import jalali_to_date
	from erpnext.farda_iran.payroll import engine
	from erpnext.farda_iran.payroll.salary import rates_for

	if not frappe.db.exists("DocType", "Salary Slip"):
		frappe.throw(_("ماژول حقوق و دستمزد (HRMS) نصب نیست"))
	year = cint(filters.get("year"))
	start = getdate(jalali_to_date(year, 1, 1))
	end = add_days(getdate(jalali_to_date(year + 1, 1, 1)), -1)
	year_days = date_diff(end, start) + 1
	r = rates_for(end)
	if not r:
		frappe.throw(_("نرخ‌های سال {0} در «سال حقوق و دستمزد» ثبت نشده است").format(year))

	emp_filters = {"company": filters.company, "date_of_joining": ["<=", end]}
	employees = frappe.get_all(
		"Employee",
		filters=emp_filters,
		or_filters=[["relieving_date", "is", "not set"], ["relieving_date", ">=", start]],
		fields=["name", "employee_name", "date_of_joining", "relieving_date"],
		order_by="employee_name asc",
	)
	paid = dict(
		frappe.db.sql(
			"""select employee, sum(payment_days) from `tabSalary Slip`
			where docstatus = 1 and company = %s and start_date >= %s and end_date <= %s
			group by employee""",
			(filters.company, start, end),
		)
	)
	out = []
	for e in employees:
		ssa = frappe.get_all(
			"Salary Structure Assignment",
			filters={"employee": e.name, "docstatus": 1, "from_date": ["<=", end]},
			fields=["base"],
			order_by="from_date desc",
			limit=1,
		)
		wage = int(flt(ssa[0].base)) if ssa else 0
		last = min(getdate(e.relieving_date), end) if e.relieving_date else end
		first = max(getdate(e.date_of_joining), start)
		if e.name in paid:
			days, source = flt(paid[e.name]), _("فیش‌های حقوق")
		else:
			days, source = max(date_diff(last, first) + 1, 0), _("روزهای تقویمی")
		x = engine.eid(wage, days, r, year_days)
		service = max(date_diff(last, getdate(e.date_of_joining)) + 1, 0) / year_days
		out.append(
			{
				"employee": e.name, "employee_name": e.employee_name, "date_of_joining": e.date_of_joining,
				"relieving_date": e.relieving_date, "days": days, "days_source": source, "daily_wage": wage,
				"eid": x["amount"], "eid_exempt": x["tax_exempt"], "eid_taxable": x["taxable"],
				"severance_year": engine.severance(wage, days / year_days),
				"service_years": round(service, 2), "severance_total": engine.severance(wage, service),
			}
		)
	return out
