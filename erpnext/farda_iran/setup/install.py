"""FardaERP Iran — idempotent site setup (custom fields + VAT defaults).

Runs on `before_migrate` (hooks.py) and is safe to run manually:
    bench --site <site> execute erpnext.farda_iran.setup.install.execute
All changes are additive custom fields — no upstream schema is modified.
"""

from __future__ import annotations

import os

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

PARTY_FIELDS = [
	dict(
		fieldname="farda_person_type",
		label="نوع شخصیت",
		fieldtype="Select",
		options="\nحقیقی\nحقوقی\nمشارکت مدنی\nاتباع غیرایرانی",
		description="برای صورتحساب سامانه مودیان لازم است. اتباع غیرایرانی: کد فراگیر را در «کد ملی» وارد کنید.",
		insert_after="tax_id",
	),
	dict(fieldname="farda_national_id", label="کد ملی", fieldtype="Data", insert_after="farda_person_type"),
	dict(fieldname="farda_legal_id", label="شناسه ملی", fieldtype="Data", insert_after="farda_national_id"),
	dict(fieldname="farda_economic_code", label="کد اقتصادی", fieldtype="Data", insert_after="farda_legal_id"),
	dict(fieldname="farda_postal_code", label="کد پستی", fieldtype="Data", insert_after="farda_economic_code"),
	dict(fieldname="farda_iban", label="شماره شبا", fieldtype="Data", insert_after="farda_postal_code"),
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_iban",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
	dict(
		fieldname="farda_vat_exempt",
		label="معاف از مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="farda_iban",
	),
]

COMPANY_FIELDS = [
	dict(
		fieldname="farda_person_type",
		label="نوع شخصیت",
		fieldtype="Select",
		options="\nحقیقی\nحقوقی",
		insert_after="tax_id",
	),
	dict(fieldname="farda_legal_id", label="شناسه ملی", fieldtype="Data", insert_after="farda_person_type"),
	dict(fieldname="farda_economic_code", label="کد اقتصادی", fieldtype="Data", insert_after="farda_legal_id"),
	dict(
		fieldname="farda_registration_number",
		label="شماره ثبت",
		fieldtype="Data",
		insert_after="farda_economic_code",
	),
	dict(fieldname="farda_postal_code", label="کد پستی", fieldtype="Data", insert_after="tax_id"),
]

PAYMENT_ENTRY_FIELDS = [
	dict(
		fieldname="farda_cheque",
		label="چک مرتبط",
		fieldtype="Link",
		options="Cheque",
		insert_after="reference_date",
	),
	dict(
		fieldname="farda_payment_authority",
		label="شناسه تراکنش درگاه",
		fieldtype="Data",
		insert_after="reference_date",
	),
]

BANK_ACCOUNT_FIELDS = [
	dict(
		fieldname="farda_card_number",
		label="شماره کارت",
		fieldtype="Data",
		insert_after="bank_account_no",
	),
]

INVOICE_FIELDS = [
	dict(
		fieldname="farda_apply_vat",
		label="اعمال مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="taxes_and_charges",
		default="0",
		print_hide=0,
	),
]

ITEM_FIELDS = [
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_iban",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
	dict(
		fieldname="farda_vat_exempt",
		label="معاف از مالیات بر ارزش افزوده",
		fieldtype="Check",
		insert_after="item_group",
		default="0",
		print_hide=0,
	),
	dict(
		fieldname="farda_search_key",
		label="کلید جستجو",
		fieldtype="Data",
		insert_after="farda_vat_exempt",
		hidden=1,
		print_hide=1,
		read_only=1,
	),
]


# CORE-034 — سامانه مودیان
MOADIAN_ITEM_FIELDS = [
	dict(
		fieldname="farda_sstid",
		label="شناسه کالا/خدمت سامانه مودیان",
		fieldtype="Data",
		length=13,
		insert_after="farda_vat_exempt",
		description="شناسه ۱۳ رقمی از stuffid.tax.gov.ir؛ نرخ مالیات آن باید با نرخ فاکتور یکی باشد.",
	),
	dict(
		fieldname="farda_moadian_unit",
		label="کد واحد اندازه‌گیری (مودیان)",
		fieldtype="Data",
		insert_after="farda_sstid",
		description="اختیاری؛ کد عددی واحد از فهرست رسمی واحدها.",
	),
]

def _p(*codes) -> str:
	"""depends_on for «pattern is one of codes» (value looks like '7 - صادرات')."""
	return "eval:[" + ",".join(str(c) for c in codes) + "].includes(parseInt(doc.farda_moadian_pattern))"


def _pp(*codes) -> str:
	"""Same, evaluated on an item row (parent = the invoice)."""
	return "eval:[" + ",".join(str(c) for c in codes) + "].includes(parseInt(parent.farda_moadian_pattern))"


_PATTERN_OPTIONS = "\n" + "\n".join(
	f"{k} - {v}"
	for k, v in {
		1: "فروش", 2: "فروش ارز", 3: "طلا، جواهر و پلاتین", 4: "قرارداد پیمانکاری", 5: "قبوض خدماتی",
		6: "بلیط هواپیما", 7: "صادرات", 8: "بارنامه", 9: "فروش فرآورده‌های نفتی", 11: "بورس کالا",
		13: "خدمات بیمه‌ای", 14: "فروش زنجیره",
	}.items()
)


def _md(fieldname, label, fieldtype="Data", after=None, **kw):
	d = dict(fieldname=f"farda_md_{fieldname}", label=label, fieldtype=fieldtype, allow_on_submit=1, print_hide=1)
	if after:
		d["insert_after"] = after
	d.update(kw)
	return d


