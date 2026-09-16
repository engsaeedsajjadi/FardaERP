# Copyright (c) 2026, FardaERP and contributors
# Iranian Trial Balance presentation layer — per-account opening / period
# debit / period credit / closing over GL Entry, with Jalali period labels and
# Toman amounts via the central currency service. Read-only; no core queries
# duplicated beyond the standard GL table.

import frappe
from frappe import _


def _sums(company, from_date=None, to_date=None, extra_condition: str = "", params_extra: dict | None = None):
	conditions = "and company = %(company)s"
	params: dict = {"company": company}
	if from_date:
		conditions += " and posting_date >= %(from_date)s"
		params["from_date"] = from_date
	if to_date:
		conditions += " and posting_date <= %(to_date)s"
		params["to_date"] = to_date
	conditions += extra_condition
	params.update(params_extra or {})
	rows = frappe.db.sql(
		f"""
		select account, sum(debit) as debit, sum(credit) as credit
		from `tabGL Entry`
		where coalesce(is_cancelled, 0) = 0 {conditions}
		group by account
		""",
		params,
		as_dict=True,
	)
	return {r.account: (frappe.utils.flt(r.debit), frappe.utils.flt(r.credit)) for r in rows}


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("حساب"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 300},
		{"label": _("نام حساب"), "fieldname": "account_name", "width": 200},
		{"label": _("نوع اصلی"), "fieldname": "root_type", "width": 110},
		{"label": _("افتتاحیه (تومان)"), "fieldname": "farda_opening", "width": 150},
		{"label": _("بدهکار دوره (تومان)"), "fieldname": "farda_debit", "width": 150},
		{"label": _("بستانکار دوره (تومان)"), "fieldname": "farda_credit", "width": 150},
		{"label": _("پایانی (تومان)"), "fieldname": "farda_closing", "width": 150},
	]

	company = filters.company
	extra = ""
	params_extra: dict = {}
	if filters.get("root_type"):
		extra = "and account in (select name from `tabAccount` where root_type = %(root_type)s)"
		params_extra["root_type"] = filters.root_type
	if filters.get("account"):
		extra += " and account = %(account)s"
		params_extra["account"] = filters.account

	opening = _sums(company, to_date=None if not filters.get("from_date") else _day_before(filters.from_date))
	period = _sums(company, from_date=filters.get("from_date"), to_date=filters.get("to_date"), extra_condition=extra, params_extra=params_extra)

	data = []
	t_open = t_dr = t_cr = t_close = 0.0
	for account, (dr, cr) in period.items():
		op_debit, op_credit = opening.get(account, (0.0, 0.0))
		open_bal = op_debit - op_credit
		closing = open_bal + dr - cr
		t_open += open_bal
		t_dr += dr
		t_cr += cr
		t_close += closing
		meta = frappe.db.get_value("Account", account, ["account_name", "root_type"], as_dict=True) or frappe._dict()
		data.append({
			"account": account,
			"account_name": meta.account_name or "",
			"root_type": meta.root_type or "",
			"farda_opening": fa(toman_str(open_bal, with_unit=False)) if open_bal else "-",
			"farda_debit": fa(toman_str(dr, with_unit=False)) if dr else "-",
			"farda_credit": fa(toman_str(cr, with_unit=False)) if cr else "-",
			"farda_closing": fa(toman_str(closing, with_unit=False)) if closing else "-",
		})

	data.sort(key=lambda r: r["account"])
	period_label = ""
	if filters.get("from_date") or filters.get("to_date"):
		start = format_jalali_date(filters.get("from_date")) if filters.get("from_date") else "…"
		end = format_jalali_date(filters.get("to_date")) if filters.get("to_date") else "…"
		period_label = f"{start} — {end}"
	data.append({
		"account": _("جمع کل"),
		"account_name": period_label,
		"root_type": "",
		"farda_opening": fa(toman_str(t_open, with_unit=False)),
		"farda_debit": fa(toman_str(t_dr, with_unit=False)),
		"farda_credit": fa(toman_str(t_cr, with_unit=False)),
		"farda_closing": fa(toman_str(t_close, with_unit=False)),
	})
	return columns, data


def _day_before(date_value):
	return frappe.utils.add_days(date_value, -1)
