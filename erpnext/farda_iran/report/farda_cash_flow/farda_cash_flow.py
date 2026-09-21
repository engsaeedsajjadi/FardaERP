# Copyright (c) 2026, FardaERP and contributors
# Iranian Cash Flow presentation layer — DIRECT cash-and-bank movement over a
# period per GL Entry: per cash/bank account opening / inflow / outflow /
# closing in Toman plus a period net row. Scope note: this is the direct
# cash-movement statement for Iranian books, NOT an indirect CFAS
# classification (operating/investing/financing) — reported honestly as such.
# Read-only; static parameterized SQL only.

import frappe
from frappe import _

_SQL = """
select
	gle.account                           as account,
	coalesce(a.account_name, gle.account) as account_name,
	a.account_type                        as account_type,
	sum(case when gle.posting_date < %(from_date)s then gle.debit - gle.credit else 0 end) as opening,
	sum(case when gle.posting_date >= %(from_date)s and gle.posting_date <= %(to_date)s then gle.debit else 0 end) as inflow,
	sum(case when gle.posting_date >= %(from_date)s and gle.posting_date <= %(to_date)s then gle.credit else 0 end) as outflow
from `tabGL Entry` gle
join `tabAccount` a on a.name = gle.account
where coalesce(gle.is_cancelled, 0) = 0
  and gle.company = %(company)s
  and gle.posting_date <= %(to_date)s
  and a.account_type in ('Cash', 'Bank')
  and ( %(account)s is null or gle.account = %(account)s )
group by gle.account, a.account_name, a.account_type
having sum(gle.debit) <> 0 or sum(gle.credit) <> 0
order by gle.account
"""


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("حساب"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 280},
		{"label": _("نام حساب"), "fieldname": "account_name", "width": 200},
		{"label": _("نوع"), "fieldname": "account_type", "width": 90},
		{"label": _("افتتاحیه (تومان)"), "fieldname": "farda_opening", "width": 150},
		{"label": _("ورود (تومان)"), "fieldname": "farda_inflow", "width": 150},
		{"label": _("خروج (تومان)"), "fieldname": "farda_outflow", "width": 150},
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
	t_open = t_in = t_out = 0.0
	for r in rows:
		opening = frappe.utils.flt(r.opening)
		inflow = frappe.utils.flt(r.inflow)
		outflow = frappe.utils.flt(r.outflow)
		t_open += opening
		t_in += inflow
		t_out += outflow
		data.append({
			"account": r.account,
			"account_name": r.account_name or "",
			"account_type": r.account_type or "",
			"farda_opening": fa(toman_str(opening, with_unit=False)) if opening else "-",
			"farda_inflow": fa(toman_str(inflow, with_unit=False)) if inflow else "-",
			"farda_outflow": fa(toman_str(outflow, with_unit=False)) if outflow else "-",
			"farda_closing": fa(toman_str(opening + inflow - outflow, with_unit=False)),
		})

	period_label = f"{format_jalali_date(filters.from_date)} — {format_jalali_date(filters.to_date)}"
	data.append({
		"account": _("جمع کل"),
		"account_name": period_label,
		"account_type": "",
		"farda_opening": fa(toman_str(t_open, with_unit=False)),
		"farda_inflow": fa(toman_str(t_in, with_unit=False)),
		"farda_outflow": fa(toman_str(t_out, with_unit=False)),
		"farda_closing": fa(toman_str(t_open + t_in - t_out, with_unit=False)),
	})
	return columns, data
