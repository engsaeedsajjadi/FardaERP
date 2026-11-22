"""لیست بیمه ماهانه تأمین اجتماعی — ستون‌ها مطابق فرم صورت مزد (CORE-036).

Shows exactly what goes into the monthly list: days, daily/monthly wage,
insurable benefits, insurable total (after the 7× ceiling) and the shares.
"""

import frappe
from frappe.utils import flt, getdate

from erpnext.farda_iran.payroll.reports import period, slips

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
	return columns, rows(filters)


def _jdate(value) -> str:
	if not value:
		return ""
	from erpnext.farda_iran.jalali.service import date_to_jalali

	y, m, d = date_to_jalali(getdate(value))
	return f"{y:04d}{m:02d}{d:02d}"


def rows(filters) -> list[dict]:
	start, end, _y, _m = period(filters)
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
				# fields only the SSO disk needs
				"id_number": e.get("farda_id_number"), "id_place": e.get("farda_id_place"),
				"birth_date": _jdate(e.get("date_of_birth")),
				"sex": {"Male": "مرد", "Female": "زن"}.get(e.get("gender"), ""),
				"job_title": e.get("designation") or "",
				"start_date": _jdate(e.get("date_of_joining")) if e.get("date_of_joining") and start <= getdate(e.get("date_of_joining")) <= end else "",
				"end_date": _jdate(e.get("relieving_date")) if e.get("relieving_date") and start <= getdate(e.get("relieving_date")) <= end else "",
			}
		)
	return data


@frappe.whitelist()
def download_disk(company: str, year: int, month: str, encoding: str | None = None):
	"""Zip with DSKKAR00.DBF + DSKWOR00.DBF for the SSO portal."""
	frappe.only_for(("System Manager", "HR Manager", "HR User", "Accounts Manager"))
	from erpnext.farda_iran.payroll import sso_disk

	c = frappe.get_doc("Company", company)
	code = (c.get("farda_sso_workshop_code") or "").strip()
	if not code:
		frappe.throw(frappe._("کد کارگاه تأمین اجتماعی در اطلاعات شرکت (بخش بیمه تأمین اجتماعی) وارد نشده است"))
	filters = frappe._dict(company=company, year=year, month=month)
	_start, _end, jy, jm = period(filters)
	data = rows(filters)
	if not data:
		frappe.throw(frappe._("برای این ماه فیش حقوق ثبت‌شده‌ای نیست"))
	content = sso_disk.build(
		{
			"code": code,
			"name": c.get("farda_sso_workshop_name") or c.company_name,
			"employer": c.get("farda_sso_employer_name") or "",
			"address": c.get("farda_sso_address") or "",
			"contract_row": c.get("farda_sso_contract_row") or "000",
		},
		jy,
		jm,
		data,
		encoding or c.get("farda_sso_encoding") or "Iran System",
	)
	frappe.response["filename"] = f"bimeh-{code}-{jy}-{jm:02d}.zip"
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"
