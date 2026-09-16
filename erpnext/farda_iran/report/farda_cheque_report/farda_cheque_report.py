# Copyright (c) 2026, FardaERP and contributors
# Iranian cheque report — real Cheque rows: direction/status/party/due/amount,
# Jalali dates, Toman amounts, Persian digits, days-to-due (منفی = معوق).

import datetime

import frappe
from frappe import _

STATUS_FA = {
	"Received": "دریافتی",
	"Issued": "صادره",
	"Deposited": "خرج‌شده",
	"Cleared": "پاس‌شده",
	"Returned": "برگشتی",
	"Cancelled": "باطل",
}


def execute(filters=None):
	filters = frappe._dict(filters or {})
	conditions = ""
	params: dict = {}
	if filters.get("company"):
		conditions += " and company = %(company)s"
		params["company"] = filters.company
	if filters.get("direction"):
		conditions += " and direction = %(direction)s"
		params["direction"] = filters.direction
	if filters.get("status"):
		conditions += " and status = %(status)s"
		params["status"] = filters.status
	if filters.get("party"):
		conditions += " and party = %(party)s"
		params["party"] = filters.party
	if filters.get("due_until"):
		conditions += " and due_date <= %(due_until)s"
		params["due_until"] = filters.due_until

	rows = frappe.db.sql(
		f"""
		select name, direction, status, cheque_number, bank, amount,
		       due_date, party_type, party, payment_entry
		from `tabCheque`
		where status != 'Cancelled'{conditions}
		order by due_date asc, name asc
		""",
		params,
		as_dict=True,
	)

	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("چک"), "fieldname": "name", "fieldtype": "Link", "options": "Cheque", "width": 150},
		{"label": _("شماره چک"), "fieldname": "cheque_number", "width": 130},
		{"label": _("نوع"), "fieldname": "farda_direction", "width": 80},
		{"label": _("وضعیت"), "fieldname": "farda_status", "width": 100},
		{"label": _("بانک"), "fieldname": "bank", "width": 150},
		{"label": _("طرف‌حساب"), "fieldname": "party", "width": 180},
		{"label": _("سررسید"), "fieldname": "farda_due", "width": 110},
		{"label": _("روز تا سررسید"), "fieldname": "days_to_due", "width": 110},
		{"label": _("مبلغ (تومان)"), "fieldname": "farda_amount", "width": 150},
		{"label": _("سند پرداخت"), "fieldname": "payment_entry", "fieldtype": "Link", "options": "Payment Entry", "width": 170},
	]

	today = frappe.utils.getdate(frappe.utils.today())
	data = []
	total_amount = 0.0
	open_count = 0
	for r in rows:
		amount = frappe.utils.flt(r.amount)
		total_amount += amount
		if r.status in ("Received", "Issued", "Deposited", "Returned"):
			open_count += 1
		due = frappe.utils.getdate(r.due_date) if r.due_date else None
		days = (due - today).days if due else None
		is_overdue = days is not None and days < 0
		data.append({
			"name": r.name,
			"cheque_number": r.cheque_number or "-",
			"farda_direction": _("دریافتی") if r.direction == "Received" else _("صادره"),
			"farda_status": _(STATUS_FA.get(r.status, r.status or "")),
			"bank": r.bank or "-",
			"party": r.party or "-",
			"farda_due": format_jalali_date(due) if due else "-",
			"days_to_due": (fa(days) + (" (معوق)" if is_overdue else "")) if days is not None else "-",
			"farda_amount": fa(toman_str(amount, persian_digits=True, with_unit=False)),
			"payment_entry": r.payment_entry or "",
			"_amount": amount,
		})

	for d in data:
		d.pop("_amount")

	data.append({
		"name": _("جمع"),
		"cheque_number": "",
		"farda_direction": "",
		"farda_status": f"{fa(open_count)} " + _("چک باز"),
		"bank": "",
		"party": "",
		"farda_due": "",
		"days_to_due": "",
		"farda_amount": fa(toman_str(total_amount, persian_digits=True, with_unit=False)),
		"payment_entry": "",
	})
	return columns, data
