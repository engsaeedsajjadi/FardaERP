# Copyright (c) 2026, FardaERP and contributors
# Iranian AR/AP balance — real outstanding amounts per party (Toman, Persian),
# فاکتور counts and oldest due date (Jalali). No demo data.

import frappe
from frappe import _


def _party_rows(doctype: str, party_field: str, name_field: str, conditions: str, params: dict):
	return frappe.db.sql(
		f"""
		select {party_field} as party,
		       max({name_field}) as party_name,
		       count(name) as inv_count,
		       sum(outstanding_amount) as outstanding,
		       min(posting_date) as oldest_date
		from `tab{doctype}`
		where docstatus = 1 and outstanding_amount > 0{conditions}
		group by {party_field}
		order by outstanding desc
		""",
		params,
		as_dict=True,
	)


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from erpnext.farda_iran.invoice.persian import fa, format_jalali_date, toman_str

	columns = [
		{"label": _("نوع"), "fieldname": "kind", "width": 100},
		{
			"label": _("طرف‌حساب"),
			"fieldname": "party",
			"fieldtype": "Dynamic Link",
			"options": "party_type",
			"width": 220,
		},
		{"label": _("تعداد فاکتور"), "fieldname": "inv_count", "width": 110},
		{"label": _("قدیمی‌ترین فاکتور"), "fieldname": "farda_oldest", "width": 120},
		{"label": _("مانده (تومان)"), "fieldname": "farda_outstanding", "width": 170},
	]

	kind = filters.get("kind")  # "AR" | "AP" | ""/None → both
	conditions = ""
	params: dict = {}
	if filters.get("company"):
		conditions += " and company = %(company)s"
		params["company"] = filters.company
	if filters.get("party"):
		conditions += " and {pf} = %(party)s"

	blocks: list[tuple[str, str, str, str, list]] = []
	if kind in (None, "", "AR"):
		c = conditions.format(pf="customer")
		blocks.append(("AR", "Customer", "customer", "customer_name", _party_rows("Sales Invoice", "customer", "customer_name", c, params)))
	if kind in (None, "", "AP"):
		c = conditions.format(pf="supplier")
		blocks.append(("AP", "Supplier", "supplier", "supplier_name", _party_rows("Purchase Invoice", "supplier", "supplier_name", c, params)))

	data = []
	totals = {"AR": 0.0, "AP": 0.0}
	counts = {"AR": 0, "AP": 0}
	for key, party_type, party_field, name_field, rows in blocks:
		for r in rows:
			outstanding = frappe.utils.flt(r.outstanding)
			totals[key] += outstanding
			counts[key] += int(r.inv_count or 0)
			data.append({
				"kind": _("دریافتنی") if key == "AR" else _("پرداختنی"),
				"party_type": party_type,
				"party": r.party,
				"party_name": r.party_name,
				"inv_count": fa(int(r.inv_count or 0)),
				"farda_oldest": format_jalali_date(r.oldest_date) if r.oldest_date else "-",
				"farda_outstanding": fa(toman_str(outstanding, persian_digits=True, with_unit=False)),
				"_out": outstanding,
			})

	for d in data:
		d.pop("_out")

	total_ar = totals["AR"]
	total_ap = totals["AP"]
	data.append({
		"kind": _("جمع دریافتنی"),
		"party_type": "",
		"party": f"{fa(counts['AR'])} " + _("فاکتور"),
		"party_name": "",
		"inv_count": "",
		"farda_oldest": "",
		"farda_outstanding": fa(toman_str(total_ar, persian_digits=True, with_unit=False)),
	})
	data.append({
		"kind": _("جمع پرداختنی"),
		"party_type": "",
		"party": f"{fa(counts['AP'])} " + _("فاکتور"),
		"party_name": "",
		"inv_count": "",
		"farda_oldest": "",
		"farda_outstanding": fa(toman_str(total_ap, persian_digits=True, with_unit=False)),
	})
	data.append({
		"kind": _("خالص (دریافتنی − پرداختنی)"),
		"party_type": "",
		"party": "",
		"party_name": "",
		"inv_count": "",
		"farda_oldest": "",
		"farda_outstanding": fa(toman_str(total_ar - total_ap, persian_digits=True, with_unit=False)),
	})
	return columns, data