MOADIAN_INVOICE_FIELDS = [
	dict(fieldname="farda_moadian_info_section", label="اطلاعات سامانه مودیان", fieldtype="Section Break", insert_after="outstanding_amount", collapsible=1),
	dict(
		fieldname="farda_moadian_pattern", label="الگوی صورتحساب (نوع کسب‌وکار)", fieldtype="Select", options=_PATTERN_OPTIONS,
		insert_after="farda_moadian_info_section", print_hide=1,
		description="از «تنظیمات سامانه مودیان» پر می‌شود. الگو روی محاسبه مالیات اثر دارد (طلا، صادرات، …).",
	),
	dict(
		fieldname="farda_moadian_invoice_type", label="نوع صورتحساب مودیان", fieldtype="Select",
		options="\n1 - نوع اول (با اطلاعات خریدار)\n2 - نوع دوم (بدون الزام اطلاعات خریدار)",
		insert_after="farda_moadian_pattern", print_hide=1, allow_on_submit=1,
		description="خالی = طبق تنظیمات. نوع دوم فقط برای فروش، طلا، فرآورده نفتی و بیمه.",
	),
	dict(fieldname="farda_moadian_cb1", fieldtype="Column Break", insert_after="farda_moadian_invoice_type"),
	_md("crn", "شماره قرارداد پیمانکاری (۱۲ رقمی، ثبت‌شده در کارپوشه)", after="farda_moadian_cb1", depends_on=_p(4), mandatory_depends_on=_p(4)),
	_md("billid", "شماره اشتراک / شناسه قبض", after="farda_md_crn", depends_on=_p(5), mandatory_depends_on=_p(5)),
	_md("ft", "نوع پرواز", "Select", after="farda_md_billid", options="\n1 - داخلی\n2 - خارجی", depends_on=_p(6), mandatory_depends_on=_p(6)),
	_md("tinc", "شماره اقتصادی آژانس فروشنده بلیط", after="farda_md_ft", depends_on=_p(6)),
	_md("bpn", "شماره گذرنامه خریدار", after="farda_md_tinc", depends_on=_p(2, 6, 7)),
	_md("scc", "کد گمرک محل اظهار", after="farda_md_bpn", depends_on=_p(7)),
	_md("cdcn", "شماره کوتاژ اظهارنامه گمرکی", after="farda_md_scc", depends_on=_p(7)),
	_md("cdcd", "تاریخ کوتاژ", "Date", after="farda_md_cdcn", depends_on=_p(7)),
	_md("asn", "شماره اعلامیه فروش بورس", after="farda_md_cdcd", depends_on=_p(11), mandatory_depends_on=_p(11)),
	_md("asd", "تاریخ اعلامیه فروش بورس", "Date", after="farda_md_asn", depends_on=_p(11), mandatory_depends_on=_p(11)),
	_md("in", "شناسه یکتای بیمه‌نامه", after="farda_md_asd", depends_on=_p(13), mandatory_depends_on=_p(13)),
	_md("an", "شناسه یکتای الحاقیه", after="farda_md_in", depends_on=_p(13)),
	# waybill (بارنامه)
	_md("lno", "شماره بارنامه", after="farda_md_an", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("lrno", "شماره بارنامه مرجع", after="farda_md_lno", depends_on=_p(8)),
	_md("lt", "نوع حمل", "Select", after="farda_md_lrno", options="\n1 - جاده‌ای\n2 - ریلی\n3 - هوایی\n4 - دریایی", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("cno", "شماره ناوگان (پلاک/قطار/پرواز/کشتی)", after="farda_md_lt", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("did", "کد ملی راننده", after="farda_md_cno", depends_on=_p(8)),
	_md("ocu", "کد کشور مبدأ (ایران: 364)", after="farda_md_did", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("oci", "کد شهر مبدأ", after="farda_md_ocu", depends_on=_p(8)),
	_md("dco", "کد کشور مقصد (ایران: 364)", after="farda_md_oci", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("dci", "کد شهر مقصد", after="farda_md_dco", depends_on=_p(8)),
	_md("tid", "شناسه/کد ملی فرستنده", after="farda_md_dci", depends_on=_p(8), mandatory_depends_on=_p(8)),
	_md("rid", "شناسه/کد ملی گیرنده", after="farda_md_tid", depends_on=_p(8)),
	_md("carried_goods", "کالاهای حمل‌شده", "Table", after="farda_md_rid", options="Farda Moadian Carried Goods", depends_on=_p(8)),
	# status (filled by the system)
	dict(fieldname="farda_moadian_section", label="وضعیت در سامانه مودیان", fieldtype="Section Break", insert_after="farda_md_carried_goods", collapsible=1, depends_on="eval:doc.docstatus>0 && doc.farda_moadian_log"),
	dict(fieldname="farda_moadian_status", label="وضعیت در سامانه مودیان", fieldtype="Data", read_only=1, allow_on_submit=1, no_copy=1, insert_after="farda_moadian_section"),
	dict(fieldname="farda_moadian_taxid", label="شماره منحصر به فرد مالیاتی", fieldtype="Data", read_only=1, allow_on_submit=1, no_copy=1, insert_after="farda_moadian_status", print_hide=0),
	dict(fieldname="farda_moadian_cb", fieldtype="Column Break", insert_after="farda_moadian_taxid"),
	dict(fieldname="farda_moadian_reference", label="شماره مرجع سامانه", fieldtype="Data", read_only=1, allow_on_submit=1, no_copy=1, insert_after="farda_moadian_cb"),
	dict(fieldname="farda_moadian_log", label="آخرین سابقه ارسال", fieldtype="Link", options="Farda Moadian Log", read_only=1, allow_on_submit=1, no_copy=1, insert_after="farda_moadian_reference"),
]

# Sales Invoice Item: values only some patterns need (gold, currency, export, levies…)
_ROW = dict(print_hide=1)
_RIAL = "Company:company:default_currency"
MOADIAN_INVOICE_ITEM_FIELDS = [
	dict(fieldname="farda_md_item_section", label="سامانه مودیان", fieldtype="Section Break", insert_after="item_tax_template", collapsible=1),
	dict(fieldname="farda_md_consfee", label="اجرت ساخت (ریال، کل ردیف)", fieldtype="Currency", options=_RIAL, insert_after="farda_md_item_section", depends_on=_pp(3), mandatory_depends_on=_pp(3), description="نرخ ردیف = قیمت کل هر واحد، شامل اجرت و سود و حق‌العمل", **_ROW),
	dict(fieldname="farda_md_spro", label="سود فروشنده (ریال، کل ردیف)", fieldtype="Currency", options=_RIAL, insert_after="farda_md_consfee", depends_on=_pp(3), **_ROW),
	dict(fieldname="farda_md_bros", label="حق‌العمل (ریال، کل ردیف)", fieldtype="Currency", options=_RIAL, insert_after="farda_md_spro", depends_on=_pp(3), **_ROW),
	dict(fieldname="farda_md_cui", label="عیار", fieldtype="Float", insert_after="farda_md_bros", depends_on=_pp(3), **_ROW),
	dict(fieldname="farda_md_cut", label="کد ارز (مثلاً USD)", fieldtype="Data", length=3, insert_after="farda_md_cui", depends_on="eval:parseInt(parent.farda_moadian_pattern)==2 || (parseInt(parent.farda_moadian_pattern)==7 && parent.currency=='IRR')", mandatory_depends_on=_pp(2), **_ROW),
	dict(fieldname="farda_md_cpr", label="نرخ خرید ارز (ریال)", fieldtype="Float", insert_after="farda_md_cut", depends_on=_pp(2), mandatory_depends_on=_pp(2), description="مقدار = مبلغ ارز؛ نرخ ردیف = نرخ فروش هر واحد ارز", **_ROW),
	dict(fieldname="farda_md_sovat", label="مأخذ مالیات فروش ارز (ریال)", fieldtype="Currency", options=_RIAL, insert_after="farda_md_cpr", depends_on=_pp(2), description="خالی = مقدار × (نرخ فروش − نرخ خرید)", **_ROW),
	dict(fieldname="farda_md_nw", label="وزن خالص (کیلوگرم)", fieldtype="Float", insert_after="farda_md_sovat", depends_on=_pp(7), **_ROW),
	dict(fieldname="farda_md_sscv", label="ارزش ارزی ردیف", fieldtype="Float", insert_after="farda_md_nw", depends_on="eval:parseInt(parent.farda_moadian_pattern)==7 && parent.currency=='IRR'", description="فقط وقتی ارز فاکتور ریال است", **_ROW),
	dict(fieldname="farda_md_vba", label="مبلغ پایه مالیات هر لیتر", fieldtype="Float", insert_after="farda_md_sscv", depends_on=_pp(9), **_ROW),
	dict(fieldname="farda_md_cb", fieldtype="Column Break", insert_after="farda_md_vba"),
	dict(fieldname="farda_md_odt", label="موضوع سایر مالیات و عوارض", fieldtype="Data", insert_after="farda_md_cb", **_ROW),
	dict(fieldname="farda_md_odr", label="نرخ سایر مالیات و عوارض (٪)", fieldtype="Percent", insert_after="farda_md_odt", **_ROW),
	dict(fieldname="farda_md_olt", label="موضوع سایر وجوه قانونی", fieldtype="Data", insert_after="farda_md_odr", **_ROW),
	dict(fieldname="farda_md_olr", label="نرخ سایر وجوه قانونی (٪)", fieldtype="Percent", insert_after="farda_md_olt", **_ROW),
]


# CORE-036 — حقوق و دستمزد ایرانی (HRMS)
PAYROLL_EMPLOYEE_FIELDS = [
	dict(fieldname="farda_payroll_section", label="حقوق و دستمزد ایرانی", fieldtype="Section Break", insert_after="iban", collapsible=0),
	dict(fieldname="farda_national_id", label="کد ملی", fieldtype="Data", length=10, insert_after="farda_payroll_section"),
	dict(fieldname="farda_father_name", label="نام پدر", fieldtype="Data", insert_after="farda_national_id"),
	dict(fieldname="farda_id_number", label="شماره شناسنامه", fieldtype="Data", insert_after="farda_father_name"),
	dict(fieldname="farda_id_place", label="محل صدور شناسنامه", fieldtype="Data", insert_after="farda_id_number"),
	dict(fieldname="farda_insurance_number", label="شماره بیمه تأمین اجتماعی", fieldtype="Data", insert_after="farda_id_place"),
	dict(fieldname="farda_job_code", label="کد شغل (بیمه)", fieldtype="Data", insert_after="farda_insurance_number"),
	dict(fieldname="farda_payroll_cb", fieldtype="Column Break", insert_after="farda_job_code"),
	dict(fieldname="farda_children_count", label="تعداد فرزندان (مشمول حق اولاد)", fieldtype="Int", insert_after="farda_payroll_cb"),
	dict(fieldname="farda_seniority_daily", label="پایه سنوات روزانه (ریال)", fieldtype="Currency", options="IRR", insert_after="farda_children_count", description="جمع پایه‌های سنواتی که تا امروز به مزد روزانه اضافه شده است"),
	dict(fieldname="farda_insured", label="بیمه‌شده تأمین اجتماعی", fieldtype="Check", default="1", insert_after="farda_seniority_daily"),
	dict(fieldname="farda_housing_allowance", label="حق مسکن می‌گیرد", fieldtype="Check", default="1", insert_after="farda_insured"),
	dict(fieldname="farda_grocery_allowance", label="کمک‌هزینه اقلام مصرفی (بن) می‌گیرد", fieldtype="Check", default="1", insert_after="farda_housing_allowance"),
]

PAYROLL_COMPANY_FIELDS = [
	dict(fieldname="farda_sso_workshop_code", label="کد کارگاه تأمین اجتماعی", fieldtype="Data", length=10, insert_after="farda_registration_number", description="برای دیسکت لیست بیمه"),
	dict(fieldname="farda_sso_workshop_name", label="نام کارگاه", fieldtype="Data", insert_after="farda_sso_workshop_code"),
	dict(fieldname="farda_sso_employer_name", label="نام کارفرما", fieldtype="Data", insert_after="farda_sso_workshop_name"),
	dict(fieldname="farda_sso_address", label="نشانی کارگاه", fieldtype="Data", insert_after="farda_sso_employer_name"),
	dict(fieldname="farda_sso_contract_row", label="ردیف پیمان", fieldtype="Data", length=3, default="000", insert_after="farda_sso_address"),
	dict(fieldname="farda_sso_encoding", label="کدگذاری متن فارسی دیسکت", fieldtype="Select", options="Iran System\nWindows-1256", default="Iran System", insert_after="farda_sso_contract_row"),
]

PAYROLL_COMPONENT_FIELDS = [
	dict(
		fieldname="farda_payroll_key", label="قلم حقوق ایرانی", fieldtype="Select", insert_after="salary_component_abbr", read_only=1,
		options="\nbase\nseniority\nhousing\ngrocery\nmarriage\nchild\novertime\nnight\nholiday\ninsurance\ntax",
		description="برای اقلام قانونی که فردا خودکار حساب می‌کند",
	),
	dict(fieldname="farda_insurable", label="مشمول بیمه تأمین اجتماعی", fieldtype="Check", default="1", insert_after="farda_payroll_key"),
	dict(fieldname="farda_taxable", label="مشمول مالیات حقوق", fieldtype="Check", default="1", insert_after="farda_insurable"),
]

PAYROLL_SLIP_FIELDS = [
	dict(fieldname="farda_hours_section", label="کارکرد ساعتی (ایران)", fieldtype="Section Break", insert_after="payment_days"),
	dict(fieldname="farda_overtime_hours", label="ساعات اضافه‌کاری", fieldtype="Float", insert_after="farda_hours_section"),
	dict(fieldname="farda_night_hours", label="ساعات شب‌کاری", fieldtype="Float", insert_after="farda_overtime_hours"),
	dict(fieldname="farda_holiday_hours", label="ساعات تعطیل‌کاری", fieldtype="Float", insert_after="farda_night_hours"),
	dict(fieldname="farda_statutory_section", label="بیمه و مالیات (ایران)", fieldtype="Section Break", insert_after="net_pay"),
	dict(fieldname="farda_insurance_base", label="دستمزد مشمول بیمه", fieldtype="Currency", options="currency", read_only=1, insert_after="farda_statutory_section"),
	dict(fieldname="farda_employer_insurance", label="بیمه سهم کارفرما (۲۰٪)", fieldtype="Currency", options="currency", read_only=1, insert_after="farda_insurance_base"),
	dict(fieldname="farda_unemployment_insurance", label="بیمه بیکاری (۳٪)", fieldtype="Currency", options="currency", read_only=1, insert_after="farda_employer_insurance"),
	dict(fieldname="farda_statutory_cb", fieldtype="Column Break", insert_after="farda_unemployment_insurance"),
	dict(fieldname="farda_tax_base", label="درآمد مشمول مالیات", fieldtype="Currency", options="currency", read_only=1, insert_after="farda_statutory_cb"),
	dict(fieldname="farda_payroll_year", label="سال نرخ‌ها", fieldtype="Int", read_only=1, insert_after="farda_tax_base"),
]


def ensure_moadian_defaults() -> None:
	"""Fill only missing settings, sandbox-safe; never overwrite the user's choices."""
	if not frappe.db.exists("DocType", "Farda Moadian Settings"):
		return
	# before_migrate runs before new DocType fields are synced: skip unknown fields,
	# after_migrate fills them.
	meta = frappe.get_meta("Farda Moadian Settings", cached=False)
	for field, value in (
		("enabled", 1),
		("auto_inquiry", 1),
		("default_invoice_type", "نوع اول (با اطلاعات خریدار)"),
		("default_pattern", "1 - فروش"),
		("last_serial", 0),
	):
		if not meta.has_field(field):
			continue
		if frappe.db.get_single_value("Farda Moadian Settings", field) in (None, ""):
			frappe.db.set_single_value("Farda Moadian Settings", field, value)


def ensure_levies_accounts() -> None:
	"""Iranian-chart companies get «سایر مالیات‌ها و عوارض» (210303) next to VAT."""
	for parent in frappe.get_all("Account", filters={"account_number": "2103", "is_group": 1}, fields=["name", "company"]):
		if frappe.db.exists("Account", {"company": parent.company, "account_number": "210303"}):
			continue
		try:
			frappe.get_doc(
				dict(
					doctype="Account",
					account_name="سایر مالیات‌ها و عوارض",
					account_number="210303",
					parent_account=parent.name,
					company=parent.company,
					account_type="Tax",
					is_group=0,
				)
			).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(f"farda_iran: levies account for {parent.company}")


def ensure_custom_fields() -> None:
	custom_fields = {
		"Customer": PARTY_FIELDS,
		"Supplier": PARTY_FIELDS,
		"Company": COMPANY_FIELDS + PAYROLL_COMPANY_FIELDS,
		"Item": ITEM_FIELDS + MOADIAN_ITEM_FIELDS,
		"Bank Account": BANK_ACCOUNT_FIELDS,
		"Sales Invoice": INVOICE_FIELDS + MOADIAN_INVOICE_FIELDS,
		"Sales Invoice Item": MOADIAN_INVOICE_ITEM_FIELDS,
		"Purchase Invoice": INVOICE_FIELDS,
		"Payment Entry": PAYMENT_ENTRY_FIELDS,
		"Employee": PAYROLL_EMPLOYEE_FIELDS,
		"Salary Component": PAYROLL_COMPONENT_FIELDS,  # HRMS
		"Salary Slip": PAYROLL_SLIP_FIELDS,  # HRMS
	}
	# HRMS may not be installed yet (bench new-site installs erpnext first)
	custom_fields = {dt: f for dt, f in custom_fields.items() if frappe.db.exists("DocType", dt)}
	# a Table/Link to one of our DocTypes waits until migrate has created that DocType
	for doctype, fields in custom_fields.items():
		custom_fields[doctype] = [
			f
			for f in fields
			if not (
				f.get("fieldtype") in ("Table", "Link")
				and str(f.get("options") or "").startswith("Farda ")
				and not frappe.db.exists("DocType", f["options"])
			)
		]
	create_custom_fields(custom_fields, ignore_validate=True, update=True)


def ensure_search_keys() -> int:
	"""§10 fold-at-rest backfill: farda_search_key for rows created before the
	field existed. Idempotent; only touches rows with an empty key."""
	from erpnext.farda_iran.utilities.normalization import fold_for_search

	total = 0
	for doctype, name_field in (
		("Customer", "customer_name"),
		("Supplier", "supplier_name"),
		("Item", "item_name"),
	):
		if not frappe.db.exists("DocType", doctype):
			continue
		rows = frappe.get_all(
			doctype,
			filters={"farda_search_key": ["in", ("", None)]},
			fields=["name", name_field],
			limit=10000,
		)
		for r in rows:
			if r.get(name_field):
				frappe.db.set_value(
					doctype, r.name, "farda_search_key", fold_for_search(r[name_field]),
					update_modified=False,
				)
				total += 1
	return total


def ensure_vat_item_tax_templates() -> None:
	"""Standard Item Tax Templates owned by Farda (§8: tax templates).

	Created per company for the configured VAT account; rate kept in sync with
	Farda VAT Settings on every migrate. "Farda Exempt 0%" stays at rate 0.
	"""
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		return
	rate = frappe.db.get_single_value("Farda VAT Settings", "default_rate")
	account = frappe.db.get_single_value("Farda VAT Settings", "vat_account")
	if not account:
		return
	for company in frappe.get_all("Company", pluck="name"):
		if frappe.db.get_value("Account", account, "company") != company:
			continue
		for title, template_rate in (("Farda VAT", rate or 0), ("Farda Exempt 0%", 0)):
			name = frappe.db.exists("Item Tax Template", {"title": title, "company": company})
			if not name:
				frappe.get_doc({
					"doctype": "Item Tax Template",
					"title": title,
					"company": company,
					"taxes": [{"tax_type": account, "tax_rate": template_rate}],
				}).insert(ignore_permissions=True)
			else:
				tpl = frappe.get_doc("Item Tax Template", name)
				changed = False
				for d in tpl.taxes:
					if d.tax_type == account and d.tax_rate != template_rate:
						d.tax_rate = template_rate
						changed = True
				if not tpl.taxes:
					tpl.append("taxes", {"tax_type": account, "tax_rate": template_rate})
					changed = True
				if changed:
					tpl.save(ignore_permissions=True)




def ensure_dashboards() -> None:
	"""§18 real-data Number Cards + chart + Dashboard (idempotent, is_public).

	Cards aggregate REAL ERP documents via frappe's own machinery (Sum over
	Sales/Purchase Invoice / Bin). No demo numbers.
	"""
	cards = [
		("فروش کل", "Sales Invoice", "base_grand_total", [["docstatus", "=", 1]]),
		("خرید کل", "Purchase Invoice", "base_grand_total", [["docstatus", "=", 1]]),
		("دریافتنی", "Sales Invoice", "outstanding_amount", [["docstatus", "=", 1], ["outstanding_amount", ">", 0]]),
		("پرداختنی", "Purchase Invoice", "outstanding_amount", [["docstatus", "=", 1], ["outstanding_amount", ">", 0]]),
		("ارزش موجودی", "Bin", "stock_value", []),
	]
	created = []
	for label, doctype, based_on, filters in cards:
		if not frappe.db.exists("Number Card", label):
			frappe.get_doc({
				"doctype": "Number Card",
				"label": label,
				"type": "Document Type",
				"document_type": doctype,
				"function": "Sum",
				"aggregate_function_based_on": based_on,
				"filters_json": frappe.as_json(filters),
				"is_public": 1,
			}).insert(ignore_permissions=True)
			created.append(label)

	chart_name = "فروش ماهانه"
	if not frappe.db.exists("Dashboard Chart", chart_name):
		frappe.get_doc({
			"doctype": "Dashboard Chart",
			"chart_name": chart_name,
			"chart_type": "Sum",
			"document_type": "Sales Invoice",
			"based_on": "posting_date",
			"value_based_on": "base_grand_total",
			"group_by_type": "Sum",
			"time_interval": "Monthly",
			"timeseries": 1,
			"filters_json": frappe.as_json([["docstatus", "=", 1]]),
			"is_public": 1,
		}).insert(ignore_permissions=True)

	dash_name = "فردا — مدیریت"
	if not frappe.db.exists("Dashboard", dash_name):
		frappe.get_doc({
			"doctype": "Dashboard",
			"dashboard_name": dash_name,
			"module": "Farda Iran",
			"charts": [{"chart": chart_name}],
			"cards": [{"card": label} for label, *_ in cards],
		}).insert(ignore_permissions=True)


def get_item_tax_template_names(company: str) -> dict:
	"""Template names for a company (used by tests/reporting)."""
	out = {}
	for title, key in (("Farda VAT", "vat"), ("Farda Exempt 0%", "exempt")):
		out[key] = frappe.db.get_value("Item Tax Template", {"title": title, "company": company}, "name")
	return out


def ensure_vat_settings_defaults() -> None:
	"""Seed the VAT singleton with the default 10% rate (once)."""
	if not frappe.db.exists("DocType", "Farda VAT Settings"):
		return
	if not frappe.db.get_single_value("Farda VAT Settings", "default_rate"):
		frappe.db.set_single_value("Farda VAT Settings", "enabled", 1)
		frappe.db.set_single_value("Farda VAT Settings", "default_rate", 10.0)
	# CORE-029: a company created from the Iranian chart already has the VAT
	# account (210301); pick it so VAT works without a manual setup step.
	if not frappe.db.get_single_value("Farda VAT Settings", "vat_account"):
		company = frappe.defaults.get_global_default("company")
		filters = {"account_type": "Tax", "is_group": 0, "account_number": "210301"}
		if company:
			filters["company"] = company
		account = frappe.db.get_value("Account", filters, "name")
		if account:
			frappe.db.set_single_value("Farda VAT Settings", "vat_account", account)


def ensure_ui_assets() -> None:
	"""Verify the Desk assets are reachable (CORE-016).

	The JS/CSS/fonts live in erpnext/public/farda_iran/, which Frappe serves at
	/assets/erpnext/farda_iran/ through the standard app-assets link and which
	the Docker build copies into the nginx image. Nothing needs copying at
	migrate time any more (the old copy into sites/assets never reached the
	nginx container, so Docker deployments rendered without RTL/fonts).
	"""
	public = frappe.get_app_path("erpnext", "public", "farda_iran")
	for rel in ("js/farda_ui.js", "css/farda_rtl.css", "css/farda_design.css"):
		if not os.path.exists(os.path.join(public, rel)):
			frappe.log_error(f"farda_iran: missing UI asset {rel}")


BRAND_NAME = "سیمراکس"
BRAND = "/assets/erpnext/farda_iran/brand/"


def ensure_brand() -> None:
	"""SIMORAX name and logo in the desk navbar, login page, tab title and favicon
	(CORE-039). Fills only values that are empty or still point at the stock
	ERPNext/Frappe assets, so a logo the customer uploads later is kept."""

	def stock(value) -> bool:
		v = (value or "").lower()
		return not v or "erpnext" in v or "frappe-framework" in v or "/frappe/images/" in v

	wanted = {
		"Website Settings": {
			"app_name": BRAND_NAME,
			"app_logo": BRAND + "simorax-app-icon.svg",
			"favicon": BRAND + "favicon-32.png",
			"splash_image": BRAND + "simorax-logo-stacked-on-light.svg",
		},
		"Navbar Settings": {"app_logo": BRAND + "simorax-app-icon.svg"},
	}
	for doctype, values in wanted.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		meta = frappe.get_meta(doctype)
		for field, value in values.items():
			if not meta.has_field(field):
				continue
			current = frappe.db.get_single_value(doctype, field)
			if field == "app_name":
				if current in (None, "", "ERPNext", "Frappe", "FardaERP", "فردا ERP"):
					frappe.db.set_single_value(doctype, field, value)
			elif stock(current):
				frappe.db.set_single_value(doctype, field, value)
	for name in ("FardaERP",):
		if frappe.db.exists("Workspace", name):
			frappe.db.set_value("Workspace", name, "title", BRAND_NAME, update_modified=False)
		if frappe.db.exists("DocType", "Workspace Sidebar") and frappe.db.exists("Workspace Sidebar", name):
			frappe.db.set_value("Workspace Sidebar", name, "title", BRAND_NAME, update_modified=False)
		if frappe.db.exists("DocType", "Desktop Icon") and frappe.db.exists("Desktop Icon", name):
			meta = frappe.get_meta("Desktop Icon")
			values = {f: v for f, v in (("label", BRAND_NAME), ("logo_url", BRAND + "simorax-app-icon.svg")) if meta.has_field(f)}
			frappe.db.set_value("Desktop Icon", name, values, update_modified=False)
			frappe.cache.delete_key("desktop_icons")
	frappe.clear_cache()


def ensure_audit_index() -> None:
	"""Composite index for audit lookups (subject filters + retention sweeps)."""
	try:
		frappe.db.add_index("Farda Audit Log", ["subject_doctype", "subject_name"])
	except Exception:
		frappe.log_error("farda_iran: audit index ensure failed")  # non-fatal


def ensure_flags() -> None:
	"""7 subsystem Check flags on System Settings (farda_enable_*, default ON)."""
	from erpnext.farda_iran.flags.service import ensure_flags as _ensure

	_ensure()


def before_migrate(**_kwargs) -> None:
	execute()


def after_install(**_kwargs) -> None:
	"""bench new-site / install-app (CORE-020)."""
	execute()


def after_migrate(**_kwargs) -> None:
	execute()  # second pass: new DocTypes/fields from this release now exist


def ensure_workspace() -> None:
	"""§5 IA — public «FardaERP» workspace (Persian business navigation).

	Idempotent: create once, then only refresh the shortcut list if missing
	entries are added in later releases (existing user order preserved).
	Real-data Number Cards + chart are embedded via their stored names
	(ensure_dashboards). No fake data; frappe enforces per-shortcut permissions.
	"""
	from frappe.desk.doctype.workspace.workspace import Workspace

	name = "FardaERP"
	shortcuts = [
		# (label, type, target)
		("مشتریان", "DocType", "Customer"),
		("سفارش‌های فروش", "DocType", "Sales Order"),
		("فاکتورهای فروش", "DocType", "Sales Invoice"),
		("دریافت‌ها", "DocType", "Payment Entry"),
		("تأمین‌کنندگان", "DocType", "Supplier"),
		("سفارش‌های خرید", "DocType", "Purchase Order"),
		("فاکتورهای خرید", "DocType", "Purchase Invoice"),
		("کالاها", "DocType", "Item"),
		("اسناد انبار (ورود/خروج/انتقال)", "DocType", "Stock Entry"),
		("موجودی کالا", "Report", "Farda Stock Balance"),
		("دفتر کل", "Report", "Farda General Ledger"),
		("تراز آزمایشی", "Report", "Farda Trial Balance"),
		("سود و زیان", "Report", "Farda Profit and Loss"),
		("ترازنامه", "Report", "Farda Balance Sheet"),
		("جریان وجوه نقد", "Report", "Farda Cash Flow"),
		("حساب‌های بانکی", "DocType", "Bank Account"),
		("گزارش بانک", "Report", "Farda Bank Report"),
		("چک‌ها", "DocType", "Cheque"),
		("گزارش چک", "Report", "Farda Cheque Report"),
		("گزارش فروش", "Report", "Farda Sales Register"),
		("گزارش خرید", "Report", "Farda Purchase Register"),
		("گزارش مالیات بر ارزش افزوده", "Report", "Farda VAT Report"),
		("مانده طرف‌حساب‌ها", "Report", "Farda Party Balance"),
	]
	# CORE-022: the workspace's job in v16 is the sidebar + desktop icon; its page
	# redirects to the «سیمراکس» home (farda_ui.js). Content is kept to valid
	# shortcut blocks only — the old number-card/chart blocks had no matching child
	# rows, which made Frappe v16 render an empty page.
	content = [{"id": "farda_h1", "type": "header", "data": {"text": "<span class=\"h4\"><b>سیمراکس</b></span>", "col": 12}}]
	content += [
		{"id": f"farda_sc{i}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 3}}
		for i, (lbl, _t, _x) in enumerate(shortcuts)
	]
	if frappe.db.exists("Workspace", name):
		doc = frappe.get_doc("Workspace", name)
		existing = {(s.label, s.type, s.link_to) for s in (doc.shortcuts or [])}
		for label, stype, target in shortcuts:
			if (label, stype, target) not in existing:
				doc.append("shortcuts", {"label": label, "type": stype, "link_to": target})
		doc.title = BRAND_NAME
		doc.content = frappe.as_json(content)
		doc.save(ignore_permissions=True)
		_ensure_desktop_icon(name)
		return

	doc = frappe.get_doc({
		"doctype": "Workspace",
		"name": name,
		"label": name,
		"title": BRAND_NAME,
		"module": "Farda Iran",
		"public": 1,
		"content": frappe.as_json(content),
	})
	for lbl, stype, target in shortcuts:
		doc.append("shortcuts", {"label": lbl, "type": stype, "link_to": target})
	doc.insert(ignore_permissions=True)
	_ensure_desktop_icon(name)


# Persian sidebar (Frappe v16 Workspace Sidebar): the navigation a user keeps
# while working — home first, then one collapsible section per business area.
SIDEBAR = [
	("صفحهٔ اصلی", "Page", "farda-home", "home", None),
	("فروش و مشتریان", None, None, "sell", [
		("مشتریان", "DocType", "Customer"),
		("پیش‌فاکتورها", "DocType", "Quotation"),
		("سفارش‌های فروش", "DocType", "Sales Order"),
		("ویزیتور (موبایل)", "Page", "farda-visitor"),
		("فاکتورهای فروش", "DocType", "Sales Invoice"),
		("گزارش فروش", "Report", "Farda Sales Register"),
	]),
	("خرید و تأمین‌کنندگان", None, None, "buying", [
		("تأمین‌کنندگان", "DocType", "Supplier"),
		("درخواست‌های کالا", "DocType", "Material Request"),
		("سفارش‌های خرید", "DocType", "Purchase Order"),
		("فاکتورهای خرید", "DocType", "Purchase Invoice"),
		("گزارش خرید", "Report", "Farda Purchase Register"),
	]),
	("انبار و کالا", None, None, "stock", [
		("کالاها", "DocType", "Item"),
		("انبارها", "DocType", "Warehouse"),
		("اسناد انبار", "DocType", "Stock Entry"),
		("موجودی کالا", "Report", "Farda Stock Balance"),
		("کاردکس کالا", "Report", "Farda Stock Movement"),
	]),
	("بانک و چک", None, None, "dollar-sign", [
		("حساب‌های بانکی", "DocType", "Bank Account"),
		("چک‌ها", "DocType", "Cheque"),
		("دریافت و پرداخت", "DocType", "Payment Entry"),
		("گزارش بانک", "Report", "Farda Bank Report"),
		("گزارش چک", "Report", "Farda Cheque Report"),
	]),
	("حسابداری", None, None, "accounting", [
		("سرفصل حساب‌ها", "DocType", "Account"),
		("اسناد حسابداری", "DocType", "Journal Entry"),
		("دفتر کل", "Report", "Farda General Ledger"),
		("تراز آزمایشی", "Report", "Farda Trial Balance"),
		("سود و زیان", "Report", "Farda Profit and Loss"),
		("ترازنامه", "Report", "Farda Balance Sheet"),
		("جریان وجوه نقد", "Report", "Farda Cash Flow"),
		("مانده طرف‌حساب‌ها", "Report", "Farda Party Balance"),
	]),
	("مالیات بر ارزش افزوده", None, None, "book-text", [
		("تنظیمات ارزش افزوده", "DocType", "Farda VAT Settings"),
		("قالب‌های مالیاتی کالا", "DocType", "Item Tax Template"),
		("گزارش ارزش افزوده", "Report", "Farda VAT Report"),
	]),
	("حقوق و دستمزد", None, None, "users", [
		("کارکنان", "DocType", "Employee"),
		("تخصیص ساختار حقوق (مزد روزانه)", "DocType", "Salary Structure Assignment"),
		("محاسبه حقوق ماهانه", "DocType", "Payroll Entry"),
		("فیش‌های حقوق", "DocType", "Salary Slip"),
		("لیست حقوق", "Report", "Farda Payroll Register"),
		("لیست بیمه", "Report", "Farda Insurance List"),
		("لیست مالیات حقوق", "Report", "Farda Salary Tax List"),
		("عیدی و سنوات", "Report", "Farda Eid Severance"),
		("نرخ‌های قانونی سال", "DocType", "Farda Payroll Year"),
	]),
	("دارایی‌های ثابت", None, None, "assets", [
		("دارایی‌ها", "DocType", "Asset"),
		("گروه‌های دارایی (جدول استهلاک)", "DocType", "Asset Category"),
		("ثبت استهلاک ماهانه", "DocType", "Asset Depreciation Schedule"),
		("دفتر دارایی‌های ثابت", "Report", "Fixed Asset Register"),
	]),
	("سامانه مودیان", None, None, "upload", [
		("ارسال‌های سامانه مودیان", "DocType", "Farda Moadian Log"),
		("تنظیمات سامانه مودیان", "DocType", "Farda Moadian Settings"),
		("فاکتورهای فروش", "DocType", "Sales Invoice"),
	]),
	("تنظیمات", None, None, "setting", [
		("شرکت‌ها", "DocType", "Company"),
		("کاربران", "DocType", "User"),
		("تراکنش‌های درگاه", "DocType", "Farda Payment Log"),
		("گزارش ممیزی", "DocType", "Farda Audit Log"),
	]),
]


def ensure_sidebar(name: str = "FardaERP") -> None:
	"""(Re)build the Persian Workspace Sidebar from SIDEBAR (CORE-022)."""
	if not frappe.db.exists("DocType", "Workspace Sidebar"):
		return  # Frappe < v16
	doc = frappe.get_doc("Workspace Sidebar", name) if frappe.db.exists("Workspace Sidebar", name) else frappe.new_doc("Workspace Sidebar")
	doc.title = BRAND_NAME
	doc.header_icon = "home"
	doc.set("items", [])
	for label, link_type, link_to, icon, children in SIDEBAR:
		if children is None:
			if link_type == "Page" and not frappe.db.exists("Page", link_to):
				continue
			doc.append("items", {"type": "Link", "label": label, "link_type": link_type, "link_to": link_to, "icon": icon})
			continue
		rows = [c for c in children if frappe.db.exists(c[1] if c[1] in ("Report", "Page") else "DocType", c[2])]
		if not rows:
			continue
		doc.append("items", {"type": "Section Break", "label": label, "icon": icon, "collapsible": 1, "indent": 1, "keep_closed": 1})
		for clabel, ctype, ctarget in rows:
			doc.append("items", {"type": "Link", "label": clabel, "link_type": ctype, "link_to": ctarget, "child": 1})
	doc.save(ignore_permissions=True) if not doc.is_new() else doc.insert(ignore_permissions=True)


def _ensure_desktop_icon(workspace: str) -> None:
	"""Frappe v16 shows only Desktop Icons on /desk; a public workspace without an
	icon (and a Workspace Sidebar) is invisible there (CORE-020). Put «سیمراکس»
	first on the desktop so users start from the Persian navigation."""
	if not frappe.db.exists("DocType", "Desktop Icon"):
		return  # Frappe < v16
	from frappe.desk.doctype.desktop_icon.desktop_icon import add_workspace_to_desktop

	add_workspace_to_desktop(workspace)
	ensure_sidebar(workspace)
	frappe.db.set_value(
		"Desktop Icon", workspace, {"idx": -1, "hidden": 0, "icon": "home", "bg_color": "blue"}
	)
	frappe.cache.delete_key("desktop_icons")


def ensure_irr_format() -> None:
	"""Rial has no fractional unit: show 3,300,000 not 3,300,000.00 (CORE-025)."""
	if frappe.db.exists("Currency", "IRR"):
		frappe.db.set_value(
			"Currency",
			"IRR",
			{"number_format": "#,###", "fraction": "", "fraction_units": 0, "smallest_currency_fraction_value": 0},
		)
		# make Frappe use each currency's own format (IRR: no decimals, USD keeps cents)
		frappe.db.set_single_value("System Settings", "use_number_format_from_currency", 1)


def ensure_payroll() -> None:
	"""Iranian payroll needs HRMS: seed the 1405 figures and the statutory components."""
	if not (frappe.db.exists("DocType", "Salary Component") and frappe.db.exists("DocType", "Farda Payroll Year")):
		return
	meta = frappe.get_meta("Salary Component", cached=False)
	if not meta.has_field("farda_payroll_key"):
		return  # custom fields arrive in the after_migrate pass
	from erpnext.farda_iran.payroll.setup import ensure_components, ensure_year

	ensure_year(1405)
	ensure_components()
	# Persian payslip as the default print for Salary Slip (only if nobody chose another)
	if frappe.db.exists("Print Format", "Farda Persian Payslip") and not frappe.get_meta("Salary Slip").default_print_format:
		from frappe.custom.doctype.property_setter.property_setter import make_property_setter

		make_property_setter("Salary Slip", None, "default_print_format", "Farda Persian Payslip", "Data", for_doctype=True)


def after_app_install(app_name: str | None = None, **_kwargs) -> None:
	"""HRMS installed after ERPNext on a new site: add the payroll fields then."""
	if app_name == "hrms":
		execute()


def execute() -> str:
	ensure_custom_fields()
	ensure_irr_format()
	try:
		ensure_payroll()
	except Exception:
		frappe.log_error("farda_iran: payroll setup failed")  # non-fatal
	try:
		from erpnext.farda_iran.assets.depreciation import ensure_categories

		for company in frappe.get_all("Account", filters={"account_number": "120201"}, pluck="company"):
			ensure_categories(company)
	except Exception:
		frappe.log_error("farda_iran: asset categories setup failed")  # non-fatal
	ensure_moadian_defaults()
	ensure_levies_accounts()
	ensure_vat_settings_defaults()
	ensure_vat_item_tax_templates()
	ensure_search_keys()
	ensure_audit_index()
	ensure_flags()
	try:
		ensure_dashboards()
	except Exception:
		frappe.log_error("farda_iran: dashboard setup failed")  # non-fatal
	try:
		ensure_workspace()
	except Exception:
		frappe.log_error("farda_iran: workspace setup failed")  # non-fatal
	try:
		ensure_brand()
	except Exception:
		frappe.log_error("farda_iran: brand setup failed")  # non-fatal
	try:
		ensure_ui_assets()
	except Exception:
		frappe.log_error("farda_iran: UI asset copy failed")  # non-fatal outside a site
	frappe.clear_cache()
	return "farda_iran setup applied (custom fields + VAT defaults + UI assets)"
