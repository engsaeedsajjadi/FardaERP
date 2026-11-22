"""لیست بیمه ماهانه تأمین اجتماعی — ستون‌ها مطابق فرم صورت مزد (CORE-036).

Shows exactly what goes into the monthly list: days, daily/monthly wage,
insurable benefits, insurable total (after the 7× ceiling) and the shares.
"""

from frappe.utils import flt

from erpnext.farda_iran.payroll.reports import slips

WAGE_KEYS = ("base", "seniority")
INSURABLE_BENEFITS = ("housing", "grocery", "marriage", "overtime", "night", "holiday")


def execute(filters=None):
	filters = filters or {}
	cur = {"fieldtype": "Currency", "options": "currency", "width": 125}
	columns = [
		{"fieldname": "insurance_number", "label": "شماره بیمه", "fieldtype": "Data", "width": 110},
		{"fieldname": "first_name", "label": "نام", "fieldtype": "Data", "width": 100},
		{"fieldname": "last_name", "label": "نام خانوادگی", "fieldtype": "Data", "width": 120},
		{"fieldname": "father_name", "label": "نام پدر", "fieldtype": "Data", "width": 90},
		{"fieldname": "national_id", "label": "کد ملی", "fieldtype": "Data", "width": 100},
		{"fieldname": "job_code", "label": "کد شغل", "fieldtype": "Data", "width": 80},
		{"fieldname": "days", "label": "روزهای کارکرد", "fieldtype": "Float", "width": 80},
		dict(cur, fieldname="daily_wage", label="دستمزد روزانه"),
		dict(cur, fieldname="monthly_wage", label="دستمزد ماهانه"),
		dict(cur, fieldname="benefits", label="مزایای ماهانه مشمول"),
		dict(cur, fieldname="insurable", label="جمع دستمزد و مزایای مشمول"),
		dict(cur, fieldname="total", label="جمع کل دستمزد و مزایا (مشمول و غیرمشمول)"),
		dict(cur, fieldname="employee_share", label="حق بیمه سهم بیمه‌شده"),
		dict(cur, fieldname="employer_share", label="حق بیمه سهم کارفرما"),
		dict(cur, fieldname="unemployment", label="بیمه بیکاری"),
	]
	data = []
	for s in slips(filters):
		e, it = s["_emp"], s["_items"]
		monthly = sum(flt(it.get(k)) for k in WAGE_KEYS)
		days = flt(s["payment_days"])
		data.append(
			{
				"insurance_number": e.get("farda_insurance_number"),
				"first_name": e.get("first_name"), "last_name": e.get("last_name"),
				"father_name": e.get("farda_father_name"), "national_id": e.get("farda_national_id"),
				"job_code": e.get("farda_job_code"), "days": days,
				"daily_wage": round(monthly / days) if days else 0,
				"monthly_wage": monthly,
				"benefits": sum(flt(it.get(k)) for k in INSURABLE_BENEFITS) + flt(s.get("other_insurable")),
				"insurable": flt(s.get("farda_insurance_base")),
				"total": flt(s["gross_pay"]),
				"employee_share": flt(it.get("insurance")),
				"employer_share": flt(s.get("farda_employer_insurance")),
				"unemployment": flt(s.get("farda_unemployment_insurance")),
				"currency": "IRR",
			}
		)
	return columns, data
