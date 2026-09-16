# Copyright (c) 2026, FardaERP and contributors
# Iranian General Ledger presentation layer — GL Entry rows with Jalali dates,
# Toman amounts (Persian digits) and Persian labels. Read-only over the
# standard GL; all IRR→Toman conversion goes through the central currency
# service (toman_str), never an inline /10.

import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("تاریخ"), "fieldname": "farda_date", "width": 110},
		{"label": _("حساب"), "fieldname": "account", "fieldtype": "Link", "options": "Account", "width": 240},
		{"label": _("نوع طرف‌حساب"), "fieldname": "party_type", "width": 110},
		{"label": _("طرف‌حساب"), "fieldname": "party", "fieldtype": "Dynamic Link", "options": "party_type", "width": 180},
		{"label": _("نوع سند"), "fieldname": "voucher_type", "width": 140},
		{"label": _("شماره سند"), "fieldname": "voucher_no", "width": 200},
		{"label": _("شرح"), "fieldname": "remarks", "width": 220},
		{"label": _("بدهکار (تومان)"), "fieldname": "farda_debit", "width": 150},
		{"label": _("بستانکار (تومان)"), "fieldname": "farda_credit", "width": 150},
		{"label": _("مانده (تومان)"), "fieldname": "farda_balance", "width": 150},
	]

	conditions = "and company = %(company)s"
	params: dict = {"company": filters.company}
	if filters.get("account"):
		conditions += " and account = %(account)s"
		params["account"] = filters.account
	if filters.get("party_type"):
		conditions += " and party_type = %(party_type)s"
		params["party_type"] = filters.party_type
	if filters.get("party"):
		conditions += " and party = %(party)s"
		params["party"] = filters.party
	if filters.get("voucher_type"):
		conditions += " and voucher_type = %(voucher_type)s"
		params["voucher_type"] = filters.voucher_type
	if filters.get("from_date"):
		conditions += " and posting_date >= %(from_date)s"
		params["from_date"] = filters.from_date
	if filters.get("to_date"):
		conditions += " and posting_date <= %(to_date)s"
		params["to_date"] = filters.to_date

	rows = frappe.db.sql(
		f"""
		select posting_date, account, party_type, party, voucher_type, voucher_no,
		       remarks, debit, credit
		from `tabGL Entry`
		where coalesce(is_cancelled, 0) = 0 {conditions}
		order by posting_date, creation, name
		""",
		params,
		as_dict=True,
	)

	data = []
	balance = 0.0
	for r in rows:
		debit = frappe.utils.flt(r.debit)
		credit = frappe.utils.flt(r.credit)
		balance += debit - credit
		data.append({
			"farda_date": format_jalali_date(r.posting_date),
			"account": r.account,
			"party_type": r.party_type or "",
			"party": r.party or "",
			"voucher_type": r.voucher_type or "",
			"voucher_no": r.voucher_no or "",
			"remarks": r.remarks or "",
			"farda_debit": fa(toman_str(debit, with_unit=False)) if debit else "-",
			"farda_credit": fa(toman_str(credit, with_unit=False)) if credit else "-",
			"farda_balance": fa(toman_str(balance, with_unit=False)),
		})

	total_dr = sum(frappe.utils.flt(r.debit) for r in rows)
	total_cr = sum(frappe.utils.flt(r.credit) for r in rows)
	data.append({
		"farda_date": _("جمع"),
		"account": f"{fa(len(rows))} " + _("سطر"),
		"party_type": "",
		"party": "",
		"voucher_type": "",
		"voucher_no": "",
		"remarks": "",
		"farda_debit": fa(toman_str(total_dr, with_unit=False)),
		"farda_credit": fa(toman_str(total_cr, with_unit=False)),
		"farda_balance": fa(toman_str(total_dr - total_cr, with_unit=False)),
	})
	return columns, data
