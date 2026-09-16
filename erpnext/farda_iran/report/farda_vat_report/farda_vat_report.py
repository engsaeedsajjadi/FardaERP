# Copyright (c) 2026, FardaERP and contributors
# Iranian VAT report — real invoice tax rows (sales + purchase), Jalali dates,
# Toman amounts with Persian digits. No demo data; account comes from settings.

import frappe
from frappe import _


def _fetch(doctype: str, tax_table: str, party_field: str, vat: str, conditions: str, params: dict):
	return frappe.db.sql(
		f"""
		select si.name, si.posting_date, si.{party_field} as party,
		       si.base_net_total, t.rate, t.base_tax_amount
		from `tab{doctype}` si
		join `tab{tax_table}` t
		  on t.parent = si.name and t.parenttype = %(dt)s
		where si.docstatus = 1 and t.account_head = %(vat)s{conditions}
		order by si.posting_date asc, si.name asc
		""",
		{**params, "dt": doctype},
		as_dict=True,
	) or []


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str
	from erpnext.farda_iran.tax.service import get_settings

	settings = get_settings()
	vat_account = settings.vat_account

	columns = [
		{"label": _("نوع"), "fieldname": "kind", "width": 90},
		{
			"label": _("فاکتور"),
			"fieldname": "voucher",
			"fieldtype": "Dynamic Link",
			"options": "voucher_type",
			"width": 190,
		},
		{"label": _("تاریخ"), "fieldname": "farda_date", "width": 110},
		{"label": _("طرف‌حساب"), "fieldname": "party", "width": 200},
		{"label": _("مبلغ مشمول (تومان)"), "fieldname": "net", "width": 150},
		{"label": _("نرخ (٪)"), "fieldname": "rate", "width": 80},
		{"label": _("مالیات (تومان)"), "fieldname": "vat", "width": 150},
	]

	if not vat_account:
		return columns, []

	conditions = ""
	params: dict = {"vat": vat_account}
	if filters.get("company"):
		conditions += " and si.company = %(company)s"
		params["company"] = filters.company
	if filters.get("from_date"):
		conditions += " and si.posting_date >= %(from_date)s"
		params["from_date"] = filters.from_date
	if filters.get("to_date"):
		conditions += " and si.posting_date <= %(to_date)s"
		params["to_date"] = filters.to_date

	kind = filters.get("kind")
	blocks: list[tuple[bool, list]] = []
	if kind in (None, "", "Sales"):
		blocks.append((True, _fetch("Sales Invoice", "Sales Taxes and Charges", "customer", vat_account, conditions, params)))
	if kind in (None, "", "Purchase"):
		blocks.append((False, _fetch("Purchase Invoice", "Purchase Taxes and Charges", "supplier", vat_account, conditions, params)))

	data = []
	total_net = total_vat = 0.0
	count = 0
	for is_sales, rows in blocks:
		for r in rows:
			count += 1
			net = frappe.utils.flt(r.base_net_total)
			vat_amt = frappe.utils.flt(r.base_tax_amount)
			total_net += net
			total_vat += vat_amt
			data.append({
				"kind": _("فروش") if is_sales else _("خرید"),
				"voucher_type": "Sales Invoice" if is_sales else "Purchase Invoice",
				"voucher": r.name,
				"farda_date": format_jalali_date(r.posting_date),
				"party": r.party or "-",
				"net": fa(toman_str(net, persian_digits=True, with_unit=False)),
				"rate": fa("%g" % (r.rate or 0)),
				"vat": fa(toman_str(vat_amt, persian_digits=True, with_unit=False)),
				"_net": net,
				"_vat": vat_amt,
			})

	for d in data:
		d.pop("_net")
		d.pop("_vat")

	data.append({
		"kind": _("جمع"),
		"voucher_type": "",
		"voucher": "",
		"farda_date": f"{fa(count)} " + _("فاکتور"),
		"party": "",
		"net": fa(toman_str(total_net, persian_digits=True, with_unit=False)),
		"rate": "",
		"vat": fa(toman_str(total_vat, persian_digits=True, with_unit=False)),
	})
	return columns, data
