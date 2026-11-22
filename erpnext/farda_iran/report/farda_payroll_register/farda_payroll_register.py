"""لیست حقوق ماهانه (CORE-036)."""

from frappe.utils import flt

from erpnext.farda_iran.payroll.reports import slips

ITEMS = [
	("base", "حقوق پایه"), ("seniority", "پایه سنوات"), ("housing", "حق مسکن"), ("grocery", "بن"),
	("marriage", "حق تأهل"), ("child", "حق اولاد"), ("overtime", "اضافه‌کاری"), ("night", "شب‌کاری"),
	("holiday", "تعطیل‌کاری"), ("other_earnings", "سایر مزایا"),
]
DEDUCT = [("insurance", "بیمه سهم کارگر"), ("tax", "مالیات حقوق"), ("other_deductions", "سایر کسور")]


def execute(filters=None):
	filters = filters or {}
	cur = {"fieldtype": "Currency", "options": "currency", "width": 120}
	columns = [
		{"fieldname": "employee", "label": "کارمند", "fieldtype": "Link", "options": "Employee", "width": 110},
		{"fieldname": "employee_name", "label": "نام", "fieldtype": "Data", "width": 160},
		{"fieldname": "national_id", "label": "کد ملی", "fieldtype": "Data", "width": 100},
		{"fieldname": "payment_days", "label": "روز کارکرد", "fieldtype": "Float", "width": 80},
	]
	columns += [dict(cur, fieldname=k, label=l) for k, l in ITEMS]
	columns += [dict(cur, fieldname="gross_pay", label="جمع حقوق و مزایا")]
	columns += [dict(cur, fieldname=k, label=l) for k, l in DEDUCT]
	columns += [
		dict(cur, fieldname="net_pay", label="خالص پرداختی"),
		dict(cur, fieldname="employer_insurance", label="بیمه سهم کارفرما"),
		dict(cur, fieldname="unemployment", label="بیمه بیکاری"),
		{"fieldname": "salary_slip", "label": "فیش", "fieldtype": "Link", "options": "Salary Slip", "width": 140},
	]
	data = []
	for s in slips(filters):
		row = {
			"employee": s["employee"], "employee_name": s["employee_name"],
			"national_id": s["_emp"].get("farda_national_id"), "payment_days": s["payment_days"],
			"gross_pay": s["gross_pay"], "net_pay": s["net_pay"], "salary_slip": s["name"],
			"employer_insurance": s.get("farda_employer_insurance"), "unemployment": s.get("farda_unemployment_insurance"),
			"currency": "IRR",
		}
		for k, _l in ITEMS + DEDUCT:
			row[k] = flt(s["_items"].get(k))
		data.append(row)
	return columns, data
