# Copyright (c) 2026, FardaERP and contributors
# Persian-first sales register: Jalali dates + Toman amounts + Persian digits.
# All conversion goes through the central jalali/currency services.

import frappe
from frappe import _


def execute(filters=None):
	filters = frappe._dict(filters or {})
	conditions = ""
	params: dict = {}
	if filters.get("from_date"):
		conditions += " and posting_date >= %(from_date)s"
		params["from_date"] = filters.from_date
	if filters.get("to_date"):
		conditions += " and posting_date <= %(to_date)s"
		params["to_date"] = filters.to_date
	rows = frappe.db.sql(
		f"""
		select name, posting_date, customer_name, base_net_total, base_grand_total,
		       total_taxes_and_charges, status, docstatus
		from `tabSales Invoice`
		where docstatus = 1{conditions}
		order by posting_date asc, name asc
		""",
		params,
		as_dict=True,
	)

	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("فاکتور"), "fieldname": "name", "fieldtype": "Link", "options": "Sales Invoice", "width": 190},
		{"label": _("تاریخ"), "fieldname": "farda_date", "width": 110},
		{"label": _("مشتری"), "fieldname": "customer_name", "width": 220},
		{"label": _("جمع (تومان)"), "fieldname": "farda_net", "width": 140},
		{"label": _("مالیات (تومان)"), "fieldname": "farda_tax", "width": 140},
		{"label": _("قابل پرداخت (تومان)"), "fieldname": "farda_grand", "width": 160},
		{"label": _("وضعیت"), "fieldname": "status", "width": 110},
	]

	data = []
	total_net = total_tax = total_grand = 0.0
	for r in rows:
		total_net += r.base_net_total or 0
		total_tax += r.total_taxes_and_charges or 0
		total_grand += r.base_grand_total or 0
		data.append({
			"name": r.name,
			"farda_date": format_jalali_date(r.posting_date),
			"customer_name": r.customer_name,
			"farda_net": fa(toman_str(r.base_net_total or 0, persian_digits=True, with_unit=False)),
			"farda_tax": fa(toman_str(r.total_taxes_and_charges or 0, persian_digits=True, with_unit=False)),
			"farda_grand": fa(toman_str(r.base_grand_total or 0, persian_digits=True, with_unit=False)),
			"status": _(r.status) if r.status else "",
		})

	data.append({
		"name": _("جمع"),
		"farda_date": "",
		"customer_name": f"{len(rows)} " + _("فاکتور"),
		"farda_net": fa(toman_str(total_net, persian_digits=True, with_unit=False)),
		"farda_tax": fa(toman_str(total_tax, persian_digits=True, with_unit=False)),
		"farda_grand": fa(toman_str(total_grand, persian_digits=True, with_unit=False)),
		"status": "",
	})
	return columns, data
