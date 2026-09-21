# Copyright (c) 2026, FardaERP and contributors
# Iranian Balance Sheet presentation layer — as-on-date balances per account
# grouped by root type (Asset / Liability / Equity) plus the period net profit
# line, so the statement balances: Assets = Liabilities + Equity + Profit.
# Toman amounts; read-only; static parameterized SQL only.

import frappe
from frappe import _

_SQL = """
select
	gle.account                           as account,
	coalesce(a.account_name, gle.account) as account_name,
	a.root_type                           as root_type,
	sum(gle.debit)                        as debit,
	sum(gle.credit)                       as credit
from `tabGL Entry` gle
join `tabAccount` a on a.name = gle.account
where coalesce(gle.is_cancelled, 0) = 0
  and gle.company = %(company)s
  and gle.posting_date <= %(as_on)s
  and a.root_type in ('Asset', 'Liability', 'Equity')
  and ( %(root_type)s is null or a.root_type = %(root_type)s )
group by gle.account, a.account_name, a.root_type
order by a.root_type, gle.account
"""

# natural balance sign per root type
_SIGN = {"Asset": 1, "Liability": -1, "Equity": -1}


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("حساب"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 280},
		{"label": _("نام حساب"), "fieldname": "account_name", "width": 220},
		{"label": _("گروه"), "fieldname": "farda_section", "width": 110},
		{"label": _("مانده (تومان)"), "fieldname": "farda_balance", "width": 170},
	]

	company = filters.get("company")
	if not company:
		frappe.throw(_("فیلتر «شرکت» الزامی است"))

	rows = frappe.db.sql(_SQL, {
		"company": company,
		"as_on": filters.get("as_on") or frappe.utils.nowdate(),
		"root_type": filters.get("root_type") or None,
	}, as_dict=True)

	sections = {
		"Asset": (_("دارایی‌ها"), 0.0),
		"Liability": (_("بدهی‌ها"), 0.0),
		"Equity": (_("حقوق صاحبان سهام"), 0.0),
	}
	data = []
	for r in rows:
		sign = _SIGN.get(r.root_type, 1)
		balance = sign * (frappe.utils.flt(r.debit) - frappe.utils.flt(r.credit))
		label, total = sections[r.root_type]
		sections[r.root_type] = (label, total + balance)
		data.append({
			"account": r.account,
			"account_name": r.account_name or "",
			"farda_section": label,
			"farda_balance": fa(toman_str(balance, with_unit=False)) if balance else "-",
		})

	# net profit of all periods up to as_on (income - expense) closes into equity
	pnl = frappe.db.sql(
		"""
		select sum(case when a.root_type = 'Income' then gle.credit - gle.debit else -(gle.debit - gle.credit) end) as profit
		from `tabGL Entry` gle
		join `tabAccount` a on a.name = gle.account
		where coalesce(gle.is_cancelled, 0) = 0
		  and gle.company = %(company)s
		  and gle.posting_date <= %(as_on)s
		  and a.root_type in ('Income', 'Expense')
		""",
		{"company": company, "as_on": filters.get("as_on") or frappe.utils.nowdate()},
		as_dict=True,
	)
	profit = frappe.utils.flt(pnl[0].profit) if pnl else 0.0

	as_on_label = format_jalali_date(filters.get("as_on") or frappe.utils.nowdate())
	for key in ("Asset", "Liability", "Equity"):
		label, total = sections[key]
		data.append({
			"account": label,
			"account_name": "",
			"farda_section": _("جمع"),
			"farda_balance": fa(toman_str(total, with_unit=False)),
		})
	data.append({
		"account": _("سود (زیان) انباشته دوره‌ها"),
		"account_name": "",
		"farda_section": _("حقوق صاحبان سهام"),
		"farda_balance": fa(toman_str(profit, with_unit=False)),
	})
	data.append({
		"account": _("تراز ترازنامه"),
		"account_name": f"{_('تا تاریخ')} {as_on_label}",
		"farda_section": _("دارایی‌ها = بدهی‌ها + حقوق صاحبان سهام"),
		"farda_balance": fa(toman_str(sections["Asset"][1], with_unit=False)),
	})
	return columns, data
