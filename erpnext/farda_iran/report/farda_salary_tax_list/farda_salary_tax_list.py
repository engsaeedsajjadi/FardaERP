"""لیست مالیات حقوق ماهانه (ماده ۸۶ ق.م.م) — CORE-036."""

from frappe.utils import flt

from erpnext.farda_iran.payroll.reports import slips


def execute(filters=None):
	filters = filters or {}
	cur = {"fieldtype": "Currency", "options": "currency", "width": 140}
	columns = [
		{"fieldname": "national_id", "label": "کد ملی", "fieldtype": "Data", "width": 110},
		{"fieldname": "employee_name", "label": "نام و نام خانوادگی", "fieldtype": "Data", "width": 180},
		{"fieldname": "days", "label": "روز کارکرد", "fieldtype": "Float", "width": 80},
		dict(cur, fieldname="gross", label="جمع حقوق و مزایای پرداختی"),
		dict(cur, fieldname="insurance_exempt", label="معافیت‌ها (۲/۷ بیمه سهم کارگر و اقلام معاف)"),
		dict(cur, fieldname="taxable", label="درآمد مشمول مالیات"),
		dict(cur, fieldname="tax", label="مالیات متعلق"),
	]
	data = []
	for s in slips(filters):
		taxable = flt(s.get("farda_tax_base"))
		data.append(
			{
				"national_id": s["_emp"].get("farda_national_id"), "employee_name": s["employee_name"],
				"days": s["payment_days"], "gross": flt(s["gross_pay"]),
				"insurance_exempt": max(flt(s["gross_pay"]) - taxable, 0), "taxable": taxable,
				"tax": flt(s["_items"].get("tax")), "currency": "IRR",
			}
		)
	return columns, data
