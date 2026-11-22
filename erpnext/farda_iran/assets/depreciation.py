"""Asset categories from the Article 149 depreciation table, straight-line,
monthly on Jalali month ends (CORE-037).

Useful lives follow the amended table (جدول استهلاکات موضوع ماده ۱۴۹، اصلاحیه
۱۳۹۸ با آخرین تغییرات). Each category stays editable: the accountant can change
the life or method in the Asset Category, and «زمین» is non-depreciable.
Assets cheaper than 10 % of the small-transaction threshold may be expensed in
the year of purchase (ماده ۱۲ جدول) — that is a booking choice, not automated.
"""

from __future__ import annotations

import frappe

# (category, account number, useful life in years or None = non-depreciable, table reference)
CATEGORIES = [
	("زمین", "120101", None, "غیرقابل استهلاک"),
	("ساختمان بتنی و اسکلت فلزی", "120102", 25, "گروه ۸ ردیف ۱-الف"),
	("ساختمان آجری و پیش‌ساخته", "120102", 15, "گروه ۸ ردیف ۱-ب"),
	("تأسیسات ساختمان (گرمایش، سرمایش، تهویه)", "120102", 10, "گروه ۷ الف ردیف ۲"),
	("ماشین‌آلات و تجهیزات صنعتی", "120103", 10, "گروه ۱۶"),
	("تجهیزات پزشکی", "120103", 8, "گروه ۱۸"),
	("وسایل نقلیه سواری، سنگین و نیمه‌سنگین", "120104", 6, "گروه ۱۳ ردیف ۴"),
	("تاکسی و وانت", "120104", 4, "گروه ۱۳ تبصره ۱"),
	("اثاثه و منصوبات اداری", "120105", 5, "گروه ۲۴ ردیف ۹"),
	("ماشین‌های اداری (کپی، کارت‌خوان، صندوق فروش)", "120106", 5, "گروه ۵ ردیف ۱"),
	("رایانه، سخت‌افزار و نرم‌افزار", "120106", 3, "گروه ۵ ردیف ۲"),
	("تلفن همراه", "120106", 5, "گروه ۱۰ ردیف ۲"),
]
ACCUMULATED = "120201"
EXPENSE = "5209"
CWIP = "120107"


def _acc(company: str, number: str):
	return frappe.db.get_value("Account", {"company": company, "account_number": number, "is_group": 0}, "name")


def ensure_categories(company: str) -> int:
	"""Create/extend the Iranian asset categories for a company on the Iranian chart."""
	if not frappe.db.exists("DocType", "Asset Category") or not _acc(company, ACCUMULATED):
		return 0
	count = 0
	for name, number, years, _ref in CATEGORIES:
		fixed = _acc(company, number)
		if not fixed:
			continue
		if frappe.db.exists("Asset Category", name):
			doc = frappe.get_doc("Asset Category", name)
		else:
			doc = frappe.new_doc("Asset Category")
			doc.asset_category_name = name
			doc.non_depreciable_category = 0 if years else 1
			if years:
				doc.append(
					"finance_books",
					{"depreciation_method": "Straight Line", "frequency_of_depreciation": 1, "total_number_of_depreciations": years * 12},
				)
		if not any(a.company_name == company for a in doc.get("accounts") or []):
			doc.append(
				"accounts",
				{
					"company_name": company,
					"fixed_asset_account": fixed,
					"accumulated_depreciation_account": _acc(company, ACCUMULATED) if years else None,
					"depreciation_expense_account": _acc(company, EXPENSE) if years else None,
					"capital_work_in_progress_account": _acc(company, CWIP),
				},
			)
			doc.flags.ignore_permissions = True
			doc.flags.ignore_mandatory = True
			doc.save()
			count += 1
	return count


def jalali_month_end(date_value):
	from erpnext.farda_iran.jalali.service import date_to_jalali, jalali_month_length, jalali_to_date

	jy, jm, _jd = date_to_jalali(date_value)
	return jalali_to_date(jy, jm, jalali_month_length(jy, jm))


def on_asset_validate(doc, method=None) -> None:
	"""Monthly depreciation posts on Jalali month ends: the first posting date
	defaults to the end of the Jalali month the asset was put to use."""
	if not doc.get("available_for_use_date") or doc.get("calculate_depreciation") in (0, None):
		return
	end = jalali_month_end(frappe.utils.getdate(doc.available_for_use_date))
	for fb in doc.get("finance_books") or []:
		if not fb.depreciation_start_date and frappe.utils.cint(fb.frequency_of_depreciation) == 1:
			fb.depreciation_start_date = end
