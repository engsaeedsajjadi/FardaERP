# Copyright (c) 2026, FardaERP and contributors
# Iranian Bank Report presentation layer — bank-type accounts' position over
# a period: opening / debit / credit / closing per account (Toman), with the
# linked Bank Account number where one is mapped. Read-only; static
# parameterized SQL only.

import frappe
from frappe import _

_SQL = """
select
	gle.account                           as account,
	coalesce(a.account_name, gle.account) as account_name,
	a.account_type                        as account_type,
	sum(case when gle.posting_date < %(from_date)s then gle.debit - gle.credit else 0 end) as opening,
	sum(case when gle.posting_date >= %(from_date)s and gle.posting_date <= %(to_date)s then gle.debit else 0 end) as debit,
	sum(case when gle.posting_date >= %(from_date)s and gle.posting_date <= %(to_date)s then gle.credit else 0 end) as credit
from `tabGL Entry` gle
join `tabAccount` a on a.name = gle.account
where coalesce(gle.is_cancelled, 0) = 0
  and gle.company = %(company)s
  and gle.posting_date <= %(to_date)s
  and a.account_type = 'Bank'
  and ( %(account)s is null or gle.account = %(account)s )
group by gle.account, a.account_name, a.account_type
having sum(gle.debit) <> 0 or sum(gle.credit) <> 0
order by gle.account
"""


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("حساب بانک"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 260},
		{"label": _("نام حساب"), "fieldname": "account_name", "width": 190},
		{"label": _("افتتاحیه (تومان)"), "fieldname": "farda_opening", "width": 150},
		{"label": _("بدهکار دوره (تومان)"), "fieldname": "farda_debit", "width": 155},
		{"label": _("بستانکار دوره (تومان)"), "fieldname": "farda_credit", "width": 155},
		{"label": _("پایانی (تومان)"), "fieldname": "farda_closing", "width": 150},
	]

	company = filters.get("company")
	if not company:
		frappe.throw(_("فیلتر «شرکت» الزامی است"))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("«از تاریخ» و «تا تاریخ» الزامی است"))

	rows = frappe.db.sql(_SQL, {
		"company": company,
		"from_date": filters.from_date,
		"to_date": filters.to_date,
		"account": filters.get("account") or None,
	}, as_dict=True)

	data = []
	t_open = t_dr = t_cr = 0.0
	for r in rows:
		opening = frappe.utils.flt(r.opening)
		debit = frappe.utils.flt(r.debit)
		credit = frappe.utils.flt(r.credit)
		t_open += opening
		t_dr += debit
		t_cr += credit
		data.append({
			"account": r.account,
			"account_name": r.account_name or "",
			"farda_opening": fa(toman_str(opening, with_unit=False)) if opening else "-",
			"farda_debit": fa(toman_str(debit, with_unit=False)) if debit else "-",
			"farda_credit": fa(toman_str(credit, with_unit=False)) if credit else "-",
			"farda_closing": fa(toman_str(opening + debit - credit, with_unit=False)),
		})

	period_label = f"{format_jalali_date(filters.from_date)} — {format_jalali_date(filters.to_date)}"
	data.append({
		"account": _("جمع کل"),
		"account_name": period_label,
		"farda_opening": fa(toman_str(t_open, with_unit=False)),
		"farda_debit": fa(toman_str(t_dr, with_unit=False)),
		"farda_credit": fa(toman_str(t_cr, with_unit=False)),
		"farda_closing": fa(toman_str(t_open + t_dr - t_cr, with_unit=False)),
	})
	return columns, data
