# Copyright (c) 2026, FardaERP and contributors
# Iranian P&L presentation layer — period income/expense per account over
# GL Entry with Toman amounts and a net profit total row. Read-only; static
# parameterized SQL only. Presentation of the direct method (account-level
# totals), consistent with Farda Balance Sheet's net-profit line.

import frappe
from frappe import _

_SQL = """
select
	gle.account                        as account,
	coalesce(a.account_name, gle.account) as account_name,
	a.root_type                        as root_type,
	sum(gle.debit)                     as debit,
	sum(gle.credit)                    as credit
from `tabGL Entry` gle
join `tabAccount` a on a.name = gle.account
where coalesce(gle.is_cancelled, 0) = 0
  and gle.company = %(company)s
  and gle.posting_date >= %(from_date)s
  and gle.posting_date <= %(to_date)s
  and a.root_type in ('Income', 'Expense')
  and ( %(root_type)s is null or a.root_type = %(root_type)s )
group by gle.account, a.account_name, a.root_type
order by a.root_type desc, gle.account
"""


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("حساب"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 280},
		{"label": _("نام حساب"), "fieldname": "account_name", "width": 220},
		{"label": _("گروه"), "fieldname": "farda_section", "width": 90},
		{"label": _("مبلغ (تومان)"), "fieldname": "farda_amount", "width": 170},
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
		"root_type": filters.get("root_type") or None,
	}, as_dict=True)

	data = []
	t_income = 0.0
	t_expense = 0.0
	for r in rows:
		amount = frappe.utils.flt(r.credit) - frappe.utils.flt(r.debit)  # income: credit-debit
		if r.root_type == "Expense":
			amount = frappe.utils.flt(r.debit) - frappe.utils.flt(r.credit)  # expense: debit-credit
		if r.root_type == "Income":
			t_income += amount
		else:
			t_expense += amount
		data.append({
			"account": r.account,
			"account_name": r.account_name or "",
			"farda_section": _("درآمد") if r.root_type == "Income" else _("هزینه"),
			"farda_amount": fa(toman_str(amount, with_unit=False)) if amount else "-",
		})

	profit = t_income - t_expense
	period_label = f"{format_jalali_date(filters.from_date)} — {format_jalali_date(filters.to_date)}"
	data.append({
		"account": _("جمع درآمدها"),
		"account_name": period_label,
		"farda_section": "",
		"farda_amount": fa(toman_str(t_income, with_unit=False)),
	})
	data.append({
		"account": _("جمع هزینه‌ها"),
		"account_name": "",
		"farda_section": "",
		"farda_amount": fa(toman_str(t_expense, with_unit=False)),
	})
	data.append({
		"account": _("سود (زیان) خالص دوره"),
		"account_name": "",
		"farda_section": "",
		"farda_amount": fa(toman_str(profit, with_unit=False)),
	})
	return columns, data
