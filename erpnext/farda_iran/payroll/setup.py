"""Seed the payroll year and set a company up for Iranian payroll (CORE-036)."""

from __future__ import annotations

import frappe
from frappe import _

from . import engine

# (name, abbr, type, key, insurable, taxable)
COMPONENTS = [
	("حقوق پایه", "BASE", "Earning", "base", 1, 1),
	("پایه سنوات", "SEN", "Earning", "seniority", 1, 1),
	("حق مسکن", "HOUS", "Earning", "housing", 1, 1),
	("کمک‌هزینه اقلام مصرفی (بن)", "GROC", "Earning", "grocery", 1, 1),
	("حق تأهل", "MARR", "Earning", "marriage", 1, 1),
	("حق اولاد", "CHLD", "Earning", "child", 0, 1),
	("اضافه‌کاری", "OVT", "Earning", "overtime", 1, 1),
	("نوبت‌کاری شب", "NGT", "Earning", "night", 1, 1),
	("تعطیل‌کاری", "HOL", "Earning", "holiday", 1, 1),
	("بیمه سهم کارگر", "INS", "Deduction", "insurance", 0, 0),
	("مالیات حقوق", "TAX", "Deduction", "tax", 0, 0),
]

# account numbers in «ایران - کدینگ استاندارد فردا»
ACCOUNT_FOR_KEY = {"insurance": "210202", "tax": "210203"}
EARNING_ACCOUNT = "5201"
PAYABLE_ACCOUNT = "210201"
STRUCTURE = "حقوق کارگری (قانون کار)"


def ensure_year(year: int = 1405) -> str:
	"""Create the 1405 figures once (bakhshnameh 6682, 1405/01/31; budget law 1405)."""
	if frappe.db.exists("Farda Payroll Year", {"year": year}):
		return str(year)
	r = engine.Rates()
	doc = frappe.get_doc(
		{
			"doctype": "Farda Payroll Year",
			"year": year,
			"circular": "بخشنامه ۶۶۸۲ مورخ ۱۴۰۵/۰۱/۳۱ تأمین اجتماعی؛ مصوبه شورای عالی کار ۱۴۰۴/۱۲/۲۴؛ جدول مالیات حقوق قانون بودجه ۱۴۰۵",
			"min_daily_wage": r.min_daily_wage,
			"seniority_daily": r.seniority_daily,
			"child_days": r.child_days,
			"grocery": r.grocery,
			"housing": r.housing,
			"marriage": r.marriage,
			"hours_per_day": r.hours_per_day,
			"overtime_factor": r.overtime_factor,
			"night_extra": r.night_extra,
			"holiday_factor": r.holiday_factor,
			"insurance_employee": r.insurance_employee,
			"insurance_employer": r.insurance_employer,
			"unemployment": r.unemployment,
			"insurance_cap_multiple": r.insurance_cap_multiple,
			"tax_insurance_exempt": round(r.tax_insurance_exempt, 6),
			"eid_days": r.eid_days,
			"eid_cap_min_days": r.eid_cap_min_days,
			"tax_brackets": [{"upper_limit": u or 0, "rate": rate} for u, rate in r.tax_brackets],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _account(company: str, number: str) -> str | None:
	return frappe.db.get_value("Account", {"company": company, "account_number": number, "is_group": 0}, "name")


def ensure_components(company: str | None = None) -> None:
	for name, abbr, ctype, key, insurable, taxable in COMPONENTS:
		if frappe.db.exists("Salary Component", name):
			doc = frappe.get_doc("Salary Component", name)
		else:
			doc = frappe.new_doc("Salary Component")
			doc.salary_component = name
			doc.salary_component_abbr = abbr
			doc.type = ctype
		doc.farda_payroll_key = key
		doc.farda_insurable = insurable
		doc.farda_taxable = taxable
		doc.depends_on_payment_days = 0  # the Iranian engine prorates itself
		doc.is_tax_applicable = 0
		if company:
			number = ACCOUNT_FOR_KEY.get(key) or (EARNING_ACCOUNT if ctype == "Earning" else None)
			account = number and _account(company, number)
			if account and not any(a.company == company for a in doc.get("accounts") or []):
				doc.append("accounts", {"company": company, "account": account})
		doc.flags.ignore_permissions = True
		doc.save()


@frappe.whitelist()
def setup_company(company: str, year: int | None = None) -> str:
	frappe.only_for(("System Manager", "HR Manager"))
	ensure_year(int(year or 1405))
	ensure_components(company)

	ps = frappe.get_single("Payroll Settings")
	ps.include_holidays_in_total_working_days = 1  # Iranian wages are paid for every day of the month
	ps.flags.ignore_permissions = True
	ps.save()

	payable = _account(company, PAYABLE_ACCOUNT)
	if payable and not frappe.db.get_value("Company", company, "default_payroll_payable_account"):
		frappe.db.set_value("Company", company, "default_payroll_payable_account", payable)

	name = f"{STRUCTURE} - {frappe.get_cached_value('Company', company, 'abbr')}"
	created = False
	if not frappe.db.exists("Salary Structure", name):
		currency = frappe.get_cached_value("Company", company, "default_currency")
		doc = frappe.get_doc(
			{
				"doctype": "Salary Structure",
				"name": name,
				"__newname": name,
				"company": company,
				"currency": currency,
				"payroll_frequency": "Monthly",
				"is_active": "Yes",
				"earnings": [
					{"salary_component": c[0], "abbr": c[1], "amount": 0, "depends_on_payment_days": 0}
					for c in COMPONENTS
					if c[2] == "Earning"
				],
				"deductions": [
					{"salary_component": c[0], "abbr": c[1], "amount": 0, "depends_on_payment_days": 0}
					for c in COMPONENTS
					if c[2] == "Deduction"
				],
			}
		)
		doc.insert(ignore_permissions=True)
		doc.submit()
		created = True

	return _(
		"اجزای حقوق ایرانی، تنظیمات حقوق و ساختار «{0}» {1}.<br><br>"
		"قدم بعد برای هر کارمند: «تخصیص ساختار حقوق» با این ساختار بسازید و در فیلد <b>Base</b> "
		"<b>مزد روزانه</b> (ریال) را وارد کنید. تعداد فرزندان، پایه سنوات و بیمه‌شده بودن را در پرونده کارمند بخش «حقوق ایرانی» پر کنید."
	).format(name, _("ساخته شد") if created else _("از قبل وجود داشت"))
